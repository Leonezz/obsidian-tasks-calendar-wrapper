import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import moment from "moment";
import { Notice } from "obsidian";

import { readTasks, reportNoteReads } from "../timeline/src/taskadapter";

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

/**
 * What the plugin tells the user while the test runs: its console lines, each with what it was called with, in order.
 * moment warns once, the first time it reads a date it does not know the format of; that line is left out.
 */
function ourLines(t: TestContext): unknown[][] {
	const told: unknown[][] = [];
	const keep =
		(kind: string) =>
		(...args: unknown[]) => {
			if (String(args[0]).startsWith("Tasks Calendar Wrapper")) told.push([kind, ...args]);
		};
	t.mock.method(console, "warn", keep("warn"));
	t.mock.method(console, "error", keep("error"));
	return told;
}

/** The two warnings, of a.md and c.md, as readTasks writes them. */
const dateWarnings = [
	'Tasks Calendar Wrapper: a.md, line 1: could not read the date " soon" of [due:: ]',
	'Tasks Calendar Wrapper: c.md, line 1: could not read the date " later" of [due:: ]',
];

const twoFailed =
	"Tasks Calendar Wrapper: 2 file(s) could not be read, their tasks are missing. See the developer console.";

test("readTasks warns about every note's dates first, then reports each failed read, then shows one Notice", async (t) => {
	const told = ourLines(t);
	shownNotices.length = 0;
	// Listed out of order, and the failed notes between the ones with warnings, so only the order of the calls is left.
	const app = coreApp({
		"d.md": { content: line },
		"c.md": { content: "- [ ] water the plants [due:: later]" },
		"b.md": { content: line },
		"a.md": { content: "- [ ] pay the rent [due:: soon]" },
	}) as unknown as { vault: { cachedRead(file: { path: string }): Promise<string> } };
	const reasons: Record<string, Error> = { "b.md": new Error("b.md is locked"), "d.md": new Error("d.md is gone") };
	const read = app.vault.cachedRead;
	app.vault.cachedRead = async (file) => {
		if (file.path in reasons) throw reasons[file.path];
		return read(file);
	};
	const tasks = await readTasks(app as never, noFilters, moment);
	assert.deepEqual(
		tasks.map((task) => task.path),
		["a.md", "c.md"],
	);
	assert.equal(told.length, 4);
	assert.deepEqual(told.slice(0, 2), [
		["warn", dateWarnings[0]],
		["warn", dateWarnings[1]],
	]);
	// Each failure is logged with the very object the read threw.
	assert.deepEqual(
		told.slice(2).map(([kind, message]) => [kind, message]),
		[
			["error", "Tasks Calendar Wrapper: reading a file failed"],
			["error", "Tasks Calendar Wrapper: reading a file failed"],
		],
	);
	assert.equal(told[2][2], reasons["b.md"]);
	assert.equal(told[3][2], reasons["d.md"]);
	assert.equal(told[2].length, 3);
	assert.equal(told[3].length, 3);
	assert.deepEqual(shownNotices, [twoFailed]);
});

// reportNoteReads is what readTasks tells the user, taken out so the task index's caller can tell the same.

const warning = (path: string, message: string) => ({ path, line: 0, message });

test("reportNoteReads with nothing to report logs nothing and shows no Notice", (t) => {
	const told = ourLines(t);
	shownNotices.length = 0;
	reportNoteReads([], []);
	assert.deepEqual(told, []);
	assert.deepEqual(shownNotices, []);
});

test("reportNoteReads with warnings only warns about each, in the order given, and shows no Notice", (t) => {
	const told = ourLines(t);
	shownNotices.length = 0;
	reportNoteReads([warning("b.md", "second"), warning("a.md", "first")], []);
	assert.deepEqual(told, [
		["warn", "Tasks Calendar Wrapper: b.md, line 1: second"],
		["warn", "Tasks Calendar Wrapper: a.md, line 1: first"],
	]);
	assert.deepEqual(shownNotices, []);
});

test("reportNoteReads logs each failure with its reason after the warnings, then shows one Notice with the count", (t) => {
	const told = ourLines(t);
	shownNotices.length = 0;
	const reasons = [new Error("x.md is locked"), "y.md is gone"];
	reportNoteReads(
		[warning("a.md", "a warning")],
		[
			{ path: "x.md", reason: reasons[0] },
			{ path: "y.md", reason: reasons[1] },
		],
	);
	assert.deepEqual(told, [
		["warn", "Tasks Calendar Wrapper: a.md, line 1: a warning"],
		["error", "Tasks Calendar Wrapper: reading a file failed", reasons[0]],
		["error", "Tasks Calendar Wrapper: reading a file failed", reasons[1]],
	]);
	assert.equal(told[1][2], reasons[0], "the reason object itself, not a copy");
	assert.deepEqual(shownNotices, [twoFailed]);
});

test("a note with too many tasks to hand on at once fails the reload, after the warnings of the notes before it", async (t) => {
	const count = 300_000;
	// The reload fails because spreading this many tasks into a call overflows; check that it does on this Node.
	assert.throws(() => [].push(...(new Array(count) as never[])), RangeError);
	const warned = t.mock.method(console, "warn", () => {});
	const item = (line: number, length: number) => ({
		task: " ",
		parent: -1,
		position: { start: { line, col: 0, offset: line * 8 }, end: { line, col: length, offset: line * 8 + length } },
	});
	const notes: Record<string, { content: string; listItems: object[] }> = {
		"a.md": { content: "- [ ] pay [due:: soon]", listItems: [item(0, 22)] },
		"z.md": {
			content: Array.from({ length: count }, () => "- [ ] t").join("\n"),
			listItems: Array.from({ length: count }, (_, line) => item(line, 7)),
		},
	};
	const app = {
		vault: {
			getMarkdownFiles: () => Object.keys(notes).map((path) => ({ path })),
			cachedRead: async (file: { path: string }) => notes[file.path].content,
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => ({
				listItems: notes[file.path].listItems,
				sections: [],
				links: [],
				tags: [],
			}),
		},
	} as never;
	await assert.rejects(readTasks(app, {}, moment), RangeError);
	const told = warned.mock.calls.map((call) => String(call.arguments[0]));
	assert.equal(told.length, 1);
	assert.match(told[0], /^Tasks Calendar Wrapper: a\.md, line 1: /);
});
