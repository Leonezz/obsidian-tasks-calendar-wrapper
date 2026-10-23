/**
 * The steps of the task index's differential test: the paths, contents, filters and environments a generated
 * sequence draws from, the actions it is made of, and how each vault action changes the fake vault. A sequence acts on
 * the readers of one index, as the timelines share the plugin's: generate gives sequences of one reader, and
 * generateShared ones of up to three. tests/vault-check.ts runs the sequences and checks every update against readTasks.
 *
 * An action picks what it acts on by an index into what exists when it runs, modulo how many there are, and does
 * nothing when there is nothing to act on; a reader is picked among the open ones. So any part of a sequence is a
 * sequence too, which is what lets a failing one be shrunk.
 */
import moment from "moment";
import { TFolder } from "obsidian";

import type { NoteFilterSettings } from "@tasks-calendar-wrapper/core";
import type { FakeVault } from "./fakevault";

// ---- the universe ----

const FOLDERS = ["", "Projects/", "Projects/Sub/", "Archive/", "Ä/"];
/** Names whose code-unit order and locale order disagree. */
const NAMES = ["a", "B", "_x", "10", "9", "é"];
const EXTENSIONS = [".md", ".txt"];
export const PATHS = FOLDERS.flatMap((folder) => NAMES.flatMap((name) => EXTENSIONS.map((ext) => folder + name + ext)));
/** What a folder is renamed to, and which folders are renamed. */
const FOLDER_NAMES = ["Projects", "Archive", "Ä", "Done", "Projects/Sub", "Z"];

export const CONTENTS = [
	"- [ ] call the plumber 📅 2026-01-20",
	// 2026-03-08 is the day daylight saving time starts in New York.
	"# Garden\n\n- [ ] plant the tulips ⏳ 2026-03-08\n- [x] buy bulbs #work",
	"---\ntags: work\nstatus: done\n---\n- [ ] with frontmatter 🛫 2026-01-15",
	"- [ ] pay the rent [due:: soon]\n- [ ] and this [scheduled:: later]",
	"- [ ] inline [due:: 2026-11-01] #skip",
	"- [ ] arabic digits [due:: ٢٠٢٦-٠١-٢٠]",
	// A parse failure: with jsonFrontmatter the tags are a list holding a number.
	"---\ntags: [2026]\n---\n- [ ] frontmatter tags that are not text",
	"Plain text, no list.",
	"- a list item\n- another one #work",
	"",
	"- [/] started #work\n  - [ ] nested",
	"- [ ] invalid 📅 2026-02-31",
	// CONTENTS[3] with one word changed: the same length and the same warnings, but another text, which is told again.
	"- [ ] pay the rent [due:: soon]\n- [ ] and that [scheduled:: later]",
];

export const FILTERS: readonly NoteFilterSettings[] = [
	{},
	{ includePaths: ["Projects"] },
	{ excludePaths: ["Archive"] },
	{ fileIncludeTags: ["#work"] },
	{ fileExcludeTags: ["#skip"] },
	{ excludeProperties: { status: ["done"] } },
	// The wrong type, as a hand-edited data.json can have it: listing the notes throws.
	{ includePaths: "Projects" as never },
];

const arabicDigits = (text: string) => text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660));

/** Whether a locale was updated, so resetEnvironment knows to undo it: undoing one that was not would delete it. */
let localeUpdated = false;

/** The changes of the parse environment, by index: moment's locale, and the time zone. */
export const ENVIRONMENTS: readonly (() => void)[] = [
	() => moment.locale("zh-cn"),
	() => moment.locale("en"),
	() => {
		// The first update of a locale makes a new locale object; a later one changes it in place.
		moment.updateLocale("en", { preparse: arabicDigits });
		localeUpdated = true;
	},
	() => {
		moment.updateLocale("en", { preparse: (text: string) => text });
		localeUpdated = true;
	},
	() => (process.env.TZ = "America/New_York"),
	() => (process.env.TZ = "Asia/Kolkata"),
	() => (process.env.TZ = "UTC"),
];

/** Puts the environment back as golden-clock set it: the locale undone and English, and UTC. */
export function resetEnvironment(): void {
	if (localeUpdated) moment.updateLocale("en", null);
	localeUpdated = false;
	moment.locale("en");
	process.env.TZ = "UTC";
}

// ---- actions ----

/**
 * What changes the vault, a reader's options or the environment between, or during, updates. `reader` picks an open
 * reader, the first when it is left out, as in the sequences of one reader.
 */
