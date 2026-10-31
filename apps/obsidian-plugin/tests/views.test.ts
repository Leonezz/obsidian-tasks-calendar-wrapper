// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import { GOLDEN_NOW } from "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Notice } from "obsidian";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { dayKey, parseTaskLine, resolveTasks, type ResolvedTask, type Task } from "@tasks-calendar-wrapper/core";
import { createResolveEnv } from "../src/state/resolveenv";
import { initialTimelineState, withReload } from "../src/state/timeline";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { heldOf, TasksTimelineView, timelineTaskIndex } from "../src/views";
import { ObsidianBridge, quickFilterOf } from "../timeline/src/obsidianbridge";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { sameParseKey } from "../utils/parsekey";
import { deeplyFrozen } from "./frozen";
import { goldenApp, loadVault } from "./golden-vault";
import { rowsOf } from "./markup";
import { notesApp, openView, unusedWriter } from "./view-harness";
import { writerHarness, deferred, flush } from "./writer-harness";
import { createNoticePresenter } from "../timeline/src/notices";
import { FakeElement, Notice as TestNotice } from "./stubs/obsidian";
import type { Store, TaskRowModel } from "@tasks-calendar-wrapper/core";
import type { TimelineState } from "../src/state/timeline";
import type { WriteEvent, TaskWriter } from "../timeline/src/taskwriter";

// The timeline's view reads the notes through its task index, which gives what readTasks gives, and hands the bridge
// the tasks, and the list the old view held of the tasks it shows, in its state. The bridge renders again when the
// options change, and when the list shown changes. The old view dropped the quick filter then; it now stays.

const DAY = 24 * 60 * 60 * 1000;

/**
 * The bridge of a view, mounted without a DOM: its state is applied at once, and it renders to markup. The bridge
 * listens to the view's models as it does in Obsidian.
 */
function bridgeOf(opened: ReturnType<typeof openView>, app: unknown, resolveEnv?: ReturnType<typeof createResolveEnv>) {
	const bridge = new ObsidianBridge({
		plugin: { app } as never,
		store: opened.store,
		writer: opened.writer,
		resolveEnv,
	});
	const mounted = bridge as unknown as { state: object; props: object };
	bridge.setState = ((update: object | ((state: object, props: object) => object)) => {
		mounted.state = {
			...mounted.state,
			...(typeof update === "function" ? update(mounted.state, mounted.props) : update),
		};
	}) as never;
	bridge.componentDidMount();
	return { bridge, rows: () => rowsOf(renderToStaticMarkup(bridge.render() as ReactElement)) };
}

/**
 * The bridge as React updates it: setState queues the update, and flush applies the queued ones in order, as React
 * does when it renders, a moment after the change.
 */
function deferredBridgeOf(opened: ReturnType<typeof openView>, app: unknown) {
	const bridge = new ObsidianBridge({ plugin: { app } as never, store: opened.store, writer: opened.writer });
	const mounted = bridge as unknown as { state: object; props: object };
	let queued: (object | ((state: object, props: object) => object))[] = [];
	bridge.setState = ((update: object | ((state: object, props: object) => object)) => {
		queued = [...queued, update];
	}) as never;
	const flush = () => {
		const updates = queued;
		queued = [];
		for (const update of updates)
			mounted.state = {
				...mounted.state,
				...(typeof update === "function" ? update(mounted.state, mounted.props) : update),
			};
	};
	bridge.componentDidMount();
	flush();
	return { bridge, flush, rows: () => rowsOf(renderToStaticMarkup(bridge.render() as ReactElement)) };
}

const ids = (tasks: readonly { id: string }[]) => tasks.map((task) => task.id);

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

test("a reload hands the bridge the tasks readTasks reads, and what it shows of them", async () => {
	const { view, store } = openView(goldenApp(loadVault()));
	await view.onUpdateOptions({ ...defaultUserOptions });
	const expected = await readTasks(goldenApp(loadVault()), defaultUserOptions, moment);
	assert.ok(expected.length > 100);
	assert.deepEqual(ids(store.getSnapshot().tasks), ids(expected));
	const shown = resolveTasks(expected, defaultUserOptions, { now: moment(), moment }).shown;
	assert.deepEqual(ids(store.getSnapshot().shown), ids(shown.map((r) => r.task)));
});

test("a reload reads the notes the user's note filters keep", async () => {
	const { view, store } = openView(goldenApp(loadVault()));
	await view.onUpdateOptions({ ...defaultUserOptions, excludePaths: ["Inbox.md"] });
	const { tasks } = store.getSnapshot();
	assert.ok(tasks.length > 100);
	assert.ok(!tasks.some((task) => task.path === "Inbox.md"));
});

test("a reload of the same notes changes nothing, and so does a setting that changes nothing shown", async () => {
	const { view, changes } = openView(goldenApp(loadVault()));
	await view.onUpdateOptions({ ...defaultUserOptions });
	assert.equal(changes(), 1);
	await view.onReloadTasks();
	await view.onUpdateOptions({ ...defaultUserOptions, dateFormat: "DD.MM.YYYY" });
	assert.equal(changes(), 1);
	await view.onUpdateOptions({ ...defaultUserOptions, sort: "text-desc" });
	assert.equal(changes(), 2);
});

test("every reload hands the bridge new frozen tasks, also when nothing changed, and the options frozen", async () => {
	// The timeline remembers what it worked out by the tasks array. Status changes only with the day; each reload
	// still hands over a new array, as it always has.
	const { view, store } = openView(goldenApp(loadVault()));
	await view.onUpdateOptions({ ...defaultUserOptions });
	const first = store.getSnapshot().tasks;
	await view.onReloadTasks();
	const second = store.getSnapshot().tasks;
	assert.notEqual(second, first);
	assert.deepEqual(ids(second), ids(first));
	assert.ok(Object.isFrozen(first) && Object.isFrozen(second));
	assert.ok(deeplyFrozen(store.getSnapshot().options));
});

