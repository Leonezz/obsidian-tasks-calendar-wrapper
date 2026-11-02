import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { abArgs, compareAb, parseBenchArgs, type Slot } from "../scripts/bench-ab.mjs";
import { benchVaultNotes, SAVE_MARKER, withSaveToken } from "../scripts/bench-notes.mjs";
import { heapAfterLoad, measureViewScenarios } from "../scripts/bench-scenarios.mjs";
import { viewPage, viewScenarioDeps } from "./bench-view-page";

import {
	assertToggleChanges,
	assertToggleRestored,
	clickResults,
	compare,
	countIgnoredClicks,
	counts,
	focusTodayResults,
	frameStats,
	paintedAfter,
	scrollResults,
	splitLoad,
	summary,
	type ClickStep,
} from "../scripts/bench-results.mjs";

// scripts/bench.mjs measures in a real Obsidian; what it makes of the raw times, and how it judges them against the
// baseline, is plain arithmetic in scripts/bench-results.mjs, tested here.

test("a summary has the median, the fastest and the slowest run, rounded to a tenth of a millisecond", () => {
	assert.deepEqual(summary([3, 1.04, 2]), { medianMs: 2, minMs: 1, maxMs: 3, samplesMs: [3, 1, 2] });
	assert.deepEqual(summary([4, 1, 2, 3]).medianMs, 2.5);
});

test("counts are summed up the same way, without units", () => {
	assert.deepEqual(counts([1, 3, 2]), { median: 2, min: 1, max: 3, samples: [1, 3, 2] });
});

test("a change is on screen when the first frame that starts after it is painted", () => {
	const frames = [
		{ startedAt: 5, paintedAt: 9 },
		{ startedAt: 12, paintedAt: 20 },
	];
	assert.equal(paintedAfter(frames, 10), 20);
	assert.equal(paintedAfter(frames, 5), 9);
	assert.throws(() => paintedAfter(frames, 13), /no frame was painted/);
});

test("a load's first render ends at the first pause, and what comes later is counted apart", () => {
	const raw = {
		rows: 120,
		filesRead: 2000,
		rowsAt: 100,
		// One render from 100 to 300, then two more after pauses of at least 500 ms.
		times: [50, 100, 200, 300, 900, 950, 1600],
		frames: [
			{ startedAt: 310, paintedAt: 400 },
			{ startedAt: 960, paintedAt: 1000 },
			{ startedAt: 1610, paintedAt: 1650 },
		],
		tasks: [
			{ start: 0, duration: 120 },
			{ start: 250, duration: 60 },
			{ start: 900, duration: 80 },
			{ start: 1600, duration: 70 },
		],
	};
	assert.deepEqual(splitLoad(raw, 500), {
		renderedMs: 400,
		rows: 120,
		filesRead: 2000,
		blockedMs: 180,
		longestMs: 120,
		longTasks: 2,
		laterRenders: 2,
		laterBlockedMs: 150,
		totalBlockedMs: 330,
	});
});

test("a load without task rows is an error", () => {
	assert.throws(
		() => splitLoad({ rows: 0, filesRead: 0, rowsAt: null, times: [1], frames: [], tasks: [] }, 500),
		/no task rows/,
	);
});

const timing = (minMs: number, medianMs = minMs) => ({ minMs, medianMs, maxMs: minMs, samplesMs: [minMs] });

function baselineWith(results: Record<string, Record<string, unknown>>) {
	return { results: { initialLoad: { rows: 100 }, saveWithoutTasks: { reloads: 0 }, ...results } };
}

function resultsWith(results: Record<string, Record<string, unknown>>) {
	return {
		initialLoad: { rows: 100 },
		saveWithoutTasks: { runs: 10, reloads: 0 },
		...results,
	};
}

