import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { insertTaskUnderSection, normalizeNotePath, parentFolder, quickEntryTargets } from "../src/quickentry";

// Issue #48: a path without an extension created a file the timeline never reads

test("a note path without an extension gets .md", () => {
	assert.equal(normalizeNotePath("Inbox"), "Inbox.md");
	assert.equal(normalizeNotePath("01 Tasks/Inbox"), "01 Tasks/Inbox.md");
});

test("a note path that already ends in .md is kept", () => {
	assert.equal(normalizeNotePath("Inbox.md"), "Inbox.md");
	assert.equal(normalizeNotePath("Notes/Inbox.MD"), "Notes/Inbox.MD");
});

test("surrounding spaces and a leading slash are removed", () => {
	assert.equal(normalizeNotePath("  /Tasks/Inbox.md "), "Tasks/Inbox.md");
});

test("a dot inside a folder name does not count as an extension", () => {
	assert.equal(normalizeNotePath("v1.2/Inbox"), "v1.2/Inbox.md");
});

// A new note in a folder that does not exist yet needs that folder first

test("the folder of a note is the path up to its last slash", () => {
	assert.equal(parentFolder("01 Tasks/Inbox.md"), "01 Tasks");
	assert.equal(parentFolder("a/b.c/Inbox.md"), "a/b.c");
});

test("a note at the top of the vault has no folder", () => {
	assert.equal(parentFolder("Inbox.md"), "");
});

// The task goes under the configured section, or under a new one at the end, never above the frontmatter

test("the task is inserted right below the section heading", () => {
	const note = "---\ntags: inbox\n---\n# Inbox\n## Tasks\n- [ ] older\n";
	assert.equal(
		insertTaskUnderSection(note, "## Tasks", "- [ ] new"),
		"---\ntags: inbox\n---\n# Inbox\n## Tasks\n- [ ] new\n- [ ] older\n",
	);
});

test("a missing section is added at the end instead of writing above the frontmatter", () => {
	const note = "---\ntags: inbox\n---\n# Inbox\nSome text\n";
	assert.equal(
		insertTaskUnderSection(note, "## Tasks", "- [ ] new"),
		"---\ntags: inbox\n---\n# Inbox\nSome text\n\n## Tasks\n- [ ] new\n",
	);
});

test("a note with Windows line endings still finds its section and keeps its line endings", () => {
	const note = "# Inbox\r\n## Tasks\r\n- [ ] older\r\n";
	assert.equal(
		insertTaskUnderSection(note, "## Tasks", "- [ ] new"),
		"# Inbox\r\n## Tasks\r\n- [ ] new\r\n- [ ] older\r\n",
	);
});

test("an empty note gets the section and the task", () => {
	assert.equal(insertTaskUnderSection("", "## Tasks", "- [ ] new"), "## Tasks\n- [ ] new\n");
});

test("with no section configured the task is appended at the end", () => {
	assert.equal(
		insertTaskUnderSection("# Inbox\n- [ ] older\n", "", "- [ ] new"),
		"# Inbox\n- [ ] older\n- [ ] new\n",
	);
});

const targetOptions = {
	taskFiles: ["Projects.md"],
	inbox: "Inbox.md",
	dailyNoteFormat: "YYYY-MM-DD",
	dailyNoteFolder: "Daily",
};
const thursday = moment.utc("2026-01-15T09:00:00Z");

test("quick entry offers the task files, then the inbox, then today's daily note in its folder", () => {
	assert.deepEqual(quickEntryTargets(targetOptions, thursday), ["Projects.md", "Inbox.md", "Daily/2026-01-15.md"]);
});

test("the daily note folder gets one slash, and no folder means the top of the vault", () => {
	assert.deepEqual(
		quickEntryTargets({ ...targetOptions, dailyNoteFolder: "Daily/" }, thursday).at(-1),
		"Daily/2026-01-15.md",
	);
	assert.deepEqual(quickEntryTargets({ ...targetOptions, dailyNoteFolder: "" }, thursday).at(-1), "2026-01-15.md");
});

test("the daily note is named with its format, as the daily notes plugin names it", () => {
	const options = { ...targetOptions, dailyNoteFormat: "YYYY, MMMM DD - dddd" };
	assert.equal(quickEntryTargets(options, thursday).at(-1), "Daily/2026, January 15 - Thursday.md");
});

test("the daily note is named after the day it is where now is, not in UTC", () => {
	// 01:00 on the 16th at UTC+8 is still the 15th in UTC.
	const earlyMorningInShanghai = moment.parseZone("2026-01-16T01:00:00+08:00");
	assert.equal(quickEntryTargets(targetOptions, earlyMorningInShanghai).at(-1), "Daily/2026-01-16.md");
});

test("the inbox and the task files are offered as they are configured", () => {
	assert.deepEqual(quickEntryTargets({ ...targetOptions, taskFiles: ["Projects"], inbox: "Inbox" }, thursday), [
		"Projects",
		"Inbox",
		"Daily/2026-01-15.md",
	]);
});

test("an empty inbox or daily note format is left out, and a note offered twice is listed once", () => {
	assert.deepEqual(quickEntryTargets({ ...targetOptions, inbox: "", dailyNoteFormat: "" }, thursday), [
		"Projects.md",
	]);
	assert.deepEqual(quickEntryTargets({ ...targetOptions, taskFiles: ["Inbox.md", "Projects.md"] }, thursday), [
		"Inbox.md",
		"Projects.md",
		"Daily/2026-01-15.md",
	]);
});
