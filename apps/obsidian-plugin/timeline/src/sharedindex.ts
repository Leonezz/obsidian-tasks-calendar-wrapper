import { Component, type App } from "obsidian";
import type { NoteFilterSettings } from "@tasks-calendar-wrapper/core";
import {
	createTaskIndex,
	watchNotes,
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
	/** The plugin unloads: stops the watching, closes every reader still open and drops the index. Idempotent. */
	dispose(): void;
}

/** The index of the open timelines, the events it watches, and the readers handed out. */
interface Lease {
	readonly index: TaskIndex;
	/** Holds the event refs of watchNotes, and takes them off when it unloads. */
	readonly watching: Component;
	readonly readers: Set<TaskIndexReader>;
}

/** The holder of the plugin's shared index. It makes nothing until the first openReader. */
export function createSharedTaskIndex(
	deps: TaskIndexDeps & { readonly app: NoteSource & Pick<App, "vault" | "metadataCache"> },
): SharedTaskIndex {
	let lease: Lease | null = null;
	let disposed = false;

	function drop(): void {
		lease?.watching.unload();
		lease = null;
	}

	function lend(): Lease {
		if (lease !== null) return lease;
		const index = createTaskIndex(deps);
		const watching = new Component();
		watching.load();
		for (const ref of watchNotes(deps.app, index)) watching.registerEvent(ref);
		lease = { index, watching, readers: new Set() };
		return lease;
	}

	function openReader(): TaskIndexReader {
		if (disposed) throw new Error("Tasks Calendar Wrapper: the plugin unloaded; its task index is gone.");
		const mine = lend();
		const reader = mine.index.openReader();
		const handed: TaskIndexReader = Object.freeze({
			rereadAll: () => reader.rereadAll(),
			update: (filters: NoteFilterSettings) => reader.update(filters),
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
		dispose(): void {
			disposed = true;
			const readers = lease ? [...lease.readers] : [];
			drop();
			for (const reader of readers) reader.close();
		},
	});
}
