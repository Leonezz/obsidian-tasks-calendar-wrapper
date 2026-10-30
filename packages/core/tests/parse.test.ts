import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/zh-cn";

import { sameDay, type DateValue } from "../src/dates";
import { hasTaskItems, parseNote, parseTaskLine } from "../src/parse";
import type { NoteSnapshot, Task } from "../src/task";
import { resolveTasks, type ResolveSettings, type ResolvedTask } from "../src/resolve";
import { TaskStatus } from "../src/status";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// Ported from the plugin's tests/taskmapable.test.ts. Those ran the legacy parser chain with the forward option on
// and the status taken from the real clock; here the same tasks go through parseTaskLine and resolveTasks with
// `now` given, so the results do not depend on the day the tests run.

const TODAY = moment("2026-09-18", "YYYY-MM-DD");

function task(line: string, path = "Inbox.md", col = 0): Task {
	const parsed = parseTaskLine(line, { moment, path, col });
	assert.ok(parsed, `not a task line: ${line}`);
	return parsed;
}

/** One task line, parsed and resolved as the timeline does with the forward option on. */
function resolve(line: string, settings: ResolveSettings = {}, path = "Inbox.md"): ResolvedTask {
	const shown = resolveTasks(
		[task(line, path)],
		{ forward: true, dailyNoteFormat: "YYYY-MM-DD", ...settings },
		{ now: TODAY, moment },
	).shown;
	assert.equal(shown.length, 1);
	return shown[0];
}

/** Whether the timeline lists the task on a day: any of its dates, or today when it is forwarded. */
function isShownOn(resolved: ResolvedTask, day: DateValue): boolean {
	const dates = [
		...Object.values(resolved.dates),
		...resolved.extraDates.map(([, date]) => date),
		...(resolved.forwarded ? [TODAY] : []),
	];
	return dates.some((date) => date !== undefined && sameDay(day, date));
}

const day = (text: string) => moment(text, "YYYY-MM-DD", true);
const ymd = (date: DateValue | undefined) => date?.format("YYYY-MM-DD");

// Issue #155: priority followed by unknown or trailing content

test("priority is parsed when followed by a created date", () => {
	const resolved = resolve("- [ ] A TASK ⏫ ➕ 2026-09-14");
	assert.equal(resolved.task.priority, "High");
	assert.equal(resolved.visual, "A TASK");
});

test("priority is parsed when followed by trailing free text", () => {
	const resolved = resolve("- [ ] A TASK ⏫ 📅 2026-09-18 to continue");
	assert.equal(resolved.task.priority, "High");
	assert.equal(ymd(resolved.dates.due), "2026-09-18");
	assert.match(resolved.visual, /^A TASK\s+to continue$/);
});

test("priority at the end of the line still works", () => {
	const resolved = resolve("- [ ] A TASK 📅 2026-09-18 🔼");
	assert.equal(resolved.task.priority, "Medium");
	assert.equal(resolved.visual, "A TASK");
});

test("task without a priority keeps an empty priority", () => {
	const resolved = resolve("- [ ] plain task");
	assert.equal(resolved.task.priority, "");
	assert.equal(resolved.visual, "plain task");
});

// Issue #129: in-progress and scheduled markers without any date

test("undated in-progress task stays in-progress and is shown today", () => {
	const resolved = resolve("- [/] Work In Process");
	assert.equal(resolved.status, TaskStatus.process);
	assert.ok(isShownOn(resolved, TODAY), "task should be placed on today");
});

test("undated scheduled-marker task stays scheduled and is shown today", () => {
	const resolved = resolve("- [<] Scheduled");
	assert.equal(resolved.status, TaskStatus.scheduled);
	assert.ok(isShownOn(resolved, TODAY), "task should be placed on today");
});

test("dated in-progress task is not moved to today", () => {
	const resolved = resolve("- [/] Work In Process 📅 2099-01-01");
	assert.equal(resolved.status, TaskStatus.process);
	assert.equal(resolved.forwarded, undefined);
	assert.ok(!isShownOn(resolved, TODAY));
	assert.ok(isShownOn(resolved, day("2099-01-01")));
});

test("undated open task is still unplanned and shown today", () => {
	const resolved = resolve("- [ ] Unplanned");
	assert.equal(resolved.status, TaskStatus.unplanned);
	assert.ok(isShownOn(resolved, TODAY));
});

// Issue #66: an undated cancelled task had no date to be shown on, even when cancelled tasks were not hidden
test("undated cancelled task is shown today, like an undated done task", () => {
	const resolved = resolve("- [-] Cancelled");
	assert.equal(resolved.status, TaskStatus.cancelled);
	assert.ok(isShownOn(resolved, TODAY));
});

