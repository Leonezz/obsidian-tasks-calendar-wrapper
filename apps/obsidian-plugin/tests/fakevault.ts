/**
 * A vault in memory for tests of how the timeline follows changes. Its edits fire the events Obsidian 1.14.4 fires for
 * them, in the same order:
 * - writing a note: the vault's "modify" (or "create" for a new note), then the metadata cache's "changed";
 * - removing a note: the metadata cache's "deleted" with the metadata the note had, then the vault's "delete";
 * - renaming: the metadata moves to the new path, then the vault's "rename"; a folder is renamed first, then each
 *   file and folder in it, as Obsidian reports them;
 * - after each of them, once Obsidian has resolved the links again, the metadata cache's "resolved". The "resolve" it
 *   fires for each note before that is left out, as the plugin does not listen to it.
 * Obsidian fires the metadata events a moment later, after reading the note; here they come at once. A file that is not
 * a note (not ".md") gets no "changed", and its metadata is empty, as in Obsidian.
 *
 * A test can also ask for what Obsidian does only now and then; unless it asks, none of it happens:
 * - write a note before Obsidian has indexed it (`indexed: false`): only "modify" or "create" fires, and the metadata
 *   stays as it was, none for a new note, until indexPending fires "changed" for each such note, then "resolved". A
 *   note removed meanwhile is no longer waiting, and one renamed waits at its new path;
 * - change a note with no event at all (writeSilently), as when an event is missed;
 * - make reading a note fail (failReads) and work again (healReads), hold every read until a test lets them go
 *   (holdReads), or make the next listing of the notes throw (breakListing);
 * - with `staggerReads`, have reads finish out of order, a few microtasks apart, so a change can land between two
 *   notes' parses.
 *
 * The metadata of a note is computed from its text, as far as the plugin uses it: each line that starts with a list
 * marker is a list item at the top of its list, a task when "[x]" follows the marker; "#tags"; and a frontmatter of
 * "key: value" lines between "---" lines. Code blocks, nested lists and typed frontmatter values are not modelled,
 * except that with `jsonFrontmatter` a value written as a JSON list or object, such as `tags: [2026]`, is read as one;
 * tests that need Obsidian's own metadata use the golden vault's, see golden-vault.ts.
 */
