/**
 * Runs a sequence of tests/vault-steps.ts against a task index and readTasks on one fake vault, and checks each update:
 * - at rest, the index gives what readTasks gives, tasks and moments included, rejects as it rejects, and its warnings
 *   and failures tell the user what readTasks tells;
 * - always, it reads exactly the notes a model of the marks says are due, each once, and parses each it read;
 * - a note it did not read gives the same Task objects as before.
 * shrink makes a failing sequence as short as it can while it still fails.
 */
import assert from "node:assert/strict";
import moment from "moment";
import { Notice } from "obsidian";

import { noteVisible, parseNote, resolveTasks, type NoteFilterSettings, type Task } from "@tasks-calendar-wrapper/core";
import { readTasks, reportNoteReads } from "../timeline/src/taskadapter";
import { createTaskIndex, watchNotes, type IndexUpdate, type TaskIndex } from "../timeline/src/taskindex";
import { parseKeyOf, sameParseKey, type ParseKey } from "../utils/parsekey";
import { fakeVault, type FakeVault } from "./fakevault";
import { applyVaultAction, resetEnvironment, type Action, type Stage, type VaultAction } from "./vault-steps";

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

/** How a sequence is run. */
export interface Run {
	/** Where the test's console mocks put our console lines, each with what it was called with. */
	readonly lines: unknown[][];
	/** Told what each step did, for the coverage guard. */
	readonly count?: (what: string) => void;
}

/** The last update that succeeded. */
interface Previous {
	readonly result: IndexUpdate;
	/** The notes listed and kept by the filters when it started. */
	readonly visible: ReadonlySet<string>;
	readonly failed: ReadonlySet<string>;
}

/** What the model knows of the index, besides the stage the vault actions change. */
interface World extends Stage {
	readonly index: TaskIndex;
	/** The paths parsed, in order. */
	readonly parsed: string[];
	/** The paths watchNotes marked since the last update took the marks. */
	marked: Set<string>;
	/** The environment changed during the last update, so the index may read everything, or not. */
	maybeFull: boolean;
	committed: { readonly filters: string; readonly parseKey: ParseKey } | null;
	previous: Previous | null;
}

/** What one update starts from: the model takes it right before update(), as the index takes its marks. */
interface Window {
	readonly marks: ReadonlySet<string>;
	readonly rereadAll: boolean;
	readonly maybeFull: boolean;
}

function takeWindow(world: World): Window {
	const window = { marks: world.marked, rereadAll: world.rereadAll, maybeFull: world.maybeFull };
	world.marked = new Set();
	world.rereadAll = false;
	world.maybeFull = false;
	return window;
}

/** A rejected update stored nothing: its window goes on into the next one. */
function putBack(world: World, window: Window): void {
	world.marked = new Set([...window.marks, ...world.marked]);
	world.rereadAll ||= window.rereadAll;
	world.maybeFull ||= window.maybeFull;
}

const filterKey = (s: NoteFilterSettings) =>
	JSON.stringify([s.includePaths, s.excludePaths, s.fileIncludeTags, s.fileExcludeTags, s.excludeProperties]);

const sorted = (paths: Iterable<string>) => [...paths].sort();

/** The notes the filters keep now, worked out without listing through the vault; null when the filters throw. */
function visibleNow(vault: FakeVault, filters: NoteFilterSettings): Set<string> | null {
	const notes = vault.filePaths().filter((path) => path.endsWith(".md"));
	try {
		return new Set(
			notes.filter((path) => {
				const cache = vault.app.metadataCache.getFileCache(vault.app.vault.getAbstractFileByPath(path));
				const note = { path, tags: cache?.tags?.map((t) => t.tag) ?? [], frontmatter: cache?.frontmatter };
				return noteVisible(note, filters);
			}),
		);
	} catch {
		return null;
	}
}

interface Captured<T> {
	readonly value?: T;
	readonly error?: unknown;
	/** Our console lines, then the Notices shown. */
	readonly told: readonly unknown[][];
}

/** What `run` gives or throws, and what it tells the user meanwhile. */
async function captured<T>(lines: unknown[][], run: () => Promise<T> | T): Promise<Captured<T>> {
	const logged = lines.length;
	const shown = shownNotices.length;
	const told = () => [...lines.slice(logged), ...shownNotices.slice(shown).map((notice) => ["notice", notice])];
	try {
		const value = await run();
		return { value, told: told() };
	} catch (error) {
		return { error, told: told() };
	}
}