test("on another day, the list shown changes when a status does, and not when only today's day does", async () => {
	try {
		const golden = openView(goldenApp(loadVault()));
		await golden.view.onUpdateOptions({ ...defaultUserOptions });
		const someday = openView(notesApp({ "Someday.md": "- [ ] someday", "Later.md": "- [ ] later 📅 2026-03-01" }));
		await someday.view.onUpdateOptions({ ...defaultUserOptions });
		moment.now = () => GOLDEN_NOW + DAY;
		await golden.view.onReloadTasks();
		await someday.view.onReloadTasks();
		assert.equal(golden.changes(), 2, "tasks of the golden vault fall due");
		// The unplanned task is on today either way; the old list kept that day where Backbone did not compare it.
		assert.equal(someday.changes(), 1);
	} finally {
		moment.now = () => GOLDEN_NOW;
	}
});

test("a reload asked for while one runs runs once more when it is done", async () => {
	const app = goldenApp(loadVault()) as { vault: { getMarkdownFiles: () => unknown[] } };
	const listed = app.vault.getMarkdownFiles;
	let lists = 0;
	app.vault.getMarkdownFiles = () => ((lists += 1), listed());
	const { view } = openView(app);
	const first = view.onUpdateOptions({ ...defaultUserOptions });
	await view.onReloadTasks();
	assert.equal(lists, 1, "the second reload waits for the first");
	await first;
	assert.equal(lists, 2);
});

test("a reload uses the options it started with, and options changed meanwhile reload again", async () => {
	const app = notesApp({ "Inbox.md": "- [ ] beta 📅 2026-01-20", "Done.md": "- [x] gamma 📅 2026-01-15" });
	const opened = openView(app);
	const shownIds: string[][] = [];
	opened.store.subscribe(() => shownIds.push(ids(opened.store.getSnapshot().shown)));
	const first = opened.view.onUpdateOptions({ ...defaultUserOptions });
	// Showing the done tasks too, while the first reload still reads the notes.
	const second = opened.view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
	await first;
	await second;
	assert.equal(opened.changes(), 2);
	assert.deepEqual(shownIds.at(-1)?.sort(), ["Done.md:0", "Inbox.md:0"]);
	assert.ok(
		shownIds.some((list) => list.length === 1 && list[0] === "Inbox.md:0"),
		JSON.stringify(shownIds),
	);
});

test("options pushed during a running reload never render the old list under new options", async () => {
	const app = notesApp({ "Inbox.md": "- [ ] a 📅 2026-01-20", "Done.md": "- [x] b 📅 2026-01-21" });
	const cachedRead = app.vault.cachedRead;
	let release!: () => void;
	let reading!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const started = new Promise<void>((resolve) => (reading = resolve));
	app.vault.cachedRead = async (file) => {
		reading();
		await gate;
		return cachedRead(file);
	};
	const opened = openView(app);
	const { bridge, rows } = bridgeOf(opened, app);
	const renders: { rows: string[]; expected: string[]; held: number; options: UserOption }[] = [];
	const record = () => {
		const { tasks, userOptions } = bridge.state as { tasks: readonly Task[]; userOptions: UserOption };
		renders.push({
			rows: rows(),
			expected: ids(resolveTasks(tasks, userOptions, { now: moment(), moment }).shown.map((r) => r.task)),
			held: opened.store.getSnapshot().shown.length,
			options: userOptions,
		});
	};
	const unsubscribe = opened.store.subscribe(record);
	try {
		const first = opened.view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: ["x", "-"] });
		await started;
		const second = opened.view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
		release();
		await first;
		await second;
		record();
		assert.ok(renders.some((render) => render.held === 1 && render.options.hideStatusTasks.length === 0));
		for (const render of renders) assert.deepEqual(render.rows.sort(), render.expected.sort());
		assert.deepEqual(renders.at(-1)?.rows.sort(), ["Done.md:0", "Inbox.md:0"]);
	} finally {
		release();
		unsubscribe();
		bridge.componentWillUnmount();
	}
});

test("equal-valued options reuse the reload's list", async () => {
	const app = notesApp({ "Inbox.md": "- [ ] a 📅 2026-01-20" });
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	// This bridge's cache has never seen a task: any fallback resolve would increase its counter.
	const resolveEnv = createResolveEnv();
	const taskCache = resolveEnv(moment()).env.taskCache;
	assert.ok(taskCache);
	const { bridge, rows } = bridgeOf(opened, app, resolveEnv);
	assert.equal(taskCache.resolutionCount, 0);
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	assert.equal(taskCache.resolutionCount, 0, "the first render uses the reload's list");
	const reloading = opened.view.onUpdateOptions({ ...opened.store.getSnapshot().options });
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	assert.equal(taskCache.resolutionCount, 0, "equal-valued options reuse it before the new reload finishes");
	await reloading;
	assert.notEqual((bridge.state as { tasks: unknown }).tasks, opened.store.getSnapshot().tasks);
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	assert.equal(taskCache.resolutionCount, 1, "a newer reload's list cannot replace the bridge's older tasks");
	bridge.componentWillUnmount();
});

