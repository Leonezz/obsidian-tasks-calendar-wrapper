// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Notice } from "obsidian";

import type { Store } from "@tasks-calendar-wrapper/core";
import type { TimelineState } from "../src/state/timeline";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { TasksTimelineView, timelineTaskIndex } from "../src/views";
import type { SharedTaskIndex } from "../timeline/src/sharedindex";
import { fakeVault, type FakeVault } from "./fakevault";
import { ourLines } from "./indexed-vault";
import { roots } from "./stubs/react-dom-client";

// What the timeline's view does when the vault changes: which events reload it, and when, and which notes a reload
// reads. The edits fire the events Obsidian fires for them, see tests/fakevault.ts, so the tests hold whatever the view
// listens to.

/** Changes that arrive within this time of each other are applied in one reload, see views.tsx. */
const RELOAD_DELAY_MS = 500;

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

/** Obsidian's views open and close this way; its typings do not declare it, the stub does. */
interface Opening {
	open(): Promise<void>;
	close(): Promise<void>;
}

/** The task index each vault's timelines share, as the plugin's do. */
const sharedIndexes = new WeakMap<FakeVault, SharedTaskIndex>();
function sharedIndexOf(vault: FakeVault): SharedTaskIndex {
	const known = sharedIndexes.get(vault);
	if (known) return known;
	const made = timelineTaskIndex(vault.app as never);
	sharedIndexes.set(vault, made);
	return made;
}

/** Lets the reads of a reload, which need no timer, finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Lets the given time pass on the mocked clock, then the reload that starts then finish. */
async function wait(t: TestContext, ms: number): Promise<void> {
	t.mock.timers.tick(ms);
	await settle();
}

/**
 * Opens a timeline on the vault as the plugin does: its view factory hands the new view the options, which reads the
 * notes, and Obsidian then opens the view. With `resolved`, Obsidian's first "resolved" after opening has come too, as
 * it does after the first edit of any note, so later events show on their own. The counts start after that.
 */
async function openTimeline(
	t: TestContext,
	vault: FakeVault,
	{ resolved = true, options = {} }: { resolved?: boolean; options?: Partial<UserOption> } = {},
) {
	const leaf = vault.app.workspace.addLeaf();
	const view = new TasksTimelineView(leaf as never, sharedIndexOf(vault));
	const loading = view.onUpdateOptions({ ...defaultUserOptions, ...options });
	leaf.view = view;
	await (view as unknown as Opening).open();
	await loading;
	if (resolved) {
		vault.resolve();
		await wait(t, RELOAD_DELAY_MS);
	}
	const listed = vault.listings();
	return {
		view,
		/** The reloads since the timeline opened, as the view's task index lists the notes once each time. */
		reloads: () => vault.listings() - listed,
		close: async () => {
			await (view as unknown as Opening).close();
			vault.app.workspace.removeLeaf(leaf);
		},
	};
}

const notes = () => ({
	"Inbox.md": "- [ ] call the plumber 📅 2026-01-20",
	"Projects/Garden.md": "# Garden\n\n- [ ] plant the tulips\n- [x] buy bulbs",
	"Reference/Plain.md": "# Plain\n\n- a list item\n- another one",
	"Archive/Old.md": "- [ ] an old task",
});

test("a change to a note with tasks reloads once, 500 ms after it", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	vault.write("Inbox.md", "- [ ] call the plumber again 📅 2026-01-20");
	await wait(t, RELOAD_DELAY_MS - 1);
	assert.equal(timeline.reloads(), 0);
	await wait(t, 1);
	assert.equal(timeline.reloads(), 1);
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
});

test("changes in a burst reload once, 500 ms after the last of them", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	vault.write("Inbox.md", "- [ ] call");
	await wait(t, 300);
	vault.write("Projects/Garden.md", "- [ ] plant");
	await wait(t, 300);
	vault.write("Inbox.md", "- [ ] call the plumber");
	await wait(t, RELOAD_DELAY_MS - 1);
	assert.equal(timeline.reloads(), 0);
	await wait(t, 1);
	assert.equal(timeline.reloads(), 1);
});

