import { test } from "node:test";
import assert from "node:assert/strict";

import { compare, counts, paintedAfter, splitLoad, summary } from "../scripts/bench-results.mjs";

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
