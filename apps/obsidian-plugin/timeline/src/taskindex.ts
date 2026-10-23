import { TFile, type App, type CachedMetadata, type EventRef } from "obsidian";
import { hasTaskItems, noteVisible, parseNote } from "@tasks-calendar-wrapper/core";
import type {
	MomentFactory,
	NoteFilterSettings,
	NoteSnapshot,
	ParsedNote,
	ParseWarning,
	Task,
} from "@tasks-calendar-wrapper/core";
import { sameParseKey, type ParseKey } from "../../utils/parsekey";
import type { NoteReadFailure } from "./taskadapter";

/** What the index uses of Obsidian's App. App satisfies it; the tests pass fakes. */
export interface NoteSource {
	readonly vault: { getMarkdownFiles(): TFile[]; cachedRead(file: TFile): Promise<string> };
	readonly metadataCache: { getFileCache(file: TFile): CachedMetadata | null };
}

/** core's parseNote, or a wrapper of it that counts the notes parsed. */
export type ParseNote = (snapshot: NoteSnapshot, moment: MomentFactory) => ParsedNote;

export interface TaskIndexDeps {
	/**
	 * Always called through, as deps.app.vault.cachedRead(file), never taken apart, so a wrapper added later, such as
	 * the benchmark's cachedRead counter, sees every read.
	 */
	readonly app: NoteSource;
	readonly moment: MomentFactory;
	/**
	 * The parse environment now: () => parseKeyOf(moment) in the plugin. Required: there is no default that could go
	 * unnoticed. Called exactly twice by every update: when it starts, before it lists the notes, and once its reads
	 * have settled, right before it stores; once by an update that rejects at that first call or while it lists. The
	 * differential test follows the updates by these calls.
	 */
	readonly parseKey: () => ParseKey;
	/** Defaults to core's parseNote; tests pass a wrapper that records each path parsed. */
	readonly parse?: ParseNote;
}

/** What one update gives. Frozen, with new frozen arrays every time, also when nothing changed. */
export interface IndexUpdate {
	/**
	 * The tasks of every visible note: notes by path in code-unit order, each note's tasks in parseNote's order, as
	 * readTasks orders them. A note this update did not read gives the same Task objects as the update that read it,
	 * of whichever reader.
	 */
	readonly tasks: readonly Task[];
	/** The warnings of every visible note read without failure, stored notes included, in the same order. */
	readonly warnings: readonly ParseWarning[];
	/** The visible notes whose read or parse failed in this update, in path order. They are read again next time. */
	readonly failures: readonly NoteReadFailure[];
}

/**
 * The parsed notes of every open timeline, kept between reloads and shared, so a note that changed is read once, by
 * whichever timeline reloads first, and stored once:
 * - it keeps one entry per note: the last ParsedNote read without failure, and the generation its read started at;
 * - a reader's update uses an entry only while it is fresh for that reader: of a note the reader's last update gave
 *   without failure, read after the last mark of its path, under the parse key now, and after the reader's last full
 *   read was asked for, see TaskIndexReader. So a reader reads no note an index of its own would not read, except
 *   after the parse key changed and back, or after a file went with no event and a note came at its path;
 * - each update that succeeds replaces the Map as a whole. It keeps the fresh entries of the notes it showed and of
 *   the notes it listed that another open reader's last update gave, and no other;
 * - the updates of every reader run one at a time, in the order asked for;
 * - it keeps no view state, no CachedMetadata and no TFile, and subscribes to nothing itself, see watchNotes.
 */
export interface TaskIndex {
	/**
	 * These paths may have changed: no entry of theirs read before this call is used again, by any reader. Called for
	 * every vault "modify", every metadata cache "changed" and "deleted", and every vault "rename" of a file (new and
	 * old path), whatever changeAffectsTasks says. May be called at any time, also while an update runs or waits. O(1)
	 * per path. No update takes the marks, so one reader's update cannot lose another reader's.
	 */
	markDirty(paths: readonly string[]): void;
	/** A reader for one timeline. Its first update reads every note it shows, as its filters are new. */
	openReader(): TaskIndexReader;
}

