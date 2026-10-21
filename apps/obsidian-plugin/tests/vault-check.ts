/**
 * Runs a sequence of tests/vault-steps.ts against the readers of one task index and against readTasks, on one fake
 * vault, and checks each update:
 * - at rest, a reader gets what readTasks gives with its own filters, tasks and moments included, rejects as it
 *   rejects, and its warnings and failures tell the user what readTasks tells;
 * - always, it reads exactly the notes the model of tests/vault-model.ts says are due, in order and each once, parses
 *   each it read, and reads no note an index of the reader's own would not read at the same moment, but in the two
 *   cases the model names;
 * - a note it did not read gives the same Task objects as the last update, of any reader, that gave it.
 * The sequence starts with one reader open, with no filters, as a sequence of one reader has it. shrink makes a failing
 * sequence as short as it can while it still fails.
 */
import assert from "node:assert/strict";
import moment from "moment";
import { Notice } from "obsidian";

import { parseNote, resolveTasks, type Task } from "@tasks-calendar-wrapper/core";
import { readTasks, reportNoteReads } from "../timeline/src/taskadapter";
import { createTaskIndex, watchNotes, type IndexUpdate, type TaskIndex } from "../timeline/src/taskindex";
import { parseKeyOf } from "../utils/parsekey";
import { fakeVault } from "./fakevault";
import {
	ended,
	filterKey,
	fullReadAsked,
	marked,
	newReader,
	openReaders,
	pickOpen,
	started,
	type Asked,
	type Plan,
	type ReaderModel,
	type World,
} from "./vault-model";
import {
	applyVaultAction,
	FILTERS,
	MOST_READERS,
	resetEnvironment,
	type Action,
	type Stage,
	type VaultAction,
} from "./vault-steps";

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

/** How a sequence is run. */
export interface Run {
	/** Where the test's console mocks put our console lines, each with what it was called with. */
	readonly lines: unknown[][];
	/** Told what each step did, for the coverage guard. */
	readonly count?: (what: string) => void;
}

/** What a sequence runs with: the model, the index, the app readTasks reads through, and the vault actions' stage. */
interface Setup {
	readonly world: World;
	readonly index: TaskIndex;
	/** The vault's app without the hooks, so readTasks's reads and parses are not taken for the index's. */
	readonly reference: unknown;
	readonly stage: Stage;
	readonly run: Run;
}