test("a change to a note that has no tasks and had none does not reload", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	vault.write("Reference/Plain.md", "# Plain\n\n- a list item, edited");
	vault.write("Reference/New.md", "Text without a list.");
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0);
});

test("the first resolved after opening reloads once, as after the first edit of any note; later ones do not", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault, { resolved: false });
	// Obsidian resolves the links again after any edit, even of a note without tasks.
	vault.write("Reference/Plain.md", "# Plain, edited");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	vault.write("Reference/Plain.md", "# Plain, edited again");
	vault.resolve();
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
});

test("removing a note's last task reloads, and later changes to the note do not", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	vault.write("Inbox.md", "Called the plumber.");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	vault.write("Inbox.md", "Called the plumber, who is coming on Monday.");
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
});

test("deleting a note reloads when the metadata it had has tasks, even of a note the timeline does not read", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	// The timeline does not read the archive, so its tasks are not among those it read at the last reload.
	const timeline = await openTimeline(t, vault, { options: { excludePaths: ["Archive"] } });
	assert.ok(!vault.reads.includes("Archive/Old.md"));
	vault.remove("Reference/Plain.md");
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0, "a note without tasks");
	vault.remove("Archive/Old.md");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1, "the tasks the deleted note had");
	vault.remove("Inbox.md");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 2, "a note the timeline read tasks from");
});

test("renaming a note reloads when it has tasks; renaming a folder reloads once for the notes in it", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault({ ...notes(), "Empty/Plain.md": "# Plain", "Projects/Pond.md": "- [ ] dig the pond" });
	const timeline = await openTimeline(t, vault);
	vault.rename("Reference/Plain.md", "Reference/Renamed.md");
	vault.rename("Empty", "Still empty");
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0, "notes and folders without tasks");
	vault.rename("Inbox.md", "Errands.md");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1, "a note with tasks");
	// Obsidian renames the folder and then each of its two notes with tasks, each with an event.
	vault.rename("Projects", "Done projects");
	await wait(t, RELOAD_DELAY_MS - 1);
	assert.equal(timeline.reloads(), 1, "a folder's notes are changes like any other");
	await wait(t, 1);
	assert.equal(timeline.reloads(), 2, "a folder with notes with tasks");
	assert.ok(vault.reads.includes("Done projects/Garden.md") && vault.reads.includes("Done projects/Pond.md"));
});

test("renaming a note to a file that is not a note reloads, as the tasks it had are gone", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	// Obsidian moves the metadata to the new path, where a file that is not a note has none; the path the timeline read
	// tasks from is what counts.
	vault.rename("Inbox.md", "Inbox.txt");
	const read = vault.reads.length;
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	assert.ok(!vault.reads.slice(read).some((path) => path.startsWith("Inbox")));
});

test("renaming a note the timeline does not read reloads when the note has tasks", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault, { options: { excludePaths: ["Archive"] } });
	// Neither path was read at the last reload; the metadata at the new path has the tasks.
	vault.rename("Archive/Old.md", "Archive/Older.md");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
});

test("a new window reloads at once", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	vault.openWindow();
	await settle();
	assert.equal(timeline.reloads(), 1);
});

test("closing a timeline drops the reload it was waiting for, and it hears no more changes", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const root = roots[roots.length - 1];
	assert.equal(root.rendered.length, 1, "opening mounts the bridge");
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS / 2);
	await timeline.close();
	assert.ok(root.unmounted);
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0, "the reload it was waiting for");
	vault.write("Inbox.md", "- [ ] call the plumber once more");
	vault.remove("Archive/Old.md");
	vault.rename("Projects/Garden.md", "Projects/Flowers.md");
	vault.openWindow();
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0, "changes, deletions, renames and new windows after closing");
});

test("a timeline closed before Obsidian's first resolved does not reload on it", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault, { resolved: false });
	await timeline.close();
	vault.resolve();
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0);
});

