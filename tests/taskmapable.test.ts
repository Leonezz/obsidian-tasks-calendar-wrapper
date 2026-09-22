import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { makeTask, parse as parseChain } from "./helpers";
import * as TaskMapable from "../utils/taskmapable";
import { TaskDataModel, TaskStatus } from "../utils/tasks";

const TODAY = moment("2026-09-18", "YYYY-MM-DD");

const parse = (line: string) => parseChain(line, TODAY);

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

// Issue #105, #140: a well formed but non-existent date must not break the view

test("an impossible calendar date is ignored instead of becoming an invalid date", async () => {
    const task = await parse("- [ ] Broken due date 📅 2024-02-31");
    assert.equal(task.due, undefined);
    assert.equal(task.visual, "Broken due date");
});

test("a leap day is still parsed", async () => {
    const task = await parse("- [ ] Leap day 📅 2024-02-29");
    assert.equal(task.due?.format("YYYY-MM-DD"), "2024-02-29");
});

test("impossible start, scheduled and done dates are ignored", async () => {
    const task = await parse("- [x] All broken 🛫 2024-13-01 ⏳ 2024-04-31 ✅ 2024-02-30");
    assert.equal(task.start, undefined);
    assert.equal(task.scheduled, undefined);
    assert.equal(task.completion, undefined);
    assert.equal(task.visual, "All broken");
});

// Issue #125, #100: markdown comments must not be shown

test("a markdown comment is removed from the task text", async () => {
    const task = await parse("- [ ] Write docs %%private note%%");
    assert.equal(task.visual, "Write docs");
});

test("a comment wrapping an inline field leaves no comment markers behind", async () => {
    const task = await parse("- [ ] Sync task %%[ticktick_id:: 665850a0]%%");
    assert.equal(task.visual, "Sync task");
});

test("an inline field outside a comment is still parsed", async () => {
    const task = await parse("- [ ] Field task [due:: 2026-09-20] %%hidden%%");
    assert.equal(task.due?.format("YYYY-MM-DD"), "2026-09-20");
    assert.equal(task.visual, "Field task");
});

test("a date inside a comment is not treated as a task date", async () => {
    const task = await parse("- [ ] Commented date %%📅 2026-09-20%%");
    assert.equal(task.due, undefined);
    assert.equal(task.visual, "Commented date");
});

// Issue #102: dataview style priority

test("dataview priority field is read", async () => {
    const task = await parse("- [ ] Dataview priority [priority:: high]");
    assert.equal(task.priority, "High");
    assert.equal(task.visual, "Dataview priority");
});

test("dataview priority is case insensitive and covers every level", async () => {
    const levels: [string, string][] = [["Highest", "Highest"], ["HIGH", "High"], ["medium", "Medium"], ["low", "Low"], ["lowest", "Lowest"], ["none", "No"]];
    for (const [value, label] of levels) {
        const task = await parse(`- [ ] Task [priority:: ${value}]`);
        assert.equal(task.priority, label, `priority:: ${value}`);
    }
});

test("an unknown dataview priority value is ignored", async () => {
    const task = await parse("- [ ] Task [priority:: urgent]");
    assert.equal(task.priority, "");
});

test("the emoji priority still wins over nothing", async () => {
    const task = await parse("- [ ] Task ⏫");
    assert.equal(task.priority, "High");
});

// Issue #84: tasks whose start or scheduled date has passed can be forwarded too

const parseForwardedLine = (line: string) => parseChain(line, TODAY, { pastStartAndScheduled: true });

test("a task started in the past is shown today when the option is on", async () => {
    const task = await parseForwardedLine("- [ ] started earlier 🛫 2026-09-10");
    assert.equal(task.status, TaskStatus.process);
    assert.ok(isShownOn(task, TODAY), "should be placed on today");
    assert.ok(isShownOn(task, moment("2026-09-10", "YYYY-MM-DD")), "should stay on its own date");
});

test("a task scheduled in the past is shown today when the option is on", async () => {
    const task = await parseForwardedLine("- [ ] scheduled earlier ⏳ 2026-09-10");
    assert.equal(task.status, TaskStatus.start);
    assert.ok(isShownOn(task, TODAY));
});

test("a task starting in the future is left alone", async () => {
    const task = await parseForwardedLine("- [ ] starts later 🛫 2026-09-30");
    assert.ok(!isShownOn(task, TODAY));
});

test("the option does not change tasks that are already due", async () => {
    const task = await parseForwardedLine("- [ ] due today 📅 2026-09-18");
    assert.equal(task.dates.size, 0);
});

test("without the option a task started in the past stays on its own date", async () => {
    const task = await parse("- [ ] started earlier 🛫 2026-09-10");
    assert.ok(!isShownOn(task, TODAY));
});

// Issue #61: nested task items can be hidden

test("nested tasks are dropped when subtasks are hidden", () => {
    const top = makeTask("- [ ] top level");
    const nested = makeTask("  - [ ] nested", "Inbox.md", 2);
    assert.deepEqual([top, nested].filter(TaskMapable.filterSubTasks(true)).map(t => t.visual), ["top level"]);
});

test("nested tasks are kept when the option is off", () => {
    const top = makeTask("- [ ] top level");
    const nested = makeTask("  - [ ] nested", "Inbox.md", 2);
    assert.equal([top, nested].filter(TaskMapable.filterSubTasks(false)).length, 2);
});