test("a measurement is slower when its fastest run grew by more than 25 % and 50 ms", () => {
	const base = baselineWith({ saveWithTasks: { renderedMs: timing(200), blockedMs: timing(100) } });
	const slower = (renderedMs: number, blockedMs: number) =>
		compare(base, resultsWith({ saveWithTasks: { renderedMs: timing(renderedMs), blockedMs: timing(blockedMs) } }))
			.slower;
	assert.equal(slower(200, 100), 0);
	// 26 % and 52 ms more is slower; 24.5 % and 49 ms, under both limits, is not.
	assert.equal(slower(252, 100), 1);
	assert.equal(slower(249, 100), 0);
	// 40 % but only 40 ms more is not; 51 % and 51 ms is.
	assert.equal(slower(200, 140), 0);
	assert.equal(slower(200, 151), 1);
	assert.equal(slower(300, 160), 2);
	// 100 ms more but only 10 % is not slower either.
	const longer = baselineWith({ initialLoad: { rows: 100, renderedMs: timing(1000) } });
	const slowerLoad = (renderedMs: number) =>
		compare(longer, resultsWith({ initialLoad: { rows: 100, renderedMs: timing(renderedMs) } })).slower;
	assert.equal(slowerLoad(1100), 0);
	assert.equal(slowerLoad(1251), 1);
});

test("how long Obsidian takes to read a note is shown but not judged", () => {
	const base = baselineWith({ saveWithTasks: { indexedMs: timing(2) } });
	const result = compare(base, resultsWith({ saveWithTasks: { indexedMs: timing(500) } }));
	assert.equal(result.slower, 0);
	const line = result.lines.find((candidate) => candidate.includes("saveWithTasks.indexedMs"));
	assert.ok(line && !line.includes("SLOWER") && line.endsWith("  not judged"), line);
});

test("in the large vault, the work after a load's first render is shown but not judged; the whole load's work is", () => {
	// Whether the options push lands before the first render or after it is a race, which moved this by seconds
	// between runs of the same build in the 40,000-task vault.
	const base = baselineWith({
		initialLoad: { rows: 100, laterBlockedMs: timing(1658), totalBlockedMs: timing(1000) },
	});
	const result = compare(
		base,
		resultsWith({ initialLoad: { rows: 100, laterBlockedMs: timing(3488), totalBlockedMs: timing(1300) } }),
		10,
	);
	assert.equal(result.slower, 1);
	const later = result.lines.find((line) => line.includes("initialLoad.laterBlockedMs"));
	assert.ok(later && later.endsWith("  not judged"), later);
	const total = result.lines.find((line) => line.includes("initialLoad.totalBlockedMs"));
	assert.ok(total && total.endsWith("  SLOWER"), total);
});

test("in the 4,000-task vault, where it is steady, the work after a load's first render is judged", () => {
	const base = baselineWith({
		initialLoad: { rows: 100, laterBlockedMs: timing(230), totalBlockedMs: timing(1970) },
	});
	const result = compare(
		base,
		resultsWith({ initialLoad: { rows: 100, laterBlockedMs: timing(360), totalBlockedMs: timing(2100) } }),
	);
	assert.equal(result.slower, 1);
	const later = result.lines.find((line) => line.includes("initialLoad.laterBlockedMs"));
	assert.ok(later && later.endsWith("  SLOWER"), later);
	assert.equal(compare(base, resultsWith({ initialLoad: { rows: 100, laterBlockedMs: timing(360) } }), 1).slower, 1);
});

test("a measurement the baseline does not have is shown, not judged, and named in a warning", () => {
	const result = compare(
		baselineWith({}),
		resultsWith({ optionChange: { appliedMs: timing(300), blockedMs: timing(200), reloadCalls: counts([1]) } }),
	);
	assert.equal(result.slower, 0);
	const line = result.lines.find((candidate) => candidate.includes("optionChange.appliedMs"));
	assert.ok(line && line.endsWith("  no baseline"), line);
	assert.deepEqual(result.warnings, [
		"bench: warning: the baseline has no optionChange.appliedMs, optionChange.blockedMs; they are not judged until it is recorded again with `pnpm bench --update`.",
	]);
	assert.match(
		compare(baselineWith({}), resultsWith({ optionChange: { appliedMs: timing(300) } }), 10).warnings[0],
		/`pnpm bench --update --scale 10`/,
	);
});

test("counts such as the files read are shown next to the baseline's and not judged", () => {
	const base = baselineWith({ saveWithTasks: { filesRead: counts([2000]) } });
	const result = compare(base, resultsWith({ saveWithTasks: { filesRead: counts([1, 1]) } }));
	assert.equal(result.slower, 0);
	const line = result.lines.find((candidate) => candidate.includes("saveWithTasks.filesRead"));
	assert.ok(line && line.includes("2000") && line.includes("1"), line);
});