test("a closed timeline hands the view task rows render with to another open one, or to none", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const first = await openTimeline(t, vault);
	const second = await openTimeline(t, vault);
	const third = await openTimeline(t, vault);
	assert.equal(TasksTimelineView.view, third.view, "the last one created");
	await first.close();
	assert.equal(TasksTimelineView.view, third.view, "closing another one keeps it");
	await third.close();
	assert.equal(TasksTimelineView.view, second.view, "the one left open");
	await second.close();
	assert.equal(TasksTimelineView.view, null);
});

test("a note that cannot be read shows the Notice once, and its reason is logged on every reload", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const errors = t.mock.method(console, "error", () => {});
	const vault = fakeVault(notes());
	vault.failReads("Projects/Garden.md");
	shownNotices.length = 0;
	const timeline = await openTimeline(t, vault);
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	const notice =
		"Tasks Calendar Wrapper: 1 file(s) could not be read, their tasks are missing. See the developer console.";
	// The view's first reload shows it; the one after Obsidian's first "resolved" and the one after the edit fail the
	// same note, so they show nothing new.
	assert.deepEqual(shownNotices, [notice]);
	// Node also reports, once, that its mocked timers are experimental.
	const failures = errors.mock.calls
		.map((call) => call.arguments)
		.filter(([message]) => String(message).startsWith("Tasks Calendar Wrapper"));
	assert.equal(failures.length, 3, "the reason, on each of the three reloads");
	for (const [message, reason] of failures) {
		assert.equal(message, "Tasks Calendar Wrapper: reading a file failed");
		assert.match(String(reason), /could not read Projects\/Garden\.md/);
	}
});

test("a task whose date cannot be read is warned about once, also when full reads read its note again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const warnings = t.mock.method(console, "warn", () => {});
	const vault = fakeVault({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	// The first reload, the full read after the first "resolved", and the full read of a new window.
	await openTimeline(t, vault);
	vault.openWindow();
	await settle();
	// The value is quoted as written after "::", with the space.
	const warning = 'Tasks Calendar Wrapper: Dates.md, line 2: could not read the date " soon" of [due:: ]';
	// moment warns once, the first time it reads a date it does not know the format of.
	const ours = warnings.mock.calls
		.map((call) => call.arguments)
		.filter(([message]) => String(message).startsWith("Tasks Calendar Wrapper"));
	assert.deepEqual(ours, [[warning]]);
});

// Which notes a reload reads. The view keeps the notes it read in its task index, see timeline/src/taskindex.ts: a
// reload reads the notes changed since the last one and those that could not be read then, and every note again where
// a change may have gone unheard.

/** The notes of notes() a reload that reads every note reads, in its order: those with a task item. */
const ALL = ["Archive/Old.md", "Inbox.md", "Projects/Garden.md"];

/** The notice a reload shows when one note could not be read. */
const ONE_FAILED =
	"Tasks Calendar Wrapper: 1 file(s) could not be read, their tasks are missing. See the developer console.";

/** The first line of each task of the note the view holds, which the bridge renders. */
const linesIn = (view: TasksTimelineView, path: string) =>
	(view as unknown as { store: Store<TimelineState> }).store
		.getSnapshot()
		.tasks.filter((task) => task.path === path)
		.map((task) => task.sourceLine);

/** The notes read from now on: each call gives those read since the call before. */
function readsOf(vault: FakeVault): () => string[] {
	let from = vault.reads.length;
	return () => {
		const read = vault.reads.slice(from);
		from = vault.reads.length;
		return read;
	};
}

test("saving a note with tasks reloads once and reads that one note, and the other notes' tasks stay", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] call the plumber again 📅 2026-01-20");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	assert.deepEqual(read(), ["Inbox.md"]);
	assert.deepEqual(linesIn(timeline.view, "Inbox.md"), ["- [ ] call the plumber again 📅 2026-01-20"]);
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), ["- [ ] plant the tulips", "- [x] buy bulbs"]);
});

