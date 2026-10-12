import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import moment from "moment";

import { groupTasksByDate } from "../Obsidian-Tasks-Timeline/src/taskdates";
import * as TaskMapable from "../utils/taskmapable";
import { innerDateFormat, TaskDataModel } from "../utils/tasks";
import { parse } from "./helpers";

// Issue #63: the timeline compared every day against every task, which froze Obsidian for seconds
// in large vaults. Grouping the tasks by day once must list exactly the tasks the old filter did.

const today = moment("2026-10-12");

const lines = [
    "- [ ] due today 📅 2026-10-12",
    "- [ ] scheduled before its due date ⏳ 2026-10-10 📅 2026-10-12",
    "- [x] done on its due date 📅 2026-10-12 ✅ 2026-10-12",
    "- [ ] starts in one year and is due in the next 🛫 2025-12-31 📅 2026-01-02",
    "- [ ] overdue, so it is also listed today 📅 2026-10-01",
    "- [ ] unplanned",
    "- [-] cancelled ⏳ 2026-10-11",
    "- [ ] created date only ➕ 2026-09-30",
];

async function tasks(): Promise<TaskDataModel[]> {
    return Promise.all(lines.map(line => parse(line, today)));
}

/** The days the year view used to list: every date of every task. */
function daysOf(list: TaskDataModel[]): Set<string> {
    const days = new Set<string>();
    for (const t of list) {
        for (const d of [t.due, t.scheduled, t.created, t.start, t.completion]) d && days.add(d.format(innerDateFormat));
        t.dates.forEach(d => days.add(d.format(innerDateFormat)));
    }
    return days;
}

test("each day lists the same tasks, in the same order, as filtering by that day", async () => {
    const list = await tasks();
    const byDate = groupTasksByDate(list);
    const days = daysOf(list);

    assert.deepEqual(new Set(byDate.keys()), days);
    for (const day of days) {
        const expected = list.filter(TaskMapable.filterDate(moment(day)));
        assert.ok(expected.length > 0, `no task on ${day}`);
        assert.equal(byDate.get(day)?.length, expected.length, day);
        expected.forEach((task, i) => assert.equal(byDate.get(day)?.[i], task, `${day} #${i}`));
    }
});

test("a task with two dates on the same day is listed once on that day", async () => {
    const [, , done] = await tasks();
    assert.deepEqual(groupTasksByDate([done]).get("2026-10-12"), [done]);
});

test("a task with dates in two years is listed on both days", async () => {
    const list = await tasks();
    const spanning = list[3];
    const byDate = groupTasksByDate([spanning]);
    assert.deepEqual(byDate.get("2025-12-31"), [spanning]);
    assert.deepEqual(byDate.get("2026-01-02"), [spanning]);
});

test("an empty list has no days", () => {
    assert.equal(groupTasksByDate([]).size, 0);
});
