import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/ar";

import { arrange, groupTasksByDay, query, tasksListedOnDay, type QueryResult, type ViewState } from "../src/arrange";
import { dateOfDay, dayKey, sameDay, type DateValue } from "../src/dates";
import { parseTaskLine } from "../src/parse";
import { resolveTasks, type ResolvedTask, type ResolveSettings } from "../src/resolve";
import type { Task } from "../src/task";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// Ported from the plugin's tests/taskdates.test.ts, which tested groupTasksByDate, timelineSpan and tasksListedOnDay.
// Issue #63: the timeline compared every day against every task, which froze Obsidian for seconds in large vaults.
// Grouping the tasks by day once must list exactly the tasks the old filter did.

const day = (key: string) => moment(key, "YYYY-MM-DD", true);
const TODAY = day("2026-10-12");

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

/** Each line on a line of its own, so the order the tasks are resolved in is the order of the lines. */
const parsed = (texts: readonly string[]): Task[] =>
	texts.map((line, i) => {
		const task = parseTaskLine(line, { moment, path: `Note ${String(i).padStart(2, "0")}.md` });
		assert.ok(task, `not a task line: ${line}`);
		return task;
	});

const settings = { forward: true, hideStatusTasks: [], dateFormat: "YYYY-MM-DD", sort: "status-asc" };

function resolved(texts = lines, now: DateValue = TODAY, extra: ResolveSettings = {}): readonly ResolvedTask[] {
	return resolveTasks(parsed(texts), { ...settings, ...extra }, { now, moment }).shown;
}

/** The lines' tasks resolved on TODAY, in the order of the lines. */
const inLineOrder = (texts = lines) => [...resolved(texts)].sort((a, b) => (a.task.path < b.task.path ? -1 : 1));

const view = (extra: Partial<ViewState["settings"]> = {}): ViewState => ({
	settings: { ...settings, ...extra },
	counter: "",
});

/** Lays out the lines' tasks as of `now`. */
const layout = (now: DateValue, extra: Partial<ViewState["settings"]> = {}, texts = lines): QueryResult =>
	query(parsed(texts), view(extra), { now, moment });

/** Every date a task is placed on, as the views read them: its own, its other dates, and today when forwarded. */
function datesOf(r: ResolvedTask, now: DateValue): DateValue[] {
	const { due, scheduled, created, start, completion } = r.dates;
	return [
		due,
		scheduled,
		created,
		start,
		completion,
		...r.extraDates.map(([, date]) => date),
		r.forwarded && now,
	].filter((date): date is DateValue => !!date);
}

test("each day lists the same tasks, in the same order, as filtering by that day", () => {
	const list = inLineOrder();
	const byDay = groupTasksByDay(list, TODAY);
	const days = new Set(list.flatMap((r) => datesOf(r, TODAY).map(dayKey)));
	assert.deepEqual(new Set(byDay.keys()), days);
	for (const key of days) {
		const expected = list.filter((r) => datesOf(r, TODAY).some((date) => sameDay(date, dateOfDay(moment, key))));
		assert.ok(expected.length > 0, `no task on ${key}`);
		assert.deepEqual(byDay.get(key), expected, key);
	}
});

test("a task with two dates on the same day is listed once on that day", () => {
	const done = inLineOrder()[2];
	assert.deepEqual(groupTasksByDay([done], TODAY).get("2026-10-12"), [done]);
});

test("a task with dates in two years is listed on both days, in both years", () => {
	const spanning = inLineOrder()[3];
	const byDay = groupTasksByDay([spanning], TODAY);
	assert.deepEqual(byDay.get("2025-12-31"), [spanning]);
	assert.deepEqual(byDay.get("2026-01-02"), [spanning]);
	// Overdue on TODAY, so forwarding would list it on today only.
	const shown = resolved([lines[3]], TODAY, { forward: false });
	const { years } = arrange({ today: "2026-10-12", shown }, view({ forward: false }), { now: TODAY, moment });
	assert.deepEqual(
		years.map((year) => [year.year, year.showHeader, year.days.map((d) => [d.key, d.tasks.length])]),
		[
			[2025, true, [["2025-12-31", 1]]],
			[
				2026,
				true,
				[
					["2026-01-02", 1],
					["2026-10-12", 0],
				],
			],
		],
	);
});