test("counted as the benchmark counts them, a save with tasks reloads once and reads one note, one without none", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	// As scripts/bench.mjs counts them: it puts a counter in place of the open view's onReloadTasks and of the vault's
	// cachedRead, after the view opened.
	let reloadCalls = 0;
	const reload = timeline.view.onReloadTasks;
	timeline.view.onReloadTasks = () => {
		reloadCalls += 1;
		return reload.call(timeline.view);
	};
	let reads = 0;
	const cachedRead = vault.app.vault.cachedRead;
	vault.app.vault.cachedRead = (file) => {
		reads += 1;
		return cachedRead(file);
	};
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual({ reloadCalls, reads }, { reloadCalls: 1, reads: 1 }, "a save with tasks");
	vault.write("Reference/Plain.md", "# Plain, edited");
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.deepEqual({ reloadCalls, reads }, { reloadCalls: 1, reads: 1 }, "a save without tasks");
	// The note saved without tasks is not read at the next reload either: it has no task item.
	vault.write("Inbox.md", "- [ ] call the plumber once more");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual({ reloadCalls, reads }, { reloadCalls: 2, reads: 2 }, "the next save with tasks");
});

test("the first reload after the view opens reads every note again, as a change before it listened went unheard", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const leaf = vault.app.workspace.addLeaf();
	const view = new TasksTimelineView(leaf as never, sharedIndexOf(vault));
	// The plugin's view factory hands the new view the options, which reads the notes, before Obsidian opens it.
	await view.onUpdateOptions({ ...defaultUserOptions });
	vault.write("Inbox.md", "- [ ] call the plumber, before the view listened");
	leaf.view = view;
	await (view as unknown as Opening).open();
	const read = readsOf(vault);
	await view.onReloadTasks();
	assert.deepEqual(read(), ALL);
	assert.deepEqual(linesIn(view, "Inbox.md"), ["- [ ] call the plumber, before the view listened"]);
});

test("Obsidian's first resolved after opening reads every note again, also after a reload before it; later ones do not", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault, { resolved: false });
	// A reload before it, as for new options, reads every note, for what the view may have missed while it opened.
	await timeline.view.onReloadTasks();
	// A change no event told of, as while Obsidian starts and has not read the metadata of every note yet.
	vault.writeSilently("Inbox.md", "- [ ] call the plumber, unheard");
	const read = readsOf(vault);
	vault.resolve();
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 2);
	assert.deepEqual(read(), ALL);
	assert.deepEqual(linesIn(timeline.view, "Inbox.md"), ["- [ ] call the plumber, unheard"]);
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 3);
	assert.deepEqual(read(), ["Projects/Garden.md"], "a later resolved, which each save brings");
});

test("a new window reads every note again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	vault.writeSilently("Inbox.md", "- [ ] call the plumber, unheard");
	const read = readsOf(vault);
	vault.openWindow();
	await settle();
	assert.equal(timeline.reloads(), 1);
	assert.deepEqual(read(), ALL);
	assert.deepEqual(linesIn(timeline.view, "Inbox.md"), ["- [ ] call the plumber, unheard"]);
});

