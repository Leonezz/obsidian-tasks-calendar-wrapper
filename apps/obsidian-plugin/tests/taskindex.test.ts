// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import type { App } from "obsidian";

import type { MomentFactory, Task } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions } from "../src/useroptions";
import { reportNoteReads } from "../timeline/src/taskadapter";
import { watchChanges, watchNotes, type IndexUpdate, type NoteSource } from "../timeline/src/taskindex";
import type { moment as obsidianMoment } from "../utils/moment";
import { parseKeyOf, type ParseKey } from "../utils/parsekey";
import { changeAffectsTasks } from "../utils/refresh";
import { fakeVault } from "./fakevault";
import { goldenApp, loadVault } from "./golden-vault";
import { ALL, indexed, notes, ourLines, pathsOf, shownNotices, soleReader, telling } from "./indexed-vault";

// The task index keeps the parsed notes of a view between reloads, so a reload reads only the notes that may have
// changed. These tests pin which notes each update reads, exactly, and that what it returns is what readTasks returns.
// taskindex-env.test.ts changes the parse environment and reads the golden vault, taskindex-readers.test.ts has several
// readers share one index, and taskindex-differential.test.ts compares the index with readTasks over generated
// sequences of changes.

/** Compiles only when T fits Bound. */
type Fits<T extends Bound, Bound> = T;

/** Checked by tsc alone: what the view will pass, Obsidian's App and its moment, fits what the index takes. */
export type ObsidianFits = [
	Fits<App, NoteSource>,
	Fits<typeof obsidianMoment, MomentFactory>,
	Fits<typeof obsidianMoment, Parameters<typeof parseKeyOf>[0]>,
];

/** Whether the update and each of its arrays are frozen. */
const frozen = (update: IndexUpdate) =>
	[update, update.tasks, update.warnings, update.failures].every((value) => Object.isFrozen(value));

/** Asserts that every task not of the given paths is the same object as in the earlier update. */
function sameObjectsExcept(now: IndexUpdate, before: IndexUpdate, paths: readonly string[]): void {
	const kept = now.tasks.filter((task) => !paths.includes(task.path));
	assert.ok(kept.length > 0);
	for (const task of kept) assert.ok(before.tasks.includes(task), `${task.id} is the same object as before`);
}

// A. Reading

test("the first update reads each visible note once, in code-unit order, and gives what readTasks gives", async () => {
	const t = indexed({
		...notes(),
		"B.md": "- [ ] b",
		"a.md": "- [ ] a",
		"Notes/ä.md": "- [ ] ä",
		"Files/data.txt": "x",
	});
	const first = await t.index.update({ excludePaths: ["Archive"] });
	// Reference/Plain.md has no task item, and data.txt is no note.
	const visible = ["B.md", "Inbox.md", "Notes/ä.md", "Projects/Garden.md", "a.md"];
	assert.deepEqual(t.since(), { read: visible, parsed: visible });
	assert.deepStrictEqual([...first.tasks], await t.reference({ excludePaths: ["Archive"] }));
	assert.ok(frozen(first));
	assert.deepEqual(first.warnings, []);
	assert.deepEqual(first.failures, []);
});

test("a note without a task item is not read: not first, not by a full read, not saved; failing, it tells nothing", async () => {
	const t = indexed();
	t.vault.failReads("Reference/Plain.md");
	const first = await t.index.update({});
	assert.deepEqual(t.since(), { read: ALL, parsed: ALL });
	assert.deepEqual(first.failures, []);
	t.index.rereadAll();
	await t.index.update({});
	assert.deepEqual(t.since().read, ALL);
	t.vault.write("Reference/Plain.md", "# Plain\n\n- edited");
	const saved = await t.index.update({});
	assert.deepEqual(t.since().read, []);
	assert.deepEqual(saved.failures, []);
	assert.deepStrictEqual([...saved.tasks], await t.reference());
});

test("a note that gets its first task is read; one that loses its last is not read, and its tasks are gone", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.vault.write("Reference/Plain.md", "# Plain\n\n- [ ] now a task");
	const gained = await t.index.update({});
	assert.deepEqual(t.since().read, ["Reference/Plain.md"]);
	assert.deepEqual(
		gained.tasks.filter((task) => task.path === "Reference/Plain.md").map((task) => task.visual),
		["now a task"],
	);
	t.vault.write("Projects/Garden.md", "# Garden\n\nnothing to do");
	const lost = await t.index.update({});
	assert.deepEqual(t.since().read, []);
	assert.ok(!pathsOf(lost.tasks).includes("Projects/Garden.md"));
	assert.deepStrictEqual([...lost.tasks], await t.reference());
});

