import type { Store } from "@tasks-calendar-wrapper/core";
import type { TimelineState } from "../src/state/timeline";
import { TasksTimelineView } from "../src/views";
import { createTaskIndex } from "../timeline/src/taskindex";
import type { TaskWriter } from "../timeline/src/taskwriter";
import { moment } from "../utils/moment";
import { parseKeyOf } from "../utils/parsekey";

/** Read-only view tests never submit an edit; fail explicitly if a test starts writing. */
export const unusedWriter = {
	async insert(): Promise<never> {
		throw new Error("This view test does not provide a writer.");
	},
} as unknown as TaskWriter;

/**
 * A timeline view opened on an app, counting the changes of the list shown. `edited` tells the view a note changed, as
 * Obsidian's "changed" does through watchNotes, so that the next reload reads the note; these apps fire no events.
 */
export function openView(app: unknown) {
	// An index of the view's own: these apps fire no events, so `edited` marks it as watchNotes would.
	const index = createTaskIndex({ app: app as never, moment, parseKey: () => parseKeyOf(moment) });
	const writer = unusedWriter;
	const view = new TasksTimelineView({ app } as never, index, writer);
	const { store } = view as unknown as { store: Store<TimelineState> };
	let changes = 0;
	let shown = store.getSnapshot().shown;
	store.subscribe(() => {
		if (store.getSnapshot().shown !== shown) changes += 1;
		shown = store.getSnapshot().shown;
	});
	return { view, store, writer, changes: () => changes, edited: (path: string) => index.markDirty([path]) };
}

/**
 * An app whose notes have one task each, on their first line, and can be edited between reloads. Each edit is told to
 * the view with `edited`, see openView.
 */
export function notesApp(notes: Record<string, string>) {
	return {
		vault: {
			getMarkdownFiles: () => Object.keys(notes).map((path) => ({ path })),
			cachedRead: async (file: { path: string }) => notes[file.path],
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const end =
					notes[file.path].indexOf("\n") < 0 ? notes[file.path].length : notes[file.path].indexOf("\n");
				const position = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: end, offset: end } };
				return { listItems: [{ task: " ", parent: -1, position }], sections: [], links: [], tags: [] };
			},
		},
		plugins: { plugins: {} },
	};
}