test("the bridge resolves again when the day or parse key changes", async () => {
	const app = notesApp({ "Inbox.md": "- [ ] a 📅 2026-01-15" });
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions, forward: false });
	const resolveEnv = createResolveEnv();
	const first = resolveEnv(moment());
	assert.ok(first.env.taskCache);
	const { bridge } = bridgeOf(opened, app, resolveEnv);
	// The child can render on a counter click without the bridge rendering again.
	const tree = bridge.render() as ReactElement;
	const rows = () => rowsOf(renderToStaticMarkup(tree));
	try {
		assert.deepEqual(rows(), ["Inbox.md:0"]);
		assert.equal(first.env.taskCache.resolutionCount, 0);
		moment.now = () => GOLDEN_NOW + DAY;
		assert.deepEqual(rows(), ["Inbox.md:0"]);
		// A new day also gets new caches; the bridge resolved into the one this day keeps.
		const nextDay = resolveEnv(moment());
		assert.notEqual(nextDay.env.taskCache, first.env.taskCache);
		assert.ok(nextDay.env.taskCache);
		assert.equal(first.env.taskCache.resolutionCount, 0);
		assert.equal(nextDay.env.taskCache.resolutionCount, 1, "another day cannot use the prepared list");
		process.env.TZ = "America/Los_Angeles";
		const second = resolveEnv(moment());
		assert.equal(dayKey(first.env.now.clone().add(1, "day")), dayKey(second.env.now));
		assert.ok(!sameParseKey(first.parseKey, second.parseKey));
		assert.ok(second.env.taskCache);
		assert.equal(second.env.taskCache.resolutionCount, 0);
		assert.deepEqual(rows(), ["Inbox.md:0"]);
		assert.equal(second.env.taskCache.resolutionCount, 1, "a new parse key cannot use the prepared list");
	} finally {
		moment.now = () => GOLDEN_NOW;
		process.env.TZ = "UTC";
		bridge.componentWillUnmount();
	}
});

test("daily-note date cache drops on time-zone change", () => {
	try {
		process.env.TZ = "Asia/Shanghai";
		const resolveEnv = createResolveEnv();
		const task = parseTaskLine("- [ ] a", { moment, path: "Daily/2026-03-10.md" });
		assert.ok(task);
		const lookupTask = parseTaskLine("- [ ] b", { moment, path: "Daily/2026/Mar/11th/Tue.md" });
		assert.ok(lookupTask);
		const settings = { dailyNoteFormat: "YYYY-MM-DD" };
		const lookupSettings = { dailyNoteFormat: "YYYY/MMM/Wo/ddd" };
		const first = resolveEnv(moment());
		const before = resolveTasks([task], settings, first.env).shown[0];
		assert.ok(before.dates.start);
		assert.equal(dayKey(before.dates.start), "2026-03-10");
		const lookupBefore = resolveTasks([lookupTask], lookupSettings, first.env).shown[0];
		assert.ok(lookupBefore.dates.start);
		assert.equal(dayKey(lookupBefore.dates.start), "2026-03-10");
		assert.equal(resolveEnv(moment()).env.dateCache, first.env.dateCache, "the same parse key keeps its cache");
		process.env.TZ = "America/Los_Angeles";
		const second = resolveEnv(moment());
		assert.ok(!sameParseKey(first.parseKey, second.parseKey));
		assert.notEqual(second.env.dateCache, first.env.dateCache);
		assert.notEqual(second.env.taskCache, first.env.taskCache);
		const after = resolveTasks([task], settings, second.env).shown[0];
		assert.ok(after.dates.start);
		assert.equal(dayKey(after.dates.start), "2026-03-10");
		const lookupAfter = resolveTasks([lookupTask], lookupSettings, second.env).shown[0];
		assert.ok(lookupAfter.dates.start);
		assert.equal(dayKey(lookupAfter.dates.start), "2026-03-10");
	} finally {
		process.env.TZ = "UTC";
	}
});

test("a reload that fails says so, and the next reload runs", async () => {
	const app = goldenApp(loadVault()) as { vault: { getMarkdownFiles: () => unknown[] } };
	const listed = app.vault.getMarkdownFiles;
	let fail = true;
	app.vault.getMarkdownFiles = () => {
		if (!fail) return listed();
		fail = false;
		throw new Error("the vault is not ready");
	};
	const { view, store } = openView(app);
	shownNotices.length = 0;
	await view.onUpdateOptions({ ...defaultUserOptions });
	assert.deepEqual(shownNotices, ["Error when generating tasks from files: Error: the vault is not ready"]);
	assert.deepEqual(store.getSnapshot().tasks, []);
	await view.onReloadTasks();
	assert.ok(store.getSnapshot().tasks.length > 100);
});

// The quick filter, as the bridge keeps it

test("the quick filter keeps the priorities it was applied with, while the panel goes on changing its list", () => {
	const panelList = ["High"];
	const filter = quickFilterOf("2026-01-10", "2026-01-20", panelList);
	panelList.push("Low");
	assert.deepEqual(filter, { from: "2026-01-10", to: "2026-01-20", priorities: ["High"] });
	assert.ok(Object.isFrozen(filter) && Object.isFrozen(filter.priorities));
});

test("the quick filter lasts across reloads and option changes", async () => {
	const notes = {
		"Inbox.md": "- [ ] beta 📅 2026-01-20",
		"Later.md": "- [ ] alpha 📅 2026-01-25",
		"Done.md": "- [x] gamma 📅 2026-01-15",
		"Someday.md": "- [ ] delta",
	};
	const app = notesApp(notes);
	const opened = openView(app);
	const options: UserOption = { ...defaultUserOptions };
	await opened.view.onUpdateOptions(options);
	const { bridge, rows } = bridgeOf(opened, app);
	assert.deepEqual(rows().sort(), ["Inbox.md:0", "Later.md:0", "Someday.md:0"]);

	bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	// A setting that changes nothing shown, and an edit of a task the settings hide, keep it.
	await opened.view.onUpdateOptions({ ...options, dateFormat: "DD.MM.YYYY" });
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	notes["Done.md"] = "- [-] gamma 📅 2026-01-15";
	opened.edited("Done.md");
	const before = (bridge.state as { tasks: unknown }).tasks;
	await opened.view.onReloadTasks();
	const hidden = opened.store.getSnapshot().tasks.find((task) => task.path === "Done.md");
	assert.equal(hidden?.statusMarker, "-", "the hidden task changed");
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	// Nothing shown changed, so the timeline does not render again, as before.
	assert.equal((bridge.state as { tasks: unknown }).tasks, before);
	// Showing the cancelled task changes the list shown, but keeps the quick filter.
	await opened.view.onUpdateOptions({ ...options, hideStatusTasks: ["x"] });
	assert.deepEqual(rows(), ["Inbox.md:0"]);
});