test("the table's columns line up, with and without a baseline", () => {
	const base = baselineWith({ saveWithTasks: { renderedMs: timing(200), filesRead: counts([2000]) } });
	const { lines } = compare(
		base,
		resultsWith({
			saveWithTasks: { renderedMs: timing(300), filesRead: counts([1]) },
			optionChange: { appliedMs: timing(600), externalSettingsCalls: counts([0]) },
		}),
	);
	const table = lines.map((line) => line.replace(/ {2}(SLOWER|not judged|no baseline)$/, ""));
	assert.equal(table.length, 5);
	assert.equal(new Set(table.map((line) => line.length)).size, 1, table.join("\n"));
});

test("a save without tasks that reloads the timeline counts as slower", () => {
	const result = compare(baselineWith({}), resultsWith({ saveWithoutTasks: { runs: 10, reloads: 2 } }));
	assert.equal(result.slower, 1);
	assert.ok(result.lines.some((line) => line.includes("reloaded the timeline 2 of 10 times")));
});

test("another number of task rows than the baseline's is a warning", () => {
	const result = compare(baselineWith({}), resultsWith({ initialLoad: { rows: 99 } }));
	assert.equal(result.slower, 0);
	assert.deepEqual(result.warnings, [
		"bench: warning: the timeline shows 99 task rows, the baseline 100; it renders something else now.",
	]);
});

const toggleOriginal = "# 今日\n\n- [ ] First\n- [ ] 保留 📝\n- [ ] Third\nUnchanged  \n";
const toggleWritten = toggleOriginal
	.replace("- [ ] First", "- [x] First ✅ 2026-01-15")
	.replace("- [ ] Third", "- [x] Third ✅ 2026-01-15");

test("toggle: exactly the ticked lines changed and every other byte is unchanged", () => {
	assert.doesNotThrow(() => assertToggleChanges(toggleOriginal, toggleWritten, [2, 4]));
	assert.doesNotThrow(() => assertToggleChanges(toggleOriginal.slice(0, -1), toggleWritten.slice(0, -1), [2, 4]));
	assert.throws(() => assertToggleChanges(toggleOriginal, toggleOriginal, [2, 4]), /line 3/);
	assert.throws(
		() => assertToggleChanges(toggleOriginal, toggleWritten.replace("[x] First", "[/] First"), [2, 4]),
		/line 3/,
	);
});

test("toggle: another changed line fails and names it", () => {
	assert.throws(
		() => assertToggleChanges(toggleOriginal, toggleWritten.replace("保留", "changed"), [2, 4]),
		/line 4.*changed/,
	);
	assert.throws(() => assertToggleChanges(toggleOriginal, toggleWritten.trimEnd(), [2, 4]), /line 6|line 7/);
});

test("toggle: a note that cannot be restored fails", () => {
	const path = "Reference/Note 0002.md";
	assert.doesNotThrow(() => assertToggleRestored(path, toggleOriginal, toggleOriginal));
	assert.throws(
		() => assertToggleRestored(path, toggleOriginal, toggleWritten),
		/could not restore.*Reference\/Note 0002\.md/,
	);
	assert.throws(
		() => assertToggleRestored(path, toggleOriginal, null),
		/could not restore.*Reference\/Note 0002\.md/,
	);
	assert.throws(() => assertToggleRestored(path, toggleOriginal, toggleOriginal.slice(0, -1)), /could not restore/);
});

test("toggle: ignored clicks are counted", () => {
	assert.equal(
		countIgnoredClicks([{ overlayMs: 0 }, { overlayMs: null }, { overlayMs: 25 }, { overlayMs: null }]),
		2,
	);
	assert.equal(countIgnoredClicks([{ overlayMs: 200 }]), 0);
	assert.equal(countIgnoredClicks([]), 0);
});

test("toggle: stored baselines without the scenario show no baseline and do not judge it", () => {
	const result = compare(
		baselineWith({}),
		resultsWith({ toggle: { overlayMs: timing(25), renderedMs: timing(1500), ignoredClicks: counts([1]) } }),
	);
	assert.equal(result.slower, 0);
	assert.match(result.lines.find((line) => line.includes("toggle.overlayMs")) ?? "", /no baseline$/);
	assert.match(result.lines.find((line) => line.includes("toggle.renderedMs")) ?? "", /no baseline$/);
	assert.match(result.lines.find((line) => line.includes("toggle.ignoredClicks")) ?? "", /\(count\).*-/);
});