test("undated done task is shown today unless forwardUndatedDone is off", () => {
	assert.ok(isShownOn(resolve("- [x] Done"), TODAY));
	const resolved = resolve("- [x] Done", { forwardUndatedDone: false });
	assert.equal(resolved.status, TaskStatus.done);
	assert.equal(resolved.forwarded, undefined);
	assert.ok(!isShownOn(resolved, TODAY));
});

test("forwardUndatedDone off leaves a done task with a date on that date", () => {
	const resolved = resolve("- [x] Done ✅ 2026-09-10", { forwardUndatedDone: false });
	assert.ok(isShownOn(resolved, day("2026-09-10")));
});

test("a dated cancelled task stays on its own date", () => {
	const resolved = resolve("- [-] Cancelled 📅 2026-09-10");
	assert.equal(resolved.status, TaskStatus.cancelled);
	assert.ok(!isShownOn(resolved, TODAY));
	assert.ok(isShownOn(resolved, day("2026-09-10")));
});

// Issue #105, #140: a well formed but non-existent date must not break the view

test("an impossible calendar date is ignored instead of becoming an invalid date", () => {
	const resolved = resolve("- [ ] Broken due date 📅 2024-02-31");
	assert.equal(resolved.dates.due, undefined);
	assert.equal(resolved.visual, "Broken due date");
});

test("a leap day is still parsed", () => {
	assert.equal(ymd(resolve("- [ ] Leap day 📅 2024-02-29").dates.due), "2024-02-29");
});

test("impossible start, scheduled and done dates are ignored", () => {
	const resolved = resolve("- [x] All broken 🛫 2024-13-01 ⏳ 2024-04-31 ✅ 2024-02-30");
	assert.equal(resolved.dates.start, undefined);
	assert.equal(resolved.dates.scheduled, undefined);
	assert.equal(resolved.dates.completion, undefined);
	assert.equal(resolved.visual, "All broken");
});

// Issue #125, #100: markdown comments must not be shown

test("a markdown comment is removed from the task text", () => {
	assert.equal(resolve("- [ ] Write docs %%private note%%").visual, "Write docs");
});

test("a comment wrapping an inline field leaves no comment markers behind", () => {
	assert.equal(resolve("- [ ] Sync task %%[ticktick_id:: 665850a0]%%").visual, "Sync task");
});

test("an inline field outside a comment is still parsed", () => {
	const resolved = resolve("- [ ] Field task [due:: 2026-09-20] %%hidden%%");
	assert.equal(ymd(resolved.dates.due), "2026-09-20");
	assert.equal(resolved.visual, "Field task");
});

test("a date inside a comment is not treated as a task date", () => {
	const resolved = resolve("- [ ] Commented date %%📅 2026-09-20%%");
	assert.equal(resolved.dates.due, undefined);
	assert.equal(resolved.visual, "Commented date");
});

// Issue #102: dataview style priority

test("dataview priority field is read", () => {
	const resolved = resolve("- [ ] Dataview priority [priority:: high]");
	assert.equal(resolved.task.priority, "High");
	assert.equal(resolved.visual, "Dataview priority");
});

test("dataview priority is case insensitive and covers every level", () => {
	const levels: [string, string][] = [
		["Highest", "Highest"],
		["HIGH", "High"],
		["medium", "Medium"],
		["low", "Low"],
		["lowest", "Lowest"],
		["none", "No"],
	];
	for (const [value, label] of levels) {
		assert.equal(resolve(`- [ ] Task [priority:: ${value}]`).task.priority, label, `priority:: ${value}`);
	}
});

test("an unknown dataview priority value is ignored", () => {
	assert.equal(resolve("- [ ] Task [priority:: urgent]").task.priority, "");
});

test("the emoji priority still wins over nothing", () => {
	assert.equal(resolve("- [ ] Task ⏫").task.priority, "High");
});

// Issue #84: tasks whose start or scheduled date has passed can be forwarded too

const resolveForwarded = (line: string) => resolve(line, { forwardPastStartAndScheduled: true });

test("a task started in the past is shown today when the option is on", () => {
	const resolved = resolveForwarded("- [ ] started earlier 🛫 2026-09-10");
	assert.equal(resolved.status, TaskStatus.process);
	assert.ok(isShownOn(resolved, TODAY), "should be placed on today");
	assert.ok(isShownOn(resolved, day("2026-09-10")), "should stay on its own date");
});

test("a task scheduled in the past is shown today when the option is on", () => {
	const resolved = resolveForwarded("- [ ] scheduled earlier ⏳ 2026-09-10");
	assert.equal(resolved.status, TaskStatus.start);
	assert.ok(isShownOn(resolved, TODAY));
});