export type VaultAction =
	| { readonly op: "write"; readonly path: number; readonly content: number; readonly indexed: boolean }
	| { readonly op: "index" }
	| { readonly op: "remove"; readonly pick: number }
	| { readonly op: "rename"; readonly pick: number; readonly to: number }
	| { readonly op: "renameFolder"; readonly pick: number; readonly to: number }
	/** The note starts failing to be read, and changes: by design an unchanged note is not read again. */
	| { readonly op: "fail"; readonly pick: number; readonly content: number }
	| { readonly op: "heal"; readonly pick: number }
	/** A note starts failing to be read, with no change and no event, which the index does not see, by design. */
	| { readonly op: "silentFail"; readonly pick: number }
	/** A file goes with no event: the next update that succeeds lists it no more, and keeps nothing of it. */
	| { readonly op: "silentRemove"; readonly pick: number }
	/** The reader's next updates take these filters. */
	| { readonly op: "filters"; readonly pick: number; readonly reader?: number }
	| { readonly op: "env"; readonly pick: number }
	| { readonly op: "restoreEnv" }
	| { readonly op: "rereadAll"; readonly reader?: number }
	/** A note changes with no event, and every open reader rereads everything, as each view does on window-open. */
	| { readonly op: "missedEvent"; readonly pick: number; readonly content: number };

/** What can come while an update reads: a vault action, an update asked for, a new reader, or the update's own closing. */
export type During =
	| VaultAction
	| { readonly op: "update"; readonly reader?: number }
	| { readonly op: "open"; readonly filters: number }
	/** The reader of the update closes, as a timeline closed while its reload runs. */
	| { readonly op: "close" };

export type Action =
	| VaultAction
	| { readonly op: "update"; readonly reader?: number }
	/**
	 * An update, with the actions applied while it reads: 0 ticks right after it started, more between its parses. The
	 * updates asked for meanwhile wait for it.
	 */
	| {
			readonly op: "updateDuring";
			readonly reader?: number;
			readonly ticks: number;
			readonly during: readonly During[];
	  }
	/** An update whose listing of the notes throws, with the filters unchanged, when no update runs or waits. */
	| { readonly op: "updateBroken"; readonly reader?: number }
	/** A new reader, as a timeline opens, with these filters; at most three are open. */
	| { readonly op: "open"; readonly filters: number }
	/** An open reader is done, as a timeline closes once its reloads are done. */
	| { readonly op: "close"; readonly pick: number }
	/** An update of a closed reader, as a timeline that closed while its reload waited. */
	| { readonly op: "closedUpdate"; readonly pick: number }
	/** Two updates asked for one right after the other, so the second waits for the first. */
	| { readonly op: "pair"; readonly a: number; readonly b: number };

/** A small seeded random number generator, so a seed gives the same sequence everywhere. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function vaultAction(random: () => number): VaultAction {
	const n = (k: number) => Math.floor(random() * k);
	const r = random();
	if (r < 0.4) return { op: "write", path: n(PATHS.length), content: n(CONTENTS.length), indexed: random() < 0.8 };
	if (r < 0.5) return { op: "index" };
	if (r < 0.6) return { op: "remove", pick: n(1000) };
	if (r < 0.72) return { op: "rename", pick: n(1000), to: n(PATHS.length) };
	if (r < 0.78) return { op: "renameFolder", pick: n(1000), to: n(FOLDER_NAMES.length) };
	if (r < 0.86) return { op: "fail", pick: n(1000), content: n(CONTENTS.length) };
	if (r < 0.92) return { op: "heal", pick: n(1000) };
	if (r < 0.95) return { op: "env", pick: n(ENVIRONMENTS.length) };
	if (r < 0.97) return { op: "rereadAll" };
	return { op: "filters", pick: n(FILTERS.length) };
}

/** Six notes and an update, then `steps` steps, then whatever is not indexed yet is indexed, and a last update. */
export function generate(seed: number, steps: number): Action[] {
	const random = mulberry32(seed);
	const n = (k: number) => Math.floor(random() * k);
	const write = (): Action => ({ op: "write", path: n(PATHS.length), content: n(CONTENTS.length), indexed: true });
	const start: Action[] = [...Array.from({ length: 6 }, write), { op: "update" }];
	const middle = Array.from({ length: steps }, (): Action[] => {
		const r = random();
		if (r < 0.25) return [{ op: "update" }];
		if (r < 0.3) {
			const ticks = n(7);
			return [{ op: "updateDuring", ticks, during: Array.from({ length: 1 + n(3) }, () => vaultAction(random)) }];
		}
		// The parse environment changes while the notes are read, and is back before the next update.
		if (r < 0.34) {
			const ticks = n(7);
			return [
				{ op: "updateDuring", ticks, during: [{ op: "env", pick: n(ENVIRONMENTS.length) }] },
				{ op: "restoreEnv" },
			];
		}
		if (r < 0.36) return [{ op: "filters", pick: n(FILTERS.length) }];
		if (r < 0.39) return [{ op: "updateBroken" }];
		if (r < 0.41) return [{ op: "missedEvent", pick: n(1000), content: n(CONTENTS.length) }];
		return [vaultAction(random)];
	}).flat();
	return [...start, ...middle, { op: "index" }, { op: "update" }];
}

