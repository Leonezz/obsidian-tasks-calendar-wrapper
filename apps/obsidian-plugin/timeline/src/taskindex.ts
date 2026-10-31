import { TFile, type App, type CachedMetadata, type EventRef } from "obsidian";
import { copyJsonValue, deepFreeze, hasTaskItems, noteVisible, parseNote } from "@tasks-calendar-wrapper/core";
import type {
	MomentFactory,
	NoteFilterSettings,
	NoteSnapshot,
	ParsedNote,
	ParseWarning,
	Task,
} from "@tasks-calendar-wrapper/core";
import { contentIdOf, type ContentId } from "../../utils/contentid";
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

/** A note whose parse gave warnings, with the id of the text it was parsed from. Frozen. */
export interface WarnedNote {
	readonly path: string;
	/** contentIdOf the text read: a note read again with the same text has the same id. */
	readonly content: ContentId;
	/** The note's warnings, the same array as its ParsedNote's. */
	readonly warnings: readonly ParseWarning[];
}

/** What one update gives, pins included. Frozen, with new frozen arrays every time, also when nothing changed. */
export interface IndexUpdate {
	/**
	 * The tasks of every visible note: notes by path in code-unit order, each note's tasks in parseNote's order, as
	 * readTasks orders them. A note this update did not read gives the same Task objects as the update that read it,
	 * of whichever reader.
	 */
	readonly tasks: readonly Task[];
	/** The warnings of every visible note read without failure, stored notes included, in the same order. */
	readonly warnings: readonly ParseWarning[];
	/**
	 * The notes of `warnings`, each once, in the same order: warned.flatMap((note) => note.warnings) is `warnings`. A
	 * note this update did not read gives the same WarnedNote object as the update that read it.
	 */
	readonly warned: readonly WarnedNote[];
	/** The visible notes whose read or parse failed in this update, in path order. They are read again next time. */
	readonly failures: readonly NoteReadFailure[];
	/** The visible notes given from a write's pin, in path order, even when their read was already in flight. */
	readonly pinned: readonly string[];
}

/** One write's claim on a note; see TaskIndex.hold. */
export interface HoldToken {
	/** Ends this claim. `markDirty` (default true) marks the note dirty as markDirty would. A second call does nothing. */
	release(options?: { readonly markDirty?: boolean }): void;
}

/**
 * The parsed notes of every open timeline, kept between reloads and shared, so a note that changed is read once, by
 * whichever timeline reloads first, and stored once:
 * - it keeps one entry per note: the last ParsedNote read without failure, the generation its read started at, and
 *   for a note that warns, the id of the text it was parsed from, see WarnedNote;
 * - a reader's update uses an entry only while it is fresh for that reader: of a note the reader's last update gave
 *   without failure, read after the last mark of its path, under the parse key now, and after the reader's last full
 *   read was asked for, see TaskIndexReader. So a reader reads no note an index of its own would not read, except
 *   after the parse key changed and back, or after a file went with no event and a note came at its path;
 * - each update that succeeds replaces the Map as a whole. It keeps the fresh entries of the notes it showed and of
 *   the notes it listed that another open reader's last update gave, and no other;
 * - a write's hold pins the entry and its visibility until the last token releases. Every reader gives the pin,
 *   without reading or storing it, even on a full read. A retired pin bridges release to the next read stored;
 * - the updates of every reader run one at a time, in the order asked for;
 * - it keeps no view state, no CachedMetadata and no TFile, and subscribes to nothing itself, see watchNotes.
 */
export interface TaskIndex {
	/**
	 * These paths may have changed: no unpinned entry read before this call is used again, by any reader. Called for
	 * every vault "modify", every metadata cache "changed" and "deleted", and every vault "rename" of a file (new and
	 * old path), whatever changeAffectsTasks says. May be called at any time, also while an update runs or waits. O(1)
	 * per path. No update takes the marks, so one reader's update cannot lose another reader's.
	 */
	markDirty(paths: readonly string[]): void;
	/** A reader for one timeline. Its first update reads every unpinned note it shows, as its filters are new. */
	openReader(): TaskIndexReader;
	/**
	 * One write's claim on a note. The first claim pins its committed entry, however old, and its tags, frontmatter
	 * and task-item visibility now, or its retired pin if no entry is committed. With neither, updates read normally.
	 * Claims count: only the last release retires the pin. A read stored later, or forget, drops the retired pin.
	 */
	hold(path: string): HoldToken;
	/** A note was deleted or renamed (both paths): drop its retired pin so a later note cannot inherit it. */
	forget(paths: readonly string[]): void;
}