/** One timeline's use of the shared index: its own full reads, note filters and notes held. */
export interface TaskIndexReader {
	/**
	 * This reader's next update reads every note it shows that no update has read since this call, for when an event
	 * may have been missed: when the view opens, on Obsidian's first "resolved" and on "window-open". The other readers
	 * read nothing for it; they may use what its full read stores.
	 */
	rereadAll(): void;
	/**
	 * Lists and filters the notes as readTasks does, reads the ones that have no entry fresh for this reader, and
	 * returns every visible note's tasks, warnings and failures. A note its last update that succeeded did not give
	 * without failure has none: it is new to the reader, or its read failed. It tells the user nothing: the caller
	 * hands the warnings and failures to reportNoteReads. `filters` may be the view's whole options; only the five note
	 * filters count.
	 * - It starts at once when no update of any reader runs or waits, so every read has started when it returns;
	 *   otherwise right when every update asked for before it has settled, before their callers hear of it. A
	 *   rejection stops none of the updates after it.
	 * - Note filters other than those of this reader's last update that succeeded read every note it shows.
	 * - It rejects with the error readTasks would throw when listing the notes, reading their metadata for the filters,
	 *   or a filter of the wrong type throws, and when deps.parseKey throws. Nothing is stored then, and no mark, full
	 *   read asked for, filters or notes held of any reader change.
	 * - A note whose read, metadata or parse throws is a failure, as in readTasks, and the update still succeeds. The
	 *   entry it had stays for the other open readers that hold it, while it is fresh. This reader holds the note no
	 *   more, and reads it on every update until it reads it without failure.
	 */
	update(filters: NoteFilterSettings): Promise<IndexUpdate>;
	/**
	 * The timeline is done with the index: the entries only this reader showed go at the next update that succeeds.
	 * An update asked for before or after still runs and gives what it gives, but keeps nothing for this reader. The
	 * view closes its reader once its reloads are done, see TasksTimelineView.onClose. Calling it again does nothing.
	 */
	close(): void;
}

/** A stored note, and the generation its read started at. */
interface Entry {
	readonly note: ParsedNote;
	readonly readAt: number;
}

/** What the last update that succeeded stored. */
interface Committed {
	/** A frozen Entry for each note kept, by path: read without failure, and fresh when it was stored. */
	readonly entries: ReadonlyMap<string, Entry>;
	/** The key the entries were parsed under; null before the first update, and when it changed during their reads. */
	readonly parseKey: ParseKey | null;
}

/** What the index knows of one open reader. Changed in place, by its own calls and by the commits of its updates. */
interface ReaderState {
	open: boolean;
	/** Entries read before this generation are not fresh for the reader. */
	dueAt: number;
	/** The note filters of its last update that succeeded, see filterKeyOf; null before. */
	filters: string | null;
	/** The notes its last update that succeeded gave without failure: the only ones it may use an entry of. */
	held: ReadonlySet<string>;
}

/** A visible note of an update, and the entry it keeps of it, unless it is to be read. */
interface Planned {
	readonly file: TFile;
	/** Taken when the update starts: a rename while the notes are read changes the path of the same TFile. */
	readonly path: string;
	readonly kept: Entry | undefined;
}

/** An update, from its start to its commit. */
interface Running {
	readonly reader: ReaderState;
	/** The generation its reads started at: an entry it stores is fresh until a mark of its path comes after it. */
	readonly start: number;
	readonly before: Committed;
	/**
	 * Every markdown path the update listed, visible or not, when another reader was open as it started; null when
	 * none was, as there is nothing to keep for another then.
	 */
	readonly listed: ReadonlySet<string> | null;
	readonly planned: readonly Planned[];
	readonly filtersKey: string;
	/** The parse key at its start is the one the entries were stored under. */
	readonly keyHeldSince: boolean;
}

/**
 * The five note filters, in a fixed order: a copy of the same values, or a change of any other option, is no change.
 * A reordered excludeProperties is one, which only reads everything once more.
 */
const filterKeyOf = (f: NoteFilterSettings): string =>
	JSON.stringify([f.includePaths, f.excludePaths, f.fileIncludeTags, f.fileExcludeTags, f.excludeProperties]);

/**
 * The notes the filters keep that may have tasks, by path in code-unit order, and with `all`, the paths of every
 * markdown note. A note whose metadata has no task item gives no task and no warning, so it is not read, and one of
 * those that cannot be read tells nothing. A note Obsidian has given no metadata yet, new or being indexed again, is
 * listed as before, so its stored tasks stay and it is read when it is due. It is what readTasks lists, written out
 * again on purpose, so readTasks stays a reference of its own and the tests can tell when the two drift apart.
 */
function listNotes(
	app: NoteSource,
	filters: NoteFilterSettings,
	all: boolean,
): { listed: Set<string> | null; visible: TFile[] } {
	const files = app.vault.getMarkdownFiles();
	const visible = files.filter((file) => {
		const cache = app.metadataCache.getFileCache(file);
		// The filters first, so a filter of the wrong type throws as it always has.
		return (
			noteVisible(
				{ path: file.path, tags: cache?.tags?.map((t) => t.tag) ?? [], frontmatter: cache?.frontmatter },
				filters,
			) &&
			(cache === null || hasTaskItems(cache))
		);
	});
	return {
		listed: all ? new Set(files.map((file) => file.path)) : null,
		visible: [...visible].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
	};
}