/** The open readers, at most: an open action does nothing when there are as many. */
export const MOST_READERS = 3;

/** A vault action of generateShared, whose filters and full reads are actions of their own. */
function sharedVaultAction(random: () => number): VaultAction {
	const n = (k: number) => Math.floor(random() * k);
	const r = random();
	if (r < 0.42) return { op: "write", path: n(PATHS.length), content: n(CONTENTS.length), indexed: random() < 0.8 };
	if (r < 0.52) return { op: "index" };
	if (r < 0.62) return { op: "remove", pick: n(1000) };
	if (r < 0.74) return { op: "rename", pick: n(1000), to: n(PATHS.length) };
	if (r < 0.8) return { op: "renameFolder", pick: n(1000), to: n(FOLDER_NAMES.length) };
	if (r < 0.88) return { op: "fail", pick: n(1000), content: n(CONTENTS.length) };
	if (r < 0.95) return { op: "heal", pick: n(1000) };
	return { op: "env", pick: n(ENVIRONMENTS.length) };
}

/** What comes while an update of generateShared reads. */
function during(random: () => number): During {
	const n = (k: number) => Math.floor(random() * k);
	const r = random();
	if (r < 0.2) return { op: "update", reader: n(10) };
	if (r < 0.26) return { op: "close" };
	if (r < 0.34) return { op: "rereadAll", reader: n(10) };
	if (r < 0.38) return { op: "open", filters: n(FILTERS.length - 1) };
	return sharedVaultAction(random);
}

/**
 * Six notes, a second reader, with the first one's filters 40% of the time, and an update of each, then `steps`
 * steps, then whatever is not indexed yet is indexed, and an update of every open reader. The wrong-type filters come
 * only from a filters action, so the start always succeeds.
 */
export function generateShared(seed: number, steps: number): Action[] {
	const random = mulberry32(seed);
	const n = (k: number) => Math.floor(random() * k);
	const write = (): Action => ({ op: "write", path: n(PATHS.length), content: n(CONTENTS.length), indexed: true });
	const filters = () => n(FILTERS.length - 1);
	const first = filters();
	const start: Action[] = [
		...Array.from({ length: 6 }, write),
		{ op: "filters", pick: first, reader: 0 },
		{ op: "open", filters: random() < 0.4 ? first : filters() },
		{ op: "update", reader: 0 },
		{ op: "update", reader: 1 },
	];
	const middle = Array.from({ length: steps }, (): Action[] => {
		const r = random();
		if (r < 0.22) return [{ op: "update", reader: n(10) }];
		if (r < 0.3) {
			const reader = n(10);
			const ticks = n(7);
			return [
				{ op: "updateDuring", reader, ticks, during: Array.from({ length: 1 + n(3) }, () => during(random)) },
			];
		}
		if (r < 0.34) return [{ op: "pair", a: n(10), b: n(10) }];
		// The parse environment changes while the notes are read, and is back before the next update.
		if (r < 0.37) {
			const reader = n(10);
			const ticks = n(7);
			return [
				{ op: "updateDuring", reader, ticks, during: [{ op: "env", pick: n(ENVIRONMENTS.length) }] },
				{ op: "restoreEnv" },
			];
		}
		if (r < 0.39) return [{ op: "open", filters: filters() }];
		if (r < 0.41) return [{ op: "close", pick: n(10) }];
		if (r < 0.43) {
			const reader = n(10);
			return [{ op: "filters", pick: n(FILTERS.length), reader }];
		}
		if (r < 0.45) return [{ op: "rereadAll", reader: n(10) }];
		if (r < 0.47) return [{ op: "missedEvent", pick: n(1000), content: n(CONTENTS.length) }];
		if (r < 0.49) return [{ op: "updateBroken", reader: n(10) }];
		if (r < 0.5) return [{ op: "closedUpdate", pick: n(10) }];
		if (r < 0.53) return [{ op: "silentFail", pick: n(1000) }];
		if (r < 0.55) return [{ op: "silentRemove", pick: n(1000) }];
		return [sharedVaultAction(random)];
	}).flat();
	const last = Array.from({ length: MOST_READERS }, (_, reader): Action => ({ op: "update", reader }));
	return [...start, ...middle, { op: "index" }, ...last];
}

// ---- applying a vault action ----

