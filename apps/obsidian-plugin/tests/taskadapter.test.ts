import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import moment from "moment";
import { Notice } from "obsidian";

import { readTasks } from "../timeline/src/taskadapter";

const line = "- [ ] a task";

// readTasks reads the notes for packages/core: each note is parsed inside its own read, so a note that cannot be
// read or parsed drops only its own tasks.

interface FakeNote {
	content: string;
	frontmatter?: Record<string, unknown>;
}

/** An app whose notes each hold one task on their first line, with the given frontmatter. `read` lists the notes read. */
function coreApp(notes: Record<string, FakeNote>, failing: string[] = [], read: string[] = []) {
	const list = Object.keys(notes).map((path) => ({ path }));
	return {
		vault: {
			getMarkdownFiles: () => list,
			cachedRead: async (file: { path: string }) => {
				read.push(file.path);
				if (failing.includes(file.path)) throw new Error(`cannot read ${file.path}`);
				return notes[file.path].content;
			},
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const { content, frontmatter } = notes[file.path];
				const end = content.indexOf("\n") < 0 ? content.length : content.indexOf("\n");
				return {
					listItems: [
						{
							task: " ",
							parent: -1,
							position: {
								start: { line: 0, col: 0, offset: 0 },
								end: { line: 0, col: end, offset: end },
							},
						},
					],
					sections: [],
					links: [],
					tags: [],
					frontmatter,
				};
			},
		},
	} as never;
}

/** The stub of Notice keeps what it showed; the real type knows nothing of that. */
const shownNotices = (Notice as unknown as { shown: string[] }).shown;

const noFilters = {
	includePaths: [],
	excludePaths: [],
	fileIncludeTags: [],
	fileExcludeTags: [],
	excludeProperties: {},
};

test("readTasks parses every note, in path order, and shows no Notice when all went well", async () => {
	shownNotices.length = 0;
	const tasks = await readTasks(coreApp({ "b.md": { content: line }, "a.md": { content: line } }), noFilters, moment);
	assert.deepEqual(
		tasks.map((t) => t.path),
		["a.md", "b.md"],
	);
	assert.equal(tasks[0].visual, "a task");
	assert.deepEqual(shownNotices, []);
});

test("readTasks skips notes the note filters leave out, before reading them", async () => {
	const read: string[] = [];
	const tasks = await readTasks(
		coreApp({ "Excluded/x.md": { content: line }, "kept.md": { content: line } }, [], read),
		{ ...noFilters, excludePaths: ["Excluded"] },
		moment,
	);
	assert.deepEqual(
		tasks.map((t) => t.path),
		["kept.md"],
	);
	assert.deepEqual(read, ["kept.md"]);
});

test("a note whose frontmatter tags hold a number drops only that note, and says so", async (t) => {
	const errors = t.mock.method(console, "error", () => undefined);
	shownNotices.length = 0;
	const tasks = await readTasks(
		coreApp({
			"broken.md": { content: line, frontmatter: { tags: [2026] } },
			"good.md": { content: line, frontmatter: { tags: ["work"] } },
		}),
		noFilters,
		moment,
	);
	assert.deepEqual(
		tasks.map((t) => t.path),
		["good.md"],
	);
	assert.deepEqual(tasks[0].tags, ["#work"]);
	assert.equal(errors.mock.callCount(), 1);
	assert.deepEqual(shownNotices, [
		"Tasks Calendar Wrapper: 1 file(s) could not be read, their tasks are missing. See the developer console.",
	]);
});

test("a note that cannot be read drops only that note, and says so", async (t) => {
	t.mock.method(console, "error", () => undefined);
	shownNotices.length = 0;
	const tasks = await readTasks(
		coreApp({ "broken.md": { content: line }, "good.md": { content: line } }, ["broken.md"]),
		noFilters,
		moment,
	);
	assert.deepEqual(
		tasks.map((t) => t.path),
		["good.md"],
	);
	assert.equal(shownNotices.length, 1);
});
