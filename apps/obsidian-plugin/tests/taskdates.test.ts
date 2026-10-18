import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import moment from "moment";
import "moment/locale/ar";

import { groupTasksByDate, tasksListedOnDay, timelineSpan } from "../timeline/src/taskdates";
import * as TaskMapable from "../utils/taskmapable";
import { innerDateFormat, TaskDataModel } from "../utils/tasks";
import { parse } from "./helpers";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

/** Runs with moment switched to a locale, as Obsidian does when the app language is changed. */
async function inLocale<T>(locale: string, run: () => Promise<T>): Promise<T> {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale(locale), locale, `moment locale ${locale} is not loaded`);
		return await run();
	} finally {
		moment.locale(previous);
	}
}

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
	return Promise.all(lines.map((line) => parse(line, today)));
}

/** The days the year view used to list: every date of every task. */
function daysOf(list: TaskDataModel[]): Set<string> {
	const days = new Set<string>();
	for (const t of list) {
		for (const d of [t.due, t.scheduled, t.created, t.start, t.completion])
			d && days.add(d.format(innerDateFormat));
		t.dates.forEach((d) => days.add(d.format(innerDateFormat)));
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

// The tasks have days from 2025-12-31 to 2026-10-12.

test("the timeline spans every year from its earliest day to its latest, today included", async () => {
	const list = await tasks();
	assert.deepEqual(timelineSpan(list, "2026-06-01", "today", false).years, [2025, 2026]);
	assert.deepEqual(timelineSpan(list, "2024-05-01", "today", false).years, [2024, 2025, 2026]);
	assert.deepEqual(timelineSpan(list, "2028-03-01", "today", false).years, [2025, 2026, 2027, 2028]);
	assert.deepEqual(timelineSpan([], "2026-10-12", "today", false).years, [2026]);
});

test("the years are listed newest first with the newest first option", async () => {
	assert.deepEqual(timelineSpan(await tasks(), "2026-06-01", "today", true).years, [2026, 2025]);
});

test("the entry sits on today, or on the day at the top or the bottom of the view", async () => {
	const list = await tasks();
	// Today lies between the earliest and the latest day, so each position gives another day.
	const entryDay = (position: "today" | "top" | "bottom", newestFirst: boolean) =>
		timelineSpan(list, "2026-06-01", position, newestFirst).entryDay;
	assert.equal(entryDay("today", false), "2026-06-01");
	assert.equal(entryDay("today", true), "2026-06-01");
	assert.equal(entryDay("top", false), "2025-12-31");
	assert.equal(entryDay("bottom", false), "2026-10-12");
	// Newest first turns the view around, so the top is the latest day.
	assert.equal(entryDay("top", true), "2026-10-12");
	assert.equal(entryDay("bottom", true), "2025-12-31");
});

test("today is the top or the bottom of the view when it lies outside the days with tasks", async () => {
	const list = await tasks();
	assert.equal(timelineSpan(list, "2026-11-20", "bottom", false).entryDay, "2026-11-20");
	assert.equal(timelineSpan(list, "2026-11-20", "top", true).entryDay, "2026-11-20");
	assert.equal(timelineSpan(list, "2025-01-01", "top", false).entryDay, "2025-01-01");
	assert.equal(timelineSpan([], "2026-10-12", "top", false).entryDay, "2026-10-12");
});

test("days in years before 0000 or after 9999 are placed by their year", async () => {
	// moment reads extended ISO years in dataview fields, so a typo can give one.
	const list = await Promise.all([
		parse("- [ ] far ahead [due:: +012026-01-15]", today),
		parse("- [ ] far back [due:: -000001-12-31]", today),
	]);
	// As text, "12026-01-15" would sort before "2026-10-12".
	const span = timelineSpan(list, "2026-10-12", "bottom", false);
	assert.equal(span.entryDay, "12026-01-15");
	assert.deepEqual([span.years[0], span.years[span.years.length - 1], span.years.length], [-1, 12026, 12028]);
	assert.equal(timelineSpan(list, "2026-10-12", "top", false).entryDay, "-0001-12-31");
});

// In 16 moment locales, among them Arabic, Persian and Hindi, moment writes dates in the locale's own
// digits. The timeline read its years back from such text, got NaN, and showed no year at all.

test("days are keyed in ASCII digits whatever the locale", async () => {
	const inEnglish = [...groupTasksByDate(await tasks()).keys()];
	const inArabic = await inLocale("ar", async () => {
		const list = await tasks();
		assert.notEqual(list[0].due?.format(innerDateFormat), "2026-10-12", "Arabic should write its own digits");
		return [...groupTasksByDate(list).keys()];
	});
	assert.ok(inEnglish.includes("2026-10-12"));
	assert.deepEqual(inArabic, inEnglish);
});

test("the timeline has its years in a locale with digits of its own", async () => {
	const span = await inLocale("ar", async () => timelineSpan(await tasks(), "2026-10-12", "top", false));
	assert.deepEqual(span, { years: [2025, 2026], entryDay: "2025-12-31" });
});

// With forwarding on, overdue tasks and tasks forwarded to today are listed on today only, not twice.

test("with forwarding on, a day other than today leaves out overdue and forwarded tasks", async () => {
	const tasks = await Promise.all([
		parse("- [ ] overdue 📅 2026-10-01", today),
		parse("- [ ] started earlier 🛫 2026-10-01", today, { pastStartAndScheduled: true }),
		parse("- [ ] due later 📅 2026-10-20", today),
	]);
	assert.deepEqual(
		tasksListedOnDay(tasks, false, true).map((t) => t.visual),
		["due later"],
	);
});

test("today, or any day with forwarding off, lists every task of the day", async () => {
	const tasks = await Promise.all([
		parse("- [ ] overdue 📅 2026-10-01", today),
		parse("- [ ] started earlier 🛫 2026-10-01", today, { pastStartAndScheduled: true }),
	]);
	assert.equal(tasksListedOnDay(tasks, true, true).length, 2);
	assert.equal(tasksListedOnDay(tasks, false, false).length, 2);
});