test("the overlay paint timing is report-only against a stored baseline", () => {
	const base = baselineWith({ toggle: { overlayMs: timing(200), overlayPaintedMs: timing(200) } });
	for (const scale of [1, 10]) {
		const result = compare(
			base,
			resultsWith({ toggle: { overlayMs: timing(400), overlayPaintedMs: timing(400) } }),
			scale,
		);
		assert.equal(result.slower, 1);
		assert.match(result.lines.find((line) => line.includes("toggle.overlayMs")) ?? "", / {2}SLOWER$/);
		assert.match(result.lines.find((line) => line.includes("toggle.overlayPaintedMs")) ?? "", / {2}not judged$/);
	}
});

interface PageRow {
	nodeType: number;
	isConnected: boolean;
	dataset: { task: string };
	parentElement: object;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	querySelector(selector: string): unknown;
	closest(): object;
}

interface PageClick {
	type: string;
	timeStamp: number;
	view: object;
}

interface ToggleMeasurement {
	overlayMs: number | null;
	overlayPaintedMs: number | null;
	renderedMs: number | null;
	blockedMs: number;
	longestMs: number;
	reloadCalls: number;
	filesRead: number;
	clicks: { text: string; clickAt: number; overlayMs: number | null; realMs: number | null }[];
	content: string;
}

/** Runs the source sent to Obsidian against a tiny page and a clock advanced only by its scheduled callbacks. */
function togglePage({
	ignoreFirst = false,
	missing = false,
	refuseRestore = false,
	overlayDelay = 10,
	rowScanMs = 0,
} = {}) {
	let now = 1000;
	let disk = "- [ ] Task\n";
	const timers: { at: number; callback: () => void }[] = [];
	const schedule = (callback: () => void, delay = 0) => timers.push({ at: now + delay, callback });
	type Change = { target: PageRow; attributeName: string; oldValue: string | null; type: string; addedNodes: [] };
	const observers = new Set<{ callback: (changes: Change[]) => void }>();
	class Observer {
		readonly callback: (changes: Change[]) => void;
		constructor(callback: (changes: Change[]) => void) {
			this.callback = callback;
		}
		observe() {
			observers.add(this);
		}
		disconnect() {
			observers.delete(this);
		}
	}
	const emit = (row: PageRow, name: string, oldValue: string | null) => {
		for (const observer of observers)
			observer.callback([{ target: row, attributeName: name, oldValue, type: "attributes", addedNodes: [] }]);
	};
	const pageWindow = {};
	const dispatched: { text: string; at: number; event: PageClick }[] = [];
	const column = {};
	const taskTexts = ["One", "Two", "Three", "Four", "Five"];
	const view = { onReloadTasks() {} };
	const originalReload = view.onReloadTasks;
	const vault = {
		cachedRead() {
			return disk;
		},
		getAbstractFileByPath: () => (missing ? null : {}),
		read: async () => disk,
		modify: async (_file: object, content: string) => {
			if (!refuseRestore) disk = content;
		},
		adapter: { readBinary: async () => new TextEncoder().encode(disk) },
	};
	const originalRead = vault.cachedRead;
	const pageRows = taskTexts.map((text) => {
		let busy = false;
		const row: PageRow = {
			nodeType: 1,
			isConnected: true,
			dataset: { task: " " },
			parentElement: column,
			getAttribute: () => (busy ? "true" : null),
			hasAttribute: () => busy,
			closest: () => root,
			querySelector: (selector) => {
				if (selector === ":scope > .lines > .content") return { textContent: text };
				if (selector !== ":scope > .timeline > label.icon") return null;
				return {
					dispatchEvent(event: PageClick) {
						dispatched.push({ text, at: now, event });
						if (ignoreFirst && dispatched.length === 1) return;
						schedule(() => {
							busy = true;
							emit(row, "aria-busy", null);
						}, overlayDelay);
						schedule(() => {
							row.dataset.task = "x";
							emit(row, "data-task", " ");
						}, overlayDelay + 10);
						schedule(() => {
							busy = false;
							view.onReloadTasks();
							vault.cachedRead();
							emit(row, "aria-busy", "true");
						}, overlayDelay + 70);
					},
				};
			},
		};
		return row;
	});
	const root = { querySelectorAll: () => pageRows.map((row) => ({ closest: () => row })) };
	const plugin: { writer?: object; userOptions: { openNoteInsteadOfInPlace?: boolean } } = {
		writer: {},
		userOptions: { openNoteInsteadOfInPlace: false },
	};
	const source = readFileSync("scripts/bench-measure.mjs", "utf8").replace(
		"export async function measure",
		"async function measure",
	);
	const measure = runInNewContext(source + "\nmeasure", {
		app: { plugins: { plugins: { test: plugin } }, workspace: { getLeavesOfType: () => [{ view }] }, vault },
		document: {
			querySelector: () => root,
			getElementsByClassName: () => ({
				*[Symbol.iterator]() {
					now += rowScanMs;
					yield* pageRows;
				},
			}),
		},
		window: pageWindow,
		performance: { now: () => now },
		Node: { ELEMENT_NODE: 1 },
		CSS: { escape: (value: string) => value },
		TextDecoder,
		MutationObserver: Observer,
		PerformanceObserver: class {
			observe() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		},
		MouseEvent: class {
			timeStamp = now;
			view: object;
			type: string;
			constructor(type: string, options: { view: object }) {
				this.type = type;
				this.view = options.view;
			}
		},
		setTimeout: schedule,
		requestAnimationFrame: (callback: () => void) => schedule(callback, 1),
	}) as (args: Record<string, unknown>) => Promise<unknown>;
	return {
		dispatched,
		plugin,
		pageWindow,
		view,
		vault,
		originalReload,
		originalRead,
		async run(args: Record<string, unknown>) {
			let done = false;
			let result: unknown;
			let failure: unknown;
			void measure({
				viewType: "timeline",
				pluginId: "test",
				path: "Note.md",
				quietMs: 1,
				toggleTasks: taskTexts,
				toggleMode: "idle",
				...args,
			}).then(
				(value) => {
					result = value;
					done = true;
				},
				(error: unknown) => {
					failure = error;
					done = true;
				},
			);
			for (let step = 0; !done && step < 10_000; step++) {
				for (let turn = 0; turn < 8; turn++) await Promise.resolve();
				if (done) break;
				timers.sort((a, b) => a.at - b.at);
				const timer = timers.shift();
				if (!timer) continue;
				now = Math.max(now, timer.at);
				timer.callback();
			}
			assert.ok(done, "the page did not finish");
			assert.equal(observers.size, 0, "measurement observers were not disconnected");
			if (failure) throw failure;
			return result;
		},
	};
}

