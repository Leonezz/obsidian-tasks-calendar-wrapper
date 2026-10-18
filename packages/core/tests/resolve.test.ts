import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { parseTaskLine } from "../src/parse";
import type { Task } from "../src/task";
import { noteVisible, resolveTasks, type ResolveSettings } from "../src/resolve";
import { sortOptionLabels } from "../src/sort";

// Ported from the parse-based tests of the plugin's tests/sort.test.ts, plus what resolveTasks adds: the order the
// tasks come in, the note filters and the 24-hour option.

const TODAY = moment("2026-09-18", "YYYY-MM-DD");

function task(line: string, path = "Inbox.md"): Task {
	const parsed = parseTaskLine(line, { moment, path });
	assert.ok(parsed, `not a task line: ${line}`);
	return parsed;
}

const shownTexts = (tasks: Task[], settings: ResolveSettings) =>
	resolveTasks(tasks, { forward: true, ...settings }, { now: TODAY, moment }).shown.map((r) => r.visual);

const sortedTexts = (sort: string, lines: string[]) =>
	shownTexts(
		lines.map((line) => task(line)),
		{ sort },
	);

test("text sorting orders by task text in both directions", () => {
	const lines = ["- [ ] cherry", "- [ ] apple", "- [ ] banana"];
	assert.deepEqual(sortedTexts("text-asc", lines), ["apple", "banana", "cherry"]);
	assert.deepEqual(sortedTexts("text-desc", lines), ["cherry", "banana", "apple"]);
});

test("due date sorting puts undated tasks last in both directions", () => {
	const lines = ["- [ ] late 📅 2026-10-01", "- [ ] none", "- [ ] early 📅 2026-09-20"];
	assert.deepEqual(sortedTexts("due-asc", lines), ["early", "late", "none"]);
	assert.deepEqual(sortedTexts("due-desc", lines), ["late", "early", "none"]);
});

test("priority sorting runs from highest to lowest with no priority in the middle", () => {
	const lines = [
		"- [ ] low 🔽",
		"- [ ] highest 🔺",
		"- [ ] none",
		"- [ ] high ⏫",
		"- [ ] lowest ⏬",
		"- [ ] medium 🔼",
	];
	assert.deepEqual(sortedTexts("priority-desc", lines), ["highest", "high", "medium", "none", "low", "lowest"]);
	assert.deepEqual(sortedTexts("priority-asc", lines), ["lowest", "low", "none", "medium", "high", "highest"]);
});

test("status sorting follows the configured status order", () => {
	const tasks = ["- [ ] unplanned", "- [ ] due 📅 2026-09-18", "- [ ] overdue 📅 2026-09-01"].map((line) =>
		task(line),
	);
	const taskStatusOrder = ["overdue", "due", "unplanned"];
	assert.deepEqual(shownTexts(tasks, { sort: "status-asc", taskStatusOrder }), ["overdue", "due", "unplanned"]);
	assert.deepEqual(shownTexts(tasks, { sort: "status-desc", taskStatusOrder }), ["unplanned", "due", "overdue"]);
});

test("every sort keeps tasks it ranks equal in the order they come in", () => {
	const tasks = [task("- [ ] same text", "a.md"), task("- [ ] same text", "b.md")];
	for (const sort of [...Object.keys(sortOptionLabels), "no-such-sort"]) {
		const shown = resolveTasks(tasks, { sort }, { now: TODAY, moment }).shown;
		assert.deepEqual(
			shown.map((r) => r.task.path),
			["a.md", "b.md"],
			sort,
		);
	}
});

test("tasks come in path order, then line order, whatever order they are passed in", () => {
	const at = (path: string, line: number) => {
		const parsed = task("- [ ] t", path);
		return { ...parsed, line, id: `${path}:${line}` };
	};
	const shown = resolveTasks([at("b.md", 0), at("a.md", 5), at("a.md", 2)], {}, { now: TODAY, moment }).shown;
	assert.deepEqual(
		shown.map((r) => r.task.id),
		["a.md:2", "a.md:5", "b.md:0"],
	);
});