/** One timeline's use of the shared index: its own full reads, note filters and notes held. */
export interface TaskIndexReader {
	/**
	 * This reader's next update reads every unpinned note it shows that no update has read since this call, for when
	 * an event may have been missed: when the view opens, on Obsidian's first "resolved" and on "window-open". The other
	 * readers read nothing for it; they may use what its full read stores.
	 */
	rereadAll(): void;
	/**
	 * Lists and filters the notes as readTasks does, reads the ones that have no entry fresh for this reader, and
	 * returns every visible note's tasks, warnings and failures. A note its last update that succeeded did not give
	 * without failure has none: it is new to the reader, or its read failed. It tells the user nothing: the view
	 * hands the warned notes and failures to its ReadReporter, see readreporter.ts. `filters` may be the view's whole
	 * options; only the five note filters count.
	 * - A pinned note uses its pin's visibility and entry, including a pin acquired during the reads. It is neither
	 *   read nor stored; a read already in flight is replaced. A pin seen by this update stays its result even if
	 *   released before it commits, and is named in `pinned`. The note must be in this update's listing.
	 * - It starts at once when no update of any reader runs or waits, so every read has started when it returns;
	 *   otherwise right when every update asked for before it has settled, before their callers hear of it. A
	 *   rejection stops none of the updates after it.
	 * - Note filters other than those of this reader's last update that succeeded read every unpinned note it shows.
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
	/** Null for a note without warnings, whose text is not hashed. */
	readonly warned: WarnedNote | null;
	readonly readAt: number;
}

/** A write's entry and a copy of the metadata needed to filter it while Obsidian has no cache. */
interface Pin {
	/** The committed entry at the first claim, or the entry of a retired pin. */
	readonly entry: Entry;
	/** The tags at pin time, so an include or exclude filter does not follow the pending metadata. */
	readonly tags: readonly string[];
	/** A frozen copy at pin time, with no reference to Obsidian's mutable frontmatter. */
	readonly frontmatter: Readonly<Record<string, unknown>> | undefined;
	/** Whether the metadata had task items at pin time, as listNotes checks for an unpinned note. */
	readonly hasTaskItems: boolean;
}

/** The outstanding claims on one path, including claims made before any entry was available. */
interface Hold {
	/** Each token decrements once; the pin lasts until this reaches zero. */
	count: number;
	/** Chosen at the first claim only: a hold without a pin never takes a later read's entry. */
	readonly pin: Pin | undefined;
	/** A deletion or rename prevents a later release from restoring the retired pin that forget dropped. */
	retire: boolean;
}

