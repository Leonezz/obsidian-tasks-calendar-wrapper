/**
 * The model of the task index's differential test: which notes each update of the readers of one index reads, and
 * which it stores and for whom, written with sets where the index has generations; and, for each reader, what an
 * index of its own, step 10's, would read at the same moment. tests/vault-check.ts runs the sequences, tells the model
 * what the index does as the index's hooks see it, and checks each update against it.
 *
 * The model follows an update from the index's parse-key probes, see TaskIndexDeps: the first starts it, when the
 * model works out what it reads, and the second ends it, when the model stores what it read. So queued updates are
 * followed too, in the order they run.
 */
import {
	hasTaskItems,
	noteVisible,
	type NoteFilterSettings,
	type ParseWarning,
	type Task,
} from "@tasks-calendar-wrapper/core";
import { createReadReporter, type ReadReporter } from "../timeline/src/readreporter";
import type { HoldToken, IndexUpdate, TaskIndexReader, WarnedNote } from "../timeline/src/taskindex";
import { sameParseKey, type ParseKey } from "../utils/parsekey";
import type { FakeVault } from "./fakevault";

/** What an index of the reader's own, step 10's, would hold: the shared one must read no note it would not read. */
export interface OwnModel {
	/** The paths marked since its last update started. */
	marks: Set<string>;
	/** rereadAll was called since its last update started. */
	rereadAll: boolean;
	/** The notes its last update that succeeded stored. */
	stored: ReadonlySet<string>;
	/** The note filters of that update, as filterKey gives them; null before. */
	filters: string | null;
	key: ParseKey | null;
	/** Files gone with no event whose stale entry it still stores: a note made at the path is read by the shared one. */
	goneSilently: ReadonlySet<string>;
	/** Since its last update, another reader's update stored under another key than the one before, dropping the rest. */
	keyDropSeen: boolean;
	/**
	 * Notes it still stores, as it would not have read them, that the shared reader read in an update and could not:
	 * the shared one holds them no more, and reads them again at each update until it can.
	 */
	failedUnread: ReadonlySet<string>;
}

export interface ReaderModel {
	readonly id: number;
	readonly reader: TaskIndexReader;
	readonly own: OwnModel;
	/** The filters of its next update. */
	filters: NoteFilterSettings;
	open: boolean;
	/** The filter key of its last update that succeeded; null before. */
	committed: string | null;
	/** The notes its last update that succeeded gave without failure. */
	held: ReadonlySet<string>;
	/** A change went unheard after it closed, which a closed view never rereads for. */
	missedSinceClose: boolean;
	/** The reporter of the reader's view, which every update that succeeds reaches, as in views.tsx. */
	readonly reporter: ReadReporter;
	/** What the reporter is to have told, worked out on its own, see checkTelling in vault-check.ts. */
	telling: TellingModel;
}

/**
 * What a view's reporter has told while it is open: each warning line as path, content id and line, and the failing
 * paths of its last report. The generated sequences give a note fewer texts than a reporter remembers.
 */
export interface TellingModel {
	readonly told: ReadonlySet<string>;
	readonly failing: readonly string[];
}

/** What an index of the reader's own would do with the update, as it starts. */
export interface OwnPlan {
	/** The notes it would read. */
	readonly due: ReadonlySet<string>;
	/** It would read every note: rereadAll, or new filters or another key. */
	readonly everything: boolean;
	/** Its own key held, and the shared one is another: the parse key changed and back meanwhile. */
	readonly keyFlipped: boolean;
	/** The files gone with no event whose stale entry it stored as the update started. */
	readonly gone: ReadonlySet<string>;
	/** OwnModel.failedUnread as the update started. */
	readonly failedUnread: ReadonlySet<string>;
}

/** What the model says of an update as it starts. */
export interface Plan {
	readonly key: ParseKey;
	/** The vault actions applied by then; at rest when none came until it is checked. */
	readonly actions: number;
	/** The notes it shows, by path in code-unit order; null when listing them throws, and it rejects. */
	readonly visible: readonly string[] | null;
	/** Every markdown path there is. */
	readonly listed: ReadonlySet<string>;
	/** The key now is the one the stored notes were parsed under. */
	readonly keyHeld: boolean;
	/** The notes it reads, in the order it reads them. */
	readonly due: readonly string[];
	/** It keeps a note another reader's update read. */
	readonly sharedKeep: boolean;
	/** Null for an update of a closed reader, which has no index of its own to compare with. */
	readonly own: OwnPlan | null;
	/** Entries before the update, including stale ones that a hold may take. */
	readonly entries: ReadonlyMap<string, ModelEntry>;
}