test("a task starting in the future is left alone", () => {
	assert.ok(!isShownOn(resolveForwarded("- [ ] starts later 🛫 2099-01-01"), TODAY));
});

test("the option does not change tasks that are already due", () => {
	assert.equal(resolveForwarded("- [ ] due today 📅 2026-09-18").forwarded, undefined);
});

test("without the option a task started in the past stays on its own date", () => {
	assert.ok(!isShownOn(resolve("- [ ] started earlier 🛫 2026-09-10"), TODAY));
});

// Issue #61: nested task items can be hidden

test("nested tasks are dropped when subtasks are hidden", () => {
	const tasks = [task("- [ ] top level"), task("  - [ ] nested", "Inbox.md", 2)];
	const shown = resolveTasks(tasks, { hideSubTasks: true }, { now: TODAY, moment }).shown;
	assert.deepEqual(
		shown.map((r) => r.visual),
		["top level"],
	);
});

test("nested tasks are kept when the option is off", () => {
	const tasks = [task("- [ ] top level"), task("  - [ ] nested", "Inbox.md", 2)];
	assert.equal(resolveTasks(tasks, { hideSubTasks: false }, { now: TODAY, moment }).shown.length, 2);
});

// Issue #114, #118: a task in a daily note was shown on the note's date and on its own date

const DAILY_NOTE = "Journal/2026-09-15.md";
const NOTE_DAY = day("2026-09-15");
const resolveInNote = (line: string) => resolve(line, {}, DAILY_NOTE);

test("a dated task in a daily note is shown on its own date only", () => {
	const resolved = resolveInNote("- [ ] pay rent 📅 2026-09-30");
	assert.ok(isShownOn(resolved, day("2026-09-30")));
	assert.ok(!isShownOn(resolved, NOTE_DAY), "should not also appear on the daily note's date");
	assert.equal(resolved.dates.start, undefined);
	assert.equal(resolved.dates.scheduled, undefined);
});

test("an undated task in a daily note still takes the note's date", () => {
	const resolved = resolveInNote("- [ ] undated note task");
	assert.ok(resolved.dailyNote);
	assert.equal(ymd(resolved.dates.scheduled), "2026-09-15");
	assert.ok(isShownOn(resolved, NOTE_DAY));
});

test("a done task in a daily note is shown on its completion date only", () => {
	const resolved = resolveInNote("- [x] finished ✅ 2026-09-16");
	assert.ok(isShownOn(resolved, day("2026-09-16")));
	assert.ok(!isShownOn(resolved, NOTE_DAY));
});

// Dataview style dates that were dropped or misread

test("a dataview start date is read as the start date", () => {
	const resolved = resolve("- [ ] started [start:: 2026-09-10]");
	assert.equal(ymd(resolved.dates.start), "2026-09-10");
	assert.equal(resolved.status, TaskStatus.process);
	assert.equal(resolved.visual, "started");
});

test("a dataview completion date is read as the done date", () => {
	const resolved = resolve("- [x] finished [completion:: 2026-09-17]");
	assert.equal(ymd(resolved.dates.completion), "2026-09-17");
	assert.ok(isShownOn(resolved, day("2026-09-17")));
});

test("a dataview created date is removed from the text without becoming the start date", () => {
	const resolved = resolve("- [ ] noted [created:: 2026-09-01]");
	assert.equal(resolved.visual, "noted");
	assert.equal(resolved.dates.start, undefined);
	assert.ok(!isShownOn(resolved, day("2026-09-01")));
});

// Issue #95: a daily note format with folders, such as YYYY/MMM/Wo/ddd, was never recognised,
// because only the file name was compared with the format

const dailyNote = (format: string, path: string) => resolve("- [ ] diary task", { dailyNoteFormat: format }, path);

test("a daily note format with folders is recognised", () => {
	const resolved = dailyNote("YYYY/MM/DD", "2024/01/22.md");
	assert.ok(resolved.dailyNote);
	assert.equal(ymd(resolved.dates.scheduled), "2024-01-22");
});

test("a daily note format with folders is recognised below a daily notes folder", () => {
	const resolved = dailyNote("YYYY/MM/DD", "Journal/2024/01/22.md");
	assert.ok(resolved.dailyNote);
	assert.equal(ymd(resolved.dates.scheduled), "2024-01-22");
});

