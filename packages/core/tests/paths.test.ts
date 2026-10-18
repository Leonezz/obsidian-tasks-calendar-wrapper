import { test } from "node:test";
import assert from "node:assert/strict";

import { getFileTitle } from "../src/paths";

test("a file title is the file name without its folders and without .md", () => {
	assert.equal(getFileTitle("Journal/2026/Daily note.md"), "Daily note");
	assert.equal(getFileTitle("Inbox.md"), "Inbox");
	assert.equal(getFileTitle("Inbox"), "Inbox");
});

test("only the .md extension is dropped", () => {
	assert.equal(getFileTitle("Boards/Plan.canvas"), "Plan.canvas");
	assert.equal(getFileTitle("Notes/v1.2 notes.md"), "v1.2 notes");
});
