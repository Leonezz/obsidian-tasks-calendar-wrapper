// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { Notice } from "obsidian";

import type { Store } from "@tasks-calendar-wrapper/core";
import type { TimelineState } from "../src/state/timeline";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { TasksTimelineView, timelineTaskIndex } from "../src/views";
import type { SharedTaskIndex } from "../timeline/src/sharedindex";
import { readTasks } from "../timeline/src/taskadapter";
import { fakeVault, type FakeVault } from "./fakevault";
import { ALL, notes, ourLines } from "./indexed-vault";

// Several timelines on one vault share the plugin's task index: each still reloads, and tells of what it read, as it
// did with an index of its own, and a changed note is read once.

/** Changes that arrive within this time of each other are applied in one reload, see views.tsx. */
const RELOAD_DELAY_MS = 500;

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

/** What reportNoteReads shows for one note that could not be read. */
const ONE_FAILED =
	"Tasks Calendar Wrapper: 1 file(s) could not be read, their tasks are missing. See the developer console.";

/** Obsidian's views open and close this way; its typings do not declare it, the stub does. */
interface Opening {
	open(): Promise<void>;
	close(): Promise<void>;
}

/** Lets the reads of a reload, which need no timer, finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Lets the given time pass on the mocked clock, then the reload that starts then finish. */
async function wait(t: TestContext, ms: number): Promise<void> {
	t.mock.timers.tick(ms);
	await settle();
}

/**
 * Opens a timeline as the plugin's factory and Obsidian do, on the index the vault's timelines share, as
 * viewevents.test.ts does. The reloads are counted from then on, per view: the listings are the index's, of every view.
 */
async function openTimeline(
	t: TestContext,
	vault: FakeVault,
	shared: SharedTaskIndex,
	{ resolved = true, options = {} }: { resolved?: boolean; options?: Partial<UserOption> } = {},
) {
	const leaf = vault.app.workspace.addLeaf();
	const view = new TasksTimelineView(leaf as never, shared);
	const loading = view.onUpdateOptions({ ...defaultUserOptions, ...options });
	leaf.view = view;
	await (view as unknown as Opening).open();
	await loading;
	if (resolved) {
		vault.resolve();
		await wait(t, RELOAD_DELAY_MS);
	}
	const reloads = t.mock.method(view, "onReloadTasks");
	return {
		view,
		options: { ...defaultUserOptions, ...options },
		reloads: () => reloads.mock.callCount(),
		tasks: () => (view as unknown as { store: Store<TimelineState> }).store.getSnapshot().tasks,
		close: async () => {
			await (view as unknown as Opening).close();
			vault.app.workspace.removeLeaf(leaf);
		},
	};
}

/** The notes read since the last call, in the order the reads started. */
function readsOf(vault: FakeVault): () => string[] {
	let from = vault.reads.length;
	return () => {
		const read = vault.reads.slice(from);
		from = vault.reads.length;
		return read;
	};
}

/** The stub's Events count their handlers; Obsidian's typings know nothing of that. */
const handlerCount = (events: object, name: string) =>
	(events as { handlerCount(name: string): number }).handlerCount(name);

/** The handlers of "changed" and "modify": the shared index has one of each, and each open timeline one "changed". */
const watchers = (vault: FakeVault) =>
	handlerCount(vault.app.metadataCache, "changed") + handlerCount(vault.app.vault, "modify");

test("two timelines: a save reloads each once and is read once; they show the same Task objects", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const b = await openTimeline(t, vault, shared);
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] call the plumber again 📅 2026-01-20");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual([a.reloads(), b.reloads()], [1, 1]);
	assert.deepEqual(read(), ["Inbox.md"]);
	assert.equal(a.tasks().length, b.tasks().length);
	a.tasks().forEach((task, i) => assert.equal(task, b.tasks()[i]));
	assert.deepStrictEqual([...b.tasks()], await readTasks(vault.app as never, b.options, moment));
});