test("an empty list has no days, and the timeline is today's year with the entry day", () => {
	assert.equal(groupTasksByDay([], TODAY).size, 0);
	const { years, entryDay } = layout(TODAY, { entryPosition: "top" }, []);
	assert.equal(entryDay, "2026-10-12");
	assert.deepEqual(
		years.map((year) => [year.year, year.showHeader, year.days.map((d) => [d.key, d.dated, d.isEntry])]),
		[[2026, false, [["2026-10-12", false, true]]]],
	);
});

// The tasks have days from 2025-12-31 to 2026-10-12.

test("the timeline spans every year from its earliest day to its latest, today included", () => {
	const years = (now: DateValue) => layout(now).years.map((year) => year.year);
	assert.deepEqual(years(day("2026-06-01")), [2025, 2026]);
	assert.deepEqual(years(day("2024-05-01")), [2024, 2025, 2026]);
	assert.deepEqual(years(day("2028-03-01")), [2025, 2026, 2027, 2028]);
	assert.deepEqual(
		layout(TODAY, {}, []).years.map((year) => year.year),
		[2026],
	);
});

test("the years are listed newest first with the newest first option", () => {
	assert.deepEqual(
		layout(day("2026-06-01"), { newestFirst: true }).years.map((year) => year.year),
		[2026, 2025],
	);
});

test("the entry sits on today, or on the day at the top or the bottom of the view", () => {
	// Today lies between the earliest and the latest day, so each position gives another day.
	const entryDay = (entryPosition: "today" | "top" | "bottom", newestFirst: boolean) =>
		layout(day("2026-06-01"), { entryPosition, newestFirst }).entryDay;
	assert.equal(entryDay("today", false), "2026-06-01");
	assert.equal(entryDay("today", true), "2026-06-01");
	assert.equal(entryDay("top", false), "2025-12-31");
	assert.equal(entryDay("bottom", false), "2026-10-12");
	// Newest first turns the view around, so the top is the latest day.
	assert.equal(entryDay("top", true), "2026-10-12");
	assert.equal(entryDay("bottom", true), "2025-12-31");
});

test("a year's days are its days with tasks and the entry day, so today is no day of its own when the entry is elsewhere", () => {
	const days = layout(day("2026-09-18"), { entryPosition: "top", forward: false }, [
		"- [ ] a 📅 2026-09-10",
		"- [ ] b 📅 2026-09-25",
	]).years.flatMap((year) => year.days);
	assert.deepEqual(
		days.map((d) => [d.key, d.isEntry]),
		[
			["2026-09-10", true],
			["2026-09-25", false],
		],
	);
});

test("today is the top or the bottom of the view when it lies outside the days with tasks", () => {
	const later = day("2026-11-20");
	assert.equal(layout(later, { entryPosition: "bottom" }).entryDay, "2026-11-20");
	assert.equal(layout(later, { entryPosition: "top", newestFirst: true }).entryDay, "2026-11-20");
	assert.equal(layout(day("2025-01-01"), { entryPosition: "top" }).entryDay, "2025-01-01");
	assert.equal(layout(TODAY, { entryPosition: "top" }, []).entryDay, "2026-10-12");
});

test("today's year is shown when every task is in a later year, with the entry panel on today", () => {
	const { years, entryDay } = layout(day("2026-09-18"), {}, ["- [ ] later 📅 2028-03-01"]);
	assert.equal(entryDay, "2026-09-18");
	assert.deepEqual(
		years.map((year) => [year.year, year.days.map((d) => d.key)]),
		[
			[2026, ["2026-09-18"]],
			[2027, []],
			[2028, ["2028-03-01"]],
		],
	);
});

// moment reads extended ISO years in dataview fields, so a typo can give a year before 0000 or after 9999.
const outOfRange = ["- [ ] far ahead [due:: +012026-01-15]", "- [ ] far back [due:: -000001-12-31]"];