test("an update with no change since the last one reads nothing and gives the same tasks in a new array", async () => {
	const t = indexed();
	const first = await t.index.update({});
	t.since();
	const second = await t.index.update({});
	assert.deepEqual(t.since(), { read: [], parsed: [] });
	assert.notEqual(second.tasks, first.tasks);
	assert.notEqual(second.warnings, first.warnings);
	assert.notEqual(second.failures, first.failures);
	assert.ok(frozen(second));
	assert.equal(second.tasks.length, first.tasks.length);
	second.tasks.forEach((task, i) => assert.equal(task, first.tasks[i]));
});

test("acceptance: after a note is saved, the update reads and parses that one note and keeps every other task", async () => {
	const t = indexed();
	const first = await t.index.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] call the plumber again 📅 2026-01-21");
	const second = await t.index.update({});
	assert.deepEqual(t.since(), { read: ["Inbox.md"], parsed: ["Inbox.md"] });
	sameObjectsExcept(second, first, ["Inbox.md"]);
	assert.deepStrictEqual([...second.tasks], await t.reference());
});

test("saving a note without tasks schedules no reload, and the next update does not read it", async () => {
	const t = indexed();
	const first = await t.index.update({});
	t.since();
	t.vault.write("Reference/Plain.md", "# Plain\n\n- edited");
	const [paths, cache] = t.heard[t.heard.length - 1] ?? assert.fail("watchChanges handed on no change");
	assert.deepEqual(paths, ["Reference/Plain.md"]);
	assert.equal(changeAffectsTasks(paths, cache, new Set(pathsOf(first.tasks))), false, "the view does not reload");
	await t.index.update({});
	assert.deepEqual(t.since(), { read: [], parsed: [] }, "it has no task item");
});

test("a removed note is not read, and its tasks are gone; written again, it is read once Obsidian indexes it", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.vault.remove("Inbox.md");
	const after = await t.index.update({});
	assert.deepEqual(t.since(), { read: [], parsed: [] });
	assert.ok(!pathsOf(after.tasks).includes("Inbox.md"));
	assert.deepStrictEqual([...after.tasks], await t.reference());
	// Only "create" comes, which marks nothing. Without metadata the note has no task item, so it is not read yet.
	t.vault.write("Inbox.md", "- [ ] a new inbox", { indexed: false });
	const again = await t.index.update({});
	assert.deepEqual(t.since(), { read: [], parsed: [] });
	assert.ok(!pathsOf(again.tasks).includes("Inbox.md"), "no metadata yet, so no tasks");
	assert.deepStrictEqual([...again.tasks], await t.reference());
	t.vault.indexPending();
	const indexedNow = await t.index.update({});
	assert.deepEqual(t.since(), { read: ["Inbox.md"], parsed: ["Inbox.md"] });
	assert.deepStrictEqual([...indexedNow.tasks], await t.reference());
});

test("renames read the notes at their new paths: a note, a folder, to a file that is no note and back, a swap", async () => {
	const t = indexed({ ...notes(), "Projects/Pond.md": "- [ ] dig the pond", "A.md": "- [ ] a", "B.md": "- [ ] b" });
	await t.index.update({});
	t.since();
	const renamed = async (from: string, to: string, read: string[]) => {
		t.vault.rename(from, to);
		const result = await t.index.update({});
		assert.deepEqual(t.since().read, read, `${from} to ${to}`);
		assert.deepStrictEqual([...result.tasks], await t.reference(), `${from} to ${to}`);
		return result;
	};
	await renamed("Inbox.md", "Errands.md", ["Errands.md"]);
	await renamed("Projects", "Done", ["Done/Garden.md", "Done/Pond.md"]);
	const txt = await renamed("Errands.md", "Errands.txt", []);
	assert.ok(!pathsOf(txt.tasks).some((path) => path.startsWith("Errands")));
	await renamed("Errands.txt", "Errands.md", ["Errands.md"]);
	t.vault.rename("A.md", "T.md");
	t.vault.rename("B.md", "A.md");
	const swapped = await renamed("T.md", "B.md", ["A.md", "B.md"]);
	assert.deepEqual(
		swapped.tasks.filter((task) => task.path.length === 4).map((task) => [task.path, task.visual]),
		[
			["A.md", "b"],
			["B.md", "a"],
		],
	);
});