test("toggle: the overlay time does not include the recorder's first-row scan", async () => {
	const page = togglePage({ rowScanMs: 60, overlayDelay: 10 });
	const result = (await page.run({ action: "toggle" })) as ToggleMeasurement;
	assert.equal(result.overlayMs, 10);
	assert.equal(result.overlayPaintedMs, 11);
});

test("a step with no task over 50 ms reports blockedMs 0 and longestMs 0", async () => {
	const result = (await togglePage().run({ action: "toggle" })) as ToggleMeasurement;
	assert.equal(result.blockedMs, 0);
	assert.equal(result.longestMs, 0);
});

test("toggle: the page clicks the label on its clock and waits for the real marker without busy", async () => {
	const page = togglePage();
	const result = (await page.run({ action: "toggle" })) as ToggleMeasurement;
	assert.equal(page.dispatched.length, 1);
	const { event, at } = page.dispatched[0];
	assert.equal(event.type, "click");
	assert.equal(event.view, page.pageWindow);
	assert.equal(event.timeStamp, at);
	assert.equal(result.overlayMs, 10);
	assert.equal(result.clicks[0].realMs, 80);
	assert.equal(result.renderedMs, 81);
	assert.equal(result.reloadCalls, 1);
	assert.equal(result.filesRead, 1);
	assert.equal(page.view.onReloadTasks, page.originalReload);
	assert.equal(page.vault.cachedRead, page.originalRead);
});

test("toggle: the page logs an ignored click and retries after the guard wait", async () => {
	const page = togglePage({ ignoreFirst: true });
	const result = (await page.run({ action: "toggle", toggleMode: "sequence" })) as ToggleMeasurement;
	assert.equal(result.clicks.length, 6);
	assert.equal(countIgnoredClicks(result.clicks), 1);
	assert.equal(result.clicks[0].overlayMs, null);
	assert.equal(result.clicks[1].clickAt - result.clicks[0].clickAt, 500);
	assert.equal(result.clicks[1].text, result.clicks[0].text);
	assert.equal(result.reloadCalls, 5);
});