test("two timelines with other note filters: each reloads as before, reads what it shows, and equals readTasks", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const b = await openTimeline(t, vault, shared, { options: { excludePaths: ["Archive"] } });
	const read = readsOf(vault);
	vault.write("Archive/Old.md", "- [ ] an old task, edited");
	await wait(t, RELOAD_DELAY_MS);
	// B reloads too, as the note has tasks, see changeAffectsTasks, and reads nothing.
	assert.deepEqual([a.reloads(), b.reloads()], [1, 1]);
	assert.deepEqual(read(), ["Archive/Old.md"]);
	vault.write("Reference/Plain.md", "# Plain, edited");
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual([a.reloads(), b.reloads()], [2, 2]);
	assert.deepEqual(read(), ["Inbox.md", "Reference/Plain.md"]);
	for (const timeline of [a, b])
		assert.deepStrictEqual([...timeline.tasks()], await readTasks(vault.app as never, timeline.options, moment));
});

test("two timelines tell of a failing note each, on every reload, and log the warnings each", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const lines = ourLines(t);
	const vault = fakeVault({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	vault.failReads("Projects/Garden.md");
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const b = await openTimeline(t, vault, shared);
	shownNotices.length = 0;
	lines.length = 0;
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual([a.reloads(), b.reloads()], [1, 1]);
	assert.deepEqual(read(), ["Inbox.md", "Projects/Garden.md", "Projects/Garden.md"]);
	assert.deepEqual(shownNotices, [ONE_FAILED, ONE_FAILED]);
	assert.deepEqual(
		lines.map(([kind, message]) => [kind, message]),
		[
			["warn", 'Tasks Calendar Wrapper: Dates.md, line 2: could not read the date " soon" of [due:: ]'],
			["error", "Tasks Calendar Wrapper: reading a file failed"],
			["warn", 'Tasks Calendar Wrapper: Dates.md, line 2: could not read the date " soon" of [due:: ]'],
			["error", "Tasks Calendar Wrapper: reading a file failed"],
		],
	);
});

test("a timeline closed while its reload waits for another's: both finish, and the one left reloads alone", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const b = await openTimeline(t, vault, shared);
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual(read(), ["Inbox.md"], "A's reload reads; B's waits for it");
	await b.close();
	release();
	await settle();
	assert.deepEqual(read(), [], "B's reload used what A read");
	assert.deepEqual(
		b.tasks().map((task) => task.sourceLine),
		a.tasks().map((task) => task.sourceLine),
	);
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual([a.reloads(), b.reloads()], [2, 1]);
	assert.deepEqual(read(), ["Projects/Garden.md"]);
	assert.equal(watchers(vault), 2 + 1, "the index still watches, and A hears its changes");
});

test("both timelines closed: nothing is watched; a new one reads every note", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const b = await openTimeline(t, vault, shared);
	assert.equal(watchers(vault), 2 + 2, "the index's, and A's and B's own 'changed'");
	await a.close();
	await b.close();
	assert.equal(watchers(vault), 0);
	vault.writeSilently("Inbox.md", "- [ ] while none was open");
	const read = readsOf(vault);
	const c = await openTimeline(t, vault, shared);
	assert.deepEqual(read(), [...ALL, ...ALL], "its first reload, and the one after the first resolved");
	assert.deepStrictEqual([...c.tasks()], await readTasks(vault.app as never, c.options, moment));
});

test("a new window: each timeline reloads at once and reads every note, as each did; the first resolved is shared", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared, { resolved: false });
	const b = await openTimeline(t, vault, shared, { resolved: false });
	const read = readsOf(vault);
	vault.resolve();
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual([a.reloads(), b.reloads()], [1, 1]);
	assert.deepEqual(read(), ALL, "asked for by both before either reloaded, read once");
	vault.openWindow();
	await settle();
	assert.deepEqual([a.reloads(), b.reloads()], [2, 2]);
	assert.deepEqual(read(), [...ALL, ...ALL]);
});

test("a timeline closed while its reload runs keeps its notes for the reload it asked for meanwhile", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	// B first, so its reload runs and A's waits; only B shows the archive.
	const b = await openTimeline(t, vault, shared);
	const a = await openTimeline(t, vault, shared, { options: { excludePaths: ["Archive"] } });
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	assert.deepEqual(read(), ["Inbox.md"], "B's reload reads; A's waits for it");
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	await b.close();
	release();
	// A's read, which starts when B's first reload is done, waits until B has asked for its follow-up: as in Obsidian,
	// where reading a note that is not in its cache takes longer than that.
	const releaseA = vault.holdReads();
	await settle();
	releaseA();
	await settle();
	assert.deepEqual(
		[a.reloads(), b.reloads()],
		[3, 3],
		"each asked for a reload while one ran, and ran it, B after it closed",
	);
	assert.deepEqual(read(), ["Projects/Garden.md"], "read by A; B's last reload kept the archive's note");
	assert.equal(watchers(vault), 2 + 1, "the index still watches, for A");
	assert.deepStrictEqual([...a.tasks()], await readTasks(vault.app as never, a.options, moment));
	await a.close();
	assert.equal(watchers(vault), 0, "B's reader was closed after its last reload");
});