test("quick filter survives a reload that changes the list", async () => {
	const notes = {
		"Inbox.md": "- [ ] beta 📅 2026-01-20",
		"Later.md": "- [ ] alpha 📅 2026-01-25",
		"Done.md": "- [x] gamma 📅 2026-01-20",
	};
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge, rows } = bridgeOf(opened, app);
	bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
	const filter = bridge.state.quickFilter;
	const tasks = bridge.state.tasks;
	assert.deepEqual(rows(), ["Inbox.md:0"]);

	notes["Inbox.md"] = "- [ ] beta, renamed 📅 2026-01-20";
	opened.edited("Inbox.md");
	await opened.view.onReloadTasks();
	assert.notEqual(bridge.state.tasks, tasks);
	assert.ok(bridge.state.tasks.some((task) => task.text.includes("beta, renamed")));
	assert.equal(bridge.state.quickFilter, filter);
	assert.deepEqual(rows(), ["Inbox.md:0"]);

	const shown = opened.store.getSnapshot().shown;
	await opened.view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
	assert.notEqual(opened.store.getSnapshot().shown, shown);
	assert.equal(bridge.state.quickFilter, filter);
	assert.deepEqual(rows().sort(), ["Done.md:0", "Inbox.md:0"]);
});

test("quick entry clears the quick filter", async () => {
	const notes = { "Inbox.md": "- [ ] beta 📅 2026-01-20", "Later.md": "- [ ] alpha 📅 2026-01-25" };
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge, rows } = bridgeOf(opened, app);
	bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
	assert.ok(bridge.state.quickFilter);
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	await opened.view.onReloadTasks();
	assert.notEqual(bridge.state.tasks, opened.store.getSnapshot().tasks);
	bridge.onUpdateTasks();
	assert.equal(bridge.state.quickFilter, undefined);
	assert.equal(bridge.state.tasks, opened.store.getSnapshot().tasks);
	assert.deepEqual(rows().sort(), ["Inbox.md:0", "Later.md:0"]);
});

test("clearing the input clears the filter", async () => {
	const notes = { "Inbox.md": "- [ ] beta 📅 2026-01-20", "Later.md": "- [ ] alpha 📅 2026-01-25" };
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge, rows } = bridgeOf(opened, app);
	for (const empty of ["", undefined]) {
		bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
		assert.deepEqual(rows(), ["Inbox.md:0"]);
		bridge.handleFilterEnable(empty, empty, []);
		assert.equal(bridge.state.quickFilter, undefined);
		assert.deepEqual(rows().sort(), ["Inbox.md:0", "Later.md:0"]);
	}
});

test("inputs show the applied filter after a reload", async () => {
	const notes = { "Inbox.md": "- [ ] beta ⏫ 📅 2026-01-20", "Later.md": "- [ ] alpha 📅 2026-01-25" };
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge } = bridgeOf(opened, app);
	const markup = () => renderToStaticMarkup(bridge.render() as ReactElement);
	const unfiltered = markup();
	assert.match(unfiltered, /<option value="append" selected="">New Task<\/option>/);
	assert.doesNotMatch(unfiltered, /<input[^>]*type="date"/);

	// The priority selector passes its option value, as before.
	bridge.handleFilterEnable("2026-01-19", "2026-01-21", ["1"]);
	notes["Inbox.md"] = "- [ ] beta, renamed ⏫ 📅 2026-01-20";
	opened.edited("Inbox.md");
	await opened.view.onReloadTasks();
	const filtered = markup();
	assert.deepEqual(
		[...filtered.matchAll(/<input\b[^>]*type="date"[^>]*>/g)].map((match) => /value="([^"]*)"/.exec(match[0])?.[1]),
		["2026-01-19", "2026-01-21"],
	);
	assert.match(filtered, /<option value="filter" selected="">Filter<\/option>/);
	assert.match(filtered, /<option value="1">High🎯<\/option>/);
	assert.match(filtered, /<a>High🎯<\/a>/);
});

test("new options reach the bridge at once, and keep the quick filter while the list shown stays", async () => {
	const notes = { "Inbox.md": "- [ ] beta 📅 2026-01-20", "Later.md": "- [ ] alpha 📅 2026-01-25" };
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge, rows } = bridgeOf(opened, app);
	bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
	const reloading = opened.view.onUpdateOptions({ ...defaultUserOptions, dateFormat: "DD.MM.YYYY" });
	const state = () => bridge.state as { userOptions: UserOption; quickFilter?: object };
	assert.equal(state().userOptions.dateFormat, "DD.MM.YYYY", "before the reload is done");
	await reloading;
	assert.ok(state().quickFilter);
	assert.deepEqual(rows(), ["Inbox.md:0"]);
});