test("toggle: idle timing records a slow overlay and burst clicks stay 200 ms apart", async () => {
	const idle = (await togglePage({ overlayDelay: 250 }).run({ action: "toggle" })) as ToggleMeasurement;
	assert.equal(idle.overlayMs, 250);
	const page = togglePage();
	const burst = (await page.run({ action: "toggle", toggleMode: "burst", quietMs: 100 })) as ToggleMeasurement;
	assert.deepEqual(
		Array.from(burst.clicks, (click) => click.clickAt),
		[0, 200, 400, 600, 800],
	);
	assert.equal(burst.reloadCalls, 5);
	assert.equal(page.view.onReloadTasks, page.originalReload);
	assert.equal(page.vault.cachedRead, page.originalRead);
});

test("toggle: the page detects writer support and returns restore read-back bytes", async () => {
	const page = togglePage();
	assert.equal(await page.run({ action: "toggleSupport" }), true);
	delete page.plugin.userOptions.openNoteInsteadOfInPlace;
	assert.equal(await page.run({ action: "toggleSupport" }), false);
	page.plugin.userOptions.openNoteInsteadOfInPlace = false;
	delete page.plugin.writer;
	assert.equal(await page.run({ action: "toggleSupport" }), false);
	const original = "\uFEFF# 恢复\r\n\n";
	assert.equal(await page.run({ action: "restore", content: original, verifyRestore: true }), original);
	assert.equal(await page.run({ action: "readNote" }), original);
	await assert.rejects(
		togglePage({ missing: true }).run({ action: "restore", content: original, verifyRestore: true }),
		/cannot restore missing note Note\.md/,
	);
	const unchanged = await togglePage({ refuseRestore: true }).run({
		action: "restore",
		content: original,
		verifyRestore: true,
	});
	assert.equal(typeof unchanged, "string");
	assert.throws(() => assertToggleRestored("Note.md", original, unchanged as string), /could not restore/);
});

test("focusToday reports on and off paintedMs and blockedMs", async () => {
	const page = viewPage({ longTasks: [{ offset: 1, duration: 60 }] });
	const on = await page.run<ClickStep>({ action: "focusToday", direction: "on", quietMs: 100, burstGapMs: 40 });
	assert.equal(page.classList.contains("todayFocus"), true);
	const off = await page.run<ClickStep>({ action: "focusToday", direction: "off", quietMs: 100, burstGapMs: 40 });
	assert.equal(page.classList.contains("todayFocus"), false);
	for (const step of [on, off]) {
		assert.equal(step.paintedMs, 26);
		assert.equal(step.blockedMs, 60);
	}
	const pairs = [
		{ on, off },
		{ on: { ...on, paintedMs: 46 }, off: { ...off, blockedMs: 80 } },
	];
	const results = focusTodayResults(pairs, false);
	assert.deepEqual(Object.keys(results), ["focusToday.on", "focusToday.off"]);
	for (const [key, steps] of [
		["focusToday.on", pairs.map((pair) => pair.on)],
		["focusToday.off", pairs.map((pair) => pair.off)],
	] as const) {
		assert.equal(results[key].runs, 2);
		assert.deepEqual(results[key].paintedMs, summary(steps.map((step) => step.paintedMs)));
		assert.deepEqual(results[key].blockedMs, summary(steps.map((step) => step.blockedMs)));
		assert.equal("cpuMs" in results[key], false);
		assert.deepEqual(
			focusTodayResults([{ on: { ...on, cpuMs: 30 }, off: { ...off, cpuMs: 40 } }], true)[key].cpuMs,
			summary([key.endsWith("on") ? 30 : 40]),
		);
	}
});

test("counterFilter reports paintedMs and blockedMs for the click on Todo", async () => {
	const page = viewPage({ clickDelay: 20, longTasks: [{ offset: 2, duration: 70 }] });
	const step = await page.run<ClickStep>({ action: "counterFilter", direction: "on", quietMs: 100 });
	assert.equal(page.classList.contains("todoFilter"), true);
	assert.equal(step.paintedMs, 36);
	assert.equal(step.blockedMs, 70);
	const result = clickResults([step, { paintedMs: 50, blockedMs: 90, longestMs: 80 }], false);
	assert.equal(result.runs, 2);
	assert.deepEqual(result.paintedMs, summary([36, 50]));
	assert.deepEqual(result.blockedMs, summary([70, 90]));
	assert.deepEqual(result.longestTaskMs, summary([70, 80]));
});