test("a timeline closed while its reload waits, which then fails: its reader is closed all the same", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	ourLines(t);
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const b = await openTimeline(t, vault, shared);
	shownNotices.length = 0;
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	await b.close();
	// B's reload lists the notes once A's is done.
	vault.breakListing();
	release();
	await settle();
	assert.deepEqual(shownNotices, ["Error when generating tasks from files: Error: the vault is not ready"]);
	await a.close();
	assert.equal(watchers(vault), 0);
});

test("a timeline closed while its reload runs goes on hearing changes until its reloads are done", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const lines = ourLines(t);
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	shownNotices.length = 0;
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	await a.close();
	// The shared index still marks it, for the follow-up A asked for while its reload ran; an index of A's own heard
	// nothing once A closed.
	vault.failReads("Archive/Old.md");
	vault.write("Archive/Old.md", "- [ ] an old task, edited");
	release();
	await settle();
	assert.deepEqual(read(), ["Inbox.md", "Archive/Old.md", "Projects/Garden.md"]);
	assert.deepEqual(shownNotices, [ONE_FAILED]);
	assert.deepEqual(
		lines.map(([kind, message]) => [kind, message]),
		[["error", "Tasks Calendar Wrapper: reading a file failed"]],
	);
	assert.equal(watchers(vault), 0);
});

test("the plugin unloads while a timeline reloads: its reloads keep their notes, and hear nothing more", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	ourLines(t);
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	vault.failReads("Reference/Plain.md");
	shownNotices.length = 0;
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await wait(t, RELOAD_DELAY_MS);
	// As Obsidian unloads the plugin: the timelines close with their view type, then the plugin drops the index.
	await a.close();
	shared.dispose();
	vault.write("Archive/Old.md", "- [ ] an old task, edited");
	release();
	await settle();
	assert.deepEqual(read(), ["Inbox.md", "Projects/Garden.md"], "what was marked before, as with an index of its own");
	assert.deepEqual(shownNotices, []);
	assert.equal(watchers(vault), 0);
});

test("a timeline made before the plugin unloads and opened after it shows each change", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	// Obsidian's setViewState makes the view, then waits for the leaf's old view to close, as a note that saves; the
	// plugin can unload meanwhile, and its sweep finds no leaf of the timeline's type yet.
	const leaf = vault.app.workspace.addLeaf();
	const view = new TasksTimelineView(leaf as never, shared);
	const loading = view.onUpdateOptions({ ...defaultUserOptions });
	shared.dispose();
	leaf.view = view;
	await (view as unknown as Opening).open();
	await loading;
	vault.resolve();
	await wait(t, RELOAD_DELAY_MS);
	vault.write("Inbox.md", "- [ ] call the plumber, edited 📅 2026-01-21");
	await wait(t, RELOAD_DELAY_MS);
	const { tasks } = (view as unknown as { store: Store<TimelineState> }).store.getSnapshot();
	assert.deepStrictEqual([...tasks], await readTasks(vault.app as never, defaultUserOptions, moment));
});

test("the last timeline closed while its reload runs keeps the index for one opened meanwhile", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const read = readsOf(vault);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	await a.close();
	assert.equal(watchers(vault), 2, "the index watches while A's reload runs");
	const leaf = vault.app.workspace.addLeaf();
	const c = new TasksTimelineView(leaf as never, shared);
	const loading = c.onUpdateOptions({ ...defaultUserOptions });
	release();
	await loading;
	await settle();
	assert.deepEqual(read(), ["Inbox.md", ...ALL], "A's reload, and C's first, which reads every note");
	assert.equal(watchers(vault), 2, "one index, still watching, for C");
});

test("the last timeline closed while its reload runs: the index stops watching once that reload is done", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const vault = fakeVault(notes());
	const shared = timelineTaskIndex(vault.app as never);
	const a = await openTimeline(t, vault, shared);
	const release = vault.holdReads();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await wait(t, RELOAD_DELAY_MS);
	await a.close();
	assert.equal(watchers(vault), 2);
	release();
	await settle();
	assert.equal(watchers(vault), 0);
});
