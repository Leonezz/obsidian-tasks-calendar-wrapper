// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import { GOLDEN_NOW } from "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "backbone";
import { Notice } from "obsidian";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseTaskLine, resolveTasks, type ResolvedTask } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { heldOf, TasksTimelineView } from "../src/views";
import { ObsidianBridge, quickFilterOf } from "../timeline/src/obsidianbridge";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { goldenApp, loadVault } from "./golden-vault";
import { rowsOf } from "./markup";

// The timeline's view reads the notes with core's readTasks and hands the bridge the tasks, and the list the old view
// held of the tasks it shows. The bridge renders again when either changes, and clears the quick filter when the list
// shown changes, which is when the old list, and the quick filter applied to it, was replaced.

const DAY = 24 * 60 * 60 * 1000;

/** A timeline view opened on an app, counting the model's changes. */
function openView(app: unknown) {
	const view = new TasksTimelineView({ app } as never);
	const internals = view as unknown as { taskListModel: Model; userOptionModel: Model };
	let changes = 0;
	internals.taskListModel.on("change", () => (changes += 1));
	return { view, model: internals.taskListModel, userOptionModel: internals.userOptionModel, changes: () => changes };
}

/** An app whose notes have one task each, on their first line, and can be edited between reloads. */
function notesApp(notes: Record<string, string>) {
	return {
		vault: {
			getMarkdownFiles: () => Object.keys(notes).map((path) => ({ path })),
			cachedRead: async (file: { path: string }) => notes[file.path],
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const end =
					notes[file.path].indexOf("\n") < 0 ? notes[file.path].length : notes[file.path].indexOf("\n");
				const position = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: end, offset: end } };
				return { listItems: [{ task: " ", parent: -1, position }], sections: [], links: [], tags: [] };
			},
		},
		plugins: { plugins: {} },
	};
}

/**
 * The bridge of a view, mounted without a DOM: its state is applied at once, and it renders to markup. The bridge
 * listens to the view's models as it does in Obsidian.
 */
function bridgeOf(opened: ReturnType<typeof openView>, app: unknown) {
	const bridge = new ObsidianBridge({
		plugin: { app } as never,
		userOptionModel: opened.userOptionModel,
		taskListModel: opened.model,
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

const ids = (tasks: readonly { id: string }[]) => tasks.map((task) => task.id);

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

test("a reload hands the bridge the tasks readTasks reads, and what it shows of them", async () => {
	const { view, model } = openView(goldenApp(loadVault()));
	await view.onUpdateOptions({ ...defaultUserOptions });
	const expected = await readTasks(goldenApp(loadVault()), defaultUserOptions, moment);
	assert.ok(expected.length > 100);
	assert.deepEqual(ids(model.get("tasks")), ids(expected));
	const shown = resolveTasks(expected, defaultUserOptions, { now: moment(), moment }).shown;
	assert.deepEqual(ids(model.get("shown")), ids(shown.map((r) => r.task)));
});

test("a reload reads the notes the user's note filters keep", async () => {
	const { view, model } = openView(goldenApp(loadVault()));
	await view.onUpdateOptions({ ...defaultUserOptions, excludePaths: ["Inbox.md"] });
	const tasks: { path: string }[] = model.get("tasks");
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

test("a reload that fails says so, and the next reload runs", async () => {
	const app = goldenApp(loadVault()) as { vault: { getMarkdownFiles: () => unknown[] } };
	const listed = app.vault.getMarkdownFiles;
	let fail = true;
	app.vault.getMarkdownFiles = () => {
		if (!fail) return listed();
		fail = false;
		throw new Error("the vault is not ready");
	};
	const { view, model } = openView(app);
	shownNotices.length = 0;
	await view.onUpdateOptions({ ...defaultUserOptions });
	assert.deepEqual(shownNotices, ["Error when generating tasks from files: Error: the vault is not ready"]);
	assert.deepEqual(model.get("tasks"), []);
	await view.onReloadTasks();
	assert.ok(model.get("tasks").length > 100);
});

// The quick filter, as the bridge keeps it

test("the quick filter keeps the priorities it was applied with, while the panel goes on changing its list", () => {
	const panelList = ["High"];
	const filter = quickFilterOf("2026-01-10", "2026-01-20", panelList);
	panelList.push("Low");
	assert.deepEqual(filter, { from: "2026-01-10", to: "2026-01-20", priorities: ["High"] });
	assert.ok(Object.isFrozen(filter) && Object.isFrozen(filter.priorities));
});

test("the quick filter lasts until the list shown changes, as it did", async () => {
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
	const before = (bridge.state as { tasks: unknown }).tasks;
	await opened.view.onReloadTasks();
	assert.equal(opened.changes(), 2, "the hidden task changed");
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	// Nothing shown changed, so the timeline does not render again, as before.
	assert.equal((bridge.state as { tasks: unknown }).tasks, before);
	// Showing the cancelled task changes the list shown, which clears it.
	await opened.view.onUpdateOptions({ ...options, hideStatusTasks: ["x"] });
	assert.deepEqual(rows().sort(), ["Done.md:0", "Inbox.md:0", "Later.md:0", "Someday.md:0"]);
});

test("a task edited where it is shown clears the quick filter, and so does a task added by the quick entry", async () => {
	const notes = { "Inbox.md": "- [ ] beta 📅 2026-01-20", "Later.md": "- [ ] alpha 📅 2026-01-25" };
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const { bridge, rows } = bridgeOf(opened, app);
	bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
	notes["Later.md"] = "- [ ] alpha, renamed 📅 2026-01-25";
	await opened.view.onReloadTasks();
	assert.deepEqual(rows().sort(), ["Inbox.md:0", "Later.md:0"]);

	bridge.handleFilterEnable("2026-01-19", "2026-01-21", []);
	assert.deepEqual(rows(), ["Inbox.md:0"]);
	bridge.onUpdateTasks();
	assert.deepEqual(rows().sort(), ["Inbox.md:0", "Later.md:0"]);
});

// What the old list held, field by field, compared the way Backbone compares it

const resolvedLine = (line: string) => {
	const task = parseTaskLine(line, { moment, path: "Inbox.md" });
	assert.ok(task);
	return resolveTasks([task], { forward: true }, { now: moment(), moment }).shown[0];
};

/** Whether Backbone sees a change from one task's held list to the other's. */
function changes(from: ResolvedTask, to: ResolvedTask): boolean {
	const model = new Model({ shown: [heldOf(from)] });
	model.set({ shown: [heldOf(to)] });
	return model.hasChanged("shown");
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
