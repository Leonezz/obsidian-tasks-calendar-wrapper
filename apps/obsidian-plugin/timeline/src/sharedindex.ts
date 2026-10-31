import { Component, type App } from "obsidian";
import type { NoteFilterSettings } from "@tasks-calendar-wrapper/core";
import {
	createTaskIndex,
	watchNotes,
	type HoldToken,
	type IndexUpdate,
	type NoteSource,
	type TaskIndex,
	type TaskIndexDeps,
	type TaskIndexReader,
} from "./taskindex";

/** Where a view gets its reader: the plugin's shared index, or in tests an index of its own that hears no events. */
export type ReaderSource = Pick<TaskIndex, "openReader">;

/**
 * The task index the plugin's timelines share, made with the first timeline and dropped after the last one is done
 * with it. The plugin holds one for as long as it is loaded.
 */
export interface SharedTaskIndex extends ReaderSource {
	/**
	 * A reader for a new timeline. The first one, and the first after the last was closed, makes a new index, which
	 * then watches the vault, see watchNotes, before the view registers its own handlers; closing the last reader stops
	 * the watching and drops the index, so the next timeline's index reads every note. Throws once the plugin unloaded.
	 */
	openReader(): TaskIndexReader;
	/**
	 * Holds the note in the open timelines' index, see TaskIndex.hold. With no timeline open there is no index:
	 * returns a token that does nothing. The token also does nothing once its index is dropped.
	 */
	hold(path: string): HoldToken;
	/** Marks the paths in the open timelines' index, see TaskIndex.markDirty; nothing when no timeline is open. */
	markDirty(paths: readonly string[]): void;
	/**
	 * The plugin unloads: stops the watching and drops the index. A reader still open is left to its view, which
	 * closes it once its reloads are done; they finish on the dropped index, which hears nothing more. A view Obsidian
	 * made before the unload and opens after it asks for a full read when it opens: from then on each of its updates
	 * reads every note it shows, as nothing marks the notes that change. Idempotent.
	 */
	dispose(): void;
}

/** The index of the open timelines, the events it watches, and the readers handed out. */
interface Lease {
	readonly index: TaskIndex;
	/** Holds the event refs of watchNotes, and takes them off when it unloads. */
	readonly watching: Component;
	readonly readers: Set<TaskIndexReader>;
	/** Underlying claims, released when the lease goes so a reader finishing after unload cannot stay pinned. */
	readonly holds: Set<HoldToken>;
}

/** The holder of the plugin's shared index. It makes nothing until the first openReader. */
export function createSharedTaskIndex(
	deps: TaskIndexDeps & { readonly app: NoteSource & Pick<App, "vault" | "metadataCache"> },
): SharedTaskIndex {
	let lease: Lease | null = null;
	let disposed = false;

	function drop(): void {
		lease?.watching.unload();
		for (const token of lease?.holds ?? []) token.release({ markDirty: false });
		lease?.holds.clear();
		lease = null;
	}

	function lend(): Lease {
		if (lease !== null) return lease;
		const index = createTaskIndex(deps);
		const watching = new Component();
		watching.load();
		for (const ref of watchNotes(deps.app, index)) watching.registerEvent(ref);
		lease = { index, watching, readers: new Set(), holds: new Set() };
		return lease;
	}

	function openReader(): TaskIndexReader {
		if (disposed) throw new Error("Tasks Calendar Wrapper: the plugin unloaded; its task index is gone.");
		const mine = lend();
		const reader = mine.index.openReader();
		/** A full read was asked for after the unload: only a view that opens then asks, as a closed one hears nothing. */
		let unwatched = false;
		const handed: TaskIndexReader = Object.freeze({
			rereadAll(): void {
				if (disposed) unwatched = true;
				reader.rereadAll();
			},
			update(filters: NoteFilterSettings): Promise<IndexUpdate> {
				if (unwatched) reader.rereadAll();
				return reader.update(filters);
			},
			close(): void {
				reader.close();
				if (!mine.readers.delete(handed)) return;
				if (mine.readers.size === 0 && lease === mine) drop();
			},
		});
		mine.readers.add(handed);
		return handed;
	}

	return Object.freeze({
		openReader,
		hold(path: string): HoldToken {
			const mine = lease;
			const token = mine?.index.hold(path);
			if (token !== undefined) mine?.holds.add(token);
			return Object.freeze({
				release(options?: { readonly markDirty?: boolean }): void {
					if (mine === null || lease !== mine || token === undefined || !mine.holds.delete(token)) return;
					token.release(options);
				},
			});
		},
		markDirty(paths: readonly string[]): void {
			lease?.index.markDirty(paths);
		},
		dispose(): void {
			// A reader closed now would keep nothing for the reload its view still runs, which would read every note.
			disposed = true;
			drop();
		},
	});
}