import type { CachedMetadata, FrontMatterCache, ListItemCache, TagCache } from "obsidian";
import { Events, TAbstractFile, TFile, TFolder } from "obsidian";

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)]) (?:\[(.)\])?/;
const TAG = /(^|\s)(#[^\s#]+)/g;

/** A frontmatter value as written; with `json`, one written as a JSON list or object is read as one, as in YAML. */
function valueOf(text: string, json: boolean): unknown {
	if (!json || !/^[[{]/.test(text)) return text;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * The metadata Obsidian computes for a note's text, as far as the plugin uses it. With `json`, frontmatter values
 * written as JSON lists or objects are read as such.
 */
export function metadataOf(content: string, json = false): CachedMetadata {
	const lines = content.split("\n");
	const starts = lines.map((_, n) => lines.slice(0, n).reduce((offset, line) => offset + line.length + 1, 0));
	const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
	const frontmatter: FrontMatterCache | undefined =
		end > 0
			? Object.fromEntries(
					lines
						.slice(1, end)
						.map((line) => line.match(/^([^:]+):\s*(.*)$/))
						.filter((match): match is RegExpMatchArray => match !== null)
						.map((match) => [match[1].trim(), valueOf(match[2].trim(), json)]),
				)
			: undefined;
	const range = (line: number, from: number, to: number) => ({
		start: { line, col: from, offset: starts[line] + from },
		end: { line, col: to, offset: starts[line] + to },
	});
	const listItems: ListItemCache[] = lines.flatMap((line, n) => {
		const match = n > end ? line.match(LIST_ITEM) : null;
		if (!match) return [];
		const item = { position: range(n, match[1].length, line.length), parent: -1 };
		return [match[3] === undefined ? item : { ...item, task: match[3] }];
	});
	const tags: TagCache[] = lines.flatMap((line, n) =>
		n <= end
			? []
			: [...line.matchAll(TAG)].map((match) => {
					const from = (match.index ?? 0) + match[1].length;
					return { tag: match[2], position: range(n, from, from + match[2].length) };
				}),
	);
	return {
		...(listItems.length > 0 ? { listItems } : {}),
		...(tags.length > 0 ? { tags } : {}),
		...(frontmatter ? { frontmatter } : {}),
	};
}

class FakeMetadataCache extends Events {
	constructor(private readonly caches: Map<string, CachedMetadata>) {
		super();
	}

	/** As in Obsidian: nothing for a path it has no metadata of, and empty metadata for a file that is not a note. */
	getFileCache(file: TAbstractFile | null): CachedMetadata | null {
		if (!file || !this.caches.has(file.path)) return null;
		return file instanceof TFile && file.extension === "md" ? (this.caches.get(file.path) ?? null) : {};
	}
}

/** The timer of the module's start, which a test's mocked clock does not replace. */
const realSetTimeout = setTimeout;

/** What the workspace uses of a view opened in a leaf. */
export interface LeafView {
	getViewType(): string;
	open?(): Promise<void>;
	close?(): Promise<void>;
}

/**
 * As Obsidian's view registry: each view type is registered once, with the function that makes its views. When a type
 * is unregistered, the workspace closes the views of that type and keeps a stand-in for each, as Obsidian does.
 */
class FakeViewRegistry {
	private creators: Readonly<Record<string, (leaf: FakeLeaf) => LeafView>> = {};
	private unregistered: (type: string) => void = () => {};

	/** Not in Obsidian's typings: what the workspace does when a type is unregistered. */
	whenUnregistered(listener: (type: string) => void): void {
		this.unregistered = listener;
	}

	registerView(type: string, creator: (leaf: FakeLeaf) => LeafView): void {
		if (Object.prototype.hasOwnProperty.call(this.creators, type))
			throw new Error(`Attempting to register an existing view type "${type}"`);
		this.creators = { ...this.creators, [type]: creator };
	}

	unregisterView(type: string): void {
		if (!Object.prototype.hasOwnProperty.call(this.creators, type)) return;
		this.creators = Object.fromEntries(Object.entries(this.creators).filter(([other]) => other !== type));
		this.unregistered(type);
	}

	/** Not in Obsidian's typings: the function that makes views of the type, if one is registered. */
	creatorOf(type: string): ((leaf: FakeLeaf) => LeafView) | undefined {
		return this.creators[type];
	}
}

/** A leaf of the workspace, with the view opened in it. */
export class FakeLeaf {
	view: LeafView | null = null;

	constructor(
		readonly app: unknown,
		private readonly workspace: FakeWorkspace,
		private readonly registry: FakeViewRegistry,
	) {}

	/** As in Obsidian: makes the view with the function registered for its type, then opens it. */
	async setViewState(state: { type: string; active?: boolean }): Promise<void> {
		const creator = this.registry.creatorOf(state.type);
		if (!creator) throw new Error(`no view type "${state.type}" is registered`);
		await this.view?.close?.();
		const view = creator(this);
		this.view = view;
		await view.open?.();
	}

	/**
	 * As in Obsidian when a view type goes: the view closes, staying in the leaf while it does, and then a stand-in that
	 * reports the type takes its place.
	 */
	async standIn(type: string): Promise<void> {
		await this.view?.close?.();
		this.view = { getViewType: () => type };
	}

	/** As in Obsidian: the leaf leaves the workspace and its view closes. */
	async detach(): Promise<void> {
		const view = this.view;
		this.workspace.removeLeaf(this);
		await view?.close?.();
	}
}

class FakeWorkspace extends Events {
	private leaves: readonly FakeLeaf[] = [];
	/** The callbacks waiting for the layout, or null once it is ready. */
	private layoutCallbacks: readonly (() => unknown)[] | null;
	/** Not in Obsidian: the leaves revealLeaf was called with, in order. */
	revealed: readonly FakeLeaf[] = [];

	constructor(
		private readonly appOf: () => unknown,
		private readonly registry: FakeViewRegistry,
		layoutReady: boolean,
	) {
		super();
		this.layoutCallbacks = layoutReady ? null : [];
	}

	/** Not in Obsidian: a new leaf to open a view in. */
	addLeaf(): FakeLeaf {
		const leaf = new FakeLeaf(this.appOf(), this, this.registry);
		this.leaves = [...this.leaves, leaf];
		return leaf;
	}

	/** Not in Obsidian: the leaf is gone, as after closing its tab. */
	removeLeaf(leaf: FakeLeaf): void {
		this.leaves = this.leaves.filter((other) => other !== leaf);
	}

	getLeavesOfType(type: string): FakeLeaf[] {
		return this.leaves.filter((leaf) => leaf.view?.getViewType() === type);
	}

	/** As in Obsidian: once the layout is ready the callback runs at once; before, it waits for the layout. */
	onLayoutReady(callback: () => unknown): void {
		if (this.layoutCallbacks === null) callback();
		else this.layoutCallbacks = [...this.layoutCallbacks, callback];
	}

	/**
	 * Not in Obsidian: the layout is ready, as when Obsidian has started. The waiting callbacks run in order; one that
	 * throws does not stop the others, and its error is thrown again from a timer.
	 */
	finishLayout(): void {
		const callbacks = this.layoutCallbacks ?? [];
		this.layoutCallbacks = null;
		for (const callback of callbacks) {
			try {
				callback();
			} catch (error) {
				realSetTimeout(() => {
					throw error;
				}, 0);
			}
		}
	}

	/** As in Obsidian: a new leaf in the right sidebar. */
	getRightLeaf(_split: boolean): FakeLeaf {
		return this.addLeaf();
	}

	async revealLeaf(leaf: FakeLeaf): Promise<void> {
		this.revealed = [...this.revealed, leaf];
	}

	detachLeavesOfType(type: string): void {
		for (const leaf of this.getLeavesOfType(type)) void leaf.detach();
	}
}

/** Gives a file or folder its path, as Obsidian does on a rename; Obsidian's typings do not declare it. */
const setPath = (file: TAbstractFile, path: string) =>
	(file as unknown as { setPath(path: string): void }).setPath(path);

const fileAt = (path: string) => {
	const file = new TFile();
	setPath(file, path);
	return file;
};

const folderAt = (path: string) => {
	const folder = new TFolder();
	setPath(folder, path);
	return folder;
};

/**
 * A vault with these notes, by path, and the app the timeline sees it through. With `layoutReady: false` the app is
 * still starting: onLayoutReady waits for finishLayout. With `jsonFrontmatter`, frontmatter values written as JSON
 * lists or objects are read as such. With `staggerReads`, each read waits a few microtasks, more or fewer by its path,
 * before it looks up the content, so reads finish out of order.
 */
export function fakeVault(
	notes: Record<string, string>,
	{ layoutReady = true, jsonFrontmatter = false, staggerReads = false } = {},
) {
	const contents = new Map<string, string>();
	const caches = new Map<string, CachedMetadata>();
	const files = new Map<string, TAbstractFile>();
	const failing = new Set<string>();
	/** The notes written with `indexed: false` whose "changed" has not come yet. */
	const pending = new Set<string>();
	const reads: string[] = [];
	let listings = 0;
	let brokenListings = 0;
	/** While reads are held, the promise they wait for. */
	let held: Promise<void> | null = null;

	const metadataCache = new FakeMetadataCache(caches);
	const vault = Object.assign(new Events(), {
		getMarkdownFiles(): TFile[] {
			listings += 1;
			if (brokenListings > 0) {
				brokenListings -= 1;
				throw new Error("the vault is not ready");
			}
			return [...files.values()].filter(
				(file): file is TFile => file instanceof TFile && file.extension === "md",
			);
		},
		async cachedRead(file: TFile): Promise<string> {
			reads.push(file.path);
			if (held) await held;
			if (staggerReads) for (let tick = 0; tick < (file.path.length * 7) % 5; tick++) await null;
			if (failing.has(file.path)) throw new Error(`could not read ${file.path}`);
			const content = contents.get(file.path);
			if (content === undefined) throw new Error(`${file.path} does not exist`);
			return content;
		},
		getAbstractFileByPath(path: string): TAbstractFile | null {
			return files.get(path) ?? null;
		},
	});
	const viewRegistry = new FakeViewRegistry();
	const workspace: FakeWorkspace = new FakeWorkspace(() => app, viewRegistry, layoutReady);
	viewRegistry.whenUnregistered((type) => {
		for (const leaf of workspace.getLeavesOfType(type)) if (leaf.view?.close) void leaf.standIn(type);
	});
	const app = { vault, metadataCache, workspace, viewRegistry };

	/** Adds the folders a path is in, as Obsidian has them. */
	const addFolders = (path: string) => {
		const parts = path.split("/").slice(0, -1);
		parts.forEach((_, n) => {
			const folder = parts.slice(0, n + 1).join("/");
			if (!files.has(folder)) files.set(folder, folderAt(folder));
		});
	};
	for (const [path, content] of Object.entries(notes)) {
		addFolders(path);
		files.set(path, fileAt(path));
		contents.set(path, content);
		caches.set(path, path.endsWith(".md") ? metadataOf(content, jsonFrontmatter) : {});
	}

	return {
		app,
		/** The paths read, in order. */
		reads,
		/** How often the notes were listed, which readTasks does once per reload. */
		listings: () => listings,
		/**
		 * Writes a note, as an editor saving it does: "modify", or "create" for a new note, then "changed". With
		 * `indexed: false`, Obsidian has not indexed it yet: "changed" waits for indexPending, and until then the
		 * metadata stays as it was, none for a new note.
		 */
		write(path: string, content: string, { indexed = true } = {}): void {
			const existing = files.get(path);
			const file = existing instanceof TFile ? existing : fileAt(path);
			if (!existing) {
				addFolders(path);
				files.set(path, file);
			}
			contents.set(path, content);
			vault.trigger(existing ? "modify" : "create", file);
			if (file.extension !== "md") {
				caches.set(path, {});
				return;
			}
			if (!indexed) {
				pending.add(path);
				return;
			}
			pending.delete(path);
			caches.set(path, metadataOf(content, jsonFrontmatter));
			metadataCache.trigger("changed", file, content, caches.get(path));
			metadataCache.trigger("resolved");
		},
		/** Deletes a note: "deleted" with the metadata it had, then "delete". */
		remove(path: string): void {
			const file = files.get(path);
			if (!(file instanceof TFile)) throw new Error(`there is no note ${path}`);
			files.delete(path);
			pending.delete(path);
			metadataCache.trigger("deleted", file, metadataCache.getFileCache(file));
			caches.delete(path);
			contents.delete(path);
			vault.trigger("delete", file);
			metadataCache.trigger("resolved");
		},
		/** Renames a note or a folder. A folder's files and folders are renamed after it, each with its own event. */
		rename(oldPath: string, newPath: string): void {
			const target = files.get(oldPath);
			if (!target) throw new Error(`there is nothing at ${oldPath}`);
			const inside = [...files.keys()].filter((path) => path.startsWith(oldPath + "/")).sort();
			addFolders(newPath);
			for (const from of [oldPath, ...inside]) {
				const to = newPath + from.slice(oldPath.length);
				const file = files.get(from) as TAbstractFile;
				files.delete(from);
				setPath(file, to);
				files.set(to, file);
				// Obsidian's metadata cache moves the metadata on "rename" before the plugins hear of it. A note still
				// waiting to be indexed waits at its new path, unless it is no note there.
				if (pending.delete(from) && to.endsWith(".md")) pending.add(to);
				for (const map of [caches, contents] as Map<string, unknown>[]) {
					if (map.has(from)) {
						map.set(to, map.get(from));
						map.delete(from);
					}
				}
				vault.trigger("rename", file, from);
			}
			metadataCache.trigger("resolved");
		},
		/** Obsidian has resolved the links of every note again, as it does after changes and once after starting. */
		resolve(): void {
			metadataCache.trigger("resolved");
		},
		/** A new Obsidian window opened. */
		openWindow(): void {
			app.workspace.trigger("window-open", {}, {});
		},
		/** Makes reading the note fail, as when the file cannot be read from disk. */
		failReads(path: string): void {
			failing.add(path);
		},
		/** Not in Obsidian: reading the note works again. */
		healReads(path: string): void {
			failing.delete(path);
		},
		/** Not in Obsidian: the note changes, its metadata too, and no event says so, as when an event is missed. */
		writeSilently(path: string, content: string): void {
			contents.set(path, content);
			caches.set(path, path.endsWith(".md") ? metadataOf(content, jsonFrontmatter) : {});
		},
		/** Not in Obsidian: the next listing of the notes throws, as in a vault that is not ready. */
		breakListing(): void {
			brokenListings += 1;
		},
		/**
		 * Not in Obsidian: every read started from now on waits until the returned function is called. A read is
		 * recorded in `reads` when it starts, and looks up the content when it is let go, so it reads what is there
		 * then.
		 */
		holdReads(): () => void {
			let release = () => {};
			held = new Promise<void>((resolve) => (release = resolve));
			return () => {
				held = null;
				release();
			};
		},
		/** Not in Obsidian: the notes written with `indexed: false` whose "changed" has not come yet, sorted. */
		pending: (): readonly string[] => [...pending].sort(),
		/** Obsidian indexes the notes written with `indexed: false`: "changed" for each, then "resolved", if any. */
		indexPending(): void {
			const paths = [...pending].sort();
			pending.clear();
			for (const path of paths) {
				const file = files.get(path) as TFile;
				const content = contents.get(path) ?? "";
				caches.set(path, metadataOf(content, jsonFrontmatter));
				metadataCache.trigger("changed", file, content, caches.get(path));
			}
			if (paths.length > 0) metadataCache.trigger("resolved");
		},
		/** Not in Obsidian: the paths of every file, not folder, sorted. Unlike getMarkdownFiles, it does not count. */
		filePaths: (): string[] =>
			[...files.entries()]
				.filter(([, file]) => file instanceof TFile)
				.map(([path]) => path)
				.sort(),
		/** Not in Obsidian: whether the metadata cache has metadata for the path. */
		hasMetadata: (path: string): boolean => caches.has(path),
	};
}

export type FakeVault = ReturnType<typeof fakeVault>;