test("a note Obsidian has not indexed yet is not read, as it has no task item yet; it is read once it is indexed", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.vault.write("New.md", "- [ ] new", { indexed: false });
	const unindexed = await t.index.update({});
	assert.deepEqual(t.since(), { read: [], parsed: [] });
	assert.ok(!pathsOf(unindexed.tasks).includes("New.md"));
	assert.deepStrictEqual([...unindexed.tasks], await t.reference());
	await t.index.update({});
	assert.deepEqual(t.since().read, []);
	t.vault.indexPending();
	const indexedNow = await t.index.update({});
	assert.deepEqual(t.since().read, ["New.md"]);
	assert.deepEqual(
		indexedNow.tasks.filter((task) => task.path === "New.md").map((task) => task.visual),
		["new"],
	);
	assert.deepStrictEqual([...indexedNow.tasks], await t.reference());
});

test("two saves of a note before an update read it once", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] one");
	t.vault.write("Inbox.md", "- [ ] two");
	const result = await t.index.update({});
	assert.deepEqual(t.since(), { read: ["Inbox.md"], parsed: ["Inbox.md"] });
	assert.deepStrictEqual([...result.tasks], await t.reference());
});

test("each update lists the notes exactly once, as readTasks does on each reload", async () => {
	const t = indexed();
	for (const change of [() => {}, () => t.vault.write("Inbox.md", "- [ ] one"), () => t.index.rereadAll()]) {
		change();
		const listed = t.vault.listings();
		await t.index.update({});
		assert.equal(t.vault.listings(), listed + 1);
	}
});

test("a mark of a path that is no visible note reads nothing", async () => {
	const t = indexed();
	await t.index.update({ excludePaths: ["Archive"] });
	t.since();
	t.index.markDirty(["Nowhere.md"]);
	await t.index.update({ excludePaths: ["Archive"] });
	assert.deepEqual(t.since().read, [], "a path with no file");
	t.vault.write("Notes.txt", "- [ ] not a note");
	await t.index.update({ excludePaths: ["Archive"] });
	assert.deepEqual(t.since().read, [], "a file that is no note");
	t.vault.write("Archive/Old.md", "- [ ] an old task, edited");
	await t.index.update({ excludePaths: ["Archive"] });
	assert.deepEqual(t.since().read, [], "a note the filters leave out");
});

// B. Failures and warnings

test("a note that cannot be read is read again on every update and reported each time, until it can be", async (t) => {
	ourLines(t);
	const i = indexed();
	i.vault.failReads("Projects/Garden.md");
	await i.index.update({});
	i.since();
	for (let n = 0; n < 2; n++) {
		const result = await i.index.update({});
		assert.deepEqual(i.since(), { read: ["Projects/Garden.md"], parsed: [] });
		assert.deepEqual(
			result.failures.map((failure) => failure.path),
			["Projects/Garden.md"],
		);
		assert.match(String(result.failures[0].reason), /could not read Projects\/Garden\.md/);
		assert.ok(Object.isFrozen(result.failures[0]));
		assert.deepStrictEqual([...result.tasks], await i.reference());
	}
	i.vault.healReads("Projects/Garden.md");
	const healed = await i.index.update({});
	assert.deepEqual(i.since(), { read: ["Projects/Garden.md"], parsed: ["Projects/Garden.md"] });
	assert.equal(healed.tasks.filter((task) => task.path === "Projects/Garden.md").length, 2);
	assert.deepEqual(healed.failures, []);
	await i.index.update({});
	assert.deepEqual(i.since().read, []);
});