test("text sorting compares the text shown, after the 24-hour option", () => {
	const tasks = [task("- [ ] 09:30 a 📅 2026-09-01"), task("- [ ] 14:00 b 📅 2026-09-01")];
	const sorted = (convert24HourTimePrefix: boolean) =>
		resolveTasks(
			tasks,
			{ forward: true, sort: "text-asc", convert24HourTimePrefix },
			{ now: TODAY, moment },
		).shown.map((r) => r.visual);
	assert.deepEqual(sorted(false), ["09:30 a", "14:00 b"]);
	assert.deepEqual(sorted(true), ["2:00 pm b", "9:30 am a"]);
});

test("resolving gives new values and leaves the tasks passed in as they were", () => {
	const tasks = [task("- [ ] 14:00 call 📅 2026-09-01")];
	const before = JSON.stringify(tasks);
	const [resolved] = resolveTasks(
		tasks,
		{ forward: true, convert24HourTimePrefix: true },
		{ now: TODAY, moment },
	).shown;
	assert.equal(resolved.visual, "2:00 pm call");
	assert.equal(resolved.task.visual, "14:00 call");
	assert.equal(JSON.stringify(tasks), before);
	assert.ok(Object.isFrozen(resolved));
});

// The note filters of the settings: paths, the note's own tags and its frontmatter properties

const note = (path: string, tags: string[] = [], frontmatter: Record<string, unknown> = {}) => ({
	path,
	tags,
	frontmatter,
});

test("an included folder keeps the notes in it, and a trailing slash includes nothing", () => {
	assert.ok(noteVisible(note("Daily/2026-01-15.md"), { includePaths: ["Daily"] }));
	assert.ok(!noteVisible(note("Inbox.md"), { includePaths: ["Daily"] }));
	assert.ok(!noteVisible(note("Daily/2026-01-15.md"), { includePaths: ["Daily/"] }));
});

test("an excluded folder or note drops it, and the root excludes nothing", () => {
	assert.ok(!noteVisible(note("Excluded/Secret.md"), { excludePaths: ["Excluded"] }));
	assert.ok(!noteVisible(note("Big note.md"), { excludePaths: ["Big note.md"] }));
	assert.ok(noteVisible(note("Excluded/Secret.md"), { excludePaths: ["/"] }));
});

test("note tags and properties include or exclude a note", () => {
	assert.ok(noteVisible(note("a.md", ["#project"]), { fileIncludeTags: ["#project"] }));
	assert.ok(!noteVisible(note("a.md"), { fileIncludeTags: ["#project"] }));
	assert.ok(!noteVisible(note("a.md", ["#project"]), { fileExcludeTags: ["#project"] }));
	assert.ok(!noteVisible(note("a.md", [], { status: "archived" }), { excludeProperties: { status: ["archived"] } }));
	assert.ok(noteVisible(note("a.md", [], { status: "active" }), { excludeProperties: { status: ["archived"] } }));
});

test("resolving drops the tasks of notes the filters leave out", () => {
	const tasks = [task("- [ ] secret", "Excluded/Secret.md"), task("- [ ] kept", "Inbox.md")];
	assert.deepEqual(shownTexts(tasks, { excludePaths: ["Excluded"] }), ["kept"]);
});

// Branches of resolveTasks the snapshots do not reach; each expectation is what the plugin's parser chain gives.

test("an open task whose only date is a done date is scheduled, not unplanned", () => {
	const [resolved] = resolveTasks([task("- [ ] a ✅ 2026-01-10")], {}, { now: TODAY, moment }).shown;
	assert.equal(resolved.status, "scheduled");
});