/** The tasks of each path, in order. */
function tasksByPath(tasks: readonly Task[]): Map<string, Task[]> {
	const byPath = new Map<string, Task[]>();
	for (const task of tasks) byPath.set(task.path, [...(byPath.get(task.path) ?? []), task]);
	return byPath;
}

/** At rest, the index gives what readTasks gives, and tells the user the same. */
async function checkAtRest(
	world: World,
	filters: NoteFilterSettings,
	indexed: Captured<IndexUpdate>,
	at: string,
	run: Run,
) {
	const reference = await captured(run.lines, () => readTasks(world.vault.app as never, filters, moment));
	if (reference.error !== undefined) {
		assert.ok(indexed.error !== undefined, `${at}: readTasks threw ${reference.error}, the index did not`);
		assert.equal(String(indexed.error), String(reference.error), `${at}: the same error`);
		run.count?.("rejected with readTasks");
		return;
	}
	assert.equal(indexed.error, undefined, `${at}: the index threw ${indexed.error}, readTasks did not`);
	const result = indexed.value as IndexUpdate;
	assert.deepStrictEqual([...result.tasks], reference.value, `${at}: the tasks`);
	const told = await captured(run.lines, () => reportNoteReads(result.warnings, result.failures));
	assert.deepStrictEqual(told.told, reference.told, `${at}: what the user is told`);
	const failed = result.failures.map((failure) => failure.path);
	assert.deepEqual(failed, sorted(failed), `${at}: the failures in path order`);
	run.count?.("at rest");
	if (failed.length > 0) run.count?.("at rest with failures");
}

/** What an update read, against the model, and whose tasks it kept. */
interface Reading {
	readonly reads: readonly string[];
	readonly parsed: readonly string[];
	readonly visible: ReadonlySet<string>;
	/** A full read is certainly due: the first update, rereadAll, or another filter or parse key. */
	readonly certainFull: boolean;
}

/** Every update that succeeds: frozen, each note read once and parsed, exactly the notes due, the others kept. */
function checkReading(world: World, window: Window, result: IndexUpdate, reading: Reading, at: string, run: Run) {
	const { reads, parsed, visible, certainFull } = reading;
	const arrays = [result, result.tasks, result.warnings, result.failures];
	assert.ok(
		arrays.every((value) => Object.isFrozen(value)),
		`${at}: the result is frozen`,
	);
	assert.equal(new Set(reads).size, reads.length, `${at}: a note read twice: ${reads}`);
	const unread = result.failures.filter((failure) => /could not read|does not exist/.test(String(failure.reason)));
	const readFailures = new Set(unread.map((failure) => failure.path));
	const readAndParsed = reads.filter((path) => !readFailures.has(path));
	assert.deepEqual(sorted(parsed), sorted(readAndParsed), `${at}: one parse per note read`);
	const previous = world.previous;
	if (previous) assert.notEqual(result.tasks, previous.result.tasks, `${at}: a new array`);
	const due = certainFull
		? sorted(visible)
		: sorted(
				[...visible].filter(
					(path) =>
						window.marks.has(path) ||
						previous === null ||
						!previous.visible.has(path) ||
						previous.failed.has(path),
				),
			);
	if (certainFull) run.count?.("full");
	if (certainFull || !window.maybeFull) {
		assert.deepEqual(sorted(reads), due, `${at}: the notes read`);
	} else {
		for (const path of due) assert.ok(reads.includes(path), `${at}: ${path} was not read`);
		for (const path of reads) assert.ok(visible.has(path), `${at}: ${path} is no visible note`);
	}
	if (previous && !certainFull && !window.maybeFull) checkKept(result, previous, reads, at, run);
}

/** The tasks of a note not read are the same objects as before. */
function checkKept(result: IndexUpdate, previous: Previous, reads: readonly string[], at: string, run: Run) {
	const before = tasksByPath(previous.result.tasks);
	for (const [path, tasks] of tasksByPath(result.tasks)) {
		const old = before.get(path);
		if (reads.includes(path) || old === undefined) continue;
		assert.equal(tasks.length, old.length, `${at}: ${path}'s tasks`);
		tasks.forEach((task, i) => assert.equal(task, old[i], `${at}: ${path}'s task ${i} is the same object`));
		run.count?.("identity kept");
	}
}

