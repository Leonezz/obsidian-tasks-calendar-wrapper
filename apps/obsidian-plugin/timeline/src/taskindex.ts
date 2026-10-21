import { TFile, type App, type CachedMetadata, type EventRef } from "obsidian";
import { noteVisible, parseNote } from "@tasks-calendar-wrapper/core";
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
	 * The parse environment now: () => parseKeyOf(moment) in the plugin. Called at the start and at the end of every
	 * update. Required: there is no default that could go unnoticed.
	 */
	readonly parseKey: () => ParseKey;
	/** Defaults to core's parseNote; tests pass a wrapper that records each path parsed. */
	readonly parse?: ParseNote;
}

/** What one update gives. Frozen, with new frozen arrays every time, also when nothing changed. */
export interface IndexUpdate {
	/**
	 * The tasks of every visible note: notes by path in code-unit order, each note's tasks in parseNote's order, as
	 * readTasks orders them. A note this update did not read gives the same Task objects as before.
	 */
	readonly tasks: readonly Task[];
	/** The warnings of every visible note read without failure, stored notes included, in the same order. */
	readonly warnings: readonly ParseWarning[];
	/** The visible notes whose read or parse failed in this update, in path order. They are read again next time. */
	readonly failures: readonly NoteReadFailure[];
}

/**
 * The parsed notes of one view, kept between reloads, so a reload reads only the notes that may have changed:
 * - it keeps one frozen ParsedNote per visible note read without failure, notes without tasks included;
 * - it keeps no view state, no CachedMetadata and no TFile;
 * - each update that succeeds replaces its Map as a whole;
 * - it subscribes to nothing itself, see watchNotes.
 * An update reads a visible note when everything is read, when the note was marked, or when it has no stored entry:
 * it is new, its last read failed, it was renamed to its path, or the filters did not keep it before. Everything is
 * read on the first update, after rereadAll, and when the note filters or the parse key changed.
 */
export interface TaskIndex {
	/**
	 * These paths may have changed; the next update reads the ones that are visible notes. Called for every vault
	 * "modify", every metadata cache "changed" and "deleted" and every vault "rename" of a file (new and old path),
	 * whatever changeAffectsTasks says. May be called at any time, also while an update runs.
	 */
	markDirty(paths: readonly string[]): void;
	/**
	 * The next update reads every visible note, for when an event may have been missed, as when the view opens, on
	 * Obsidian's first "resolved" and on "window-open". A new index starts with a full read due.
	 */
	rereadAll(): void;
	/**
	 * Lists and filters the notes as readTasks does, reads the ones that are due and returns every visible note's
	 * tasks, warnings and failures. It tells the user nothing: the caller hands the warnings and failures to
	 * reportNoteReads. `filters` may be the view's whole options; only the five note filters count.
	 * - It rejects with the error readTasks would throw when listing the notes, reading their metadata for the
	 *   filters, or a filter of the wrong type throws; when deps.parseKey throws; and at once when another update is
	 *   still running.
	 * - On a rejection nothing is stored, and the marks and a full read due stay for the next update.
	 * - A note whose read, metadata or parse throws is a failure, as in readTasks, and the update still succeeds.
	 */
	update(filters: NoteFilterSettings): Promise<IndexUpdate>;
}

/** What the last update that succeeded stored. */
interface Committed {
	/** A frozen ParsedNote for each visible note read without failure, by path. */
	readonly notes: ReadonlyMap<string, ParsedNote>;
	/** The note filters, as filterKeyOf gives them. */
	readonly filters: string;
	/** The key the notes were parsed under; null when it changed while they were read. */
	readonly parseKey: ParseKey | null;
}

/** A visible note of an update, and what is stored of it, unless it is to be read. */
interface Planned {
	readonly file: TFile;
	/** Taken when the update starts: a rename while the notes are read changes the path of the same TFile. */
	readonly path: string;
	readonly kept: ParsedNote | undefined;
}

/**
 * The five note filters, in a fixed order: a copy of the same values, or a change of any other option, is no change.
 * A reordered excludeProperties is one, which only reads everything once more.
 */
const filterKeyOf = (f: NoteFilterSettings): string =>
	JSON.stringify([f.includePaths, f.excludePaths, f.fileIncludeTags, f.fileExcludeTags, f.excludeProperties]);

/**
 * The notes the filters keep, by path in code-unit order. It is what readTasks lists, written out again on purpose,
 * so readTasks stays a reference of its own and the tests can tell when the two drift apart.
 */
