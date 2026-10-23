// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import type { NoteFilterSettings } from "@tasks-calendar-wrapper/core";
import type { IndexUpdate } from "../timeline/src/taskindex";
import { parseKeyOf, type ParseKey } from "../utils/parsekey";
import { ALL, indexed, notes, ourLines, shownNotices } from "./indexed-vault";

// Several readers of one task index, as several timelines share the plugin's: which notes each update reads, exactly,
// and that each reader gets what readTasks gives with its own filters.

const PROJECTS: NoteFilterSettings = { includePaths: ["Projects"] };
const NO_ARCHIVE: NoteFilterSettings = { excludePaths: ["Archive"] };

/** The tasks of the note, by first line. */
const linesOf = (update: IndexUpdate, path: string) =>
	update.tasks.filter((task) => task.path === path).map((task) => task.sourceLine);

test("readers with the same filters: an edit is read once, by the first update, and the next reader keeps its tasks", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	assert.deepEqual(t.since().read, ALL);
	await b.update({});
	assert.deepEqual(t.since().read, ALL, "a reader's first update reads every note it shows, its filters are new");
	t.vault.write("Inbox.md", "- [ ] call the plumber again");
	const fromA = await a.update({});
	assert.deepEqual(t.since(), { read: ["Inbox.md"], parsed: ["Inbox.md"] });
	const fromB = await b.update({});
	assert.deepEqual(t.since(), { read: [], parsed: [] });
	assert.deepEqual(linesOf(fromB, "Inbox.md"), ["- [ ] call the plumber again"]);
	fromB.tasks.forEach((task, i) => assert.equal(task, fromA.tasks[i], "the same Task objects"));
	assert.deepStrictEqual([...fromB.tasks], await t.reference());
});

test("an update does not take the marks of notes it does not show: the reader that shows them reads them", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update(PROJECTS);
	await b.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] call the plumber again");
	t.vault.write("Projects/Garden.md", "# Garden\n\n- [ ] plant the roses");
	const fromA = await a.update(PROJECTS);
	assert.deepEqual(t.since().read, ["Projects/Garden.md"]);
	const fromB = await b.update({});
	assert.deepEqual(t.since().read, ["Inbox.md"], "Garden was read by A since it was saved");
	assert.deepStrictEqual([...fromA.tasks], await t.reference(PROJECTS));
	assert.deepStrictEqual([...fromB.tasks], await t.reference());
});

test("an update with narrower filters keeps the notes another reader shows; a note gone is not kept", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update(NO_ARCHIVE);
	t.since();
	await b.update(NO_ARCHIVE);
	await a.update({});
	assert.deepEqual(t.since().read, [], "the archive's note, which only A shows, was kept");
	// The note goes, and a new one comes at its path before Obsidian indexes it: it fires "create", which marks nothing.
	t.vault.remove("Archive/Old.md");
	await b.update(NO_ARCHIVE);
	t.vault.write("Archive/Old.md", "- [ ] a new task", { indexed: false });
	t.since();
	const fromA = await a.update({});
	assert.deepEqual(t.since().read, ["Archive/Old.md"]);
	assert.deepStrictEqual([...fromA.tasks], await t.reference());
});

test("readers with different filters do not make each other read everything", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update(NO_ARCHIVE);
	t.since();
	for (let round = 0; round < 2; round++) {
		await a.update({});
		await b.update(NO_ARCHIVE);
	}
	assert.deepEqual(t.since().read, []);
	await a.update(PROJECTS);
	assert.deepEqual(t.since().read, ["Projects/Garden.md"], "A's own new filters read every note they keep");
	await b.update(NO_ARCHIVE);
	assert.deepEqual(t.since().read, []);
});

test("a closed reader's notes go at the next update of another; an update it still makes reads them again", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update(PROJECTS);
	a.close();
	a.close();
	t.since();
	await b.update(PROJECTS);
	assert.deepEqual(t.since().read, []);
	// As a view that closed finishes the reload it was asked for.
	const late = await a.update({});
	assert.deepEqual(t.since().read, ["Archive/Old.md", "Inbox.md"], "Garden stays, B shows it");
	assert.deepStrictEqual([...late.tasks], await t.reference());
	await a.update({});
	assert.deepEqual(t.since().read, ["Archive/Old.md", "Inbox.md"], "kept for no open reader");
});