/** One update, with the vault actions applied while it reads, if any. */
async function runUpdate(world: World, during: Extract<Action, { op: "updateDuring" }> | null, at: string, run: Run) {
	const { vault, index } = world;
	const window = takeWindow(world);
	const keyAtStart = parseKeyOf(moment);
	const filters = world.filters;
	const visible = visibleNow(vault, filters);
	const certainFull =
		world.committed === null ||
		window.rereadAll ||
		world.committed.filters !== filterKey(filters) ||
		!sameParseKey(world.committed.parseKey, keyAtStart);
	const readsBefore = vault.reads.length;
	const parsedBefore = world.parsed.length;
	const indexed = await captured(run.lines, async () => {
		const updating = index.update(filters);
		if (during) await applyDuring(world, during.ticks, during.during, run);
		return updating;
	});
	const reads = vault.reads.slice(readsBefore);
	const parsed = world.parsed.slice(parsedBefore);
	if (during?.during.some((action) => action.op === "env")) world.maybeFull = true;
	if (during) run.count?.("during reads");
	assert.deepEqual(indexed.told, [], `${at}: an update tells the user nothing itself`);
	// A note saved and not indexed yet is marked by its "modify", so the index reads it as readTasks does.
	if (during === null) await checkAtRest(world, filters, indexed, at, run);
	assert.equal(indexed.error !== undefined, visible === null, `${at}: the update threw ${indexed.error}`);
	if (indexed.error !== undefined || visible === null) return putBack(world, window);
	const result = indexed.value as IndexUpdate;
	checkReading(world, window, result, { reads, parsed, visible, certainFull }, at, run);
	// What the view does with the tasks: a change to the shared moments would show in the next comparison.
	resolveTasks(result.tasks, { forward: true, sort: "" }, { now: moment(), moment });
	const failed = new Set(result.failures.map((failure) => failure.path));
	world.previous = { result, visible, failed };
	world.committed = { filters: filterKey(filters), parseKey: keyAtStart };
}

/**
 * The actions applied while the update reads: with 0 ticks synchronously, right after update() returned, when every
 * read has started and none is parsed; with more, after that many microtasks, between the staggered parses.
 */
async function applyDuring(world: World, ticks: number, actions: readonly VaultAction[], run: Run): Promise<void> {
	for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
	for (const action of actions) applyVaultAction(world, action, (what) => run.count?.(what));
}

async function runStep(world: World, action: Action, at: string, run: Run): Promise<void> {
	if (action.op === "update") return runUpdate(world, null, at, run);
	if (action.op === "updateDuring") return runUpdate(world, action, at, run);
	if (action.op !== "updateBroken") return applyVaultAction(world, action, (what) => run.count?.(what));
	// The listing throws with the filters unchanged: the update fails, and the marks and a full read due stay.
	world.vault.breakListing();
	await assert.rejects(world.index.update(world.filters), /the vault is not ready/, `${at}: a broken listing`);
	run.count?.("broken listing");
}

/** Runs the sequence on a new vault, in the environment golden-clock sets. Gives null, or how it failed. */
export async function runSequence(actions: readonly Action[], run: Run): Promise<Error | null> {
	resetEnvironment();
	shownNotices.length = 0;
	const vault = fakeVault({}, { jsonFrontmatter: true, staggerReads: true });
	const parsed: string[] = [];
	const index = createTaskIndex({
		app: vault.app as never,
		moment,
		parseKey: () => parseKeyOf(moment),
		parse: (snapshot, m) => {
			parsed.push(snapshot.path);
			return parseNote(snapshot, m);
		},
	});
	const world: World = {
		vault,
		index,
		parsed,
		filters: {},
		rereadAll: false,
		marked: new Set(),
		maybeFull: false,
		committed: null,
		previous: null,
	};
	// The wiring the view will register: every event marks its paths, which the model notes too.
	// The marks as the index gets them, from every event watchNotes listens to, also those it hands nothing on for.
	const marking = {
		markDirty: (paths: readonly string[]) => {
			for (const path of paths) world.marked.add(path);
			index.markDirty(paths);
		},
	};
	watchNotes(vault.app as never, marking, () => {});
	try {
		for (const [step, action] of actions.entries()) await runStep(world, action, `step ${step}`, run);
		return null;
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	} finally {
		resetEnvironment();
	}
}

/** At most this many replays while shrinking. */
const MAX_REPLAYS = 2000;

/** Drops the actions one at a time, last first, for as long as the sequence still fails. */
export async function shrink(actions: readonly Action[], run: Run): Promise<Action[]> {
	let current = [...actions];
	let replays = 0;
	let dropped = true;
	while (dropped && replays < MAX_REPLAYS) {
		dropped = false;
		for (let i = current.length - 1; i >= 0 && replays < MAX_REPLAYS; i--) {
			const candidate = [...current.slice(0, i), ...current.slice(i + 1)];
			replays += 1;
			if ((await runSequence(candidate, run)) !== null) {
				current = candidate;
				dropped = true;
			}
		}
	}
	return current;
}