/** The objects a successful read produced, with the WarnedNote learned when its update settles. */
export interface ModelEntry {
	readonly tasks: readonly Task[];
	readonly warnings: readonly ParseWarning[];
	warned?: WarnedNote | null;
}

/** A write's snapshot of an entry and its visibility; no metadata object is kept. */
export interface Pin {
	readonly entry: ModelEntry;
	readonly tags: readonly string[];
	readonly frontmatter: Readonly<Record<string, unknown>> | undefined;
	readonly hasTaskItems: boolean;
}

/** Counting claims on one path, including a hold that had no entry to pin. */
export interface HeldPin {
	count: number;
	readonly pin: Pin | undefined;
	/** A deleted or renamed path must not regain its retired pin on a later release. */
	retire: boolean;
}

/** An update asked for, as the model follows it. */
export interface Asked {
	readonly reader: ReaderModel;
	readonly filters: NoteFilterSettings;
	/** Where in the sequence it was asked for, for the messages. */
	readonly at: string;
	/** Set when it starts. */
	plan: Plan | null;
	ended: boolean;
	/** The notes it read, parsed, and failed to read or parse, as the hooks saw them. */
	readonly reads: string[];
	readonly parsed: string[];
	readonly unread: Set<string>;
	readonly failed: Set<string>;
	/** The paths marked while it ran. */
	readonly markedDuring: Set<string>;
	/** The readers that asked for a full read while it ran: nothing it stores is fresh for them. */
	readonly requestedDuring: Set<number>;
	/** Pins used at the start or acquired before the reads settled, even if released meanwhile. */
	readonly pins: Map<string, Pin>;
	/** Each successful parse's objects, before the commit chooses whether to keep them. */
	readonly parsedEntries: Map<string, ModelEntry>;
	/** Visible paths at commit, after a pin acquired during reads applies its captured filters. */
	given: readonly string[];
}

export interface World {
	readonly vault: FakeVault;
	/** Every reader opened, closed ones too, by id. */
	readonly readers: ReaderModel[];
	/** For each stored note, the readers it is fresh for. */
	stored: Map<string, Set<number>>;
	/** The committed map still holds a marked entry until an update replaces it. */
	committedPaths: Set<string>;
	entries: Map<string, ModelEntry>;
	readonly pins: Map<string, HeldPin>;
	readonly retired: Map<string, Pin>;
	readonly tokens: { readonly path: string; readonly token: HoldToken }[];
	/** Last releases still waiting for a successful read and store. */
	readonly released: Set<string>;
	committedKey: ParseKey | null;
	/** Asked for and not started, in order. */
	readonly waiting: Asked[];
	/** The update that runs, from its first probe to its second. */
	current: Asked | null;
	/** The next listing throws. */
	brokenNext: boolean;
	/** The vault actions applied so far, to tell an update at rest. */
	actions: number;
	/** The notes failing with no change since: an update that shows one is not at rest. */
	readonly silent: Set<string>;
	/**
	 * The paths of files gone with no event, until an update that succeeds lists the notes without them: a note made at
	 * such a path before then, which fires only "create", may get the entry of the file that went, as in step 9.
	 */
	readonly silentlyRemoved: Set<string>;
	/** The Task objects of each note from the last update that read it, and the reader of that update. */
	readonly objects: Map<string, readonly Task[]>;
	/** The WarnedNote of each note from the last update that read it. */
	readonly warnedObjects: Map<string, WarnedNote>;
	readonly producer: Map<string, number>;
	/** The last update that succeeded, of any reader: every update gives new arrays. */
	lastResult: IndexUpdate | null;
	readonly count: (what: string) => void;
}

/** The five note filters, as the index compares them. */
export const filterKey = (s: NoteFilterSettings) =>
	JSON.stringify([s.includePaths, s.excludePaths, s.fileIncludeTags, s.fileExcludeTags, s.excludeProperties]);

/**
 * The notes the filters keep now that may have tasks: a task item, or no metadata yet. Worked out without listing
 * through the vault; null when the filters throw.
 */
export function visibleNow(
	vault: FakeVault,
	filters: NoteFilterSettings,
	pins?: ReadonlyMap<string, HeldPin>,
): string[] | null {
	const notes = vault.filePaths().filter((path) => path.endsWith(".md"));
	try {
		return notes.filter((path) => {
			const pin = pins?.get(path)?.pin;
			if (pin)
				return noteVisible({ path, tags: pin.tags, frontmatter: pin.frontmatter }, filters) && pin.hasTaskItems;
			const cache = vault.app.metadataCache.getFileCache(vault.app.vault.getAbstractFileByPath(path));
			const note = { path, tags: cache?.tags?.map((t) => t.tag) ?? [], frontmatter: cache?.frontmatter };
			return noteVisible(note, filters) && (cache === null || hasTaskItems(cache));
		});
	} catch {
		return null;
	}
}