test("scroll reports p95FrameMs", async () => {
	const durations = [...Array.from({ length: 17 }, (_, index) => index + 1), 50, 51, 90];
	const timestamps = durations.reduce((times, duration) => [...times, times[times.length - 1] + duration], [0]);
	assert.deepEqual(frameStats(timestamps), { p95FrameMs: 51, framesOver50Ms: 2, frames: 20 });
	const page = viewPage();
	const run = await page.run<{ timestamps: number[]; visibilityState: string; scrolledPx: number }>({
		action: "scroll",
		durationMs: 2000,
		pxPerMs: 3,
		minScrollPx: 6000,
	});
	assert.equal(run.timestamps[0], 0);
	assert.ok(run.timestamps.at(-1)! >= 2000);
	assert.equal(run.visibilityState, "hidden");
	assert.equal(run.scrolledPx, 6000);
	const frames = page.scrolls.slice(1, -1);
	assert.equal(frames.length, run.timestamps.length);
	for (const [i, frame] of frames.entries()) {
		assert.equal(frame.at - frames[0].at, run.timestamps[i]);
		assert.equal(frame.value, 3 * Math.min(2000, run.timestamps[i]));
	}
	assert.equal(page.scrolls[0].value, 0);
	assert.equal(page.scrolls.at(-1)?.value, 0);
	assert.equal(page.content.scrollTop, 0);
	assert.deepEqual(scrollResults([{ timestamps, visibilityState: "hidden" }]), {
		runs: 1,
		p95FrameMs: summary([51]),
		framesOver50Ms: counts([2]),
		frames: counts([20]),
		visibilityState: "hidden",
	});
});

test("reveal is skipped on a build without revealTask", async () => {
	const page = viewPage({ view: {}, rowPresent: false });
	assert.deepEqual(await page.run({ action: "reveal", taskPath: page.taskPath, taskLine: page.taskLine }), {
		revealed: false,
	});
	assert.deepEqual(page.scrolls, []);
});

test("reveal waits for revealTask and for the row it reveals", async () => {
	const page = viewPage({ rowPresent: false });
	let called = "";
	let resolvedAt = 0;
	page.view.revealTask = async (id) => {
		called = id;
		await page.delay(80);
		resolvedAt = page.now;
		page.showRow();
	};
	assert.deepEqual(await page.run({ action: "reveal", taskPath: page.taskPath, taskLine: page.taskLine }), {
		revealed: true,
	});
	assert.equal(called, `${page.taskPath}:${page.taskLine}`);
	assert.equal(resolvedAt, 1080);
	assert.ok(page.now >= resolvedAt);
	assert.deepEqual(page.scrolls, []);
	// A row already in the DOM must not let an unawaited reveal promise pass the row check.
	const started = page.now;
	await page.run({ action: "reveal", taskPath: page.taskPath, taskLine: page.taskLine });
	assert.equal(resolvedAt, started + 80);
	assert.ok(page.now >= resolvedAt);
});

test("a reveal whose row never appears is an error", async () => {
	const page = viewPage({ rowPresent: false, view: { revealTask: async () => {} } });
	await assert.rejects(
		page.run({ action: "reveal", taskPath: page.taskPath, taskLine: page.taskLine }),
		(error: Error) => error.message.includes(`${page.taskPath}:${page.taskLine}`),
	);
});

test("a candidate without the Focus on today control is an error; a base without it is skipped and not judged", () => {
	const lines: string[] = [];
	const deps = viewScenarioDeps({ todayHeader: false, todoCounter: true, viewContent: true }, (line) =>
		lines.push(line),
	);
	assert.throws(() => measureViewScenarios(deps), /\.todayHeader/);
	const base = measureViewScenarios({ ...deps, arm: "base" });
	for (const key of ["focusToday.on", "focusToday.off"] as const)
		assert.deepEqual(base[key], { skipped: "the loaded build has no Focus on today control" });
	assert.ok(lines.some((line) => line.includes("focusToday: skipped")));
	const slots: Slot[] = Array.from({ length: 8 }, (_, round) => [
		{
			round,
			arm: "base" as const,
			results: { "focusToday.on": { ...base["focusToday.on"] }, saveWithoutTasks: { runs: 1, reloads: 0 } },
		},
		{
			round,
			arm: "candidate" as const,
			results: { "focusToday.on": { paintedMs: timing(1000) }, saveWithoutTasks: { runs: 1, reloads: 0 } },
		},
	]).flat();
	const verdict = compareAb(slots, 1);
	assert.equal(verdict.unpaired.find((row) => row.name === "focusToday.on.paintedMs")?.verdict, "not judged");
	assert.equal(verdict.slower, 0);
});