test("days in years before 0000 or after 9999 are placed by their year", () => {
	// As text, "12026-01-15" would sort before "2026-10-12".
	const bottom = layout(TODAY, { entryPosition: "bottom" }, outOfRange);
	assert.equal(bottom.entryDay, "12026-01-15");
	const years = bottom.years.map((year) => year.year);
	assert.deepEqual([years[0], years[years.length - 1], years.length], [-1, 12026, 12028]);
	assert.equal(layout(TODAY, { entryPosition: "top" }, outOfRange).entryDay, "-0001-12-31");
	assert.equal(bottom.years.find((year) => year.year === 12026)?.label, "12026");
});

test("a year is labelled with four digits at least, from now's year", () => {
	const labels = (now: DateValue, texts: string[]) =>
		layout(now, {}, texts).years.map((year) => [year.year, year.label, year.isCurrent]);
	assert.deepEqual(labels(TODAY, ["- [ ] old 📅 0999-06-01"])[0], [999, "0999", false]);
	// On the last and the first day of a year, now's year is still the one its date says, not its week's year.
	assert.deepEqual(labels(day("2026-12-31"), ["- [ ] a 📅 2025-06-01"]), [
		[2025, "2025", false],
		[2026, "2026", true],
	]);
	assert.deepEqual(labels(day("2027-01-01"), ["- [ ] a 📅 2026-06-01"]), [
		[2026, "2026", false],
		[2027, "2027", true],
	]);
});

test("only the entry day is the entry, even a day with its month and day in another year", () => {
	for (const [now, texts] of [
		[day("2026-09-18"), ["- [ ] a 📅 2025-09-18", "- [ ] b 📅 1926-09-18"]],
		// 2027-12-27 and 2028-12-27 are in the same week of their week years' last weeks.
		[day("2028-12-27"), ["- [ ] a 📅 2027-12-27"]],
	] as const) {
		const days = layout(now, { forward: false }, [...texts]).years.flatMap((year) => year.days);
		assert.deepEqual(
			days.filter((d) => d.isEntry).map((d) => d.key),
			[now.format("YYYY-MM-DD")],
		);
		assert.deepEqual(
			days.filter((d) => d.isToday).map((d) => d.key),
			[now.format("YYYY-MM-DD")],
		);
	}
});

test("a day's heading is the day's midnight in the date format", () => {
	const days = layout(day("2026-09-18").hours(10), { dateFormat: "YYYY-MM-DD HH:mm" }, ["- [ ] a 📅 2026-09-25"])
		.years[0].days;
	assert.deepEqual(
		days.map((d) => d.label),
		["2026-09-18 00:00", "2026-09-25 00:00"],
	);
});

test("a day's heading reads its key as moment(key) did, so a year before 0000 is labelled as before", () => {
	const days = layout(TODAY, {}, outOfRange).years.flatMap((year) => year.days);
	const label = (key: string) => days.find((d) => d.key === key)?.label;
	assert.equal(label("12026-01-15"), "12026-01-15");
	// moment cannot read the key, so the engine's Date parser does, and reads another day.
	assert.equal(label("-0001-12-31"), moment("-0001-12-31").format("YYYY-MM-DD"));
	assert.notEqual(label("-0001-12-31"), "-0001-12-31");
});

test("a day before the year 0000 that moment(key) reads as today is today, as before", () => {
	// A known quirk, kept until it is fixed on purpose: moment reads "-0001-05-26" as 2026-01-05, so the views made that
	// day today and the entry day too, which listed the task and drew the entry panel twice.
	const now = moment("2026-01-05 12:00", "YYYY-MM-DD HH:mm", true);
	assert.equal(moment("-0001-05-26").format("YYYY-MM-DD"), "2026-01-05");
	const days = layout(now, {}, ["- [ ] neg [due:: -000001-05-26]"]).years.flatMap((year) => year.days);
	assert.deepEqual(
		days.map((d) => [d.key, d.isToday, d.isEntry, d.tasks.map((r) => r.visual)]),
		[
			["-0001-05-26", true, true, ["neg"]],
			["2026-01-05", true, true, ["neg"]],
		],
	);
});