test("the bridge takes in what changed between drawing it and mounting it, and nothing after it unmounts", async () => {
	const notes = { "Inbox.md": "- [ ] beta 📅 2026-01-20" };
	const app = notesApp(notes);
	const opened = openView(app);
	const bridge = new ObsidianBridge({ plugin: { app } as never, store: opened.store, writer: opened.writer });
	let updates = 0;
	const mounted = bridge as unknown as { state: object };
	bridge.setState = ((update: object | ((state: object) => object)) => {
		updates += 1;
		mounted.state = { ...mounted.state, ...(typeof update === "function" ? update(mounted.state) : update) };
	}) as never;
	await opened.view.onUpdateOptions({ ...defaultUserOptions, dateFormat: "DD.MM.YYYY" });
	bridge.componentDidMount();
	const state = () => bridge.state as { userOptions: UserOption; tasks: readonly { id: string }[] };
	assert.equal(state().userOptions.dateFormat, "DD.MM.YYYY");
	assert.deepEqual(ids(state().tasks), ["Inbox.md:0"]);
	bridge.componentWillUnmount();
	const before = updates;
	notes["Inbox.md"] = "- [ ] beta, edited 📅 2026-01-20";
	opened.edited("Inbox.md");
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	assert.equal(updates, before);
});

test("a reload that ends before the bridge renders with the same list shown brings its tasks along", async () => {
	const notes = {
		"A.md": "- [ ] alpha 📅 2026-01-20",
		"B.md": "- [ ] beta 📅 2026-01-25",
		"H.md": "- [x] hidden 📅 2026-01-15",
	};
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: ["x"] });
	const { bridge, flush, rows } = deferredBridgeOf(opened, app);
	notes["A.md"] = "- [ ] alpha, renamed 📅 2026-01-20";
	opened.edited("A.md");
	const first = opened.view.onReloadTasks();
	// While the first reload runs: the hidden task changes, and new options ask for another reload.
	notes["H.md"] = "- [-] hidden 📅 2026-01-15";
	opened.edited("H.md");
	const second = opened.view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: ["-"] });
	await first;
	await second;
	flush();
	assert.equal((bridge.state as { tasks: unknown }).tasks, opened.store.getSnapshot().tasks);
	assert.deepEqual(rows().sort(), ["A.md:0", "B.md:0"]);
});

