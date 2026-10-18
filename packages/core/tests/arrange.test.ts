import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/ar";

import { arrange, query, type ViewState } from "../src/arrange";
import { parseTaskLine } from "../src/parse";
import { resolveTasks, type ResolveSettings } from "../src/resolve";
import type { Task } from "../src/task";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// What the timeline's views and their CSS did with the tasks shown, now as data: the quick filter, the counts, the
// years and days, the entry day, and the counter filter. Each expectation is what TimelineView, YearView, DateView and
// styles.css give for the same tasks.

const TODAY = moment("2026-09-18 10:00", "YYYY-MM-DD HH:mm", true);
const env = { now: TODAY, moment };

function task(line: string, path = "Inbox.md"): Task {
	const parsed = parseTaskLine(line, { moment, path });
	assert.ok(parsed, `not a task line: ${line}`);
	return parsed;
}

const settings = { forward: true, hideStatusTasks: [], dateFormat: "YYYY-MM-DD" };

function view(changes: Partial<ViewState> = {}, extra: Partial<ViewState["settings"]> = {}): ViewState {
	return { settings: { ...settings, ...extra }, counter: "", ...changes };
}

const resolve = (lines: string[], extra: ResolveSettings = {}) =>
	resolveTasks(
		lines.map((line) => task(line)),
		{ ...settings, ...extra },
		env,
	);

/** The days of every year, as key: listed task texts. */
const listed = (result: ReturnType<typeof arrange>) =>
	Object.fromEntries(
		result.years.flatMap((year) => year.days.map((day) => [day.key, day.tasks.map((r) => r.visual)])),
	);

test("counts follow the statuses, and to-do is everything else", () => {
	const result = arrange(
		resolve([
			"- [ ] overdue 📅 2026-09-01",
			"- [ ] unplanned",
			"- [x] done ✅ 2026-09-17",
			"- [-] cancelled",
			"- [ ] due today 📅 2026-09-18",
			"- [/] in progress",
		]),
		view(),
		env,
	);
	assert.deepEqual(result.counts, { todo: 2, overdue: 1, unplanned: 1, done: 1, cancelled: 1 });
});

test("a task is listed under each day it has a date on, and a forwarded one on today too", () => {
	const result = arrange(
		resolve([
			"- [ ] twice ⏳ 2026-09-20 📅 2026-09-20",
			"- [ ] late 📅 2026-09-01",
			"- [ ] spans 🛫 2026-09-10 📅 2026-09-25",
		]),
		view(),
		env,
	);
	assert.deepEqual(listed(result), {
		// An overdue task is listed on today only, not also on its own day.
		"2026-09-01": [],
		"2026-09-10": ["spans"],
		"2026-09-18": ["late"],
		"2026-09-20": ["twice"],
		"2026-09-25": ["spans"],
	});
});

test("without forwarding, an overdue task stays on its own day", () => {
	const result = arrange(
		resolve(["- [ ] late 📅 2026-09-01"], { forward: false }),
		view({}, { forward: false }),
		env,
	);
	assert.deepEqual(listed(result), { "2026-09-01": ["late"], "2026-09-18": [] });
});

test("the entry sits on today, or at the top or the bottom of the view, which newest first turns around", () => {
	const resolved = resolve(["- [ ] early 📅 2026-09-10", "- [ ] late 📅 2026-09-25"]);
	const entryDay = (entryPosition: "today" | "top" | "bottom", newestFirst: boolean) =>
		arrange(resolved, view({}, { entryPosition, newestFirst }), env).entryDay;
	assert.equal(entryDay("today", false), "2026-09-18");
	assert.equal(entryDay("top", false), "2026-09-10");
	assert.equal(entryDay("bottom", false), "2026-09-25");
	assert.equal(entryDay("top", true), "2026-09-25");
	assert.equal(entryDay("bottom", true), "2026-09-10");
});

test("years run from the earliest day to the latest, in display order, and so do their days", () => {
	const resolved = resolve(["- [ ] old 📅 2024-03-01", "- [ ] new 📅 2026-09-25"]);
	const oldestFirst = arrange(resolved, view(), env);
	assert.deepEqual(
		oldestFirst.years.map((year) => year.year),
		[2024, 2025, 2026],
	);
	assert.deepEqual(
		oldestFirst.years[2].days.map((day) => day.key),
		["2026-09-18", "2026-09-25"],
	);
	const newestFirst = arrange(resolved, view({}, { newestFirst: true }), env);
	assert.deepEqual(
		newestFirst.years.map((year) => year.year),
		[2026, 2025, 2024],
	);
	assert.deepEqual(
		newestFirst.years[0].days.map((day) => day.key),
		["2026-09-25", "2026-09-18"],
	);
});

