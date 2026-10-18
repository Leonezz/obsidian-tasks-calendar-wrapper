import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/zh-cn";

import { createQuery, query, type ViewState } from "../src/arrange";
import { parseTaskLine } from "../src/parse";
import type { Task } from "../src/task";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// The timeline renders again for every click on a counter or on Focus on today. createQuery remembers its last
// result, so a render with the same tasks, settings, day and language resolves nothing again, and one that only
// changes the counter or the quick filter only arranges again.

const TODAY = moment("2026-09-18 10:00", "YYYY-MM-DD HH:mm", true);

const tasks: readonly Task[] = ["- [ ] late 📅 2026-09-01", "- [ ] due today ⏫ 📅 2026-09-18", "- [ ] unplanned"].map(
	(line) => {
		const task = parseTaskLine(line, { moment });
		assert.ok(task);
		return task;
	},
);

const settings = { forward: true, dateFormat: "YYYY-MM-DD", counterBehavior: "Filter" as const };
const view: ViewState = { settings, counter: "" };

test("the same tasks, settings, view, day and language give the same result, without working it out again", () => {
	const run = createQuery();
	const first = run(tasks, view, { now: TODAY, moment });
	assert.equal(run(tasks, view, { now: TODAY.clone().add(5, "hours"), moment }), first);
	assert.deepEqual(first, query(tasks, view, { now: TODAY, moment }));
});

test("another counter or quick filter arranges again from the tasks resolved before", () => {
	const run = createQuery();
	const first = run(tasks, view, { now: TODAY, moment });
	const filtered = run(tasks, { ...view, counter: "overdueFilter" }, { now: TODAY, moment });
	assert.notEqual(filtered, first);
	assert.equal(filtered.shown, first.shown, "the resolved tasks are the ones from before");
	assert.deepEqual(
		filtered.years.flatMap((year) => year.days).flatMap((day) => day.tasks.map((r) => r.visual)),
		["late"],
	);
	const quick = run(
		tasks,
		{ ...view, counter: "overdueFilter", quickFilter: { priorities: [""] } },
		{ now: TODAY, moment },
	);
	assert.notEqual(quick, filtered);
	assert.equal(quick.shown, first.shown);
});

// Each of these changes one input from a fresh start, so each check on its own makes the difference.

const labels = (result: ReturnType<typeof query>) => result.years.flatMap((year) => year.days.map((day) => day.label));

test("new tasks resolve again", () => {
	const run = createQuery();
	const first = run(tasks, view, { now: TODAY, moment });
	assert.notEqual(run([...tasks], view, { now: TODAY, moment }).shown, first.shown);
});

test("new settings resolve and arrange again", () => {
	const run = createQuery();
	run(tasks, view, { now: TODAY, moment });
	const changed = run(tasks, { ...view, settings: { ...settings, dateFormat: "DD/MM" } }, { now: TODAY, moment });
	assert.deepEqual(labels(changed), ["01/09", "18/09"]);
});

test("another day resolves and arranges again", () => {
	const run = createQuery();
	run(tasks, view, { now: TODAY, moment });
	assert.equal(run(tasks, view, { now: TODAY.clone().add(1, "day"), moment }).today, "2026-09-19");
});

test("another language resolves and arranges again", () => {
	const run = createQuery();
	const weekdays = { ...view, settings: { ...settings, dateFormat: "dddd" } };
	assert.deepEqual(labels(run(tasks, weekdays, { now: TODAY, moment })), ["Tuesday", "Friday"]);
	const previous = moment.locale();
	try {
		moment.locale("zh-cn");
		assert.deepEqual(labels(run(tasks, weekdays, { now: TODAY, moment })), ["星期二", "星期五"]);
	} finally {
		moment.locale(previous);
	}
});

test("another quick filter arranges again", () => {
	const run = createQuery();
	assert.equal(run(tasks, view, { now: TODAY, moment }).tasks.length, 3);
	const quick = run(tasks, { ...view, quickFilter: { priorities: ["High"] } }, { now: TODAY, moment });
	assert.deepEqual(
		quick.tasks.map((r) => r.visual),
		["due today"],
	);
});

test("a remembered result is what query gives at the time it was worked out", () => {
	const run = createQuery();
	for (const counter of ["", "todoFilter", "overdueFilter", "unplannedFilter", ""] as const) {
		const v = { ...view, counter };
		assert.deepEqual(run(tasks, v, { now: TODAY, moment }), query(tasks, v, { now: TODAY, moment }), counter);
	}
});
