/**
 * Runs a sequence of tests/vault-steps.ts against the readers of one task index and against readTasks, on one fake
 * vault, and checks each update:
 * - at rest, a reader gets what readTasks gives with its own filters, tasks and moments included, rejects as it
 *   rejects, and its warnings and failures tell the user what readTasks tells;
 * - always, it reads exactly the notes the model of tests/vault-model.ts says are due, in order and each once, parses
 *   each it read, and reads no note an index of the reader's own would not read at the same moment, but in the two
 *   cases the model names and again a note it could not read in one of them; with one reader, exactly those notes;
 * - a note it did not read gives the same Task objects and WarnedNote as the last update, of any reader, that gave it;
 *   at rest each warned note's content id is that of the text the note holds;
 * - the reader's view tells of the update what checkTelling says it is to: each warning line once for the same text
 *   of the same note, the reasons of the failing notes, and the Notice only when they changed.
 * The sequence starts with one reader open, with no filters, as a sequence of one reader has it. shrink makes a failing
 * sequence as short as it can while it still fails.
 */
import assert from "node:assert/strict";
import moment from "moment";
import { Notice } from "obsidian";

import { copyJsonValue, hasTaskItems, parseNote, resolveTasks, type Task } from "@tasks-calendar-wrapper/core";
import { readTasks, reportNoteReads, warningLine } from "../timeline/src/taskadapter";
import { contentIdOf } from "../utils/contentid";
import {
	createTaskIndex,
	watchNotes,
	type IndexUpdate,
	type TaskIndex,
	type NoteSource,
} from "../timeline/src/taskindex";
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
	type Pin,
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
	/** For sequences of one reader: each update reads exactly what an index of its own would, no fewer, no more. */
	readonly exact?: boolean;
}

/** What a sequence runs with: the model, the index, the app readTasks reads through, and the vault actions' stage. */
interface Setup {
	readonly world: World;
	readonly index: TaskIndex;
	/** The vault's app without the hooks, so readTasks's reads and parses are not taken for the index's. */
	readonly reference: NoteSource;
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
		pins: new Map(),
		parsedEntries: new Map(),
		given: [],
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
	if (result.error === undefined) {
		checkResult(s, asked, plan, result.value as IndexUpdate);
		await checkTelling(s, asked, result.value as IndexUpdate);
	}
}

/** No vault action came since it started, and it shows no note that fails or went with no event. */
function atRest(world: World, asked: Asked, plan: Plan): boolean {
	const unheard = (path: string) => world.silent.has(path) || world.silentlyRemoved.has(path);
	return plan.actions === world.actions && !asked.reader.missedSinceClose && !(plan.visible ?? []).some(unheard);
}

/**
 * It read no note an index of its reader's own would not read, but in the two cases the model names, and again a note
 * it could not read in one of them.
 */
function checkAgainstOwn(asked: Asked, plan: Plan, run: Run): void {
	const own = plan.own;
	if (own === null) return;
	if (run.exact) {
		const sorted = (paths: Iterable<string>) => [...paths].sort();
		assert.deepEqual(sorted(asked.reads), sorted(own.due), `${asked.at}: the reads of an index of its own`);
	}
	const more = asked.reads.filter((path) => !own.due.has(path));
	if (more.length > 0 && own.keyFlipped) run.count?.("more than its own: the key changed and back");
	else if (more.length > 0 && more.every((path) => own.gone.has(path)))
		run.count?.("more than its own: a file gone unheard");
	else if (more.length > 0 && more.every((path) => own.gone.has(path) || own.failedUnread.has(path)))
		run.count?.("more than its own: again, a note it could not read then");
	else assert.deepEqual(more, [], `${asked.at}: reader ${asked.reader.id} read what an index of its own would not`);
	if (asked.reads.length < own.due.size) run.count?.("fewer than its own");
	if (own.everything) run.count?.("full");
	run.count?.("checked against its own");
}