/** What a vault action changes besides the vault: the readers' filters and full reads, which the model follows. */
export interface Stage {
	readonly vault: FakeVault;
	/** The open reader the action picks, `reader ?? 0` modulo the open ones, takes the filters for its next updates. */
	filters(reader: number, filters: NoteFilterSettings): void;
	/** The open reader the action picks asks for a full read; with null, every open reader does. */
	rereadAll(reader: number | null): void;
}

/** The folders of FOLDER_NAMES that exist. Folders stay when their files go, as they do in Obsidian. */
const folders = (vault: FakeVault) =>
	FOLDER_NAMES.filter((path) => vault.app.vault.getAbstractFileByPath(path) instanceof TFolder);

const exists = (vault: FakeVault, path: string) => vault.app.vault.getAbstractFileByPath(path) !== null;

/**
 * Applies the action, and gives the path of the file it acted on, as it was named before, or null when it acted on
 * none or on a folder. `count` is told what it did, for the differential test's coverage guard.
 */
export function applyVaultAction(stage: Stage, action: VaultAction, count: (what: string) => void): string | null {
	const { vault } = stage;
	const files = vault.filePaths();
	/** The file the action picks, or null when there is none. */
	const picked = (k: number): string | null => (files.length === 0 ? null : files[k % files.length]);
	switch (action.op) {
		case "write":
			vault.write(PATHS[action.path], CONTENTS[action.content], { indexed: action.indexed });
			count(action.indexed ? "write" : "write unindexed");
			return PATHS[action.path];
		case "index":
			if (vault.pending().length > 0) count("index");
			vault.indexPending();
			return null;
		case "remove": {
			const path = picked(action.pick);
			if (path === null) return null;
			vault.remove(path);
			count("remove");
			return path;
		}
		case "rename": {
			const from = picked(action.pick);
			const to = PATHS[action.to];
			if (from === null || exists(vault, to)) return null;
			vault.rename(from, to);
			count(from.slice(-3) === to.slice(-3) ? "rename" : "rename md/txt");
			return from;
		}
		case "renameFolder":
			renameFolder(vault, action, count);
			return null;
		case "fail": {
			const path = picked(action.pick);
			if (path === null) return null;
			vault.failReads(path);
			vault.write(path, CONTENTS[action.content]);
			return path;
		}
		case "heal": {
			const path = picked(action.pick);
			if (path !== null) vault.healReads(path);
			return path;
		}
		case "silentFail":
			return silentFail(vault, action.pick, count);
		case "silentRemove": {
			const path = picked(action.pick);
			if (path === null) return null;
			vault.removeSilently(path);
			// A file made at its path later is a new one, which reads.
			vault.healReads(path);
			count("silent remove");
			return path;
		}
		case "filters":
			stage.filters(action.reader ?? 0, FILTERS[action.pick]);
			count("filters");
			return null;
		case "env":
			ENVIRONMENTS[action.pick]();
			count("env");
			return null;
		case "restoreEnv":
			resetEnvironment();
			return null;
		case "rereadAll":
			stage.rereadAll(action.reader ?? 0);
			return null;
		case "missedEvent":
			return missedEvent(stage, action, count);
	}
}

/** A note, not a file of another kind, starts failing to be read, and nothing tells of it. */
function silentFail(vault: FakeVault, pick: number, count: (what: string) => void): string | null {
	const notes = vault.filePaths().filter((path) => path.endsWith(".md"));
	if (notes.length === 0) return null;
	const path = notes[pick % notes.length];
	vault.failReads(path);
	count("silent failure");
	return path;
}

/** Renames a folder, never into itself or onto something that exists. */
function renameFolder(vault: FakeVault, { pick, to }: { pick: number; to: number }, count: (what: string) => void) {
	const existing = folders(vault);
	if (existing.length === 0) return;
	const from = existing[pick % existing.length];
	const target = FOLDER_NAMES[to];
	if (target === from || target.startsWith(from + "/") || exists(vault, target)) return;
	const withNotes = vault.filePaths().some((path) => path.startsWith(from + "/") && path.endsWith(".md"));
	vault.rename(from, target);
	if (withNotes) count("folder rename with notes");
}

/** A note changes and no event says so; what each view does on window-open or the first "resolved" recovers it. */
function missedEvent(
	stage: Stage,
	{ pick, content }: { pick: number; content: number },
	count: (what: string) => void,
): string | null {
	const pending = stage.vault.pending();
	const notes = stage.vault.filePaths().filter((path) => path.endsWith(".md") && !pending.includes(path));
	if (notes.length === 0) return null;
	const path = notes[pick % notes.length];
	stage.vault.writeSilently(path, CONTENTS[content]);
	stage.rereadAll(null);
	count("missed event");
	return path;
}