test("a note that cannot be read is read on every reload, its reason logged each time and the Notice shown once, until it can be", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const lines = ourLines(t);
	const vault = fakeVault(notes());
	vault.failReads("Projects/Garden.md");
	shownNotices.length = 0;
	const timeline = await openTimeline(t, vault);
	const told = () => ({ errors: lines.length, notices: shownNotices.length });
	// The view's first reload and the one after Obsidian's first "resolved" read every note.
	assert.deepEqual(told(), { errors: 2, notices: 1 });
	assert.deepEqual(shownNotices, [ONE_FAILED]);
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual(read(), ["Inbox.md", "Projects/Garden.md"]);
	assert.deepEqual(told(), { errors: 3, notices: 1 });
	await timeline.view.onReloadTasks();
	assert.deepEqual(read(), ["Projects/Garden.md"], "a reload with no change");
	assert.deepEqual(told(), { errors: 4, notices: 1 });
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), []);
	vault.healReads("Projects/Garden.md");
	await timeline.view.onReloadTasks();
	assert.deepEqual(read(), ["Projects/Garden.md"]);
	assert.deepEqual(told(), { errors: 4, notices: 1 }, "once it can be read");
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), ["- [ ] plant the tulips", "- [x] buy bulbs"]);
	await timeline.view.onReloadTasks();
	assert.deepEqual(read(), []);
	// It fails again: the set of failing notes changed, so the Notice shows again.
	vault.failReads("Projects/Garden.md");
	vault.write("Projects/Garden.md", "# Garden\n\n- [ ] plant the tulips again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual(read(), ["Projects/Garden.md"]);
	assert.deepEqual(told(), { errors: 5, notices: 2 });
	for (const [kind, message, reason] of lines) {
		assert.deepEqual([kind, message], ["error", "Tasks Calendar Wrapper: reading a file failed"]);
		assert.match(String(reason), /could not read Projects\/Garden\.md/);
	}
});

test("the approved change: a note read before that starts failing with no change keeps its tasks and tells nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const lines = ourLines(t);
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	shownNotices.length = 0;
	// Reading the file fails from now on, as it may for a moment, and the note does not change.
	vault.failReads("Projects/Garden.md");
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	// Every reload used to read every note, so this one dropped the note's tasks and showed a notice.
	assert.deepEqual(read(), ["Inbox.md"]);
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), ["- [ ] plant the tulips", "- [x] buy bulbs"]);
	assert.deepEqual(shownNotices, []);
	assert.deepEqual(lines, []);
	// A reload that reads every note reads it, and tells of it as before.
	vault.openWindow();
	await settle();
	assert.deepEqual(read(), ALL);
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), []);
	assert.deepEqual(shownNotices, [ONE_FAILED]);
	assert.equal(lines.length, 1);
});

test("reloads asked for while one reads the notes run once more, and a new window asked for meanwhile reads every note", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	assert.deepEqual(read(), ["Inbox.md"], "the reload's read is held");
	// While it is held, a save of another note with tasks and a new window each ask for a reload.
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	vault.openWindow();
	await settle();
	assert.equal(timeline.reloads(), 1, "they wait for the reload that runs");
	release();
	await settle();
	assert.equal(timeline.reloads(), 2, "once more");
	assert.deepEqual(read(), ALL, "every note, for the new window");
	assert.deepEqual(linesIn(timeline.view, "Inbox.md"), ["- [ ] call the plumber again"]);
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), ["- [ ] plant the roses"]);
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 2);
});

test("a reload asked for while one reads the notes reads, when it runs, the note saved meanwhile and no other", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual(read(), ["Inbox.md"], "the reload's read is held");
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1, "it waits for the reload that runs");
	release();
	await settle();
	assert.equal(timeline.reloads(), 2);
	assert.deepEqual(read(), ["Projects/Garden.md"]);
	assert.deepEqual(linesIn(timeline.view, "Inbox.md"), ["- [ ] call the plumber again"]);
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), ["- [ ] plant the roses"]);
});