/** At rest, the update gives what readTasks gives with its filters, and tells the user the same. */
async function checkAtRest(s: Setup, asked: Asked, indexed: Captured<IndexUpdate>): Promise<void> {
	const { at, reader } = asked;
	const { run } = s;
	// The reference reads the unpinned notes normally; the model supplies the frozen entries of every pin.
	const referenceApp = {
		...s.reference,
		vault: {
			...s.reference.vault,
			getMarkdownFiles: () =>
				s.reference.vault
					.getMarkdownFiles()
					.filter((file) => indexed.error !== undefined || !asked.pins.has(file.path)),
		},
	};
	const reference = await captured(run.lines, () => readTasks(referenceApp as never, asked.filters, moment));
	if (reference.error !== undefined) {
		assert.ok(indexed.error !== undefined, `${at}: readTasks threw ${reference.error}, the index did not`);
		assert.equal(String(indexed.error), String(reference.error), `${at}: the same error`);
		run.count?.("rejected with readTasks");
		return;
	}
	assert.equal(indexed.error, undefined, `${at}: the index threw ${indexed.error}, readTasks did not`);
	const result = indexed.value as IndexUpdate;
	const pinnedTasks = asked.given.flatMap((path) => asked.pins.get(path)?.entry.tasks ?? []);
	const expected = [...(reference.value ?? []), ...pinnedTasks].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	assert.deepStrictEqual(result.tasks, expected, `${at}: the tasks of reader ${reader.id}, including its pins`);
	const told = await captured(run.lines, () =>
		reportNoteReads(
			result.warnings.filter((warning) => !asked.pins.has(warning.path)),
			result.failures,
		),
	);
	assert.deepStrictEqual(told.told, reference.told, `${at}: what the user is told`);
	for (const note of result.warned) {
		if (asked.pins.has(note.path)) continue;
		const text = s.world.vault.contentOf(note.path);
		assert.equal(note.content, contentIdOf(text ?? ""), `${at}: the content id of ${note.path} is its text's`);
		run.count?.("content ids at rest");
	}
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
	const arrays = [
		update,
		update.tasks,
		update.warnings,
		update.warned,
		...update.warned,
		update.failures,
		update.pinned,
	];
	assert.ok(
		arrays.every((value) => Object.isFrozen(value)),
		`${at}: the result is frozen`,
	);
	const last = world.lastResult;
	if (last)
		assert.ok(
			update.tasks !== last.tasks &&
				update.warnings !== last.warnings &&
				update.failures !== last.failures &&
				update.pinned !== last.pinned,
			`${at}: new arrays`,
		);
	world.lastResult = update;
	const pinned = asked.given.filter((path) => asked.pins.has(path));
	assert.deepEqual(update.pinned, pinned, `${at}: the pinned paths, in order`);
	const actualTasks = tasksByPath(update.tasks);
	for (const [path, pin] of asked.pins) {
		const visible = pinned.includes(path);
		const tasks = actualTasks.get(path) ?? [];
		assert.equal(tasks.length, visible ? pin.entry.tasks.length : 0, `${at}: ${path}'s pinned task count`);
		tasks.forEach((task, i) => assert.equal(task, pin.entry.tasks[i], `${at}: ${path}'s pinned task ${i}`));
		assert.equal(
			update.warned.find((note) => note.path === path) ?? null,
			visible ? (pin.entry.warned ?? null) : null,
			`${at}: ${path}'s pinned WarnedNote`,
		);
		assert.deepEqual(
			update.warnings.filter((warning) => warning.path === path),
			visible ? pin.entry.warnings : [],
			`${at}: ${path}'s pinned warnings`,
		);
	}
	if (pinned.length > 0) {
		run.count?.("held update");
		if (plan.own?.everything) run.count?.("held full read");
		if (pinned.some((path) => !world.vault.hasMetadata(path))) run.count?.("held hidden by metadata");
		if (pinned.some((path) => world.producer.has(path) && world.producer.get(path) !== reader.id))
			run.count?.("held for another reader");
	}
	const failed = asked.given.filter((path) => asked.failed.has(path) && !asked.pins.has(path));
	assert.deepEqual(
		update.failures.map((failure) => failure.path),
		failed,
		`${at}: the failures, in path order`,
	);
	const readAndParsed = asked.reads.filter((path) => !asked.unread.has(path));
	assert.deepEqual(sorted(asked.parsed), sorted(readAndParsed), `${at}: one parse per note read`);
	for (const [path, tasks] of tasksByPath(update.tasks)) {
		if (asked.pins.has(path)) continue;
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
	const flat = update.warned.flatMap((note) => note.warnings);
	assert.ok(
		flat.length === update.warnings.length && flat.every((warning, i) => warning === update.warnings[i]),
		`${at}: the warned notes hold the warnings, in order`,
	);
	assert.deepEqual(
		update.warned.map((note) => note.path),
		[...new Set(update.warnings.map((warning) => warning.path))],
		`${at}: each warned note once, in path order`,
	);
	for (const note of update.warned) {
		if (asked.pins.has(note.path)) continue;
		if (asked.reads.includes(note.path)) {
			world.warnedObjects.set(note.path, note);
			const entry = asked.parsedEntries.get(note.path);
			if (entry) entry.warned = note;
		} else
			assert.equal(
				note,
				world.warnedObjects.get(note.path),
				`${at}: ${note.path}'s WarnedNote is the same object`,
			);
	}
	// What each view does with the tasks: a change to the shared moments would show in a later comparison.
	resolveTasks(update.tasks, { forward: true, sort: "" }, { now: moment(), moment });
	if (plan.sharedKeep) run.count?.("shared read");
	if (plan.own === null) run.count?.("closed reader update");
}

/**
 * What the reader's view tells of an update that succeeded, as its ReadReporter, against what it is to tell: each
 * warning line of the update that the view has not told yet for that note's text, a line that a note has twice being
 * told twice the first time; the reason of every failing note; and the Notice when the failing paths differ from the
 * last report's and are some.
 */
async function checkTelling(s: Setup, asked: Asked, update: IndexUpdate): Promise<void> {
	const { reader, at } = asked;
	const { told, failing } = reader.telling;
	const expected: unknown[][] = [];
	const toldNow = new Set(told);
	for (const note of update.warned) {
		let before = 0;
		for (const warning of note.warnings) {
			const line = warningLine(warning);
			const key = JSON.stringify([note.path, note.content, line]);
			if (told.has(key)) before += 1;
			else expected.push(["warn", line]);
			toldNow.add(key);
		}
		s.run.count?.(before > 0 ? "warnings told before" : "warnings told");
	}
	const paths = update.failures.map((failure) => failure.path);
	for (const failure of update.failures)
		expected.push(["error", "Tasks Calendar Wrapper: reading a file failed", failure.reason]);
	const changed = paths.length !== failing.length || paths.some((path, i) => path !== failing[i]);
	if (changed && paths.length > 0) {
		expected.push([
			"notice",
			`Tasks Calendar Wrapper: ${paths.length} file(s) could not be read, their tasks are missing. See the developer console.`,
		]);
		if (failing.length > 0) s.run.count?.("other failures");
	} else if (paths.length > 0) s.run.count?.("same failures");
	const actual = await captured(s.run.lines, () => reader.reporter.report(update));
	assert.deepStrictEqual(actual.told, expected, `${at}: what the view of reader ${reader.id} tells`);
	reader.telling = { told: toldNow, failing: paths };
}

/** The reader asks for a full read, and the model takes note. */
function rereadAll(world: World, reader: ReaderModel): void {
	reader.reader.rereadAll();
	fullReadAsked(world, reader);
}

function open(s: Setup, filters: number): void {
	const { world } = s;
	if (openReaders(world).length >= MOST_READERS) return;
	const reader = newReader(world.readers.length, s.index.openReader(), FILTERS[filters]);
	world.readers.push(reader);
	// No full read has been asked for yet: every fresh entry predates no cutoff for this new reader. Its new
	// filters and empty held set still force the first read, unless a pin supplies that first update instead.
	for (const fresh of world.stored.values()) fresh.add(reader.id);
	s.run.count?.("open");
}

function close(s: Setup, reader: ReaderModel): void {
	if (s.world.pins.size > 0) s.run.count?.("held at close");
	reader.reader.close();
	reader.open = false;
	s.run.count?.("close");
}

/** A hold takes the committed entry, even when stale, or the whole retired pin when no entry remains. */
function hold(world: World, index: TaskIndex, pick: number): string | null {
	const notes = world.vault.filePaths().filter((path) => path.endsWith(".md"));
	if (notes.length === 0) return null;
	const held = [...world.pins.keys()].filter((path) => notes.includes(path));
	const retired = [...world.retired.keys()].filter((path) => notes.includes(path) && !world.committedPaths.has(path));
	const reading = world.current?.reads.filter((path) => notes.includes(path) && world.committedPaths.has(path)) ?? [];
	const choices =
		reading.length > 0
			? reading
			: held.length > 0 && pick % 3 === 0
				? held
				: retired.length > 0 && pick % 3 === 1
					? retired
					: notes;
	const path = choices[pick % choices.length];
	const previous = world.pins.get(path);
	if (previous) {
		previous.count += 1;
		world.count("overlapping holds");
	} else {
		const entry = world.committedPaths.has(path) ? world.entries.get(path) : undefined;
		const cache = world.vault.app.metadataCache.getFileCache(world.vault.app.vault.getAbstractFileByPath(path));
		const pin: Pin | undefined = entry
			? {
					entry,
					tags: cache?.tags?.map((tag) => tag.tag) ?? [],
					frontmatter: cache?.frontmatter === undefined ? undefined : copyJsonValue(cache.frontmatter),
					hasTaskItems: hasTaskItems(cache),
				}
			: world.retired.get(path);
		world.pins.set(path, { count: 1, pin, retire: true });
		if (!pin) world.count("hold without pin");
		if (!entry && pin) world.count("hold acquired after a held commit, before a re-read");
	}
	const pin = world.pins.get(path)?.pin;
	if (pin && world.current?.plan?.listed.has(path)) {
		world.current.pins.set(path, pin);
		if (world.current.reads.includes(path)) world.count("held during reads");
	}
	world.tokens.push({ path, token: index.hold(path) });
	return path;
}

/** Every live token is released at most once in the model; the real second release must be a no-op. */
function release(world: World, pick: number, all: boolean, markDirty: boolean): void {
	if (world.tokens.length === 0) return;
	const released = all ? world.tokens.splice(0) : world.tokens.splice(pick % world.tokens.length, 1);
	for (const { path, token } of released) {
		const held = world.pins.get(path) ?? assert.fail(`no hold for ${path}`);
		if (markDirty) marked(world, [path]);
		held.count -= 1;
		if (held.count === 0) {
			world.pins.delete(path);
			if (held.pin && held.retire) world.retired.set(path, held.pin);
			world.released.add(path);
		}
		token.release({ markDirty });
		token.release();
	}
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
	else if (action.op !== "missedEvent" && action.op !== "hold") world.silent.delete(path);
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
		committedPaths: new Set(),
		entries: new Map(),
		pins: new Map(),
		retired: new Map(),
		tokens: [],
		released: new Set(),
		committedKey: null,
		waiting: [],
		current: null,
		brokenNext: false,
		actions: 0,
		silent: new Set(),
		silentlyRemoved: new Set(),
		objects: new Map(),
		warnedObjects: new Map(),
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
		assert.ok(!world.pins.get(path)?.pin, `${current.at}: ${path} is never read while pinned`);
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
				const note = parseNote(snapshot, m);
				current.parsedEntries.set(snapshot.path, { tasks: note.tasks, warnings: note.warnings });
				return note;
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
		forget: (paths) => {
			for (const path of paths) {
				world.retired.delete(path);
				const held = world.pins.get(path);
				if (held) held.retire = false;
			}
			index.forget(paths);
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
		heldPaths: () => [...world.pins.keys()],
		hold: (pick) => hold(world, index, pick),
		release: (pick, all, markDirty) => release(world, pick, all, markDirty),
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
