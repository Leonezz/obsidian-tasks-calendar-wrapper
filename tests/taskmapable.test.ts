import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { Link } from "../dataview-util/markdown";
import { ObsidianTaskAdapter } from "../Obsidian-Tasks-Timeline/src/taskadapter";
import * as TaskMapable from "../utils/taskmapable";
import { TaskDataModel, TaskStatus } from "../utils/tasks";

const TODAY = moment("2026-09-18", "YYYY-MM-DD");
const FILE = "Inbox.md";

type LineParser = (
    line: string, filePath: string, parent: Link, position: unknown,
    outLinks: Link[], frontMatter: undefined, tags: string[],
) => TaskDataModel | null;

function makeTask(line: string): TaskDataModel {
    const adapter = new ObsidianTaskAdapter({} as never);
    const fromLine = (adapter as unknown as { fromLine: LineParser }).fromLine;
    const position = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: line.length, offset: line.length } };
    const task = fromLine(line, FILE, Link.file(FILE), position, [], undefined, []);
    if (!task) throw new Error(`not a task line: ${line}`);
    return task;
}

/** Runs the same parser chain as TasksTimelineView.parseTasks with the forward option on. */
async function parse(line: string): Promise<TaskDataModel> {
    const chain = [
        TaskMapable.tasksPluginTaskParser,
        TaskMapable.dataviewTaskParser,
        TaskMapable.dailyNoteTaskParser(),
        TaskMapable.tagsParser,
        TaskMapable.remainderParser,
        TaskMapable.postProcessor,
        TaskMapable.forwardParser(TODAY),
    ];
    return chain.reduce((acc, step) => step(acc), Promise.resolve(makeTask(line)));
}

const isShownOn = (task: TaskDataModel, day: moment.Moment) => TaskMapable.filterDate(day)(task);

// Issue #155: priority followed by unknown or trailing content

test("priority is parsed when followed by a created date", async () => {
    const task = await parse("- [ ] A TASK ⏫ ➕ 2026-09-14");
    assert.equal(task.priority, "High");
    assert.equal(task.visual, "A TASK");
});

test("priority is parsed when followed by trailing free text", async () => {
    const task = await parse("- [ ] A TASK ⏫ 📅 2026-09-18 to continue");
    assert.equal(task.priority, "High");
    assert.equal(task.due?.format("YYYY-MM-DD"), "2026-09-18");
    assert.match(task.visual ?? "", /^A TASK\s+to continue$/);
});

test("priority at the end of the line still works", async () => {
    const task = await parse("- [ ] A TASK 📅 2026-09-18 🔼");
    assert.equal(task.priority, "Medium");
    assert.equal(task.visual, "A TASK");
});

test("task without a priority keeps an empty priority", async () => {
    const task = await parse("- [ ] plain task");
    assert.equal(task.priority, "");
    assert.equal(task.visual, "plain task");
});

// Issue #129: in-progress and scheduled markers without any date

test("undated in-progress task stays in-progress and is shown today", async () => {
    const task = await parse("- [/] Work In Process");
    assert.equal(task.status, TaskStatus.process);
    assert.ok(isShownOn(task, TODAY), "task should be placed on today");
});

test("undated scheduled-marker task stays scheduled and is shown today", async () => {
    const task = await parse("- [<] Scheduled");
    assert.equal(task.status, TaskStatus.scheduled);
    assert.ok(isShownOn(task, TODAY), "task should be placed on today");
});

test("dated in-progress task is not moved to today", async () => {
    const task = await parse("- [/] Work In Process 📅 2099-01-01");
    assert.equal(task.status, TaskStatus.process);
    assert.equal(task.dates.size, 0);
    assert.ok(!isShownOn(task, TODAY));
    assert.ok(isShownOn(task, moment("2099-01-01", "YYYY-MM-DD")));
});

test("undated open task is still unplanned and shown today", async () => {
    const task = await parse("- [ ] Unplanned");
    assert.equal(task.status, TaskStatus.unplanned);
    assert.ok(isShownOn(task, TODAY));
});

test("undated cancelled task is not moved to today", async () => {
    const task = await parse("- [-] Cancelled");
    assert.equal(task.status, TaskStatus.cancelled);
    assert.ok(!isShownOn(task, TODAY));
});