test("a renamed note's warning is told under its new path; a rejected reload changes nothing; reopened, it tells again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const lines = ourLines(t);
	const vault = fakeVault({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	vault.failReads("Projects/Garden.md");
	shownNotices.length = 0;
	const first = await openTimeline(t, vault);
	const warningOf = (path: string) =>
		`Tasks Calendar Wrapper: ${path}, line 2: could not read the date " soon" of [due:: ]`;
	const warned = () => lines.filter(([kind]) => kind === "warn").map(([, message]) => message);
	assert.deepEqual(warned(), [warningOf("Dates.md")]);
	assert.deepEqual(shownNotices, [ONE_FAILED]);
	vault.rename("Dates.md", "Dated.md");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual(warned(), [warningOf("Dates.md"), warningOf("Dated.md")]);
	// A reload that rejects between two with the same failing note: no new Notice.
	vault.breakListing();
	await first.view.onReloadTasks();
	assert.deepEqual(shownNotices, [
		ONE_FAILED,
		"Error when generating tasks from files: Error: the vault is not ready",
	]);
	await first.view.onReloadTasks();
	assert.equal(shownNotices.length, 2);
	// A timeline opened again is a new one: it tells what fails and warns now.
	await first.close();
	lines.length = 0;
	shownNotices.length = 0;
	await openTimeline(t, vault);
	assert.deepEqual(warned(), [warningOf("Dated.md")]);
	assert.deepEqual(shownNotices, [ONE_FAILED]);
});

test("a task whose date cannot be read is not warned about again for another note's save; a save of its own is", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const lines = ourLines(t);
	const vault = fakeVault({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	const timeline = await openTimeline(t, vault);
	const before = lines.length;
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	assert.deepEqual(read(), ["Inbox.md"]);
	assert.deepEqual(lines.slice(before), []);
	// Its text changes and keeps the date: the same line, for new text, is told again, once.
	vault.write("Dates.md", "# Dates\n- [ ] pay the rent [due:: soon]\n- [ ] and the water");
	await wait(t, RELOAD_DELAY_MS);
	await timeline.view.onReloadTasks();
	assert.deepEqual(lines.slice(before), [
		["warn", 'Tasks Calendar Wrapper: Dates.md, line 2: could not read the date " soon" of [due:: ]'],
	]);
});

test("an option change reads no note and keeps an unchanged failing note's tasks; a note filter reads what it keeps", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	shownNotices.length = 0;
	vault.failReads("Projects/Garden.md");
	await timeline.view.onUpdateOptions({ ...defaultUserOptions, dateFormat: "YYYY-MM-DD", sort: "text-desc" });
	assert.deepEqual(read(), []);
	assert.deepEqual(linesIn(timeline.view, "Projects/Garden.md"), ["- [ ] plant the tulips", "- [x] buy bulbs"]);
	assert.deepEqual(shownNotices, []);
	vault.healReads("Projects/Garden.md");
	await timeline.view.onUpdateOptions({ ...defaultUserOptions, excludePaths: ["Archive"] });
	assert.deepEqual(read(), ["Inbox.md", "Projects/Garden.md"]);
	assert.deepEqual(linesIn(timeline.view, "Archive/Old.md"), []);
});

test("notes swapped through a third name show each other's tasks after the reload", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault({ ...notes(), "A.md": "- [ ] alpha", "B.md": "- [ ] beta" });
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	vault.rename("A.md", "T.md");
	vault.rename("B.md", "A.md");
	vault.rename("T.md", "B.md");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	assert.deepEqual(read(), ["A.md", "B.md"]);
	assert.deepEqual(linesIn(timeline.view, "A.md"), ["- [ ] beta"]);
	assert.deepEqual(linesIn(timeline.view, "B.md"), ["- [ ] alpha"]);
});

test("a reload after the time zone changed reads every note again, as their dates may fall on other days", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	const zone = process.env.TZ;
	try {
		process.env.TZ = "America/New_York";
		await timeline.view.onReloadTasks();
		assert.deepEqual(read(), ALL);
		await timeline.view.onReloadTasks();
		assert.deepEqual(read(), [], "the next one reads none");
	} finally {
		process.env.TZ = zone;
	}
});

test("a save Obsidian's metadata cache gives no metadata for is read by the next reload, of another note's change", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const timeline = await openTimeline(t, vault);
	const read = readsOf(vault);
	// As when Obsidian cannot read the saved file for its metadata: "modify" comes, "changed" does not, nor a reload.
	vault.write("Inbox.md", "- [x] call the plumber 📅 2026-01-20", { indexed: false });
	await wait(t, 10 * RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 0);
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	assert.equal(timeline.reloads(), 1);
	assert.deepEqual(read(), ["Inbox.md", "Projects/Garden.md"]);
	assert.deepEqual(
		linesIn(timeline.view, "Inbox.md"),
		["- [x] call the plumber 📅 2026-01-20"],
		"as before the index",
	);
});