test("scroll fails when the timeline cannot scroll 6,000 px", async () => {
	const page = viewPage({ scrollHeight: 6999, clientHeight: 1000 });
	await assert.rejects(page.run({ action: "scroll", durationMs: 2000, pxPerMs: 3, minScrollPx: 6000 }), /6000/);
});

test("heapAfterLoad collects garbage before it reads the heap", () => {
	const methods: string[] = [];
	assert.deepEqual(
		heapAfterLoad((method) => {
			methods.push(method);
			return { usedSize: 4096 };
		}),
		{ usedBytes: counts([4096]) },
	);
	assert.deepEqual(methods, ["HeapProfiler.collectGarbage", "Runtime.getHeapUsage"]);
	for (const answer of [{}, { usedSize: 0 }])
		assert.throws(() => heapAfterLoad(() => answer), /no positive usedSize/);
	assert.throws(
		() =>
			heapAfterLoad(() => {
				throw new Error("CDP unavailable");
			}),
		/HeapProfiler\.collectGarbage.*CDP unavailable/,
	);
});

test("the save token goes after Task 0228 b only", () => {
	const original = benchVaultNotes(1).get(SAVE_MARKER.path)!;
	const changed = withSaveToken(original, "tok").split("\n");
	const lines = original.split("\n");
	assert.equal(changed.length, lines.length);
	assert.equal(changed[12], "- [ ] Task 0228 b tok 🔽 ➕ 2026-01-06 ⏳ 2026-01-15");
	for (let line = 0; line < lines.length; line++) if (line !== 12) assert.equal(changed[line], lines[line]);
	assert.equal(
		changed.find((line) => line.includes("Task 0228 a")),
		lines.find((line) => line.includes("Task 0228 a")),
	);
	assert.throws(() => withSaveToken("# No task\n", "tok"), {
		message: `${SAVE_MARKER.path} has no "- [ ] Task 0228 b" task to edit.`,
	});
});

test("--profile with --update is an error", () => {
	assert.throws(() => parseBenchArgs(["--profile", "--update"]), {
		message: "--profile measures no baseline; leave out --update.",
	});
	for (const args of [
		["--rounds", "8"],
		["--seed", "1"],
	])
		assert.throws(() => parseBenchArgs(["--profile", ...args]), {
			message: "--profile runs each scenario once per arm; leave out --rounds and --seed.",
		});
	assert.throws(() => parseBenchArgs(["--ab", "master", "--update"]), {
		message: "--ab compares two builds and records no baseline; leave out --update.",
	});
});

test("--profile takes --report without --ab; --report alone is still an error", () => {
	assert.deepEqual(parseBenchArgs(["--profile", "--report", "x.json"]), {
		scale: 1,
		update: false,
		ab: null,
		profile: { base: null, candidate: null, allowOtherBase: false, report: "x.json" },
	});
	assert.deepEqual(parseBenchArgs(["--profile", "--ab", "master", "--scale", "10", "--report", "p.json"]), {
		scale: 10,
		update: false,
		ab: null,
		profile: { base: "master", candidate: null, allowOtherBase: false, report: "p.json" },
	});
	assert.throws(() => parseBenchArgs(["--report", "x.json"]), { message: "--report only go with --ab <ref>." });
	assert.throws(() => parseBenchArgs(["--profile", "--candidate", "x"]), {
		message: "--candidate only go with --ab <ref>.",
	});
	assert.throws(() => parseBenchArgs(["--unknown"]), {
		message:
			'unknown arguments ["--unknown"]; the only ones are --update, --scale 10, --profile with --report <file> and --ab <ref>, and --ab <ref> with --candidate <ref>, --rounds <n>, --seed <n>, --report <file> and --any-base.',
	});
	assert.deepEqual(parseBenchArgs([]), { scale: 1, update: false, ab: null, profile: null });
	assert.deepEqual(parseBenchArgs(["--update"]), { scale: 1, update: true, ab: null, profile: null });
	const ab = abArgs(["--ab", "master"], 1).ab;
	assert.deepEqual(parseBenchArgs(["--ab", "master"]), { scale: 1, update: false, ab, profile: null });
});