/** An empty index. A closure like core's createStore; the objects it returns are frozen. */
export function createTaskIndex(deps: TaskIndexDeps): TaskIndex {
	const parse = deps.parse ?? parseNote;
	let committed: Committed = Object.freeze({ entries: new Map(), parseKey: null });
	/** Counts the marks and the full reads asked for. An update's reads start at the count when it starts. */
	let clock = 0;
	/**
	 * The generation of the last mark of each path since the last commit. Changed in place, O(1) per mark. A commit
	 * drops every entry a mark made stale, and then the marks.
	 */
	const marks = new Map<string, number>();
	/** The open readers. */
	const readers = new Set<ReaderState>();
	const queue = createQueue();

	async function readNote({ file, path }: Planned): Promise<ParsedNote> {
		const content = await deps.app.vault.cachedRead(file);
		return parse({ path, content, metadata: deps.app.metadataCache.getFileCache(file) }, deps.moment);
	}

	/** Whether the entry was read after the last mark of its path. */
	const fresh = (path: string, entry: Entry) => !((marks.get(path) ?? -1) > entry.readAt);

	/**
	 * One update of a reader. Everything before the reads runs at once, so every read starts at the generation the
	 * update started at, and the reads are the only place a change can come in.
	 */
	async function run(reader: ReaderState, filters: NoteFilterSettings): Promise<IndexUpdate> {
		const start = clock;
		const before = committed;
		const startKey = deps.parseKey();
		const filtersKey = filterKeyOf(filters);
		const keyHeldSince = before.parseKey !== null && sameParseKey(before.parseKey, startKey);
		const everything = !keyHeldSince || reader.filters !== filtersKey;
		const usable = (path: string, entry: Entry | undefined): entry is Entry =>
			entry !== undefined &&
			!everything &&
			reader.held.has(path) &&
			entry.readAt >= reader.dueAt &&
			fresh(path, entry);
		// An update of a closed reader is not among the readers: any open one is another.
		const othersOpen = [...readers].some((other) => other !== reader);
		const { listed, visible } = listNotes(deps.app, filters, othersOpen);
		const planned: Planned[] = visible.map((file) => {
			const path = file.path;
			const entry = before.entries.get(path);
			return { file, path, kept: usable(path, entry) ? entry : undefined };
		});
		const settled = await Promise.allSettled(planned.filter((note) => note.kept === undefined).map(readNote));
		// A key that changed while the notes were read: some may be parsed under each, so the next update reads all.
		const keyHeld = sameParseKey(startKey, deps.parseKey());
		const update: Running = { reader, start, before, listed, planned, filtersKey, keyHeldSince };
		return commit(update, settled, keyHeld ? startKey : null);
	}

	/** Stores what this update read and kept, and what the other open readers show, in one assignment. */
	function commit(u: Running, settled: readonly PromiseSettledResult<ParsedNote>[], parseKey: ParseKey | null) {
		const { reader } = u;
		const others = [...readers].filter((other) => other !== reader);
		const heldByOthers = (path: string) => others.some((other) => other.held.has(path));
		const entries = new Map<string, Entry>();
		const tasks: Task[] = [];
		const warnings: ParseWarning[] = [];
		const failures: NoteReadFailure[] = [];
		const given = new Set<string>();
		let next = 0;
		for (const { path, kept } of u.planned) {
			const read = kept === undefined ? settled[next++] : undefined;
			if (read?.status === "rejected") {
				// Not stored, and not held by this reader: it reads the note again. The others keep theirs, see below.
				failures.push(Object.freeze({ path, reason: read.reason }));
				continue;
			}
			const entry =
				kept ?? Object.freeze({ note: (read as PromiseFulfilledResult<ParsedNote>).value, readAt: u.start });
			given.add(path);
			// One at a time, not spread, so a note with very many tasks cannot exceed the argument limit.
			for (const task of entry.note.tasks) tasks.push(task);
			for (const warning of entry.note.warnings) warnings.push(warning);
			// Marked again since the update started: returned as read, but not stored, so it is read again.
			if ((reader.open || heldByOthers(path)) && fresh(path, entry)) entries.set(path, entry);
		}
		// The entries this update did not store, of notes the other readers hold and this update listed, stay while
		// they are fresh: those it did not show, and those it could not read, as with an index each. With no other
		// reader open as it started there are none, so one timeline's update costs what it did; after another parse
		// key, none stays.
		const { listed } = u;
		if (listed !== null && u.keyHeldSince && others.length > 0)
			for (const [path, entry] of u.before.entries)
				if (!entries.has(path) && listed.has(path) && heldByOthers(path) && fresh(path, entry))
					entries.set(path, entry);
		committed = Object.freeze({ entries, parseKey });
		// Every entry kept is fresh and those the marks made stale are gone, so the marks have done their work.
		marks.clear();
		if (reader.open) {
			// A note it could not read is not held: it reads it again, also when an entry is kept for the others.
			reader.held = given;
			reader.filters = u.filtersKey;
		}
		return Object.freeze({
			tasks: Object.freeze(tasks),
			warnings: Object.freeze(warnings),
			failures: Object.freeze(failures),
		});
	}

	function openReader(): TaskIndexReader {
		const reader: ReaderState = { open: true, dueAt: 0, filters: null, held: new Set() };
		readers.add(reader);
		return Object.freeze({
			rereadAll(): void {
				clock += 1;
				reader.dueAt = clock;
			},
			update: (filters: NoteFilterSettings) => queue(() => run(reader, filters)),
			close(): void {
				// What it held stays its own, for an update it still makes; the entries are no longer kept for it.
				reader.open = false;
				readers.delete(reader);
			},
		});
	}

	return Object.freeze({
		markDirty(paths: readonly string[]): void {
			clock += 1;
			for (const path of paths) marks.set(path, clock);
		},
		openReader,
	});
}