/** A reader just opened: it holds nothing, and its first update reads every note it shows. */
export function newReader(id: number, reader: TaskIndexReader, filters: NoteFilterSettings): ReaderModel {
	return {
		id,
		reader,
		own: {
			marks: new Set(),
			rereadAll: false,
			stored: new Set(),
			filters: null,
			key: null,
			goneSilently: new Set(),
			keyDropSeen: false,
			failedUnread: new Set(),
		},
		filters,
		open: true,
		committed: null,
		held: new Set(),
		missedSinceClose: false,
		reporter: createReadReporter(),
		telling: { told: new Set(), failing: [] },
	};
}

export const openReaders = (world: World) => world.readers.filter((reader) => reader.open);

/** The open reader picked, modulo the open ones; null when none is open. */
export function pickOpen(world: World, pick: number): ReaderModel | null {
	const open = openReaders(world);
	return open.length === 0 ? null : open[pick % open.length];
}

/** The index marked the paths: no entry of theirs is fresh, and every reader's own index would read them. */
export function marked(world: World, paths: readonly string[]): void {
	for (const reader of world.readers) for (const path of paths) reader.own.marks.add(path);
	for (const path of paths) {
		world.stored.delete(path);
		world.current?.markedDuring.add(path);
	}
}

/** The reader asked for a full read: nothing stored now, or by the update that runs, is fresh for it. */
export function fullReadAsked(world: World, reader: ReaderModel): void {
	reader.own.rereadAll = true;
	for (const fresh of world.stored.values()) fresh.delete(reader.id);
	world.current?.requestedDuring.add(reader.id);
}

/** The update starts, at its first probe of the key: what it reads, and what an index of its reader's own would. */
export function started(world: World, asked: Asked, key: ParseKey): void {
	const { reader } = asked;
	const visible = world.brokenNext ? null : visibleNow(world.vault, asked.filters, world.pins);
	world.brokenNext = false;
	const keyHeld = world.committedKey !== null && sameParseKey(world.committedKey, key);
	const everything = !keyHeld || reader.committed !== filterKey(asked.filters);
	const fresh = (path: string) => world.stored.get(path)?.has(reader.id) ?? false;
	for (const path of world.vault.filePaths().filter((path) => path.endsWith(".md"))) {
		const pin = world.pins.get(path)?.pin;
		if (pin) asked.pins.set(path, pin);
	}
	const due = (visible ?? []).filter(
		(path) => !asked.pins.has(path) && (everything || !reader.held.has(path) || !fresh(path)),
	);
	const reading = new Set(due);
	const byOther = (path: string) => (world.producer.get(path) ?? reader.id) !== reader.id;
	asked.plan = {
		key,
		actions: world.actions,
		visible,
		listed: new Set(world.vault.filePaths().filter((path) => path.endsWith(".md"))),
		keyHeld,
		due,
		sharedKeep: (visible ?? []).some((path) => !reading.has(path) && byOther(path)),
		own: ownStarted(reader, asked.filters, visible, key, world.committedKey, asked.pins),
		entries: new Map(world.entries),
	};
	// An update that rejects while it lists the notes reads nothing and does not probe the key again.
	world.current = visible === null ? null : asked;
	if (visible === null) asked.ended = true;
}

/** What the reader's own index would read now; it takes its marks and full read, as step 9's index does. */
function ownStarted(
	reader: ReaderModel,
	filters: NoteFilterSettings,
	visible: readonly string[] | null,
	key: ParseKey,
	sharedKey: ParseKey | null,
	pins: ReadonlyMap<string, Pin>,
): OwnPlan | null {
	const { own } = reader;
	if (!reader.open) return null;
	const everything =
		own.rereadAll || own.filters !== filterKey(filters) || own.key === null || !sameParseKey(own.key, key);
	const plan = {
		due: new Set(
			(visible ?? []).filter(
				(path) => !pins.has(path) && (everything || own.marks.has(path) || !own.stored.has(path)),
			),
		),
		everything,
		keyFlipped: !everything && (own.keyDropSeen || sharedKey === null || !sameParseKey(sharedKey, key)),
		gone: own.goneSilently,
		failedUnread: own.failedUnread,
	};
	// One that rejects takes nothing: step 9's puts back what it took.
	if (visible !== null) {
		own.marks = new Set();
		own.rereadAll = false;
	}
	return plan;
}