test("rereadAll makes only its own reader read everything; others use what that read stored", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update({});
	t.since();
	b.rereadAll();
	await a.update({});
	assert.deepEqual(t.since().read, []);
	await b.update({});
	assert.deepEqual(t.since().read, ALL);
	// Asked for by both before either updates, as on Obsidian's first "resolved", the full read is shared.
	a.rereadAll();
	b.rereadAll();
	await a.update({});
	assert.deepEqual(t.since().read, ALL);
	await b.update({});
	assert.deepEqual(t.since().read, []);
	// Asked for while A's update reads: A reads everything again next time, B does not.
	const release = t.vault.holdReads();
	t.vault.write("Inbox.md", "- [ ] one");
	const running = a.update({});
	a.rereadAll();
	release();
	await running;
	t.since();
	await b.update({});
	assert.deepEqual(t.since().read, []);
	await a.update({});
	assert.deepEqual(t.since().read, ALL);
});

test("a note one reader's full read cannot read keeps its tasks for the others, as with an index each", async (t) => {
	const lines = ourLines(t);
	const i = indexed();
	const a = i.index;
	const b = i.open();
	await a.update({});
	const before = await b.update({});
	i.since();
	shownNotices.length = 0;
	i.vault.failReads("Projects/Garden.md");
	a.rereadAll();
	const fromA = await a.update({});
	assert.deepEqual(i.since().read, ALL);
	assert.deepEqual(
		fromA.failures.map((failure) => failure.path),
		["Projects/Garden.md"],
	);
	const fromB = await b.update({});
	assert.deepEqual(i.since().read, []);
	assert.deepEqual(fromB.failures, []);
	assert.deepEqual(linesOf(fromB, "Projects/Garden.md"), linesOf(before, "Projects/Garden.md"));
	const again = await a.update({});
	assert.deepEqual(i.since().read, ["Projects/Garden.md"], "A reads it again, and tells of it again");
	assert.equal(again.failures.length, 1);
	// A change to the failing note: both read it, and both tell of it.
	i.vault.write("Projects/Garden.md", "- [ ] plant the roses");
	assert.equal((await a.update({})).failures.length, 1);
	assert.equal((await b.update({})).failures.length, 1);
	assert.deepEqual(i.since().read, ["Projects/Garden.md", "Projects/Garden.md"]);
	assert.deepEqual(lines, [], "the index tells nothing itself");
	// Healed with no change: each reads it again, as each failed to read it, as with an index each.
	i.vault.healReads("Projects/Garden.md");
	await a.update({});
	await b.update({});
	assert.deepEqual(i.since().read, ["Projects/Garden.md", "Projects/Garden.md"]);
	await a.update({});
	await b.update({});
	assert.deepEqual(i.since().read, []);
});

test("a full read for new filters that cannot read a note reads it again next time, with no event since", async () => {
	const t = indexed();
	const a = t.index;
	await a.update({});
	// No mark, no full read asked for: nothing happens between A's update and B's first one but the failure.
	t.vault.failReads("Projects/Garden.md");
	const b = t.open();
	const first = await b.update({});
	assert.deepEqual(
		first.failures.map((failure) => failure.path),
		["Projects/Garden.md"],
	);
	t.since();
	const second = await b.update({});
	assert.deepEqual(t.since().read, ["Projects/Garden.md"], "B read A's entry before; it does not take it now");
	assert.equal(second.failures.length, 1);
	const fromA = await a.update({});
	assert.deepEqual(t.since().read, []);
	assert.deepEqual(fromA.failures, [], "A keeps the tasks it had, as with an index of its own");
});

test("updates of different readers run one at a time, in the order asked; a rejected one stops none", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update(NO_ARCHIVE);
	t.since();
	const listed = t.vault.listings();
	const release = t.vault.holdReads();
	t.vault.write("Inbox.md", "- [ ] one");
	const first = a.update({});
	const broken = b.update({ includePaths: "Projects" as never });
	const second = b.update(NO_ARCHIVE);
	t.vault.write("Projects/Garden.md", "- [ ] plant the roses");
	assert.deepEqual(t.since().read, ["Inbox.md"], "only A's update has started");
	assert.equal(t.vault.listings(), listed + 1);
	release();
	await first;
	await assert.rejects(broken, /include\.some is not a function/);
	const fromB = await second;
	assert.deepEqual(t.since().read, ["Projects/Garden.md"], "Inbox was read after its save, Garden was saved since");
	assert.deepStrictEqual([...fromB.tasks], await t.reference(NO_ARCHIVE));
	await a.update({});
	assert.deepEqual(t.since().read, [], "A uses B's read of Garden");
});