/**
 * Runs the jobs one at a time, in the order given: at once when none runs or waits, otherwise right when the one
 * before has settled, whether it resolved or rejected, and before its caller hears of it. A job that throws before it
 * gives its promise rejects as one that rejects, so no job can stop the ones after it.
 */
function createQueue(): <T>(job: () => Promise<T>) => Promise<T> {
	const waiting: (() => void)[] = [];
	let running = false;
	const next = () => {
		const start = waiting.shift();
		if (start) start();
		else running = false;
	};
	return <T>(job: () => Promise<T>) =>
		new Promise<T>((resolve, reject) => {
			// The queue moves on first, so a follow-up the caller asks for then, with none waiting, starts at once.
			const start = () => {
				running = true;
				let settled: Promise<T>;
				try {
					settled = job();
				} catch (error) {
					settled = Promise.reject(error);
				}
				settled.then(
					(value) => {
						next();
						resolve(value);
					},
					(error: unknown) => {
						next();
						reject(error);
					},
				);
			};
			if (running) waiting.push(start);
			else start();
		});
}

/**
 * Marks the paths of every change, for the index, whatever the change:
 * - metadata cache "changed" and "deleted": the note's path;
 * - vault "rename" of a file: the new path and the old one. A folder's own event is left out, as Obsidian sends one
 *   for each file inside it;
 * - vault "modify" of a file, as Obsidian's metadata cache sends no "changed" when it cannot read a saved file, or the
 *   worker gives no metadata; the next reload, of another note's change, then reads the file, unless the metadata it
 *   still has says the note has no task item.
 * Registered once per index, by createSharedTaskIndex. Returns the refs, for the caller to register and take off.
 */
export function watchNotes(app: Pick<App, "vault" | "metadataCache">, index: Pick<TaskIndex, "markDirty">): EventRef[] {
	return [
		...watchChanges(app, (paths) => index.markDirty(paths)),
		app.vault.on("modify", (file) => {
			if (file instanceof TFile) index.markDirty([file.path]);
		}),
	];
}

/**
 * Hands each change that can change a timeline to onChange, with the arguments the view's onFileChanged takes, where
 * the view applies changeAffectsTasks and schedules its reload. It marks nothing, see watchNotes.
 * - metadata cache "changed": the note's path, with the event's metadata;
 * - metadata cache "deleted": the note's path, with the metadata it had;
 * - vault "rename" of a file: the new path and the old one, with the file's metadata now.
 * Returns the refs, for the view to registerEvent, so they go when it closes.
 */
export function watchChanges(
	app: Pick<App, "vault" | "metadataCache">,
	onChange: (paths: string[], cache: CachedMetadata | null) => void,
): EventRef[] {
	return [
		app.metadataCache.on("changed", (file, _data, cache) => onChange([file.path], cache)),
		app.metadataCache.on("deleted", (file, prevCache) => onChange([file.path], prevCache)),
		app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) onChange([file.path, oldPath], app.metadataCache.getFileCache(file));
		}),
	];
}