/** What reading one note gave. */
interface Read {
	readonly note: ParsedNote;
	readonly warned: WarnedNote | null;
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
	/** Every markdown path initially listed, including notes a pin acquired during reads may make visible. */
	readonly listed: ReadonlySet<string>;
	readonly planned: readonly Planned[];
	readonly filtersKey: string;
	/** The filters used to list, also applied to pins acquired after that listing. */
	readonly filters: NoteFilterSettings;
	/** Pins seen during this update, retained even if released before its reads settle. */
	readonly pins: Map<string, Pin>;
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
 * The notes the filters keep that may have tasks, by path in code-unit order, and every listed markdown path.
 * A note whose metadata has no task item gives no task and no warning, so it is not read, and one of
 * those that cannot be read tells nothing. A note Obsidian has given no metadata yet, new or being indexed again, is
 * listed as before, so its stored tasks stay and it is read when it is due. It is what readTasks lists, written out
 * again on purpose, so readTasks stays a reference of its own and the tests can tell when the two drift apart.
 * A pin supplies its own visibility without consulting the current metadata.
 */
function listNotes(
	app: NoteSource,
	filters: NoteFilterSettings,
	pinOf: (path: string) => Pin | undefined,
): { listed: Set<string>; visible: TFile[] } {
	const files = app.vault.getMarkdownFiles();
	const visible = files.filter((file) => {
		const pin = pinOf(file.path);
		if (pin !== undefined) return pinVisible(file.path, pin, filters);
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
		listed: new Set(files.map((file) => file.path)),
		visible: [...visible].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
	};
}

/** Filters a pin without consulting metadata that may be absent or already describe the next text. */
const pinVisible = (path: string, pin: Pin, filters: NoteFilterSettings): boolean =>
	noteVisible({ path, tags: pin.tags, frontmatter: pin.frontmatter }, filters) && pin.hasTaskItems;

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
	/** Active claims by path; a pin supplies no newly stored entry while the write waits for metadata. */
	const holds = new Map<string, Hold>();
	/** Released pins bridge another write before an update reads and stores the note. */
	const retired = new Map<string, Pin>();
	/** The one update in flight, so a hold that starts during its reads can replace them at commit. */
	let running: Running | null = null;
	const pinOf = (path: string) => holds.get(path)?.pin;
	/** The open readers. */
	const readers = new Set<ReaderState>();
	const queue = createQueue();

	async function readNote({ file, path }: Planned): Promise<Read> {
		// Metadata offsets exclude the BOM, but process can cache BOM-carrying text when it writes nothing.
		const content = (await deps.app.vault.cachedRead(file)).replace(/^\uFEFF/, "");
		const note = parse({ path, content, metadata: deps.app.metadataCache.getFileCache(file) }, deps.moment);
		// Only a note that warns is hashed, so the notes of most vaults cost nothing more.
		const warned =
			note.warnings.length === 0
				? null
				: Object.freeze({ path, content: contentIdOf(content), warnings: note.warnings });
		return { note, warned };
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
		const { listed, visible } = listNotes(deps.app, filters, pinOf);
		const pins = new Map<string, Pin>();
		for (const [path, hold] of holds) if (hold.pin !== undefined && listed.has(path)) pins.set(path, hold.pin);
		const planned: Planned[] = visible.map((file) => {
			const path = file.path;
			const entry = before.entries.get(path);
			return { file, path, kept: pins.get(path)?.entry ?? (usable(path, entry) ? entry : undefined) };
		});
		const update: Running = { reader, start, before, listed, planned, filtersKey, filters, pins, keyHeldSince };
		running = update;
		try {
			const settled = await Promise.allSettled(planned.filter((note) => note.kept === undefined).map(readNote));
			// A key that changed while the notes were read: some may be parsed under each, so the next update reads all.
			const keyHeld = sameParseKey(startKey, deps.parseKey());
			return commit(update, settled, keyHeld ? startKey : null);
		} finally {
			running = null;
		}
	}

	/** Stores what this update read and kept, and what the other open readers show, in one assignment. */
	function commit(u: Running, settled: readonly PromiseSettledResult<Read>[], parseKey: ParseKey | null) {
		const { reader } = u;
		const others = [...readers].filter((other) => other !== reader);
		const heldByOthers = (path: string) => others.some((other) => other.held.has(path));
		const entries = new Map<string, Entry>();
		const tasks: Task[] = [];
		const warnings: ParseWarning[] = [];
		const warned: WarnedNote[] = [];
		const failures: NoteReadFailure[] = [];
		const pinned: string[] = [];
		const given = new Set<string>();
		let next = 0;
		const planned = u.planned.map(({ path, kept }) => ({
			path,
			kept,
			read: kept === undefined ? settled[next++] : undefined,
		}));
		// A pin acquired during the reads can make an initially hidden note visible. It must still have been listed.
		if (u.pins.size > 0) {
			const showing = new Set(planned.map(({ path }) => path));
			for (const [path, pin] of u.pins)
				if (!showing.has(path)) planned.push({ path, kept: pin.entry, read: undefined });
			planned.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		}
		for (const { path, kept, read } of planned) {
			const pin = u.pins.get(path);
			if (pin !== undefined && !pinVisible(path, pin, u.filters)) continue;
			if (pin === undefined && read?.status === "rejected") {
				// Not stored, and not held by this reader: it reads the note again. The others keep theirs, see below.
				failures.push(Object.freeze({ path, reason: read.reason }));
				continue;
			}
			const entry =
				pin?.entry ??
				kept ??
				Object.freeze({ ...(read as PromiseFulfilledResult<Read>).value, readAt: u.start });
			given.add(path);
			if (pin !== undefined) pinned.push(path);
			// One at a time, not spread, so a note with very many tasks cannot exceed the argument limit.
			for (const task of entry.note.tasks) tasks.push(task);
			for (const warning of entry.note.warnings) warnings.push(warning);
			if (entry.warned !== null) warned.push(entry.warned);
			// Marked again since the update started: returned as read, but not stored, so it is read again.
			if (pin === undefined && (reader.open || heldByOthers(path)) && fresh(path, entry)) {
				entries.set(path, entry);
				if (read?.status === "fulfilled") retired.delete(path);
			}
		}
		// The entries this update did not store, of notes the other readers hold and this update listed, stay while
		// they are fresh: those it did not show, and those it could not read, as with an index each. A pinned note
		// may retain this earlier entry for another reader, never its pin or in-flight read. Any mark drops the entry
		// before marks are cleared; after another parse key, none stays.
		const { listed } = u;
		if (u.keyHeldSince && others.length > 0)
			for (const [path, entry] of u.before.entries)
				if (!entries.has(path) && listed.has(path) && heldByOthers(path) && fresh(path, entry))
					entries.set(path, entry);
		committed = Object.freeze({ entries, parseKey });
		// Every earlier entry kept is fresh; marked entries are gone. Clearing marks cannot revive a stale pin's entry.
		marks.clear();
		if (reader.open) {
			// A note it could not read is not held: it reads it again, also when an entry is kept for the others.
			reader.held = given;
			reader.filters = u.filtersKey;
		}
		return Object.freeze({
			tasks: Object.freeze(tasks),
			warnings: Object.freeze(warnings),
			warned: Object.freeze(warned),
			failures: Object.freeze(failures),
			pinned: Object.freeze(pinned),
		});
	}

	/** Records a mark in constant time per path, including when a release marks a still-pinned note. */
	function markDirty(paths: readonly string[]): void {
		clock += 1;
		for (const path of paths) marks.set(path, clock);
	}

	/** Takes the first claim's snapshot only once, so overlapping writes cannot move the pin forward. */
	function hold(path: string): HoldToken {
		let held = holds.get(path);
		if (held === undefined) {
			const entry = committed.entries.get(path);
			let pin = retired.get(path);
			if (entry !== undefined) {
				const file = deps.app.vault.getMarkdownFiles().find((file) => file.path === path);
				const cache = file === undefined ? null : deps.app.metadataCache.getFileCache(file);
				pin = Object.freeze({
					entry,
					tags: Object.freeze(cache?.tags?.map((tag) => tag.tag) ?? []),
					frontmatter: deepFreeze(copyJsonValue(cache?.frontmatter)),
					hasTaskItems: hasTaskItems(cache),
				});
			}
			held = { count: 0, pin, retire: true };
			holds.set(path, held);
		}
		held.count += 1;
		if (held.pin !== undefined && running?.listed.has(path)) running.pins.set(path, held.pin);
		const claim = held;
		let released = false;
		return Object.freeze({
			release(options?: { readonly markDirty?: boolean }): void {
				if (released) return;
				released = true;
				if (options?.markDirty !== false) markDirty([path]);
				claim.count -= 1;
				if (claim.count === 0) {
					holds.delete(path);
					if (claim.pin !== undefined && claim.retire) retired.set(path, claim.pin);
				}
			},
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
		markDirty,
		openReader,
		hold,
		forget(paths: readonly string[]): void {
			for (const path of paths) {
				retired.delete(path);
				const held = holds.get(path);
				if (held !== undefined) held.retire = false;
			}
		},
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
 * Marks the paths of every change, for the index, whatever the change; deleted and renamed paths also lose retired pins:
 * - metadata cache "changed" and "deleted": the note's path;
 * - vault "rename" of a file: the new path and the old one. A folder's own event is left out, as Obsidian sends one
 *   for each file inside it;
 * - vault "modify" of a file, as Obsidian's metadata cache sends no "changed" when it cannot read a saved file, or the
 *   worker gives no metadata; the next reload, of another note's change, then reads the file, unless the metadata it
 *   still has says the note has no task item.
 * Registered once per index, by createSharedTaskIndex. Returns the refs, for the caller to register and take off.
 */
export function watchNotes(
	app: Pick<App, "vault" | "metadataCache">,
	index: Pick<TaskIndex, "markDirty" | "forget">,
): EventRef[] {
	const forgotten = (paths: string[]) => {
		index.forget(paths);
		index.markDirty(paths);
	};
	return [
		app.metadataCache.on("changed", (file) => index.markDirty([file.path])),
		app.metadataCache.on("deleted", (file) => forgotten([file.path])),
		app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) forgotten([file.path, oldPath]);
		}),
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