test("a note that fails to parse is parsed again on every update, and kept once a save fixes it", async (t) => {
	ourLines(t);
	const broken = "---\ntags: [2026]\n---\n- [ ] frontmatter tags that are not text";
	const i = indexed({ ...notes(), "Tagged.md": broken }, { jsonFrontmatter: true });
	await i.index.update({});
	i.since();
	for (let n = 0; n < 2; n++) {
		const result = await i.index.update({});
		assert.deepEqual(i.since(), { read: ["Tagged.md"], parsed: ["Tagged.md"] });
		assert.equal(result.failures.length, 1);
		assert.ok(result.failures[0].reason instanceof TypeError);
		assert.deepStrictEqual([...result.tasks], await i.reference());
	}
	i.vault.write("Tagged.md", '---\ntags: ["work"]\n---\n- [ ] frontmatter tags that are text');
	const fixed = await i.index.update({});
	assert.deepEqual(i.since().read, ["Tagged.md"]);
	assert.deepEqual(fixed.failures, []);
	await i.index.update({});
	assert.deepEqual(i.since().read, []);
});

test("metadata that cannot be read after a note's read fails only that note, as in readTasks", async (t) => {
	const lines = ourLines(t);
	const i = indexed();
	const { vault, metadataCache } = i.vault.app;
	// Throws for the garden only once its read has started, so the listing still works.
	const started = new Set<string>();
	const getFileCache = metadataCache.getFileCache.bind(metadataCache);
	const cachedRead = vault.cachedRead.bind(vault);
	const getMarkdownFiles = vault.getMarkdownFiles.bind(vault);
	t.mock.method(vault, "getMarkdownFiles", () => (started.clear(), getMarkdownFiles()));
	t.mock.method(vault, "cachedRead", (file: { path: string }) => (started.add(file.path), cachedRead(file as never)));
	t.mock.method(metadataCache, "getFileCache", (file: { path: string }) => {
		if (file.path === "Projects/Garden.md" && started.has(file.path)) throw new Error("the metadata is gone");
		return getFileCache(file as never);
	});
	const result = await i.index.update({});
	i.since();
	assert.deepEqual(
		result.failures.map((failure) => [failure.path, String(failure.reason)]),
		[["Projects/Garden.md", "Error: the metadata is gone"]],
	);
	const told = await telling(lines, () => reportNoteReads(result.warnings, result.failures));
	let reference: Task[] = [];
	const toldByReadTasks = await telling(lines, async () => (reference = await i.reference()));
	assert.deepStrictEqual([...result.tasks], reference);
	assert.deepStrictEqual(told, toldByReadTasks);
});

test("a read that throws at once, not after waiting, fails only that note, as in readTasks", async (t) => {
	const lines = ourLines(t);
	const i = indexed();
	const { vault } = i.vault.app;
	const cachedRead = vault.cachedRead.bind(vault);
	t.mock.method(vault, "cachedRead", (file: { path: string }) => {
		if (file.path === "Inbox.md") throw new Error("the file is locked");
		return cachedRead(file as never);
	});
	const result = await i.index.update({});
	i.since();
	assert.deepEqual(
		result.failures.map((failure) => [failure.path, String(failure.reason)]),
		[["Inbox.md", "Error: the file is locked"]],
	);
	const told = await telling(lines, () => reportNoteReads(result.warnings, result.failures));
	let reference: Task[] = [];
	const toldByReadTasks = await telling(lines, async () => (reference = await i.reference()));
	assert.deepStrictEqual([...result.tasks], reference);
	assert.deepStrictEqual(told, toldByReadTasks);
});

test("step 10's approved change: a stored note that starts failing with no change is not read again", async (t) => {
	const lines = ourLines(t);
	const i = indexed();
	await i.index.update({});
	i.since();
	i.vault.failReads("Inbox.md");
	const result = await i.index.update({});
	assert.deepEqual(i.since().read, []);
	assert.ok(pathsOf(result.tasks).includes("Inbox.md"), "the index keeps its tasks");
	assert.deepEqual(result.failures, []);
	shownNotices.length = 0;
	const reference = await i.reference();
	assert.ok(!pathsOf(reference).includes("Inbox.md"), "readTasks reads it and drops its tasks");
	assert.equal(lines.filter(([kind]) => kind === "error").length, 1);
	assert.equal(shownNotices.length, 1);
});

