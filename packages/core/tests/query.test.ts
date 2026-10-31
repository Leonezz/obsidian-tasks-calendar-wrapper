import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/zh-cn";

import { createQuery, query, type ViewState } from "../src/arrange";
import { createDailyNoteDateCache } from "../src/dates";
import { parseTaskLine } from "../src/parse";
import { createResolvedTaskCache, resolveTasks } from "../src/resolve";
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
const queryEnv = () => ({ now: TODAY, moment, dateCache: createDailyNoteDateCache() });

test("the same tasks, settings, view, day and language give the same result, without working it out again", () => {
	const run = createQuery();
	const env = queryEnv();
	const first = run(tasks, view, env);
	assert.equal(run(tasks, view, { ...env, now: TODAY.clone().add(5, "hours") }), first);
	assert.deepEqual(first, query(tasks, view, env));
});

test("another counter or quick filter arranges again from the tasks resolved before", () => {
	const run = createQuery();
	const env = queryEnv();
	const first = run(tasks, view, env);
	const filtered = run(tasks, { ...view, counter: "overdueFilter" }, env);
	assert.notEqual(filtered, first);
	assert.equal(filtered.shown, first.shown, "the resolved tasks are the ones from before");
	assert.deepEqual(
		filtered.years.flatMap((year) => year.days).flatMap((day) => day.tasks.map((r) => r.visual)),
		["late"],
	);
	const quick = run(tasks, { ...view, counter: "overdueFilter", quickFilter: { priorities: [""] } }, env);
	assert.notEqual(quick, filtered);
	assert.equal(quick.shown, first.shown);
});

// Each of these changes one input from a fresh start, so each check on its own makes the difference.

const labels = (result: ReturnType<typeof query>) => result.years.flatMap((year) => year.days.map((day) => day.label));

test("new tasks resolve again", () => {
	const run = createQuery();
	const env = queryEnv();
	const first = run(tasks, view, env);
	assert.notEqual(run([...tasks], view, env).shown, first.shown);
});

test("new resolve settings resolve and arrange again", () => {
	const run = createQuery();
	const env = queryEnv();
	const first = run(tasks, view, env);
	const changed = run(tasks, { ...view, settings: { ...settings, forward: false } }, env);
	assert.notEqual(changed.shown, first.shown);
	assert.deepEqual(changed, query(tasks, { ...view, settings: { ...settings, forward: false } }, env));
});

test("equal-valued resolve settings reuse the resolved list", () => {
	const run = createQuery();
	const env = queryEnv();
	const current = { ...settings, hideStatusTasks: ["x", "-"] };
	const first = run(tasks, { ...view, settings: current }, env);
	const equal = run(tasks, { ...view, settings: { ...current, hideStatusTasks: ["x", "-"] } }, env);
	assert.equal(equal.shown, first.shown);
});

test("new arrange settings rearrange the same resolved list", () => {
	const run = createQuery();
	const env = queryEnv();
	const first = run(tasks, view, env);
	const changed = run(tasks, { ...view, settings: { ...settings, dateFormat: "DD/MM" } }, env);
	assert.notEqual(changed, first);
	assert.equal(changed.shown, first.shown);
	assert.deepEqual(labels(changed), ["01/09", "18/09"]);
});

test("another day resolves and arranges again", () => {
	const run = createQuery();
	const env = queryEnv();
	run(tasks, view, env);
	assert.equal(run(tasks, view, { ...env, now: TODAY.clone().add(1, "day") }).today, "2026-09-19");
});

test("another language resolves and arranges again", () => {
	const run = createQuery();
	const env = queryEnv();
	const weekdays = { ...view, settings: { ...settings, dateFormat: "dddd" } };
	assert.deepEqual(labels(run(tasks, weekdays, env)), ["Tuesday", "Friday"]);
	const previous = moment.locale();
	try {
		moment.locale("zh-cn");
		assert.deepEqual(labels(run(tasks, weekdays, { ...env, dateCache: createDailyNoteDateCache() })), [
			"星期二",
			"星期五",
		]);
	} finally {
		moment.locale(previous);
	}
});

test("another quick filter arranges again", () => {
	const run = createQuery();
	const env = queryEnv();
	assert.equal(run(tasks, view, env).tasks.length, 3);
	const quick = run(tasks, { ...view, quickFilter: { priorities: ["High"] } }, env);
	assert.deepEqual(
		quick.tasks.map((r) => r.visual),
		["due today"],
	);
});

test("a remembered result is what query gives at the time it was worked out", () => {
	const run = createQuery();
	const env = queryEnv();
	for (const counter of ["", "todoFilter", "overdueFilter", "unplannedFilter", ""] as const) {
		const v = { ...view, counter };
		assert.deepEqual(run(tasks, v, env), query(tasks, v, env), counter);
	}
});

test("without a date cache a query does not reuse its resolve", () => {
	const run = createQuery();
	const env = { now: TODAY, moment };
	const first = run(tasks, view, env);
	assert.notEqual(run(tasks, view, env).shown, first.shown);
});

test("prepared tasks are arranged without resolving", () => {
	const run = createQuery();
	const taskCache = createResolvedTaskCache();
	const env = { ...queryEnv(), taskCache };
	const prepared = resolveTasks(tasks, settings, env);
	const count = taskCache.resolutionCount;
	assert.equal(run(tasks, view, env, prepared).shown, prepared.shown);
	assert.equal(taskCache.resolutionCount, count);
});

test("a new date cache resolves again even with the same locale name", () => {
	const run = createQuery();
	const env = queryEnv();
	const first = run(tasks, view, env);
	assert.notEqual(run(tasks, view, { ...env, dateCache: createDailyNoteDateCache() }).shown, first.shown);
});

test("prepared tasks rearrange when the parse environment changes", () => {
	const previous = moment.locale();
	try {
		for (const cached of [false, true]) {
			moment.locale("en");
			const run = createQuery();
			const env = { now: TODAY, moment, dateCache: cached ? createDailyNoteDateCache() : undefined };
			const weekdays = { ...view, settings: { ...settings, dateFormat: "dddd" } };
			const prepared = resolveTasks(tasks, settings, env);
			assert.deepEqual(labels(run(tasks, weekdays, env, prepared)), ["Tuesday", "Friday"]);
			moment.locale("zh-cn");
			const changed = { ...env, dateCache: cached ? createDailyNoteDateCache() : undefined };
			assert.deepEqual(labels(run(tasks, weekdays, changed, prepared)), ["星期二", "星期五"]);
		}
	} finally {
		moment.locale(previous);
	}
});