test("a task in a daily note with only an extra date keeps its own dates", () => {
	const settings = { dailyNoteFormat: "YYYY-MM-DD" };
	const [resolved] = resolveTasks([task("- [ ] a [unplanned:: 2026-09-20]", "Journal/2026-09-15.md")], settings, {
		now: TODAY,
		moment,
	}).shown;
	assert.ok(resolved.dailyNote);
	assert.equal(resolved.dates.start, undefined);
	assert.equal(resolved.dates.scheduled, undefined);
});

test("without a daily note format, notes named YYYY-MM-DD are daily notes", () => {
	const [resolved] = resolveTasks([task("- [ ] a", "Journal/2026-09-15.md")], {}, { now: TODAY, moment }).shown;
	assert.ok(resolved.dailyNote);
	assert.equal(resolved.dates.scheduled?.format("YYYY-MM-DD"), "2026-09-15");
	// Strictly YYYY-MM-DD: a name moment would read without a format is not a daily note.
	assert.ok(!resolveTasks([task("- [ ] a", "Journal/20260915.md")], {}, { now: TODAY, moment }).shown[0].dailyNote);
});

test("a status the status order does not name sorts first, with order 0", () => {
	const tasks = [task("- [ ] due 📅 2026-09-18"), task("- [ ] unplanned")];
	const shown = resolveTasks(tasks, { sort: "status-asc", taskStatusOrder: ["due"] }, { now: TODAY, moment }).shown;
	assert.deepEqual(
		shown.map((r) => [r.visual, r.order]),
		[
			["unplanned", 0],
			["due", 1],
		],
	);
});

test("the result names today's day", () => {
	assert.equal(resolveTasks([], {}, { now: TODAY, moment }).today, "2026-09-18");
});

test("the task filters only apply when they are turned on", () => {
	const tagged = [task("- [ ] a #work")];
	assert.equal(
		resolveTasks(tagged, { useIncludeTags: false, taskIncludeTags: ["#home"] }, { now: TODAY, moment }).shown
			.length,
		1,
	);
	assert.equal(
		resolveTasks(tagged, { useExcludeTags: false, taskExcludeTags: ["#work"] }, { now: TODAY, moment }).shown
			.length,
		1,
	);
	assert.equal(
		resolveTasks(tagged, { useExcludeTags: true, taskExcludeTags: ["#work"] }, { now: TODAY, moment }).shown.length,
		0,
	);
});

test("hiding a marker hides the tasks with it, also a marker that sets no status", () => {
	const tasks = [task("- [ ] open"), task("- [X] capital x"), task("- [x] done")];
	const shownWith = (hideStatusTasks: string[]) =>
		resolveTasks(tasks, { hideStatusTasks }, { now: TODAY, moment }).shown.map((r) => r.visual);
	assert.deepEqual(shownWith([" ", "X"]), ["done"]);
	assert.deepEqual(shownWith(["x"]), ["open", "capital x"]);
});

test("note tag filters need one included tag and none of the excluded ones", () => {
	const settings = { fileIncludeTags: ["#a", "#b"], fileExcludeTags: ["#x", "#y"] };
	assert.ok(noteVisible(note("n.md", ["#b"]), settings));
	assert.ok(!noteVisible(note("n.md", ["#c"]), settings));
	assert.ok(!noteVisible(note("n.md", ["#b", "#y"]), settings));
});

test("everything resolveTasks returns is frozen, the daily note's dates included", () => {
	const tasks = [task("- [ ] a", "Journal/2026-09-15.md"), task("- [ ] b 📅 2026-09-20")];
	const resolved = resolveTasks(tasks, { dailyNoteFormat: "YYYY-MM-DD" }, { now: TODAY, moment });
	assert.ok(Object.isFrozen(resolved) && Object.isFrozen(resolved.shown));
	for (const r of resolved.shown)
		assert.ok(Object.isFrozen(r) && Object.isFrozen(r.dates) && Object.isFrozen(r.extraDates));
	assert.ok(resolved.shown.some((r) => r.dailyNote));
});
