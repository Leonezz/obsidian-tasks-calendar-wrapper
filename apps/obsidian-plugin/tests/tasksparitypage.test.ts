import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceUrl = pathToFileURL(path.resolve("scripts/tasks-parity-check.mjs")).href;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function harness(options: { hidden?: boolean; refused?: boolean; badUndo?: boolean; session?: boolean } = {}) {
	const { parityPage } = (await import(sourceUrl)) as typeof import("../scripts/tasks-parity-check.mjs");
	const original = "Before\n- [ ] Pay\nAfter\n";
	const id = "Note.md:1";
	let note = original,
		clock = 0,
		oracleCalls = 0,
		reveals = 0,
		undoClicks = 0;
	const pointerEvents: string[] = [],
		focusEvents: string[] = [];
	const notices: { querySelectorAll: () => unknown[] }[] = [];
	const events: { path: string; line: number; action: string; kind: string; reason?: string }[] = [];
	const document = {
		activeElement: null as unknown,
		querySelectorAll: (selector: string) => {
			assert.equal(selector, ".notice");
			return notices;
		},
	};
	const button = {
		textContent: "Undo",
		click() {
			undoClicks++;
			note = options.badUndo ? "Unexpected" : original;
			events.push({ path: "Note.md", line: 1, action: "undo", kind: options.badUndo ? "refused" : "written" });
		},
	};
	const checkbox = {
		dispatchEvent(event: { type: string }) {
			pointerEvents.push(event.type);
			if (event.type === "click") {
				if (options.refused)
					events.push({
						path: "Note.md",
						line: 1,
						action: "toggle",
						kind: "refused",
						reason: "impossible-date",
					});
				else {
					note = "Before\n- [x] Pay from session\nAfter\n";
					events.push({ path: "Note.md", line: 1, action: "toggle", kind: "written" });
					notices.push({ querySelectorAll: () => [button] });
				}
			}
			return true;
		},
	};
	const row = {
		getAttribute: (name: string) => (name === "data-link" ? "Note.md" : "1"),
		getBoundingClientRect: () => ({ height: 20 }),
		hasAttribute: () => false,
		querySelector: (selector: string) => {
			assert.equal(selector, ":scope > .timeline > label.icon");
			return checkbox;
		},
		addEventListener() {},
		removeEventListener() {},
		focus() {
			document.activeElement = row;
		},
		contains: (element: unknown) => element === row,
		dispatchEvent: (event: { type: string }) => {
			focusEvents.push(event.type);
			return true;
		},
	};
	const view = {
		isReloading: false,
		timelineHandle: { result: { years: [{ days: [{ tasks: options.hidden ? [] : [{ task: { id } }] }] }] } },
		containerEl: {
			querySelector: (selector: string) => {
				assert.equal(selector, ".taskido");
				return { querySelectorAll: () => [row] };
			},
		},
		async revealTask(taskId: string) {
			assert.equal(taskId, id);
			reveals++;
			return true;
		},
	};
	const app = {
		vault: {
			adapter: {
				async readBinary(file: string) {
					assert.equal(file, "Note.md");
					return Buffer.from(note);
				},
			},
			getFileByPath: () => ({ path: "Note.md" }),
		},
		metadataCache: {
			getFileCache: () => ({ listItems: [] }),
			fileCache: {
				"Note.md": {
					get hash() {
						return hash(note);
					},
				},
			},
		},
		plugins: {
			plugins: {
				tasks: {
					apiV1: {
						executeToggleTaskDoneCommand(line: string, file: string) {
							assert.equal(line, "- [ ] Pay");
							assert.equal(file, "Note.md");
							oracleCalls++;
							return "- [x] Pay from session";
						},
					},
				},
			},
		},
	};
	const state = { runId: "run", view, events, cancelled: false, busy: false };
	class Event {
		constructor(
			public type: string,
			public init: unknown,
		) {}
	}
	const execute = runInNewContext(`(${parityPage.toString()})`, {
		app,
		window: { __tcwParityCheck: state },
		document,
		Buffer,
		require: (id: string) => {
			assert.equal(id, "crypto");
			return { createHash };
		},
		performance: { now: () => (clock += 100) },
		setTimeout: (fn: () => void) => fn(),
		PointerEvent: Event,
		MouseEvent: Event,
		FocusEvent: Event,
	}) as (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
	return {
		async run() {
			return execute({
				action: "case",
				pluginId: "tcw",
				tasksId: "tasks",
				runId: "run",
				originalHash: hash(original),
				entry: {
					path: "Note.md",
					line: 1,
					id,
					sourceLine: "- [ ] Pay",
					api: "recorded oracle",
					oracle: options.session ? "session" : "recorded",
				},
			});
		},
		state,
		pointerEvents,
		focusEvents,
		stats: () => ({ note, oracleCalls, reveals, undoClicks }),
		original,
	};
}

test("the actual page driver obtains its session oracle, dispatches the pointer sequence, and clicks its own Undo", async () => {
	const h = await harness({ session: true });
	const result = await h.run();
	assert.equal(result.kind, "written");
	assert.equal(result.expectedApi, "- [x] Pay from session");
	assert.equal(result.after, "Before\n- [x] Pay from session\nAfter\n");
	assert.equal(result.restored, true);
	assert.equal(result.undo, "notice-button");
	assert.deepEqual(h.pointerEvents, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
	assert.deepEqual(h.focusEvents, ["focusin"], "background focus delivery uses the public DOM event fallback");
	assert.deepEqual(h.stats(), { note: h.original, oracleCalls: 1, reveals: 1, undoClicks: 1 });
	assert.equal(h.state.busy, false);
});

test("recorded cases never query a fresh oracle, while hidden logical IDs never click or reveal a mounted row", async () => {
	const recorded = await harness();
	assert.equal((await recorded.run()).expectedApi, "recorded oracle");
	assert.equal(recorded.stats().oracleCalls, 0);
	const hidden = await harness({ hidden: true });
	const result = await hidden.run();
	assert.equal(result.kind, "hidden");
	assert.equal(result.unchanged, true);
	assert.equal(result.metadataTaskIndexed, false);
	assert.deepEqual(hidden.pointerEvents, []);
	assert.deepEqual(hidden.stats(), { note: hidden.original, oracleCalls: 0, reveals: 0, undoClicks: 0 });
});

test("the page reports refusal without Undo and rejects a failed own Undo instead of counting success", async () => {
	const refused = await harness({ refused: true });
	const result = await refused.run();
	assert.equal(result.kind, "refused");
	assert.equal(result.reason, "impossible-date");
	assert.equal(result.unchanged, true);
	assert.equal(refused.stats().undoClicks, 0);
	const broken = await harness({ badUndo: true });
	await assert.rejects(broken.run(), /Undo was refused/);
	assert.equal(broken.state.busy, false, "failed work releases the driver busy guard");
});

test("recovery requires the original live run and verifies clock identity before discarding its saved state", async () => {
	const { parityPage } = (await import(sourceUrl)) as typeof import("../scripts/tasks-parity-check.mjs");
	const originalNow = () => 42;
	const moment = { now: originalNow, locale: () => "en" };
	const window: {
		moment: typeof moment;
		__tcwParityCheck?: { runId: string; originalNow: typeof originalNow; originalLocale: string };
	} = {
		moment,
		__tcwParityCheck: { runId: "run", originalNow, originalLocale: "en" },
	};
	const app = {
		workspace: { getLayout: () => ({ main: "original" }) },
		vault: { config: {} },
		plugins: { enabledPlugins: new Set(["tasks"]), plugins: { tasks: {} }, isEnabled: () => true },
	};
	const execute = runInNewContext(`(${parityPage.toString()})`, {
		window,
		app,
		require: (id: string) => {
			assert.equal(id, "@electron/remote");
			return { getCurrentWebContents: () => ({ getBackgroundThrottling: () => true }) };
		},
	}) as (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
	const input = { pluginId: "tcw", tasksId: "tasks", runId: "run" };
	assert.equal((await execute({ ...input, action: "recovery-inspect" })).fixtureSaved, false);
	await assert.rejects(
		execute({ ...input, runId: "other", action: "recovery-inspect" }),
		/original live parity session/,
	);
	moment.now = () => 42;
	await assert.rejects(execute({ ...input, action: "verify" }), /clock\/locale state did not restore exactly/);
	assert.ok(window.__tcwParityCheck, "a failed verification preserves the only live recovery state");
	moment.now = originalNow;
	const runtime = {
		layout: { main: "original" },
		theme: null,
		locale: "en",
		throttling: true,
		restricted: false,
		pluginEnabled: false,
		pluginLoaded: false,
		tasksEnabled: true,
		tasksLoaded: true,
	};
	Object.assign(app.plugins.plugins, { tcw: {} });
	await assert.rejects(
		execute({ ...input, action: "verify", runtime, clear: false }),
		/runtime not restored: pluginLoaded/,
	);
	delete (app.plugins.plugins as Record<string, unknown>).tcw;
	await execute({ ...input, action: "verify", runtime, clear: false });
	assert.ok(window.__tcwParityCheck, "an earlier failed byte restoration can retain the live state for --restore");
	await execute({
		...input,
		action: "verify",
		runtime: {
			layout: { main: "original" },
			theme: null,
			locale: "en",
			throttling: true,
			restricted: false,
			pluginEnabled: false,
			pluginLoaded: false,
			tasksEnabled: true,
			tasksLoaded: true,
		},
	});
	assert.equal(window.__tcwParityCheck, undefined);
	await assert.rejects(execute({ ...input, action: "recovery-inspect" }), /original live parity session/);
});

test("inspect rejects a loaded old TCW instance even when its persistent enabled set is false", async () => {
	const { parityPage } = (await import(sourceUrl)) as typeof import("../scripts/tasks-parity-check.mjs");
	const execute = runInNewContext(`(${parityPage.toString()})`, {
		window: {},
		app: {
			vault: {},
			plugins: { enabledPlugins: new Set(), plugins: { tcw: {} } },
			workspace: { getLeavesOfType: () => [] },
		},
	}) as (input: Record<string, unknown>) => Promise<unknown>;
	await assert.rejects(
		execute({ action: "inspect", pluginId: "tcw", tasksId: "tasks", viewType: "timeline", paths: [] }),
		/TCW must be controlled-disabled/,
	);
});