test("a year without tasks has no header, and one whose tasks are all listed elsewhere keeps it", () => {
	const result = arrange(resolve(["- [ ] late 📅 2025-12-01", "- [ ] new 📅 2026-09-25"]), view(), env);
	const [last, current] = result.years;
	// The overdue task of 2025 is listed on today only, but 2025 still has it, so its header stays.
	assert.equal(last.year, 2025);
	assert.ok(last.showHeader);
	assert.deepEqual(
		last.days.map((day) => [day.key, day.tasks.length]),
		[["2025-12-01", 0]],
	);
	assert.ok(current.isCurrent && !last.isCurrent);
	const gap = arrange(resolve(["- [ ] old 📅 2024-03-01"]), view(), env).years.find((year) => year.year === 2025);
	assert.ok(gap && !gap.showHeader && gap.days.length === 0);
});

test("the entry day is a day of its year even without a task, and only it is marked as the entry", () => {
	const result = arrange(resolve(["- [ ] later 📅 2026-09-25"]), view(), env);
	const days = result.years[0].days;
	assert.deepEqual(
		days.map((day) => [day.key, day.isEntry, day.isToday, day.dated]),
		[
			["2026-09-18", true, true, false],
			["2026-09-25", false, false, true],
		],
	);
	assert.equal(days[0].label, "2026-09-18");
});

// The quick filter (ObsidianBridge.handleFilterEnable): a date range, both ends left out, and priorities.

test("the quick filter's range leaves out both of its days", () => {
	const resolved = resolve([
		"- [ ] on the first day 📅 2026-09-20",
		"- [ ] inside 📅 2026-09-25",
		"- [ ] on the last day 📅 2026-09-30",
		"- [ ] unplanned",
	]);
	const result = arrange(
		resolved,
		view({ quickFilter: { from: "2026-09-20", to: "2026-09-30", priorities: [] } }),
		env,
	);
	assert.deepEqual(
		result.tasks.map((r) => r.visual),
		["inside"],
	);
	// The shown tasks are kept as they were; counts, years and days use the filtered ones.
	assert.equal(result.shown.length, 4);
	assert.equal(result.counts.todo, 1);
});

test("the quick filter counts a forwarded task as being on today", () => {
	const resolved = resolve(["- [ ] unplanned", "- [ ] late 📅 2026-09-01", "- [ ] later 📅 2026-09-25"]);
	const result = arrange(
		resolved,
		view({ quickFilter: { from: "2026-09-15", to: "2026-09-20", priorities: [] } }),
		env,
	);
	assert.deepEqual(
		result.tasks.map((r) => r.visual),
		["unplanned", "late"],
	);
});

test("the quick filter's range needs both of its days", () => {
	const resolved = resolve(["- [ ] a 📅 2026-09-10", "- [ ] b 📅 2026-09-25"]);
	for (const quickFilter of [
		{ from: "2026-09-11", to: "", priorities: [] },
		{ from: "", to: "2026-09-20", priorities: [] },
	]) {
		assert.equal(arrange(resolved, view({ quickFilter }), env).tasks.length, 2);
	}
});

test("the quick filter reads its days as moment(day) did, and one it cannot read matches no task, as before", () => {
	const resolved = resolve(["- [ ] a 📅 2026-09-10", "- [ ] b 📅 2026-09-25"]);
	const tasksBetween = (from: string, to: string) =>
		arrange(resolved, view({ quickFilter: { from, to, priorities: [] } }), env).tasks.map((r) => r.visual);
	assert.deepEqual(tasksBetween("2026-09-20T08:00", "2026-09-30"), ["b"]);
	assert.deepEqual(tasksBetween("2026-09-01", "no such day"), []);
});

test("the quick filter's priorities are compared as written, so the numbered ones match nothing, as before", () => {
	const resolved = resolve(["- [ ] high ⏫", "- [ ] none"]);
	const tasksWith = (priorities: string[]) =>
		arrange(resolved, view({ quickFilter: { priorities } }), env).tasks.map((r) => r.visual);
	assert.deepEqual(tasksWith(["High"]), ["high"]);
	// A known quirk, kept until it is fixed on purpose: the quick filter offers "1" to "4".
	assert.deepEqual(tasksWith(["1"]), []);
	assert.deepEqual(tasksWith([]), ["high", "none"]);
});