test("a note that cannot be read is no longer read or reported once it is removed or the filters leave it out", async (t) => {
	ourLines(t);
	const i = indexed();
	i.vault.failReads("Projects/Garden.md");
	i.vault.failReads("Archive/Old.md");
	const failing = await i.index.update({});
	assert.equal(failing.failures.length, 2);
	i.since();
	i.vault.remove("Projects/Garden.md");
	const removed = await i.index.update({});
	assert.deepEqual(i.since().read, ["Archive/Old.md"]);
	assert.deepEqual(
		removed.failures.map((failure) => failure.path),
		["Archive/Old.md"],
	);
	const filtered = await i.index.update({ excludePaths: ["Archive"] });
	assert.deepEqual(i.since().read, ["Inbox.md"], "the filters changed: every visible note with a task item");
	assert.deepEqual(filtered.failures, []);
	const after = await i.index.update({ excludePaths: ["Archive"] });
	assert.deepEqual(i.since().read, []);
	assert.deepEqual(after.failures, []);
});

test("every update gives the warnings of every note, stored ones too, and they are told as readTasks tells them", async (t) => {
	const lines = ourLines(t);
	const i = indexed({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	const warning = { path: "Dates.md", line: 1, message: 'could not read the date " soon" of [due:: ]' };
	for (const read of [[...ALL.slice(0, 1), "Dates.md", ...ALL.slice(1)], []]) {
		const result = await i.index.update({});
		assert.deepEqual(i.since().read, read);
		assert.deepEqual(result.warnings, [warning]);
		const told = await telling(lines, () => reportNoteReads(result.warnings, result.failures));
		const toldByReadTasks = await telling(lines, () => i.reference());
		assert.deepEqual(told, [["warn", "Tasks Calendar Wrapper: Dates.md, line 2: " + warning.message]]);
		assert.deepEqual(told, toldByReadTasks);
	}
});

test("an update tells the user nothing itself, even with warnings and failures", async (t) => {
	const lines = ourLines(t);
	const i = indexed({ ...notes(), "Dates.md": "# Dates\n- [ ] pay the rent [due:: soon]" });
	i.vault.failReads("Projects/Garden.md");
	const told = await telling(lines, async () => {
		const result = await i.index.update({});
		assert.equal(result.warnings.length, 1);
		assert.equal(result.failures.length, 1);
	});
	assert.deepEqual(told, []);
});

// C. During an update

test("a note saved again while its read is held is read again by the next update", async () => {
	const t = indexed();
	await t.index.update({});
	t.vault.write("Inbox.md", "- [ ] one");
	t.since();
	const release = t.vault.holdReads();
	const running = t.index.update({});
	t.vault.write("Inbox.md", "- [ ] two");
	release();
	await running;
	assert.deepEqual(t.since(), { read: ["Inbox.md"], parsed: ["Inbox.md"] });
	const next = await t.index.update({});
	assert.deepEqual(t.since(), { read: ["Inbox.md"], parsed: ["Inbox.md"] });
	assert.deepStrictEqual([...next.tasks], await t.reference());
});

test("a stored note saved while another note's read is held is read by the next update, alone", async () => {
	const t = indexed();
	await t.index.update({});
	t.vault.write("Inbox.md", "- [ ] one");
	t.since();
	const release = t.vault.holdReads();
	const running = t.index.update({});
	t.vault.write("Projects/Garden.md", "# Garden\n\n- [ ] plant the roses");
	release();
	await running;
	assert.deepEqual(t.since().read, ["Inbox.md"]);
	const next = await t.index.update({});
	assert.deepEqual(t.since(), { read: ["Projects/Garden.md"], parsed: ["Projects/Garden.md"] });
	assert.deepStrictEqual([...next.tasks], await t.reference());
});

test("a rename while reads are held: the result keeps the paths listed, the next update reads the new path", async () => {
	const t = indexed();
	await t.index.update({});
	t.vault.write("Inbox.md", "- [ ] one");
	t.since();
	const release = t.vault.holdReads();
	const running = t.index.update({});
	t.vault.rename("Inbox.md", "Errands.md");
	release();
	const racy = await running;
	assert.deepEqual(pathsOf(racy.tasks), ["Archive/Old.md", "Inbox.md", "Projects/Garden.md", "Projects/Garden.md"]);
	t.since();
	const next = await t.index.update({});
	assert.deepEqual(t.since().read, ["Errands.md"]);
	assert.deepStrictEqual([...next.tasks], await t.reference());
});

test("rereadAll while an update runs makes the next update read every note", async () => {
	const t = indexed();
	await t.index.update({});
	t.vault.write("Inbox.md", "- [ ] one");
	const release = t.vault.holdReads();
	const running = t.index.update({});
	t.index.rereadAll();
	release();
	await running;
	t.since();
	await t.index.update({});
	assert.deepEqual(t.since().read, ALL);
});

// D. Full reads

test("rereadAll makes the next update read every note once, and the one after reads none", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.index.rereadAll();
	await t.index.update({});
	assert.deepEqual(t.since(), { read: ALL, parsed: ALL });
	await t.index.update({});
	assert.deepEqual(t.since().read, []);
});

test("a change of the note filters reads every note; equal values and the other options read none", async () => {
	const t = indexed();
	await t.index.update(defaultUserOptions);
	t.since();
	await t.index.update(structuredClone({ ...defaultUserOptions, sort: "something else" }));
	assert.deepEqual(t.since().read, [], "a copy, with another sort");
	await t.index.update({ ...defaultUserOptions, excludePaths: ["Archive"] });
	assert.deepEqual(t.since().read, ["Inbox.md", "Projects/Garden.md"]);
	await t.index.update(defaultUserOptions);
	assert.deepEqual(t.since().read, ALL);
});

test("the parse key: the same parts read nothing, another key reads all, a change during the reads reads all next", async () => {
	const a: ParseKey = Object.freeze({ locale: {}, localeConfig: 1, timeZone: "A", offsets: [0, 0] as const });
	const b: ParseKey = Object.freeze({ ...a, timeZone: "B" });
	let key = a;
	const t = indexed(notes(), { parseKey: () => key });
	await t.index.update({});
	t.since();
	key = Object.freeze({ ...a, offsets: [0, 0] as const });
	await t.index.update({});
	assert.deepEqual(t.since().read, [], "a new object with the same parts");
	key = b;
	await t.index.update({});
	assert.deepEqual(t.since().read, ALL, "another time zone");
	key = a;
	await t.index.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] one");
	const release = t.vault.holdReads();
	const running = t.index.update({});
	key = b;
	release();
	await running;
	key = a;
	assert.deepEqual(t.since().read, ["Inbox.md"]);
	await t.index.update({});
	assert.deepEqual(
		t.since().read,
		ALL,
		"the key was A at the start and B at the end: notes may be parsed under both",
	);
});