test("an entry day moment(key) cannot read is still the entry, labelled Invalid date, as before", () => {
	// moment hands "-0031-01-01" to the engine's Date parser, which cannot read it. Both sides of the entry comparison then
	// read "Invalid date", so the views drew the entry panel there.
	const days = layout(TODAY, { entryPosition: "top" }, ["- [ ] neg [due:: -000031-01-01]"]).years.flatMap(
		(year) => year.days,
	);
	const neg = days.find((d) => d.key === "-0031-01-01");
	assert.deepEqual([neg?.label, neg?.isEntry, neg?.isToday], ["Invalid date", true, false]);
	assert.deepEqual(
		days.filter((d) => d.isEntry).map((d) => d.key),
		["-0031-01-01"],
	);
});

// In 16 moment locales, among them Arabic, Persian and Hindi, moment writes dates in the locale's own digits. The
// timeline read its years back from such text, got NaN, and showed no year at all.

function inArabic<T>(run: () => T): T {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale("ar"), "ar");
		return run();
	} finally {
		moment.locale(previous);
	}
}

test("days are keyed in ASCII digits whatever the locale", () => {
	const inEnglish = [...groupTasksByDay(inLineOrder(), TODAY).keys()];
	const arabic = inArabic(() => {
		const now = day("2026-10-12");
		const list = resolved(lines, now);
		assert.notEqual(list[0].dates.due?.format("YYYY-MM-DD"), "2026-10-12", "Arabic should write its own digits");
		return [...groupTasksByDay(list, now).keys()];
	});
	assert.ok(inEnglish.includes("2026-10-12"));
	assert.deepEqual(new Set(arabic), new Set(inEnglish));
});

test("the timeline has its years and entry day in a locale with digits of its own", () => {
	const result = inArabic(() => layout(day("2026-10-12"), { entryPosition: "top" }));
	assert.deepEqual(
		result.years.map((year) => year.year),
		[2025, 2026],
	);
	assert.equal(result.entryDay, "2025-12-31");
	assert.deepEqual(
		result.years.map((year) => year.label),
		["٢٠٢٥", "٢٠٢٦"],
	);
	// The day keys are compared as the views compared them, written in the locale's digits on both sides.
	const days = result.years.flatMap((year) => year.days);
	assert.deepEqual(
		days.filter((d) => d.isEntry).map((d) => d.key),
		["2025-12-31"],
	);
	assert.deepEqual(
		days.filter((d) => d.isToday).map((d) => d.key),
		["2026-10-12"],
	);
	const onToday = inArabic(() => layout(day("2026-10-12"))).years.flatMap((year) => year.days);
	assert.deepEqual(
		onToday.filter((d) => d.isEntry).map((d) => d.key),
		["2026-10-12"],
	);
});

// With forwarding on, overdue tasks and tasks forwarded to today are listed on today only, not twice.

const underway = [
	"- [ ] overdue 📅 2026-10-01",
	"- [ ] started earlier 🛫 2026-10-01",
	"- [ ] due later 📅 2026-10-20",
];

test("with forwarding on, a day other than today leaves out overdue and forwarded tasks", () => {
	const list = resolved(underway, TODAY, { forwardPastStartAndScheduled: true });
	assert.deepEqual(
		list.map((r) => [r.visual, r.status, r.forwarded]),
		[
			["overdue", "overdue", "overdue"],
			["started earlier", "process", "forwarded"],
			["due later", "scheduled", undefined],
		],
	);
	assert.deepEqual(
		tasksListedOnDay(list, false, true).map((r) => r.visual),
		["due later"],
	);
});

test("today, or any day with forwarding off, lists every task of the day", () => {
	const list = resolved(underway.slice(0, 2), TODAY, { forwardPastStartAndScheduled: true });
	assert.equal(tasksListedOnDay(list, true, true).length, 2);
	assert.equal(tasksListedOnDay(list, false, false).length, 2);
});

test("a task forwarded past its start date is listed on today, not on its start day", () => {
	const result = layout(TODAY, { forwardPastStartAndScheduled: true }, ["- [ ] started earlier 🛫 2026-10-01"]);
	const listed = Object.fromEntries(
		result.years.flatMap((year) => year.days).map((d) => [d.key, d.tasks.map((r) => r.visual)]),
	);
	assert.deepEqual(listed, { "2026-10-01": [], "2026-10-12": ["started earlier"] });
});