test("a localised daily note format with folders is recognised", () => {
	const previous = moment.locale();
	try {
		moment.locale("zh-cn");
		const resolved = dailyNote("YYYY/MMM/Wo/ddd", "2024/1月/4周/周一.md");
		assert.ok(resolved.dailyNote);
		assert.equal(ymd(resolved.dates.scheduled), "2024-01-22");
		// The last days of December can fall in week 1 of the next year.
		assert.equal(ymd(dailyNote("YYYY/MMM/Wo/ddd", "2024/12月/1周/周一.md").dates.scheduled), "2024-12-30");
	} finally {
		moment.locale(previous);
	}
});

test("a note that only partly matches a folder format is not a daily note", () => {
	assert.ok(!dailyNote("YYYY/MM/DD", "Projects/notes/22.md").dailyNote);
});

test("a flat daily note format still matches the file name inside any folder", () => {
	assert.ok(dailyNote("YYYY-MM-DD", "Journal/2024-01-22.md").dailyNote);
});

// What parseNote keeps of a note beyond what the snapshots pin

const position = (line: number, col: number, offset: number, endCol: number) => ({
	start: { line, col, offset },
	end: { line, col: endCol, offset: offset - col + endCol },
});

function snapshot(
	content: string,
	items: [line: number, col: number][],
	frontmatter?: Record<string, unknown>,
): NoteSnapshot {
	const lines = content.split("\n");
	const offsetOf = (line: number) => lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
	return {
		path: "Note.md",
		content,
		metadata: {
			listItems: items.map(([line, col]) => ({
				task: " ",
				parent: -1,
				position: position(line, col, offsetOf(line) + col, lines[line].replace(/\r$/, "").length),
			})),
			frontmatter,
		},
	};
}

test("a task keeps its whole first line, indentation and quote marks included, without the line ending", () => {
	const content = "- [ ] top\r\n    - [ ] nested\r\n> - [ ] quoted";
	const tasks = parseNote(
		snapshot(content, [
			[0, 0],
			[1, 4],
			[2, 2],
		]),
		moment,
	).tasks;
	assert.deepEqual(
		tasks.map((t) => t.sourceLine),
		["- [ ] top", "    - [ ] nested", "> - [ ] quoted"],
	);
});

test("frontmatter tags are added to every task of the note, a # prefix where it is missing", () => {
	const tasks = parseNote(
		snapshot(
			"- [ ] one\n- [ ] two #local",
			[
				[0, 0],
				[1, 0],
			],
			{ tag: "single", tags: ["work", "plan"] },
		),
		moment,
	).tasks;
	assert.deepEqual(
		tasks.map((t) => t.tags),
		[
			["#single", "#work", "#plan"],
			["#single", "#work", "#plan", "#local"],
		],
	);
});

test("a frontmatter tag that already starts with # becomes an empty tag, as before", () => {
	// A known quirk of the legacy parser, kept until it is fixed on purpose.
	assert.deepEqual(parseNote(snapshot("- [ ] one", [[0, 0]], { tags: ["#hashed"] }), moment).tasks[0].tags, [""]);
});

test("frontmatter tags that are not a list of text make the note fail to parse, but only once it has a task", () => {
	assert.throws(() => parseNote(snapshot("- [ ] one", [[0, 0]], { tags: [2026] }), moment), /tags/);
	assert.throws(() => parseNote(snapshot("- [ ] one", [[0, 0]], { tags: { work: true } }), moment), /tags/);
	assert.deepEqual(parseNote(snapshot("no tasks here", [], { tags: [2026] }), moment).tasks, []);
});

test("a task, its note and their lists cannot be changed, and the metadata passed in stays as it was", () => {
	const frontmatter = { tags: ["work"], nested: { list: [1, 2] } };
	const note = snapshot("- [ ] one 📅 2026-09-20", [[0, 0]], frontmatter);
	const [parsed] = parseNote(note, moment).tasks;
	for (const container of [
		parsed,
		parsed.note,
		parsed.note.frontmatter,
		parsed.note.tags,
		parsed.tags,
		parsed.dates,
		parsed.position,
		parsed.position.start,
		parsed.section,
		parsed.outlinks,
		parsed.extraDates,
	]) {
		assert.ok(Object.isFrozen(container));
	}
	assert.ok(
		!Object.isFrozen(frontmatter) &&
			!Object.isFrozen(frontmatter.nested) &&
			!Object.isFrozen(note.metadata!.listItems![0].position),
	);
});

test("an inline date that moment cannot read is a warning, not an error", () => {
	const previous = moment.suppressDeprecationWarnings;
	moment.suppressDeprecationWarnings = true;
	try {
		const parsed = parseNote(snapshot("- [ ] call [due:: someday]", [[0, 0]]), moment);
		assert.equal(parsed.tasks.length, 1);
		assert.equal(parsed.tasks[0].dates.due, undefined);
		assert.equal(parsed.warnings.length, 1);
		assert.match(parsed.warnings[0].message, /someday/);
	} finally {
		moment.suppressDeprecationWarnings = previous;
	}
});