// E. Updates that fail

test("an update whose listing throws reads nothing, and the next one reads the notes marked before", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] one");
	t.vault.breakListing();
	await assert.rejects(t.index.update({}), /the vault is not ready/);
	assert.deepEqual(t.since().read, []);
	const next = await t.index.update({});
	assert.deepEqual(t.since().read, ["Inbox.md"]);
	assert.deepStrictEqual([...next.tasks], await t.reference());
});

test("a full read asked for before an update that fails is still due", async () => {
	const t = indexed();
	await t.index.update({});
	t.index.rereadAll();
	t.vault.breakListing();
	await assert.rejects(t.index.update({}), /the vault is not ready/);
	t.since();
	await t.index.update({});
	assert.deepEqual(t.since().read, ALL);
});

test("a filter of the wrong type rejects as readTasks does, and its filters are not kept", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] one");
	const wrong = { includePaths: "Projects" as never };
	await assert.rejects(t.index.update(wrong), /include\.some is not a function/);
	await assert.rejects(t.reference(wrong), /include\.some is not a function/);
	await t.index.update({});
	assert.deepEqual(t.since().read, ["Inbox.md"], "only the marked note: the filters are those of the last update");
});

test("after a first update that fails, the next one reads every note", async () => {
	const t = indexed();
	t.vault.breakListing();
	await assert.rejects(t.index.update({}), /the vault is not ready/);
	await t.index.update({});
	assert.deepEqual(t.since().read, ALL);
});

test("an update that fails after its reads keeps the marks it took and those made while it ran", async () => {
	let calls = 0;
	let failAt = -1;
	const t = indexed(notes(), {
		parseKey: () => {
			calls += 1;
			if (calls === failAt) throw new Error("the parse key cannot be read");
			return parseKeyOf(moment);
		},
	});
	await t.index.update({});
	t.vault.write("Inbox.md", "- [ ] one");
	const release = t.vault.holdReads();
	// The second call of the update, after its reads.
	failAt = calls + 2;
	const running = t.index.update({});
	t.vault.write("Projects/Garden.md", "- [ ] plant the roses");
	release();
	await assert.rejects(running, /the parse key cannot be read/);
	t.since();
	const next = await t.index.update({});
	assert.deepEqual(t.since().read, ["Inbox.md", "Projects/Garden.md"]);
	assert.deepStrictEqual([...next.tasks], await t.reference());
});

