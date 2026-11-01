import { test } from "node:test";
import assert from "node:assert/strict";
import type { App, OpenViewState, PaneType, UserEvent } from "obsidian";

import { openNoteAt } from "../src/open-note";
import { MarkdownView, Notice, TFile } from "./stubs/obsidian";

test("opens once at the line", async () => {
	Notice.shown = [];
	const file = new TFile();
	file.setPath("Notes/a.md");
	const opens: { file: TFile; openState: OpenViewState }[] = [];
	const cursors: { line: number; ch: number }[] = [];
	const leafRequests: (PaneType | boolean)[] = [];
	const view = new MarkdownView();
	view.editor = { setCursor: (position) => cursors.push(position) };
	const leaf = {
		view,
		openFile: async (file: TFile, openState: OpenViewState) => {
			opens.push({ file, openState });
		},
	};
	const app = {
		vault: { getFileByPath: (path: string) => (path === "Notes/a.md" ? file : null) },
		workspace: {
			getLeaf: (newLeaf: PaneType | boolean) => {
				leafRequests.push(newLeaf);
				return leaf;
			},
		},
	} as unknown as App;

	assert.equal(await openNoteAt(app, "Notes/a.md", 12), leaf);
	assert.equal(opens.length, 1);
	assert.equal(opens[0].file, file);
	assert.equal(opens[0].openState.active, true);
	assert.equal(opens[0].openState.eState?.line, 12);
	assert.equal("state" in opens[0].openState, false);
	assert.deepEqual(cursors, [{ line: 12, ch: 0 }]);
	assert.deepEqual(leafRequests, [false]);

	opens.length = 0;
	leafRequests.length = 0;
	await openNoteAt(app, "Notes/a.md", 12, { metaKey: true } as UserEvent);
	assert.equal(opens.length, 1);
	assert.deepEqual(leafRequests, ["tab"]);

	opens.length = 0;
	leafRequests.length = 0;
	assert.equal(await openNoteAt(app, "Notes/missing.md", 3), null);
	assert.deepEqual(Notice.shown, ["No such file: Notes/missing.md"]);
	assert.equal(opens.length, 0);
	assert.equal(leafRequests.length, 0);
});
