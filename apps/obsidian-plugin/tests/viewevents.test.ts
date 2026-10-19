// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Notice } from "obsidian";

import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { TasksTimelineView } from "../src/views";
import { fakeVault, type FakeVault } from "./fakevault";
import { roots } from "./stubs/react-dom-client";

// What the timeline's view does today when the vault changes: which events reload it, and when. The edits fire the
// events Obsidian fires for them, see tests/fakevault.ts, so the tests hold whatever the view listens to.

/** Changes that arrive within this time of each other are applied in one reload, see views.tsx. */
const RELOAD_DELAY_MS = 500;

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

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
	const view = new TasksTimelineView(leaf as never);
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
		/** The reloads since the timeline opened, as readTasks lists the notes once each time. */
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

test("a note that cannot be read is reported again on every reload", async (t) => {
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
	// The view's first reload, the one after Obsidian's first "resolved", and the one after the edit.
	assert.deepEqual(shownNotices, [notice, notice, notice]);
	// Node also reports, once, that its mocked timers are experimental.
	const failures = errors.mock.calls
		.map((call) => call.arguments)
		.filter(([message]) => String(message).startsWith("Tasks Calendar Wrapper"));
	assert.equal(failures.length, 3);
	for (const [message, reason] of failures) {
		assert.equal(message, "Tasks Calendar Wrapper: reading a file failed");
		assert.match(String(reason), /could not read Projects\/Garden\.md/);
	}
});

test("a task whose date cannot be read is warned about again on every reload", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const warnings = t.mock.method(console, "warn", () => {});
	const vault = fakeVault({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	await openTimeline(t, vault);
	vault.openWindow();
	await settle();
	// The value is quoted as written after "::", with the space.
	const warning = 'Tasks Calendar Wrapper: Dates.md, line 2: could not read the date " soon" of [due:: ]';
	// moment warns once, the first time it reads a date it does not know the format of.
	const ours = warnings.mock.calls
		.map((call) => call.arguments)
		.filter(([message]) => String(message).startsWith("Tasks Calendar Wrapper"));
	assert.deepEqual(ours, [[warning], [warning], [warning]]);
});