test("a bridge mounted before the first reload keeps the quick filter", async () => {
	const notes = { "Inbox.md": "- [ ] beta 📅 2026-01-20", "Done.md": "- [x] gamma 📅 2026-01-15" };
	const app = notesApp(notes);
	const opened = openView(app);
	// The order onOpen uses: the bridge is drawn and mounted, then the options arrive and the notes are read.
	const { bridge, rows } = bridgeOf(opened, app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	bridge.handleFilterEnable("2026-01-25", "2026-01-30", []);
	assert.deepEqual(rows(), []);
	await opened.view.onReloadTasks();
	assert.deepEqual(rows(), [], "the same notes");
	await opened.view.onUpdateOptions({ ...defaultUserOptions, dateFormat: "DD.MM.YYYY" });
	assert.deepEqual(rows(), [], "a setting that changes nothing shown");
	const before = (bridge.state as { tasks: unknown }).tasks;
	notes["Done.md"] = "- [-] gamma 📅 2026-01-15";
	opened.edited("Done.md");
	await opened.view.onReloadTasks();
	assert.equal((bridge.state as { tasks: unknown }).tasks, before, "an edit of a hidden task");
	assert.deepEqual(rows(), []);
});

// What the old list held, field by field, compared the way Backbone compared it

const resolvedLine = (line: string) => {
	const task = parseTaskLine(line, { moment, path: "Inbox.md" });
	assert.ok(task);
	return resolveTasks([task], { forward: true }, { now: moment(), moment }).shown[0];
};

/** Whether a reload hands the bridge a new list from one task's held list to the other's. */
function changes(from: ResolvedTask, to: ResolvedTask): boolean {
	const before = { ...initialTimelineState(), shown: [heldOf(from)] };
	return withReload(before, [], [heldOf(to)]).shown !== before.shown;
}

test("the list shown changes with every field the old list held", () => {
	const r = resolvedLine("- [ ] write #work ⏫ 🔁 every week 📅 2026-01-20");
	const task = (changes: object) => ({ ...r, task: { ...r.task, ...changes } }) as ResolvedTask;
	const range = { start: { line: 1, col: 0, offset: 9 }, end: { line: 1, col: 9, offset: 18 } };
	const variants: Record<string, ResolvedTask> = {
		id: task({ id: "Inbox.md:1" }),
		position: task({ position: range }),
		lineCount: task({ lineCount: 2 }),
		text: task({ text: "- [ ] write more" }),
		symbol: task({ symbol: "*" }),
		statusMarker: task({ statusMarker: "/" }),
		completed: task({ completed: true }),
		fullyCompleted: task({ fullyCompleted: true }),
		checked: task({ checked: false }),
		isTasksTask: task({ isTasksTask: false }),
		priority: task({ priority: "Low" }),
		recurrence: task({ recurrence: "every day" }),
		tags: task({ tags: ["#home"] }),
		section: task({ section: { ...r.task.section, subpath: "Heading" } }),
		outlinks: task({ outlinks: [{ path: "Other.md", type: "file", embed: false }] }),
		frontmatter: task({ note: { ...r.task.note, frontmatter: { color: "red" } } }),
		status: { ...r, status: "overdue" },
		order: { ...r, order: 3 },
		dailyNote: { ...r, dailyNote: true },
		dates: { ...r, dates: { ...r.dates, due: moment("2026-01-21", "YYYY-MM-DD", true) } },
		visual: { ...r, visual: "2:00 pm write" },
	};
	for (const [field, variant] of Object.entries(variants)) assert.ok(changes(r, variant), field);
	assert.ok(
		!changes(r, resolvedLine("- [ ] write #work ⏫ 🔁 every week 📅 2026-01-20")),
		"the same line read again",
	);
});

test("the list shown does not change with what the old list did not hold or Backbone did not compare", () => {
	const r = resolvedLine("- [ ] write 📅 2026-01-20 [unplanned:: 2026-01-18]");
	const variants: Record<string, ResolvedTask> = {
		// What comes before the list marker, such as a quote's "> " in place of indentation of the same width.
		sourceLine: { ...r, task: { ...r.task, sourceLine: "> - [ ] write 📅 2026-01-20" } },
		"the note's tags": { ...r, task: { ...r.task, note: { ...r.task.note, tags: ["#project"] } } },
		// The old list kept these in a Map.
		extraDates: { ...r, extraDates: [["unplanned", moment("2026-01-19", "YYYY-MM-DD", true)]] },
		forwarded: { ...r, forwarded: "forwarded" },
	};
	assert.ok(r.extraDates.length === 1);
	for (const [field, variant] of Object.entries(variants)) assert.ok(!changes(r, variant), field);
});

/** Real writer events, shared pins and two independent view debounces, on one controllable clock. */
async function writingViews(t: TestContext, text = "- [ ] Pay", toggle?: (line: string) => string) {
	const h = writerHarness({ "Note.md": text });
	t.mock.method(globalThis, "setTimeout", h.clock.setTimeout as never);
	t.mock.method(globalThis, "clearTimeout", h.clock.clearTimeout as never);
	const shared = timelineTaskIndex(h.app as never);
	const writer = h.create({
		index: {
			hold(path) {
				const token = shared.hold(path);
				const spy = h.index.hold(path);
				return {
					release(options) {
						token.release(options);
						spy.release(options);
					},
				};
			},
			markDirty(paths) {
				shared.markDirty(paths);
				h.index.markDirty(paths);
			},
		},
		...(toggle ? { tasks: () => ({ kind: "toggle" as const, toggle }) } : {}),
	});
	const document = {
		createDocumentFragment: () => new FakeElement("#document-fragment"),
		createTextNode: (text: string) => new FakeElement("#text", { text }),
		createElement: (tag: string) => new FakeElement(tag),
	} as unknown as Document;
	const presenter = createNoticePresenter(h.app as never, { document, openNote: async () => {} });
	const opened: {
		view: TasksTimelineView;
		store: Store<TimelineState>;
		bridge: ObsidianBridge;
		renders: () => number;
		reloads: () => number;
	}[] = [];
	for (let i = 0; i < 2; i++) {
		const view = new TasksTimelineView({ app: h.app } as never, shared, writer, presenter);
		h.leaves.push({ view });
		const store = (view as unknown as { store: Store<TimelineState> }).store;
		await view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
		await view.onOpen();
		const bridge = new ObsidianBridge({
			plugin: { app: h.app } as never,
			store,
			writer: view.viewWriter,
			ledger: view.ledger,
			pendingWrites: view.pendingWrites,
			onWriteResult: view.onWriteResult,
		});
		let renders = 0;
		bridge.setState = ((update: object | ((state: object, props: object) => object)) => {
			renders++;
			(bridge as unknown as { state: object }).state = {
				...bridge.state,
				...(typeof update === "function" ? update(bridge.state, bridge.props) : update),
			};
		}) as never;
		bridge.componentDidMount();
		let reloads = 0;
		const reload = view.onReloadTasks.bind(view);
		view.onReloadTasks = () => {
			reloads++;
			return reload();
		};
		opened.push({ view, store, bridge, renders: () => renders, reloads: () => reloads });
	}
	// Startup's one-shot resolved listener must not turn later writes into a full-read request.
	h.app.metadataCache.trigger("resolved");
	await h.clock.advance(500);
	const counts = opened.map((o) => o.reloads());
	const model = (which = 0, line = 0): TaskRowModel => {
		const task = opened[which].bridge.state.tasks.find((task) => task.line === line)!;
		assert.ok(task, `task at line ${line}`);
		return { ...task, position: task.position } as unknown as TaskRowModel;
	};
	t.after(async () => {
		for (const { view, bridge } of opened) {
			bridge.componentWillUnmount();
			await view.onClose();
		}
		writer.dispose();
		presenter.dispose();
		shared.dispose();
	});
	return {
		h,
		writer,
		opened,
		model,
		counts,
		async click(which = 0, line = 0) {
			const result = await opened[which].bridge.handleCompleteTask(model(which, line), {} as MouseEvent);
			assert.ok(result, "in-place clicks return the writer result");
			return result;
		},
	};
}

test("the overlay clears after a reload that started after release though shown is unchanged", async (t) => {
	const listeners = new Set<(event: WriteEvent) => void>();
	let seq = 0;
	const writer: TaskWriter = {
		...unusedWriter,
		onWrite(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		releaseSeq: () => seq,
	};
	const app = { ...notesApp({ "Note.md": "- [ ] Pay" }), workspace: { getLeavesOfType: () => [] } };
	const opened = openView(app, writer);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge } = bridgeOf(opened, app);
	const render = t.mock.method(bridge, "setState");
	t.after(async () => {
		bridge.componentWillUnmount();
		await opened.view.onClose();
	});
	const event = { id: 1, path: "Note.md", line: 0, sourceLine: "- [ ] Pay", lines: ["- [x] Pay"] };
	for (const listener of listeners) listener({ ...event, kind: "pending" });
	assert.ok(opened.view.pendingWrites.getSnapshot("Note.md:0"));
	seq = 1;
	for (const listener of listeners) listener({ ...event, kind: "released", releaseSeq: seq });
	const before = opened.store.getSnapshot().shown;
	await opened.view.onReloadTasks();
	assert.equal(opened.store.getSnapshot().shown, before);
	assert.equal(opened.view.pendingWrites.getSnapshot("Note.md:0"), undefined);
	assert.equal(render.mock.callCount(), 0);
});

test("a reload started before release does not clear it", async (t) => {
	const f = await writingViews(t);
	await f.click();
	const first = f.opened[0];
	const reload = first.view.onReloadTasks();
	f.h.changed("Note.md");
	await reload;
	assert.ok(first.view.pendingWrites.getSnapshot("Note.md:0"));
	await first.view.onReloadTasks();
	assert.equal(first.view.pendingWrites.getSnapshot("Note.md:0"), undefined);
});

test("an overwrite clears the overlay at once in every open timeline", async (t) => {
	const f = await writingViews(t);
	await f.click();
	for (const o of f.opened) assert.ok(o.view.pendingWrites.getSnapshot("Note.md:0"));
	f.h.put("Note.md", "- [ ] Pay");
	f.h.changed("Note.md");
	await flush();
	for (const o of f.opened) assert.equal(o.view.pendingWrites.getSnapshot("Note.md:0"), undefined);
	const before = f.opened.map((o) => o.bridge.state.tasks);
	await f.h.clock.advance(500);
	for (const [i, o] of f.opened.entries()) {
		assert.equal(o.reloads() - f.counts[i], 1);
		assert.notEqual(o.bridge.state.tasks, before[i]);
	}
});

test("refusal reload hands the bridge new tasks", async (t) => {
	const f = await writingViews(t, "- [ ] Pay %% ⏰ 2026-10-31 12:00 %%");
	const old = f.opened.map((o) => o.bridge.state.tasks);
	const shown = f.opened.map((o) => o.store.getSnapshot().shown);
	f.h.cache.set("Note.md", "- [ ] Pay %% ⏰ 2026-10-31 13:00 %%");
	f.h.put("Note.md", "- [ ] Pay %% ⏰ 2026-10-31 13:00 %%");
	await f.click();
	await f.h.clock.advance(2500);
	for (const [i, o] of f.opened.entries()) {
		assert.notEqual(o.bridge.state.tasks, old[i]);
		assert.equal(o.store.getSnapshot().shown, shown[i]);
		assert.equal(o.bridge.state.tasks[0].sourceLine, "- [ ] Pay %% ⏰ 2026-10-31 13:00 %%");
	}
});

test("the line shift is cleared with the rows written after it", async (t) => {
	const f = await writingViews(t, "- [ ] a 🔁 every day\n- [ ] b", (line) =>
		line.includes("every day") ? "- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-31" : "- [x] b",
	);
	await f.click();
	assert.equal(f.opened[0].view.ledger.shift("Note.md", 1), 2);
	f.h.changed("Note.md");
	await f.h.clock.advance(500);
	assert.equal(f.opened[0].view.ledger.shift("Note.md", 2), 2);
	await f.click(0, 2);
	assert.equal(f.h.events.filter((e) => e.kind === "pending").at(-1)?.line, 2);
});

test("one Undo notice per write, only in the view that started it", async (t) => {
	const f = await writingViews(t);
	const before = TestNotice.instances.length;
	await f.click();
	const notices = TestNotice.instances.slice(before).filter((n) => n.duration === 10000);
	assert.equal(notices.length, 1);
	assert.equal(notices[0].duration, 10000);
	const content = notices[0].message as FakeElement;
	assert.equal((content.children[0] as FakeElement).textContent, "Completed “Pay” in Note.");
	const buttons = content.children.filter((c): c is FakeElement => c instanceof FakeElement && c.tag === "button");
	assert.deepEqual(
		buttons.map((b) => b.textContent),
		["Undo", "Open note"],
	);
	buttons[0].click();
	buttons[0].click();
	await flush();
	assert.equal(f.h.events.filter((e) => e.kind === "written").length, 2);
	assert.equal(f.h.text("Note.md"), "- [ ] Pay");
	const target = f.h.target(0, "Note.md");
	const unchanged = await f.writer.write(() => target, { kind: "date", field: "due", day: null });
	assert.equal(unchanged.kind, "unchanged");
	f.opened[0].view.onWriteResult(target, unchanged);
	f.h.put("Note.md", "- [ ] Changed");
	await f.click();
	assert.equal(f.h.refusals.at(-1)?.reason, "line-changed");
	assert.equal(
		TestNotice.instances.slice(before).filter((n) => n.duration === 10000).length,
		1,
		"refusal and unchanged results create no undo notice",
	);
});

test("120 s without events → release, markDirty, console.warn, each view reloads once and hands the bridge new tasks, overlay cleared, the next click can write", async (t) => {
	const f = await writingViews(t);
	await f.click();
	const before = f.opened.map((o) => o.bridge.state.tasks);
	await f.h.clock.advance(120500);
	assert.ok(f.h.dirty.includes("Note.md"));
	assert.equal(f.h.warnings.length, 1);
	for (const [i, o] of f.opened.entries()) {
		assert.equal(o.reloads() - f.counts[i], 1);
		assert.notEqual(o.bridge.state.tasks, before[i]);
		assert.equal(o.view.pendingWrites.getSnapshot("Note.md:0"), undefined);
	}
	await f.click();
	assert.equal(f.h.events.filter((e) => e.kind === "written").length, 2);
});

test("revert report: each view reloads once handing the bridge new tasks, overlay cleared; with two timelines the revert notice appears once", async (t) => {
	const f = await writingViews(t);
	await f.click();
	f.h.put("Note.md", "- [ ] Pay");
	f.h.changed("Note.md");
	await f.h.clock.advance(500);
	assert.equal(f.h.reverts.length, 1);
	for (const [i, o] of f.opened.entries()) {
		assert.equal(o.reloads() - f.counts[i], 1);
		assert.equal(o.view.pendingWrites.getSnapshot("Note.md:0"), undefined);
		assert.equal(o.bridge.state.tasks, o.store.getSnapshot().tasks);
	}
});

test("line-changed: no event for 2 s → each view reloads once handing new tasks; changed within 500 ms → none", async (t) => {
	const f = await writingViews(t);
	f.h.put("Note.md", "- [ ] Changed");
	await f.click();
	await f.h.clock.advance(1999);
	for (const [i, o] of f.opened.entries()) assert.equal(o.reloads(), f.counts[i]);
	await f.h.clock.advance(501);
	for (const [i, o] of f.opened.entries()) {
		assert.equal(o.reloads() - f.counts[i], 1);
		assert.equal(o.bridge.state.tasks, o.store.getSnapshot().tasks);
	}
	f.h.put("Note.md", "- [ ] Again");
	await f.click();
	await f.h.clock.advance(500);
	f.h.changed("Note.md");
	await f.h.clock.advance(2000);
	assert.equal(
		f.h.events.filter((e) => e.kind === "recheck").length,
		1,
		"the changed event cancels the second refusal's recheck",
	);
});

test("save-first (check 5) never returns → may-not-have-been-saved at 60 s, overlay cleared, queue blocked", async (t) => {
	const f = await writingViews(t);
	const view = f.h.view("Note.md");
	view.type("- [ ] Pay\nunsaved");
	const gate = deferred();
	view.beforeSave = () => gate.promise;
	const writing = f.click();
	await flush();
	for (const o of f.opened) assert.ok(o.view.pendingWrites.getSnapshot("Note.md:0"));
	await f.h.clock.advance(60000);
	await writing;
	assert.ok(f.h.notices.some((n) => n.includes("may not have been saved")));
	for (const o of f.opened) assert.equal(o.view.pendingWrites.getSnapshot("Note.md:0"), undefined);
	await f.click();
	assert.equal(f.h.refusals.at(-1)?.reason, "queue-blocked");
	gate.resolve();
	await flush();
});

test("slow at 10 s: row undimmed, written state kept, a click reaches the writer and is refused not-reread", async (t) => {
	const f = await writingViews(t);
	await f.click();
	await f.h.clock.advance(10000);
	for (const [i, o] of f.opened.entries()) {
		assert.equal(o.view.pendingWrites.getSnapshot("Note.md:0")?.dimmed, false);
		assert.equal(o.view.pendingWrites.getSnapshot("Note.md:0")?.marker, "x");
		assert.equal(o.reloads(), f.counts[i]);
	}
	await f.click();
	assert.equal(f.h.refusals.at(-1)?.reason, "not-reread");
	assert.equal(f.h.writes.length, 1);
});

test("quick entry at line 1, then clicking a row read at line 3 targets line 4", async (t) => {
	const f = await writingViews(t, "## Tasks\nparagraph\nother\n- [ ] b");
	await f.opened[0].bridge.handleCreateNewTask("Note.md", "new");
	await f.click(0, 3);
	assert.equal(f.h.events.filter((e) => e.kind === "pending" && !e.insertBefore).at(-1)?.line, 4);
	assert.match(f.h.text("Note.md"), /- \[x\] b/);
});

test("terminal results leave no view bookkeeping waiting for an unrelated reload", async (t) => {
	const f = await writingViews(t);
	for (let i = 0; i < 3; i++)
		await f.writer.write(() => ({ path: "Note.md", line: 0, sourceLine: "not a task" }), { kind: "toggle" });
	const unchanged = await f.writer.write(() => f.h.target(0, "Note.md"), { kind: "date", field: "due", day: null });
	assert.equal(unchanged.kind, "unchanged");
	for (const { view } of f.opened) {
		const bookkeeping = view as unknown as { writes: Map<number, unknown>; releases: Map<number, number> };
		assert.equal(bookkeeping.writes.size, 0);
		assert.equal(bookkeeping.releases.size, 0);
	}
});

test("a write finishing after its view closes forgets its undo and adds no shift", async (t) => {
	const f = await writingViews(
		t,
		"- [ ] a 🔁 every day\n- [ ] b",
		() => "- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-31",
	);
	const gate = deferred();
	f.h.onProcess(() => gate.promise);
	const gone: number[] = [];
	f.writer.onUndoGone((record) => gone.push(record.id));
	const writing = f.click();
	await flush();
	await f.opened[0].view.onClose();
	gate.resolve();
	const result = await writing;
	assert.equal(result.kind, "written");
	if (result.kind === "written") assert.deepEqual(gone, [result.id]);
	assert.equal(f.opened[0].view.ledger.shift("Note.md", 1), 1);
});

test("a released write already rendered before its result is handled adds no stale shift", async (t) => {
	const f = await writingViews(
		t,
		"- [ ] a 🔁 every day\n- [ ] b",
		() => "- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-31",
	);
	const target = f.h.target(0, "Note.md");
	const result = await f.writer.write(() => target, { kind: "toggle" });
	f.h.changed("Note.md");
	await f.h.clock.advance(500);
	f.opened[0].view.onWriteResult(target, result);
	assert.equal(f.opened[0].view.ledger.shift("Note.md", 2), 2);
});

test("a pending write released and rendered by rename cannot restore a cleared shift when it finishes", async (t) => {
	const f = await writingViews(
		t,
		"- [ ] a 🔁 every day\n- [ ] b",
		() => "- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-31",
	);
	const gate = deferred();
	f.h.afterProcess(() => gate.promise);
	const writing = f.click();
	await flush();
	f.h.rename("Note.md", "Moved.md");
	f.h.changed("Moved.md");
	await f.h.clock.advance(500);
	assert.equal(f.opened[0].view.pendingWrites.getSnapshot("Note.md:0"), undefined);
	gate.resolve();
	assert.equal((await writing).kind, "written");
	assert.equal(f.opened[0].view.ledger.shift("Moved.md", 2), 2);
});