test("[priority:: __proto__] does not freeze Object.prototype", () => {
	// The lookup gives Object.prototype as the priority, as the plugin's parser always did; it must stay unfrozen.
	const parsed = task("- [ ] pay rent [priority:: __proto__]");
	assert.ok(Object.isFrozen(parsed));
	assert.ok(!Object.isFrozen(Object.prototype));
	assert.ok(!Object.isFrozen(Array.prototype));
});

// Details of the text and tags the snapshots do not reach; each expectation is what the plugin's parser chain gives.

test("hashtags are taken out after the inline fields, so a hashtag inside a field goes with the field", () => {
	const parsed = task("- [ ] call [note:: see #x]");
	assert.equal(parsed.visual, "call");
	assert.deepEqual(parsed.tags, []);
});

test("taking out a leading hashtag leaves the space after it", () => {
	const parsed = task("- [ ] #work call Bob");
	assert.equal(parsed.visual, " call Bob");
	assert.deepEqual(parsed.tags, ["#work"]);
});

test("the recurrence is trimmed when a tag follows it", () => {
	assert.equal(task("- [ ] water 🔁 every week #home").recurrence, "every week");
});

test("a frontmatter tag that is not text, and tags that are text or null, add no tags", () => {
	const tagsOf = (frontmatter: Record<string, unknown>) =>
		parseNote(snapshot("- [ ] one", [[0, 0]], frontmatter), moment).tasks[0].tags;
	assert.deepEqual(tagsOf({ tag: 7, tags: "work" }), []);
	assert.deepEqual(tagsOf({ tags: null }), []);
	assert.deepEqual(tagsOf({ tag: "#done" }), ["#done"]);
});

test("a tag both on the line and in the frontmatter is listed once, in the line's place", () => {
	const content = "- [ ] one #work";
	const note: NoteSnapshot = {
		path: "Note.md",
		content,
		metadata: {
			listItems: [{ task: " ", parent: -1, position: position(0, 0, 0, content.length) }],
			tags: [
				{ tag: "#work", position: position(0, 10, 10, 15) },
				{ tag: "#work", position: position(0, 10, 10, 15) },
			],
			frontmatter: { tags: ["plan", "work"] },
		},
	};
	// The line's and the frontmatter's tags are de-duplicated; the hashtag taken from the text is added again.
	assert.deepEqual(parseNote(note, moment).tasks[0].tags, ["#work", "#plan", "#work"]);
});

test("everything parseNote returns is frozen, for a note without tasks too", () => {
	const parsed = parseNote(snapshot("- [ ] one [due:: someday]", [[0, 0]]), moment);
	for (const value of [
		parsed,
		parsed.tasks,
		parsed.warnings,
		parsed.note,
		parsed.note.frontmatter,
		parsed.note.tags,
	]) {
		assert.ok(Object.isFrozen(value));
	}
	const empty = parseNote({ path: "Empty.md", content: "text", metadata: { frontmatter: { a: 1 } } }, moment);
	assert.ok(Object.isFrozen(empty.note) && Object.isFrozen(empty.note.frontmatter) && Object.isFrozen(empty.tasks));
});

test("hasTaskItems says whether parseNote can make a task: a list item with a status character", () => {
	const content = "- [ ] a task [due:: someday]";
	const item = (task?: string) => ({
		...(task === undefined ? {} : { task }),
		parent: -1,
		position: position(0, 0, 0, content.length),
	});
	const cases: [NoteSnapshot["metadata"], boolean][] = [
		[null, false],
		[undefined, false],
		[{}, false],
		[{ listItems: [] }, false],
		[{ listItems: [item()] }, false],
		[{ listItems: [item("")] }, false],
		[{ listItems: [item(), item(" ")] }, true],
		[{ listItems: [item("x")] }, true],
		[{ listItems: [item("/")] }, true],
	];
	for (const [metadata, expected] of cases) {
		assert.equal(hasTaskItems(metadata), expected, JSON.stringify(metadata));
		// A note without one gives no task and no warning, whatever its text: there is nothing to read it for.
		const parsed = parseNote({ path: "Note.md", content, metadata }, moment);
		if (!expected)
			assert.deepEqual([parsed.tasks.length, parsed.warnings.length], [0, 0], JSON.stringify(metadata));
		else assert.equal(parsed.tasks.length, 1, JSON.stringify(metadata));
	}
});