test("an update that fails after its reads keeps a full read asked for while it ran, and not its filters", async () => {
	let calls = 0;
	let failAt = -1;
	const t = indexed(notes(), {
		parseKey: () => {
			calls += 1;
			if (calls === failAt) throw new Error("the parse key cannot be read");
			return parseKeyOf(moment);
		},
	});
	await t.index.update({});
	const release = t.vault.holdReads();
	failAt = calls + 2;
	const running = t.index.update({});
	t.index.rereadAll();
	release();
	await assert.rejects(running, /the parse key cannot be read/);
	t.since();
	await t.index.update({});
	assert.deepEqual(t.since().read, ALL, "the full read asked for while it ran");
	// New filters on an update that fails are not stored: the next update with them reads every note they keep.
	failAt = calls + 2;
	const archived = { excludePaths: ["Archive"] };
	await assert.rejects(t.index.update(archived), /the parse key cannot be read/);
	t.since();
	const next = await t.index.update(archived);
	assert.deepEqual(t.since().read, ["Inbox.md", "Projects/Garden.md"]);
	assert.deepStrictEqual([...next.tasks], await t.reference(archived));
});

test("a parse key that cannot be read when an update starts rejects it before any read, and the marks wait", async () => {
	let broken = false;
	const t = indexed(notes(), {
		parseKey: () => {
			if (broken) throw new Error("the parse key cannot be read");
			return parseKeyOf(moment);
		},
	});
	await t.index.update({});
	t.since();
	t.vault.write("Inbox.md", "- [ ] one");
	broken = true;
	await assert.rejects(t.index.update({}), /the parse key cannot be read/);
	assert.deepEqual(t.since().read, []);
	broken = false;
	const next = await t.index.update({});
	assert.deepEqual(t.since().read, ["Inbox.md"]);
	assert.deepStrictEqual([...next.tasks], await t.reference());
});

test("metadata that cannot be read while the notes are filtered rejects the update, as readTasks rejects", async (t) => {
	const i = indexed();
	await i.index.update({});
	i.since();
	const { metadataCache } = i.vault.app;
	const getFileCache = metadataCache.getFileCache.bind(metadataCache);
	const broken = t.mock.method(metadataCache, "getFileCache", (file: { path: string }) => {
		if (file.path === "Inbox.md") throw new Error("the metadata is gone");
		return getFileCache(file as never);
	});
	i.vault.write("Projects/Garden.md", "- [ ] plant the roses");
	await assert.rejects(i.index.update({ excludePaths: ["Archive"] }), /the metadata is gone/);
	await assert.rejects(i.reference({ excludePaths: ["Archive"] }), /the metadata is gone/);
	assert.deepEqual(i.since().read, []);
	broken.mock.restore();
	await i.index.update({});
	assert.deepEqual(i.since().read, ["Projects/Garden.md"], "the mark stayed, and the filters are the last ones");
});

// F. Contract

test("an update asked for while one runs waits for it and then runs; a rejected one does not stop the next", async () => {
	const t = indexed();
	const release = t.vault.holdReads();
	const running = t.index.update({});
	const listed = t.vault.listings();
	t.vault.write("Inbox.md", "- [ ] one");
	const queued = t.index.update({});
	const broken = t.index.update({ includePaths: "Projects" as never });
	const after = t.index.update({});
	assert.equal(t.vault.listings(), listed, "the queued ones have not started");
	release();
	assert.equal((await running).tasks.length, 4);
	await queued;
	await assert.rejects(broken, /include\.some is not a function/);
	const last = await after;
	assert.deepEqual(t.since().read, [...ALL, "Inbox.md"], "the mark made while the first ran is read by the next one");
	assert.equal(t.vault.listings(), listed + 3);
	assert.deepStrictEqual([...last.tasks], await t.reference());
});

test("tasks come by path in code-unit order, then in the order parseNote gives them", async () => {
	const twoTasks = (name: string) => `- [ ] ${name} one\n- [ ] ${name} two`;
	const t = indexed({ "B.md": twoTasks("B"), "Z/a.md": twoTasks("Z/a") });
	await t.index.update({});
	// Some notes are stored and some are new, so the order is that of the paths, not of the reads.
	for (const name of ["Ä", "9", "a", "_", "10"]) t.vault.write(`${name}.md`, twoTasks(name));
	const result = await t.index.update({});
	t.since();
	assert.deepEqual(
		result.tasks.map((task) => task.visual),
		["10", "9", "B", "Z/a", "_", "a", "Ä"].flatMap((name) => [`${name} one`, `${name} two`]),
	);
	assert.deepStrictEqual([...result.tasks], await t.reference());
});

