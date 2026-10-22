/**
 * A task index of a fake vault, for the index's tests, wired to the vault as the plugin wires it. It records which
 * notes the index reads and parses, so a test can pin them exactly, and compares with readTasks on the same vault.
 */
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import moment from "moment";
import { Notice, type CachedMetadata } from "obsidian";

import { parseNote, type NoteFilterSettings, type Task } from "@tasks-calendar-wrapper/core";
import { readTasks } from "../timeline/src/taskadapter";
import {
	createTaskIndex,
	watchChanges,
	watchNotes,
	type TaskIndex,
	type TaskIndexDeps,
	type TaskIndexReader,
} from "../timeline/src/taskindex";
import { parseKeyOf, type ParseKey } from "../utils/parsekey";
import { fakeVault } from "./fakevault";

/** The notes of viewevents.test.ts: two with tasks, one without, and one in the archive. */
export const notes = () => ({
	"Inbox.md": "- [ ] call the plumber 📅 2026-01-20",
	"Projects/Garden.md": "# Garden\n\n- [ ] plant the tulips\n- [x] buy bulbs",
	"Reference/Plain.md": "# Plain\n\n- a list item\n- another one",
	"Archive/Old.md": "- [ ] an old task",
});

/**
 * The notes of notes() a full read reads, in the order the index reads them: those with a task item, so every note but
 * Reference/Plain.md.
 */
export const ALL = ["Archive/Old.md", "Inbox.md", "Projects/Garden.md"];

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
export const shownNotices = (Notice as unknown as { shown: string[] }).shown;

/**
 * An index of a fake vault, wired to it as the plugin wires it: watchNotes marks the paths of every change, and the
 * changes watchChanges hands on, as to a view, are kept in `heard`. The index parses with core's parseNote and records
 * each path it parses. `index` is its first reader, with the index's markDirty; `open` gives another.
 */
export function indexed(
	content: Record<string, string> = notes(),
	{
		parseKey,
		jsonFrontmatter = false,
		staggerReads = false,
	}: { parseKey?: () => ParseKey; jsonFrontmatter?: boolean; staggerReads?: boolean } = {},
) {
	const vault = fakeVault(content, { jsonFrontmatter, staggerReads });
	const parsed: string[] = [];
	const heard: [string[], CachedMetadata | null][] = [];
	const shared = createTaskIndex({
		app: vault.app as never,
		moment,
		parseKey: parseKey ?? (() => parseKeyOf(moment)),
		parse: (snapshot, m) => {
			parsed.push(snapshot.path);
			return parseNote(snapshot, m);
		},
	});
	const index = withMarks(shared, shared.openReader());
	const refs = [
		...watchNotes(vault.app as never, shared),
		...watchChanges(vault.app as never, (paths, cache) => heard.push([paths, cache])),
	];
	let reads = 0;
	let parses = 0;
	return {
		vault,
		shared,
		index,
		/** Another reader of the same index, with the same markDirty. */
		open: () => withMarks(shared, shared.openReader()),
		heard,
		refs,
		/** The notes read and parsed since the last call, in the order the reads started and the parses ran. */
		since() {
			const result = { read: vault.reads.slice(reads), parsed: parsed.slice(parses) };
			reads = vault.reads.length;
			parses = parsed.length;
			return result;
		},
		/** What readTasks gives now. Its reads are not the index's: take those with since() first. */
		async reference(filters: NoteFilterSettings = {}): Promise<Task[]> {
			assert.equal(vault.reads.length, reads, "since() takes the index's reads before readTasks reads the notes");
			const tasks = await readTasks(vault.app as never, filters, moment);
			reads = vault.reads.length;
			return tasks;
		},
	};
}

/** A reader with the index's markDirty, as the tests of one reader use it. */
export const withMarks = (shared: TaskIndex, reader: TaskIndexReader) =>
	Object.freeze({ ...reader, markDirty: shared.markDirty });

/** The only reader of a new index, with the index's markDirty. */
export function soleReader(deps: TaskIndexDeps) {
	const shared = createTaskIndex(deps);
	return withMarks(shared, shared.openReader());
}

/**
 * Our console lines while the test runs, each with what it was called with, in order. moment's one-time deprecation
 * warning and Node's note on mocked timers are left out.
 */
export function ourLines(t: TestContext): unknown[][] {
	const lines: unknown[][] = [];
	const keep =
		(kind: string) =>
		(...args: unknown[]) => {
			if (String(args[0]).startsWith("Tasks Calendar Wrapper")) lines.push([kind, ...args]);
		};
	t.mock.method(console, "warn", keep("warn"));
	t.mock.method(console, "error", keep("error"));
	return lines;
}

/** What `run` tells the user: the console lines it adds to `lines`, then the Notices it shows. */
export async function telling(lines: unknown[][], run: () => unknown): Promise<unknown[][]> {
	const logged = lines.length;
	const shown = shownNotices.length;
	await run();
	return [...lines.slice(logged), ...shownNotices.slice(shown).map((notice) => ["notice", notice])];
}

/** The paths of the tasks, in order. */
export const pathsOf = (tasks: readonly Task[]) => tasks.map((task) => task.path);