/**
 * What the reader's own index stores at the end of the update: what it read without failure, and what it kept, unless
 * marked since. A note the shared reader could not read stays stored when the own index would not have read it.
 */
function ownEnded(asked: Asked, plan: Plan, endKey: ParseKey): void {
	const { own } = asked.reader;
	const ownPlan = plan.own;
	if (ownPlan === null) return;
	const visible = asked.given;
	const failedByOwn = (path: string) => asked.failed.has(path) && !asked.pins.has(path) && ownPlan.due.has(path);
	const stored = new Set(
		visible.filter((path) => !asked.pins.has(path) && !failedByOwn(path) && !own.marks.has(path)),
	);
	own.failedUnread = new Set(
		visible.filter((path) => asked.failed.has(path) && !asked.pins.has(path) && !ownPlan.due.has(path)),
	);
	own.stored = stored;
	own.filters = filterKey(asked.filters);
	own.key = sameParseKey(plan.key, endKey) ? plan.key : null;
	own.goneSilently = new Set([...own.goneSilently].filter((path) => stored.has(path)));
	own.keyDropSeen = false;
}

/** The update's reads have settled and it stores, at its second probe of the key, as the index does. */
export function ended(world: World, asked: Asked, endKey: ParseKey): void {
	const plan = asked.plan;
	if (plan === null) throw new Error(`${asked.at}: an update ended that never started`);
	const visibleAtCommit = new Set(plan.visible ?? []);
	for (const [path, pin] of asked.pins) {
		if (pin.hasTaskItems && noteVisible({ path, tags: pin.tags, frontmatter: pin.frontmatter }, asked.filters))
			visibleAtCommit.add(path);
		else visibleAtCommit.delete(path);
	}
	asked.given = [...visibleAtCommit].sort();
	ownEnded(asked, plan, endKey);
	if (!plan.keyHeld) for (const other of world.readers) if (other !== asked.reader) other.own.keyDropSeen = true;
	asked.ended = true;
	world.current = null;
	const { reader } = asked;
	const visible = new Set(asked.given);
	const due = new Set(plan.due);
	const others = openReaders(world).filter((other) => other !== reader);
	const heldByOthers = (path: string) => others.some((other) => other.held.has(path));
	const keptFor = (path: string) => reader.open || heldByOthers(path);
	const all = world.readers.map((other) => other.id).filter((id) => !asked.requestedDuring.has(id));
	const next = new Map<string, Set<number>>();
	for (const path of visible) {
		if (asked.pins.has(path)) continue;
		const old = world.stored.get(path);
		if (!due.has(path)) {
			if (old && keptFor(path)) next.set(path, old);
		} else if (!asked.failed.has(path)) {
			if (!asked.markedDuring.has(path) && keptFor(path)) next.set(path, new Set(all));
		} else if (plan.keyHeld && old && heldByOthers(path)) {
			// The reader that failed holds it no more; the others keep the entry they had.
			next.set(path, new Set([...old].filter((id) => id !== reader.id)));
			world.count("failure kept for another reader");
		}
	}
	// Fresh entries another reader holds stay while listed, including an original entry replaced by a pin here.
	if (plan.keyHeld)
		for (const [path, fresh] of world.stored)
			if (!next.has(path) && heldByOthers(path)) {
				if (plan.listed.has(path)) next.set(path, fresh);
				else world.count("not listed, not kept");
			}
	for (const path of world.silentlyRemoved) if (!plan.listed.has(path)) world.silentlyRemoved.delete(path);
	if (reader.open) {
		reader.held = new Set([...visible].filter((path) => asked.pins.has(path) || !asked.failed.has(path)));
		reader.committed = filterKey(asked.filters);
	}
	world.stored = next;
	world.committedPaths = new Set(next.keys());
	world.entries = new Map(
		[...next.keys()].map((path) => [
			path,
			(asked.pins.has(path)
				? plan.entries.get(path)
				: (asked.parsedEntries.get(path) ?? plan.entries.get(path))) as ModelEntry,
		]),
	);
	for (const path of next.keys())
		if (due.has(path) && !asked.pins.has(path) && !asked.failed.has(path)) {
			world.retired.delete(path);
			if (world.released.delete(path)) world.count("released then read");
		}
	world.committedKey = sameParseKey(plan.key, endKey) ? plan.key : null;
}