// The counter filter, as styles.css applied it: Filter hides the tasks, days and year headers without the counter's
// statuses; Focus hides nothing. The entry panel is never hidden.

const mixed = [
	"- [ ] late 📅 2026-09-01",
	"- [ ] old late 📅 2025-11-01",
	"- [ ] due today 📅 2026-09-18",
	"- [ ] unplanned",
	"- [ ] later 📅 2026-09-25",
];

test("the Todo filter keeps due, scheduled, started and in-progress tasks, and the days and years that have one", () => {
	const result = arrange(resolve(mixed), view({ counter: "todoFilter" }, { counterBehavior: "Filter" }), env);
	assert.deepEqual(listed(result), {
		"2025-11-01": [],
		"2026-09-01": [],
		"2026-09-18": ["due today"],
		"2026-09-25": ["later"],
	});
	assert.deepEqual(
		result.years.map((year) => [year.year, year.showHeader]),
		[
			[2025, false],
			[2026, true],
		],
	);
});

test("the Overdue filter keeps a year whose overdue task is listed on another year's today", () => {
	const result = arrange(resolve(mixed), view({ counter: "overdueFilter" }, { counterBehavior: "Filter" }), env);
	// The year header looks at the year's tasks before they are listed on today, as the CSS did.
	assert.deepEqual(
		result.years.map((year) => [year.year, year.showHeader]),
		[
			[2025, true],
			[2026, true],
		],
	);
	assert.deepEqual(listed(result)["2026-09-18"], ["late", "old late"]);
});

test("a filter that leaves the entry day empty still keeps it, for the entry panel", () => {
	const result = arrange(
		resolve(["- [ ] later 📅 2026-09-25"]),
		view({ counter: "overdueFilter" }, { counterBehavior: "Filter" }),
		env,
	);
	const entry = result.years.flatMap((year) => year.days).find((day) => day.isEntry);
	assert.ok(entry);
	assert.equal(entry.key, "2026-09-18");
	assert.deepEqual(entry.tasks, []);
});

test("the Focus behaviour hides nothing", () => {
	const filtered = arrange(resolve(mixed), view({ counter: "todoFilter" }, { counterBehavior: "Focus" }), env);
	const plain = arrange(resolve(mixed), view(), env);
	assert.deepEqual(listed(filtered), listed(plain));
	assert.ok(
		filtered.years.every((year) => year.showHeader === plain.years.find((y) => y.year === year.year)?.showHeader),
	);
});

test("counts are taken before the counter filter", () => {
	const result = arrange(resolve(mixed), view({ counter: "unplannedFilter" }, { counterBehavior: "Filter" }), env);
	assert.deepEqual(result.counts, { todo: 2, overdue: 2, unplanned: 1, done: 0, cancelled: 0 });
});

// Languages that write numbers in their own digits

test("in Arabic the years and day keys are numbers and ASCII, and the labels use Arabic digits", () => {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale("ar"), "ar");
		const now = moment("2026-09-18 10:00", "YYYY-MM-DD HH:mm", true);
		const tasks = [task("- [ ] old 📅 2025-12-01"), task("- [ ] new 📅 2026-09-25")];
		const result = query(tasks, view({}, { dateFormat: "YYYY-MM-DD" }), { now, moment });
		assert.deepEqual(
			result.years.map((year) => year.year),
			[2025, 2026],
		);
		assert.equal(result.today, "2026-09-18");
		assert.ok(result.years[1].days.some((day) => day.key === "2026-09-25" && day.label === "٢٠٢٦-٠٩-٢٥"));
		assert.equal(result.years[1].label, "٢٠٢٦");
	} finally {
		moment.locale(previous);
	}
});

test("query resolves and arranges in one go, and every part of the result is frozen", () => {
	const tasks = mixed.map((line) => task(line));
	const result = query(tasks, view({ counter: "todoFilter" }, { counterBehavior: "Filter" }), env);
	const inTwoSteps = arrange(
		resolveTasks(tasks, settings, env),
		view({ counter: "todoFilter" }, { counterBehavior: "Filter" }),
		env,
	);
	assert.deepEqual(listed(result), listed(inTwoSteps));
	assert.deepEqual(result.counts, inTwoSteps.counts);
	for (const part of [
		result,
		result.tasks,
		result.shown,
		result.counts,
		result.years,
		...result.years,
		...result.years.flatMap((year) => [year.days, year.statuses, ...year.days]),
	]) {
		assert.ok(Object.isFrozen(part));
	}
});