/** Every array and plain object reachable from a value, dates left out, as in golden.test.ts. */
function containers(value: unknown, found = new Set<object>()): Set<object> {
	if (value === null || typeof value !== "object" || moment.isMoment(value) || found.has(value)) return found;
	found.add(value);
	for (const item of Object.values(value)) containers(item, found);
	return found;
}

test("the tasks keep none of Obsidian's metadata objects", async () => {
	const handedOut: unknown[] = [];
	const app = goldenApp(loadVault(), {}, handedOut) as never;
	const index = soleReader({ app, moment, parseKey: () => parseKeyOf(moment) });
	const result = await index.update(defaultUserOptions);
	assert.ok(result.tasks.length > 100 && handedOut.length > 0);
	const reachable = containers(result.tasks);
	const kept = handedOut.flatMap((cache) => [...containers(cache)]).filter((object) => reachable.has(object));
	assert.deepEqual(kept, []);
});

test("watchNotes marks the paths of each change, then watchChanges hands on the change with its metadata", () => {
	const vault = fakeVault({ ...notes(), "Projects/Pond.md": "- [ ] dig the pond" });
	const { metadataCache } = vault.app;
	const events: unknown[][] = [];
	// Registered in this order, as the plugin's shared index watches before a view does.
	const refs = [
		...watchNotes(vault.app as never, { markDirty: (paths) => events.push(["marked", ...paths]) }),
		...watchChanges(vault.app as never, (paths, cache) => events.push(["changed", paths, cache])),
	];
	const fileCache = (path: string) => metadataCache.getFileCache(vault.app.vault.getAbstractFileByPath(path));
	const expect = (change: () => void, paths: string[], cache: () => unknown) => {
		events.length = 0;
		change();
		assert.deepEqual(events, [
			["marked", ...paths],
			["changed", paths, cache()],
		]);
		// The metadata of a file that is no note is a new empty object each time; a note's is the same object.
		if (paths[0].endsWith(".md")) assert.equal(events[1][2], cache(), "the very metadata object");
	};
	// A save marks the note when it is written, and again with its metadata, which goes on to the view.
	events.length = 0;
	vault.write("Inbox.md", "- [ ] one");
	assert.deepEqual(events, [
		["marked", "Inbox.md"],
		["marked", "Inbox.md"],
		["changed", ["Inbox.md"], fileCache("Inbox.md")],
	]);
	// A save Obsidian's metadata cache does not answer, as when it cannot read the file: marked, and nothing handed on.
	events.length = 0;
	vault.write("Inbox.md", "- [x] one", { indexed: false });
	assert.deepEqual(events, [["marked", "Inbox.md"]]);
	vault.indexPending();
	const archived = fileCache("Archive/Old.md");
	assert.ok(archived);
	expect(
		() => vault.remove("Archive/Old.md"),
		["Archive/Old.md"],
		() => archived,
	);
	expect(
		() => vault.rename("Inbox.md", "Errands.md"),
		["Errands.md", "Inbox.md"],
		() => fileCache("Errands.md"),
	);
	events.length = 0;
	vault.rename("Projects", "Done");
	assert.deepEqual(
		events.filter(([kind]) => kind === "marked"),
		[
			["marked", "Done/Garden.md", "Projects/Garden.md"],
			["marked", "Done/Pond.md", "Projects/Pond.md"],
		],
		"each note in the folder; the folder's own event is no note's",
	);
	expect(
		() => vault.rename("Errands.md", "Errands.txt"),
		["Errands.txt", "Errands.md"],
		() => fileCache("Errands.txt"),
	);
	for (const ref of refs) {
		vault.app.vault.offref(ref);
		metadataCache.offref(ref);
	}
	events.length = 0;
	vault.write("Done/Garden.md", "- [ ] two");
	vault.remove("Done/Pond.md");
	vault.rename("Errands.txt", "Errands.md");
	assert.deepEqual(events, [], "nothing after offref");
});