function visibleNotes(app: NoteSource, filters: NoteFilterSettings): TFile[] {
	const visible = app.vault.getMarkdownFiles().filter((file) => {
		const cache = app.metadataCache.getFileCache(file);
		return noteVisible(
			{ path: file.path, tags: cache?.tags?.map((t) => t.tag) ?? [], frontmatter: cache?.frontmatter },
			filters,
		);
	});
	return [...visible].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** An empty index with a full read due. A closure like core's createStore; the object it returns is frozen. */
export function createTaskIndex(deps: TaskIndexDeps): TaskIndex {
	const parse = deps.parse ?? parseNote;
	let committed: Committed | null = null;
	/** The marks since the last update took them. Only ever added to, and swapped out whole when taken. */
	let dirty = new Set<string>();
	let all = false;
	let updating = false;

	async function readNote({ file, path }: Planned): Promise<ParsedNote> {
		const content = await deps.app.vault.cachedRead(file);
		return parse({ path, content, metadata: deps.app.metadataCache.getFileCache(file) }, deps.moment);
	}

	/**
	 * One update, after it took the marks. Everything before the reads runs at once, so every read starts right after
	 * the marks were taken, and the reads are the only place a change can come in.
	 */
	async function run(filters: NoteFilterSettings, taken: ReadonlySet<string>, takenAll: boolean) {
		const before = committed;
		const startKey = deps.parseKey();
		const filtersKey = filterKeyOf(filters);
		const everything =
			takenAll ||
			before === null ||
			before.filters !== filtersKey ||
			before.parseKey === null ||
			!sameParseKey(before.parseKey, startKey);
		const planned: Planned[] = visibleNotes(deps.app, filters).map((file) => {
			const path = file.path;
			return { file, path, kept: everything || taken.has(path) ? undefined : before?.notes.get(path) };
		});
		const settled = await Promise.allSettled(planned.filter((note) => note.kept === undefined).map(readNote));
		// A key that changed while the notes were read: some may be parsed under each, so the next update reads all.
		const keyHeld = sameParseKey(startKey, deps.parseKey());
		return commit(planned, settled, filtersKey, keyHeld ? startKey : null);
	}

	/** Stores what this update read and kept, in one assignment, and gives what it returns. */
	function commit(
		planned: readonly Planned[],
		settled: readonly PromiseSettledResult<ParsedNote>[],
		filters: string,
		parseKey: ParseKey | null,
	): IndexUpdate {
		const notes = new Map<string, ParsedNote>();
		const tasks: Task[] = [];
		const warnings: ParseWarning[] = [];
		const failures: NoteReadFailure[] = [];
		let next = 0;
		for (const { path, kept } of planned) {
			const read = kept === undefined ? settled[next++] : undefined;
			if (read?.status === "rejected") {
				failures.push(Object.freeze({ path, reason: read.reason }));
				continue;
			}
			const note = kept ?? (read as PromiseFulfilledResult<ParsedNote>).value;
			// One at a time, not spread, so a note with very many tasks cannot exceed the argument limit.
			for (const task of note.tasks) tasks.push(task);
			for (const warning of note.warnings) warnings.push(warning);
			// Marked again since the update took the marks: returned as read, but not stored, so it stays due.
			if (!dirty.has(path)) notes.set(path, note);
		}
		committed = Object.freeze({ notes, filters, parseKey });
		return Object.freeze({
			tasks: Object.freeze(tasks),
			warnings: Object.freeze(warnings),
			failures: Object.freeze(failures),
		});
	}

	async function update(filters: NoteFilterSettings): Promise<IndexUpdate> {
		if (updating)
			throw new Error("TaskIndex.update was called while another update was running; wait for it first.");
		updating = true;
		const taken = dirty;
		const takenAll = all;
		dirty = new Set();
		all = false;
		try {
			return await run(filters, taken, takenAll);
		} catch (error) {
			// Nothing was stored: the marks taken, and those made since, are there for the next update.
			dirty = new Set([...taken, ...dirty]);
			all ||= takenAll;
			throw error;
		} finally {
			updating = false;
		}
	}

	return Object.freeze({
		markDirty(paths: readonly string[]): void {
			for (const path of paths) dirty.add(path);
		},
		rereadAll(): void {
			all = true;
		},
		update,
	});
}

/**
 * Wires the index to the vault the way the view does: each event marks its paths first, then hands the change to
 * onChange with the arguments the view's onFileChanged takes, where the view applies changeAffectsTasks and schedules
 * its reload.
 * - metadata cache "changed": the note's path, with the event's metadata;
 * - metadata cache "deleted": the note's path, with the metadata it had;
 * - vault "rename" of a file: the new path and the old one, with the file's metadata now. A folder's own event is left
 *   out, as Obsidian sends one for each file inside it.
 * - vault "modify" of a file only marks it and hands nothing on. Obsidian's metadata cache sends no "changed" when it
 *   cannot read a saved file, or the worker gives no metadata; the next reload, of another note's change, then reads
 *   the file as every reload did before the index, instead of keeping the tasks it had.
 * Returns the refs, for the caller to registerEvent, so they go when the view unloads.
 */
export function watchNotes(
	app: Pick<App, "vault" | "metadataCache">,
	index: Pick<TaskIndex, "markDirty">,
	onChange: (paths: string[], cache: CachedMetadata | null) => void,
): EventRef[] {
	const changed = (paths: string[], cache: CachedMetadata | null) => {
		index.markDirty(paths);
		onChange(paths, cache);
	};
	return [
		app.metadataCache.on("changed", (file, _data, cache) => changed([file.path], cache)),
		app.metadataCache.on("deleted", (file, prevCache) => changed([file.path], prevCache)),
		app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) changed([file.path, oldPath], app.metadataCache.getFileCache(file));
		}),
		app.vault.on("modify", (file) => {
			if (file instanceof TFile) index.markDirty([file.path]);
		}),
	];
}