/** An update asked for, and what it gives. */
interface Pending {
	readonly asked: Asked;
	readonly promise: Promise<IndexUpdate>;
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

const sorted = (paths: Iterable<string>) => [...paths].sort();

/** Asks the reader's index for an update. It is in the model's queue first, as it may start right in update(). */
function ask(s: Setup, reader: ReaderModel, at: string): Pending {
	const { world } = s;
	if (world.current !== null || world.waiting.length > 0) s.run.count?.("queued");
	const asked: Asked = {
		reader,
		filters: reader.filters,
		at,
		plan: null,
		ended: false,
		reads: [],
		parsed: [],
		unread: new Set(),
		failed: new Set(),
		markedDuring: new Set(),
		requestedDuring: new Set(),
	};
	world.waiting.push(asked);
	const promise = reader.reader.update(reader.filters);
	// Kept from turning into an unhandled rejection before it is checked.
	promise.catch(() => {});
	return { asked, promise };
}

/** Checks an update once it settled, against the model, readTasks when at rest, and the updates before. */
async function check(s: Setup, { asked, promise }: Pending): Promise<void> {
	const result = await captured(s.run.lines, () => promise);
	// Read once it settled: an update that waited had no plan when it was asked for.
	const { at, reader, plan } = asked;
	assert.ok(plan !== null && asked.ended, `${at}: the update started and ended`);
	assert.deepEqual(result.told, [], `${at}: an update tells the user nothing itself`);
	assert.equal(result.error !== undefined, plan.visible === null, `${at}: the update threw ${result.error}`);
	assert.deepEqual(asked.reads, plan.due, `${at}: the notes reader ${reader.id} read`);
	checkAgainstOwn(asked, plan, s.run);
	if (atRest(s.world, asked, plan)) await checkAtRest(s, asked, result);
	if (result.error === undefined) checkResult(s, asked, plan, result.value as IndexUpdate);
}

/** No vault action came since it started, and it shows no note that fails or went with no event. */
function atRest(world: World, asked: Asked, plan: Plan): boolean {
	const unheard = (path: string) => world.silent.has(path) || world.silentlyRemoved.has(path);
	return plan.actions === world.actions && !asked.reader.missedSinceClose && !(plan.visible ?? []).some(unheard);
}

/** It read no note an index of its reader's own would not read, but in the two cases the model names. */
function checkAgainstOwn(asked: Asked, plan: Plan, run: Run): void {
	const own = plan.own;
	if (own === null) return;
	const more = asked.reads.filter((path) => !own.due.has(path));
	if (more.length > 0 && own.keyFlipped) run.count?.("more than its own: the key changed and back");
	else if (more.length > 0 && more.every((path) => own.gone.has(path)))
		run.count?.("more than its own: a file gone unheard");
	else assert.deepEqual(more, [], `${asked.at}: reader ${asked.reader.id} read what an index of its own would not`);
	if (asked.reads.length < own.due.size) run.count?.("fewer than its own");
	if (own.everything) run.count?.("full");
	run.count?.("checked against its own");
}

/** At rest, the update gives what readTasks gives with its filters, and tells the user the same. */
async function checkAtRest(s: Setup, asked: Asked, indexed: Captured<IndexUpdate>): Promise<void> {
	const { at, reader } = asked;
	const { run } = s;
	const reference = await captured(run.lines, () => readTasks(s.reference as never, asked.filters, moment));
	if (reference.error !== undefined) {
		assert.ok(indexed.error !== undefined, `${at}: readTasks threw ${reference.error}, the index did not`);
		assert.equal(String(indexed.error), String(reference.error), `${at}: the same error`);
		run.count?.("rejected with readTasks");
		return;
	}
	assert.equal(indexed.error, undefined, `${at}: the index threw ${indexed.error}, readTasks did not`);
	const result = indexed.value as IndexUpdate;
	assert.deepStrictEqual([...result.tasks], reference.value, `${at}: the tasks of reader ${reader.id}`);
	const told = await captured(run.lines, () => reportNoteReads(result.warnings, result.failures));
	assert.deepStrictEqual(told.told, reference.told, `${at}: what the user is told`);
	run.count?.("at rest");
	if (result.failures.length > 0) run.count?.("at rest with failures");
	const others = openReaders(s.world).filter((other) => other !== reader);
	if (others.some((other) => filterKey(other.filters) !== filterKey(asked.filters)))
		run.count?.("at rest beside other filters");
}

/** Every update that succeeds: frozen and new, the failures and parses as read, the tasks of a note kept the same. */
function checkResult(s: Setup, asked: Asked, plan: Plan, update: IndexUpdate): void {
	const { world, run } = s;
	const { at, reader } = asked;
	const arrays = [update, update.tasks, update.warnings, update.failures];
	assert.ok(
		arrays.every((value) => Object.isFrozen(value)),
		`${at}: the result is frozen`,
	);
	const last = world.lastResult;
	if (last)
		assert.ok(
			update.tasks !== last.tasks && update.warnings !== last.warnings && update.failures !== last.failures,
			`${at}: new arrays`,
		);
	world.lastResult = update;
	const failed = (plan.visible ?? []).filter((path) => asked.failed.has(path));
	assert.deepEqual(
		update.failures.map((failure) => failure.path),
		failed,
		`${at}: the failures, in path order`,
	);
	const readAndParsed = asked.reads.filter((path) => !asked.unread.has(path));
	assert.deepEqual(sorted(asked.parsed), sorted(readAndParsed), `${at}: one parse per note read`);
	for (const [path, tasks] of tasksByPath(update.tasks)) {
		if (asked.reads.includes(path)) {
			world.objects.set(path, tasks);
			world.producer.set(path, reader.id);
			continue;
		}
		const before = world.objects.get(path) ?? [];
		assert.equal(tasks.length, before.length, `${at}: ${path}'s tasks`);
		tasks.forEach((task, i) => assert.equal(task, before[i], `${at}: ${path}'s task ${i} is the same object`));
		run.count?.("identity kept");
	}
	// What each view does with the tasks: a change to the shared moments would show in a later comparison.
	resolveTasks(update.tasks, { forward: true, sort: "" }, { now: moment(), moment });
	if (plan.sharedKeep) run.count?.("shared read");
	if (plan.own === null) run.count?.("closed reader update");
}

/** The reader asks for a full read, and the model takes note. */
function rereadAll(world: World, reader: ReaderModel): void {
	reader.reader.rereadAll();
	fullReadAsked(world, reader);
}

function open(s: Setup, filters: number): void {
	const { world } = s;
	if (openReaders(world).length >= MOST_READERS) return;
	world.readers.push(newReader(world.readers.length, s.index.openReader(), FILTERS[filters]));
	s.run.count?.("open");
}

function close(s: Setup, reader: ReaderModel): void {
	reader.reader.close();
	reader.open = false;
	s.run.count?.("close");
}

/** A vault action, which the model follows: an update it comes during is not at rest, unless it changes no note. */
function vaultStep(s: Setup, action: VaultAction): void {
	const { world } = s;
	if (action.op !== "filters" && action.op !== "rereadAll") world.actions += 1;
	const path = applyVaultAction(s.stage, action, (what) => s.run.count?.(what));
	if (path === null) return;
	if (action.op === "silentFail") world.silent.add(path);
	else if (action.op === "silentRemove") {
		world.silent.delete(path);
		for (const reader of world.readers) reader.own.goneSilently = new Set([...reader.own.goneSilently, path]);
		if (path.endsWith(".md")) world.silentlyRemoved.add(path);
	}
	// A note failing with no event is heard of again once it is written, healed, removed or renamed.
	else if (action.op !== "missedEvent") world.silent.delete(path);
}

/** An update, with the actions applied while it reads: with 0 ticks right after update() returned, more later. */
async function updateDuring(s: Setup, action: Extract<Action, { op: "updateDuring" }>, at: string): Promise<void> {
	const { world, run } = s;
	const reader = pickOpen(world, action.reader ?? 0);
	if (reader === null) return;
	const main = ask(s, reader, at);
	const queued: Pending[] = [];
	for (let tick = 0; tick < action.ticks; tick++) await Promise.resolve();
	for (const [i, during] of action.during.entries()) {
		if (during.op === "update") {
			const other = pickOpen(world, during.reader ?? 0);
			if (other !== null) queued.push(ask(s, other, `${at}, queued ${i}`));
		} else if (during.op === "close") {
			if (!reader.open) continue;
			close(s, reader);
			run.count?.("closed during");
		} else if (during.op === "open") open(s, during.filters);
		else vaultStep(s, during);
	}
	run.count?.("during reads");
	await check(s, main);
	for (const pending of queued) await check(s, pending);
}

async function step(s: Setup, action: Action, at: string): Promise<void> {
	const { world, run } = s;
	switch (action.op) {
		case "update": {
			const reader = pickOpen(world, action.reader ?? 0);
			if (reader !== null) await check(s, ask(s, reader, at));
			return;
		}
		case "updateDuring":
			return updateDuring(s, action, at);
		case "updateBroken": {
			// The listing throws with the filters unchanged: the update fails, and nothing changes.
			const reader = pickOpen(world, action.reader ?? 0);
			if (reader === null) return;
			world.vault.breakListing();
			world.brokenNext = true;
			const { promise } = ask(s, reader, at);
			await assert.rejects(promise, /the vault is not ready/, `${at}: a broken listing`);
			run.count?.("broken listing");
			return;
		}
		case "open":
			return open(s, action.filters);
		case "close": {
			const reader = pickOpen(world, action.pick);
			if (reader !== null) close(s, reader);
			return;
		}
		case "closedUpdate": {
			const closed = world.readers.filter((reader) => !reader.open);
			if (closed.length > 0) await check(s, ask(s, closed[action.pick % closed.length], at));
			return;
		}
		case "pair": {
			const a = pickOpen(world, action.a);
			const b = pickOpen(world, action.b);
			if (a === null || b === null) return;
			const first = ask(s, a, `${at} (a)`);
			const second = ask(s, b, `${at} (b)`);
			await check(s, first);
			await check(s, second);
			return;
		}
		default:
			return vaultStep(s, action);
	}
}

/** The model's world of a new vault, before any reader. */
function newWorld(run: Run): World {
	return {
		vault: fakeVault({}, { jsonFrontmatter: true, staggerReads: true }),
		readers: [],
		stored: new Map(),
		committedKey: null,
		waiting: [],
		current: null,
		brokenNext: false,
		actions: 0,
		silent: new Set(),
		silentlyRemoved: new Set(),
		objects: new Map(),
		producer: new Map(),
		lastResult: null,
		count: (what) => run.count?.(what),
	};
}

/** The index on the world's vault, with the hooks that tell the model what it does. */
function hookedIndex(world: World): TaskIndex {
	const files = world.vault.app.vault;
	const cachedRead = files.cachedRead.bind(files);
	files.cachedRead = (file) => {
		// Taken as the read starts, as the index takes it: a rename while it reads changes the path of the same TFile.
		const path = file.path;
		const current = world.current ?? assert.fail(`a read of ${path} with no update running`);
		current.reads.push(path);
		return cachedRead(file).catch((error: unknown) => {
			current.unread.add(path);
			current.failed.add(path);
			throw error;
		});
	};
	const index = createTaskIndex({
		app: world.vault.app as never,
		moment,
		// The first probe of an update starts it, the second ends it, see TaskIndexDeps.
		parseKey: () => {
			const key = parseKeyOf(moment);
			if (world.current !== null) ended(world, world.current, key);
			else
				started(
					world,
					world.waiting.shift() ?? assert.fail("a probe of the key with no update asked for"),
					key,
				);
			return key;
		},
		parse: (snapshot, m) => {
			const current = world.current ?? assert.fail(`a parse of ${snapshot.path} with no update running`);
			current.parsed.push(snapshot.path);
			try {
				return parseNote(snapshot, m);
			} catch (error) {
				current.failed.add(snapshot.path);
				throw error;
			}
		},
	});
	// The marks as the index gets them, from every event watchNotes listens to, which the model takes note of first.
	watchNotes(world.vault.app as never, {
		markDirty: (paths) => {
			marked(world, paths);
			index.markDirty(paths);
		},
	});
	return index;
}

/** Runs the sequence on a new vault, in the environment golden-clock sets. Gives null, or how it failed. */
export async function runSequence(actions: readonly Action[], run: Run): Promise<Error | null> {
	resetEnvironment();
	shownNotices.length = 0;
	const world = newWorld(run);
	const files = world.vault.app.vault;
	const reference = {
		vault: { getMarkdownFiles: () => files.getMarkdownFiles(), cachedRead: files.cachedRead.bind(files) },
		metadataCache: world.vault.app.metadataCache,
	};
	const index = hookedIndex(world);
	world.readers.push(newReader(0, index.openReader(), {}));
	const stage: Stage = {
		vault: world.vault,
		filters: (pick, filters) => {
			const reader = pickOpen(world, pick);
			if (reader !== null) reader.filters = filters;
		},
		rereadAll: (pick) => {
			if (pick !== null) {
				const reader = pickOpen(world, pick);
				if (reader !== null) rereadAll(world, reader);
				return;
			}
			// As every open view does on window-open; a closed one has stopped listening.
			for (const reader of world.readers) {
				if (reader.open) rereadAll(world, reader);
				else reader.missedSinceClose = true;
			}
		},
	};
	const setup: Setup = { world, index, reference, stage, run };
	try {
		for (const [n, action] of actions.entries()) {
			await step(setup, action, `step ${n}`);
			assert.ok(world.current === null && world.waiting.length === 0, `step ${n}: an update has not settled`);
		}
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