test("another parse key: the first update reads every note it shows, the next reader only those not read since", async () => {
	const a1: ParseKey = Object.freeze({ locale: {}, localeConfig: 1, timeZone: "A", offsets: [0, 0] as const });
	let key = a1;
	const t = indexed(notes(), { parseKey: () => key });
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update(PROJECTS);
	t.since();
	key = Object.freeze({ ...a1, timeZone: "B" });
	await b.update(PROJECTS);
	assert.deepEqual(t.since().read, ["Projects/Garden.md"]);
	await a.update({});
	assert.deepEqual(t.since().read, ["Archive/Old.md", "Inbox.md"]);
	// The key changes while B reads and is back before A updates: what B stored may be parsed under either.
	const release = t.vault.holdReads();
	t.vault.write("Projects/Garden.md", "- [ ] plant the roses");
	const running = b.update(PROJECTS);
	key = a1;
	release();
	await running;
	key = Object.freeze({ ...a1, timeZone: "B" });
	t.since();
	await a.update({});
	assert.deepEqual(t.since().read, ALL);
	await b.update(PROJECTS);
	assert.deepEqual(t.since().read, []);
});

test("the real environment: a locale change is read once for both readers, and each equals readTasks", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update({});
	await b.update(NO_ARCHIVE);
	t.since();
	try {
		moment.locale("zh-cn");
		assert.ok(parseKeyOf(moment));
		const fromA = await a.update({});
		assert.deepEqual(t.since().read, ALL);
		const fromB = await b.update(NO_ARCHIVE);
		assert.deepEqual(t.since().read, []);
		assert.deepStrictEqual([...fromA.tasks], await t.reference());
		assert.deepStrictEqual([...fromB.tasks], await t.reference(NO_ARCHIVE));
	} finally {
		moment.locale("en");
	}
});

test("a note a reader comes to show with no event is read by it, though another reader keeps an entry of it", async () => {
	const t = indexed({ ...notes(), "Inbox.md": "- [ ] call the plumber #skip" });
	const a = t.index;
	const b = t.open();
	const SKIP: NoteFilterSettings = { fileExcludeTags: ["#skip"] };
	await a.update({});
	await b.update(SKIP);
	t.since();
	// Its tag goes with no event, as when one is missed: B shows it now, A has an entry of it from before.
	t.vault.writeSilently("Inbox.md", "- [ ] call the plumber, unheard");
	const fromB = await b.update(SKIP);
	assert.deepEqual(t.since().read, ["Inbox.md"], "as with an index of its own, which had no entry of it");
	assert.deepEqual(linesOf(fromB, "Inbox.md"), ["- [ ] call the plumber, unheard"]);
	assert.deepStrictEqual([...fromB.tasks], await t.reference(SKIP));
	await a.update({});
	assert.deepEqual(t.since().read, [], "A keeps what it has, as with an index of its own");
});

test("a note gone with no event is kept for no reader once an update lists the notes without it", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update(NO_ARCHIVE);
	await b.update({});
	t.since();
	// Gone with no event, and an update of A, which does not show it, lists the notes without it.
	t.vault.removeSilently("Archive/Old.md");
	await a.update(NO_ARCHIVE);
	// A new note at its path before Obsidian indexes it: "create" only, which marks nothing.
	t.vault.write("Archive/Old.md", "- [ ] a new task", { indexed: false });
	const fromB = await b.update({});
	assert.deepEqual(t.since().read, ["Archive/Old.md"], "B holds it, but its entry went with A's update");
	assert.deepStrictEqual([...fromB.tasks], await t.reference());
});

test("updates waiting for one that runs start in the order asked, each when the one before has settled", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	const c = t.open();
	await a.update({});
	await b.update(NO_ARCHIVE);
	await c.update({});
	t.since();
	const settled: string[] = [];
	const release = t.vault.holdReads();
	t.vault.write("Projects/Garden.md", "- [ ] plant the roses");
	const first = a.update(PROJECTS).then(() => settled.push("a"));
	t.vault.write("Inbox.md", "- [ ] call the plumber again");
	t.vault.write("Archive/Old.md", "- [ ] an old task, edited");
	const second = b.update(NO_ARCHIVE).then(() => settled.push("b"));
	const third = c.update({}).then(() => settled.push("c"));
	assert.deepEqual(t.since().read, ["Projects/Garden.md"], "A's new filters read what they show; B and C wait");
	release();
	await Promise.all([first, second, third]);
	assert.deepEqual(settled, ["a", "b", "c"]);
	assert.deepEqual(t.since().read, ["Inbox.md", "Archive/Old.md"], "B reads the inbox, then C only the archive");
});

test("an update of a closed reader keeps what the open readers hold", async () => {
	const t = indexed();
	const a = t.index;
	const b = t.open();
	await a.update(NO_ARCHIVE);
	await b.update({});
	a.close();
	t.since();
	// As a view that closed finishing its reload: it does not show the archive, which B holds.
	await a.update(NO_ARCHIVE);
	assert.deepEqual(t.since().read, [], "it holds what it showed, and the entries are there");
	await b.update({});
	assert.deepEqual(t.since().read, [], "the archive's entry stayed for B");
});
