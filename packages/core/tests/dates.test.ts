import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/zh-cn";
import "moment/locale/ar";

import {
	afterInstant,
	beforeDay,
	betweenDaysExclusive,
	convert24HourPrefix,
	DateValue,
	dateOfDay,
	dayKey,
	inDisplayOrder,
	MomentFactory,
	parseDailyNoteName,
	parseLooseDate,
	parseStrictDate,
	relativeDate,
	sameDay,
	sameYear,
	yearOfDay,
} from "../src/dates";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

/** The npm moment stands in for Obsidian's; both satisfy the factory type. */
const factory: MomentFactory = moment;
const day = (text: string) => moment(text, "YYYY-MM-DD", true);
const at = (text: string) => moment(text, "YYYY-MM-DD HH:mm", true);
const ymd = (date: DateValue | undefined) => date?.format("YYYY-MM-DD");

/** Runs with moment switched to a locale, as Obsidian does when the app language is changed. */
function inLocale<T>(locale: string, run: () => T): T {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale(locale), locale, `moment locale ${locale} is not loaded`);
		return run();
	} finally {
		moment.locale(previous);
	}
}

test("a DateValue can be read but offers nothing that changes it", () => {
	const value: DateValue = at("2026-01-15 09:30");
	assert.equal(value.format("YYYY-MM-DD HH:mm"), "2026-01-15 09:30");
	assert.deepEqual([value.year(), value.month(), value.date(), value.hours(), value.minutes()], [2026, 0, 15, 9, 30]);
	// Never called: the type check of the tests fails if any of these compiles.
	const changes = (date: DateValue) => {
		// @ts-expect-error add() is not part of DateValue, so a stored date cannot be moved by accident.
		date.add(1, "day");
		// @ts-expect-error startOf() changes the moment it is called on.
		date.startOf("day");
		// @ts-expect-error year() reads the year; year(n) would set it.
		date.year(2020);
		// @ts-expect-error locale(x) would switch the moment's language.
		date.locale("fr");
	};
	assert.equal(typeof changes, "function");
});

test("core cannot ask the moment factory for the current time", () => {
	// Never called: the type check of the tests fails if this compiles.
	const readsTheClock = (m: MomentFactory) => {
		// @ts-expect-error moment() without input reads the clock; core gets `now` passed in.
		m();
	};
	assert.equal(typeof readsTheClock, "function");
});

test("clone() hands out a moment of its own", () => {
	const value: DateValue = day("2026-01-15");
	value.clone().add(1, "day");
	assert.equal(ymd(value), "2026-01-15");
});

test("a day key is written in ASCII digits whatever the locale", () => {
	assert.equal(dayKey(day("2026-01-15")), "2026-01-15");
	assert.equal(dayKey(day("0987-03-04")), "0987-03-04");
	inLocale("ar", () => {
		const date = day("2026-01-15");
		// Arabic writes the date in its own digits, which a number cannot be read from.
		assert.notEqual(date.format("YYYY-MM-DD"), "2026-01-15");
		assert.equal(dayKey(date), "2026-01-15");
	});
});

test("a day key of a year outside 0000-9999 still names its year", () => {
	assert.equal(dayKey(moment.utc("+012026-01-15")), "12026-01-15");
	assert.equal(dayKey(moment.utc("-000001-12-31")), "-0001-12-31");
});

test("the year of a day key is read from the key itself", () => {
	assert.equal(yearOfDay("2026-01-15"), 2026);
	assert.equal(yearOfDay("0987-03-04"), 987);
	assert.equal(yearOfDay("12026-01-15"), 12026);
	assert.equal(yearOfDay("-0001-12-31"), -1);
	inLocale("ar", () => assert.equal(yearOfDay(dayKey(day("2026-01-15"))), 2026));
});

test("text that is not a day key has no year", () => {
	// Arabic digits are what the timeline used to key its days with, which gave it no years at all.
	for (const text of ["٢٠٢٦-٠١-١٥", "2026-1-15", "15.01.2026", ""]) {
		assert.throws(() => yearOfDay(text), /is not a day key/, text);
	}
});

test("a day key turns back into its day, labelled in the locale's own digits", () => {
	assert.equal(ymd(dateOfDay(factory, "2026-01-15")), "2026-01-15");
	inLocale("ar", () => {
		const date = dateOfDay(factory, "2026-01-15");
		assert.equal(dayKey(date), "2026-01-15");
		assert.equal(date.format("YYYY"), "٢٠٢٦");
	});
});

test("a day key that is not a real day is an error", () => {
	assert.throws(() => dateOfDay(factory, "2026-02-31"), /2026-02-31/);
	assert.throws(() => dateOfDay(factory, "15.01.2026"), /15\.01\.2026/);
});

// Issue #105 and #140: dates such as 2024-02-31 match the date regex but are not real days.

test("a strict date must be a real day in exactly the given format", () => {
	assert.equal(ymd(parseStrictDate(factory, "2026-01-20", "YYYY-MM-DD")), "2026-01-20");
	assert.equal(parseStrictDate(factory, "2024-02-31", "YYYY-MM-DD"), undefined);
	assert.equal(parseStrictDate(factory, "2026-1-20", "YYYY-MM-DD"), undefined);
	assert.equal(parseStrictDate(factory, "2026-01-20 ", "YYYY-MM-DD"), undefined);
	assert.equal(ymd(parseStrictDate(factory, "20/01/2026", "DD/MM/YYYY")), "2026-01-20");
});

test("a strict date in ASCII digits is read in a locale with digits of its own", () => {
	inLocale("ar", () => assert.equal(dayKey(parseStrictDate(factory, "2026-01-20", "YYYY-MM-DD")!), "2026-01-20"));
});

test("a loose date accepts what moment() accepts, time included", () => {
	assert.equal(ymd(parseLooseDate(factory, "2026-01-20")), "2026-01-20");
	assert.equal(parseLooseDate(factory, "2026-01-20T10:30")?.format("HH:mm"), "10:30");
	assert.equal(parseLooseDate(factory, "2026-02-31"), undefined);
});

test("a loose date that moment cannot read is undefined", () => {
	// Text that is not ISO falls back to the engine's Date parser, which logs a deprecation warning.
	const previous = moment.suppressDeprecationWarnings;
	moment.suppressDeprecationWarnings = true;
	try {
		assert.equal(parseLooseDate(factory, "soon"), undefined);
	} finally {
		moment.suppressDeprecationWarnings = previous;
	}
});

// Issue #95: a daily note format with folders, such as YYYY/MMM/Wo/ddd, was never recognised,
// because only the file name was compared with the format.

test("a flat daily note format matches the file name inside any folder", () => {
	assert.equal(ymd(parseDailyNoteName(factory, "Journal/2024-01-22.md", "YYYY-MM-DD")), "2024-01-22");
	assert.equal(ymd(parseDailyNoteName(factory, "2024-01-22.md", "YYYY-MM-DD")), "2024-01-22");
});

test("a daily note name without a four-digit year is read directly, not looked up", () => {
	// The lookup only generates the years written in the name, so this name can only be parsed.
	assert.equal(ymd(parseDailyNoteName(factory, "Daily/24-01-22.md", "YY-MM-DD")), "2024-01-22");
});

test("a daily note format with folders matches that many trailing path segments", () => {
	assert.equal(ymd(parseDailyNoteName(factory, "2024/01/22.md", "YYYY/MM/DD")), "2024-01-22");
	assert.equal(ymd(parseDailyNoteName(factory, "Journal/2024/01/22.md", "YYYY/MM/DD")), "2024-01-22");
	assert.equal(parseDailyNoteName(factory, "Projects/notes/22.md", "YYYY/MM/DD"), undefined);
});

test("a format that moment writes but cannot read back is looked up by name", () => {
	assert.equal(ymd(parseDailyNoteName(factory, "2024/Jan/4th/Mon.md", "YYYY/MMM/Wo/ddd")), "2024-01-22");
	inLocale("zh-cn", () => {
		assert.equal(ymd(parseDailyNoteName(factory, "2024/1月/4周/周一.md", "YYYY/MMM/Wo/ddd")), "2024-01-22");
		// The last days of December can fall in week 1 of the next year.
		assert.equal(ymd(parseDailyNoteName(factory, "2024/12月/1周/周一.md", "YYYY/MMM/Wo/ddd")), "2024-12-30");
		// The names looked up follow the locale, so the English names are not daily notes any more.
		assert.equal(parseDailyNoteName(factory, "2024/Jan/4th/Mon.md", "YYYY/MMM/Wo/ddd"), undefined);
	});
});

test("a looked-up daily note date is a copy, so changing it changes no later lookup", () => {
	parseDailyNoteName(factory, "2024/Jan/4th/Mon.md", "YYYY/MMM/Wo/ddd")!.add(1, "year");
	assert.equal(ymd(parseDailyNoteName(factory, "2024/Jan/4th/Mon.md", "YYYY/MMM/Wo/ddd")), "2024-01-22");
});

test("a time at the start of the text is written in the 12-hour clock", () => {
	assert.equal(convert24HourPrefix(factory, "09:30 standup"), "9:30 am standup");
	assert.equal(convert24HourPrefix(factory, "14:00"), "2:00 pm");
	// moment reads 24:00 as the midnight that ends the day.
	assert.equal(convert24HourPrefix(factory, "24:00 wrap up"), "12:00 am wrap up");
});

test("text that does not start with a 24-hour time is left alone", () => {
	for (const text of ["25:00 too late", "9:30 one digit", "call at 09:30", "0930", ""]) {
		assert.equal(convert24HourPrefix(factory, text), text, text);
	}
});

test("the 12-hour time is written in the locale's words and digits", () => {
	inLocale("zh-cn", () => assert.equal(convert24HourPrefix(factory, "14:00 会议"), "2:00 下午 会议"));
	// moment reads the locale's own digits too, which is why this stays a moment call.
	inLocale("ar", () => assert.equal(convert24HourPrefix(factory, "٠٩:٣٠ اجتماع"), "٩:٣٠ ص اجتماع"));
});

// Issue #108: the label was computed from the current time, not from the current day,
// so from about noon onwards every task two or more days away read "in a day".

const noWarning = (message: string) => assert.fail(`unexpected warning: ${message}`);

test("a date two days away reads the same at any time of day", () => {
	for (const hour of ["00:30", "09:00", "14:00", "23:30"]) {
		assert.equal(
			relativeDate(at("2026-09-24 00:00"), at(`2026-09-22 ${hour}`), "en", noWarning),
			"in 2 days",
			hour,
		);
	}
});

test("today, tomorrow and yesterday keep their words, capitalized", () => {
	const now = at("2026-09-22 14:00");
	assert.equal(relativeDate(at("2026-09-22 00:00"), now, "en", noWarning), "Today");
	assert.equal(relativeDate(at("2026-09-23 00:00"), now, "en", noWarning), "Tomorrow");
	assert.equal(relativeDate(at("2026-09-21 00:00"), now, "en", noWarning), "Yesterday");
	assert.equal(relativeDate(at("2026-09-19 00:00"), now, "en", noWarning), "3 days ago");
	assert.equal(relativeDate(at("2026-10-02 00:00"), now, "en", noWarning), "in 10 days");
});

test("the time of day of the date itself does not change the label", () => {
	const now = at("2026-09-22 09:00");
	assert.equal(relativeDate(at("2026-09-24 23:00"), now, "en", noWarning), "in 2 days");
	assert.equal(relativeDate(at("2026-09-24 01:00"), now, "en", noWarning), "in 2 days");
});

test("the label is written in the given locale", () => {
	const now = at("2026-09-22 14:00");
	assert.equal(relativeDate(at("2026-09-23 00:00"), now, "zh-cn", noWarning), "明天");
	assert.equal(relativeDate(at("2026-09-24 00:00"), now, "zh-cn", noWarning), "后天");
	assert.equal(relativeDate(at("2026-09-19 00:00"), now, "zh-cn", noWarning), "3天前");
});

test("a locale the platform cannot format falls back to moment's words, with a warning", () => {
	const warnings: [string, unknown][] = [];
	const label = relativeDate(at("2026-09-24 00:00"), at("2026-09-22 14:00"), "not a locale", (message, error) =>
		warnings.push([message, error]),
	);
	assert.equal(label, "in 2 days");
	assert.equal(warnings.length, 1);
	const [message, error] = warnings[0];
	assert.match(message, /not a locale/);
	// The error itself is passed on, so the console shows its stack.
	assert.ok(error instanceof RangeError);
});

/**
 * Runs with a stand-in for Intl.RelativeTimeFormat that records the locale of every formatter built, then puts the
 * real one back. The stand-in is the real formatter underneath, so a formatter dates.ts keeps still works afterwards.
 */
function countingFormatters(run: (built: string[]) => void) {
	const real = Object.getOwnPropertyDescriptor(Intl, "RelativeTimeFormat");
	if (!real) assert.fail("this platform has no Intl.RelativeTimeFormat");
	const built: string[] = [];
	class Counting extends Intl.RelativeTimeFormat {
		constructor(...args: ConstructorParameters<typeof Intl.RelativeTimeFormat>) {
			// Before super(), so a locale the platform rejects is counted too.
			built.push(String(args[0]));
			super(...args);
		}
	}
	Object.defineProperty(Intl, "RelativeTimeFormat", { ...real, value: Counting });
	try {
		run(built);
	} finally {
		Object.defineProperty(Intl, "RelativeTimeFormat", real);
	}
}

test("each locale's formatter is built once, not once per label", () => {
	const now = at("2026-09-22 14:00");
	// Locales no other test formats, so neither has a formatter yet.
	countingFormatters((built) => {
		assert.equal(relativeDate(at("2026-09-23 00:00"), now, "de", noWarning), "Morgen");
		assert.equal(relativeDate(at("2026-09-24 00:00"), now, "de", noWarning), "übermorgen");
		assert.equal(relativeDate(at("2026-09-19 00:00"), now, "de", noWarning), "vor 3 Tagen");
		assert.equal(relativeDate(at("2026-09-24 00:00"), now, "fr", noWarning), "après-demain");
		assert.equal(relativeDate(at("2026-09-25 00:00"), now, "fr", noWarning), "dans 3 jours");
		assert.equal(relativeDate(at("2026-09-21 00:00"), now, "de", noWarning), "Gestern");
		assert.deepEqual(built, ["de", "fr"]);
	});
});

test("a locale the platform rejects is tried again, and warned about, on every label", () => {
	const now = at("2026-09-22 14:00");
	const warnings: string[] = [];
	const warn = (message: string) => warnings.push(message);
	countingFormatters((built) => {
		assert.equal(relativeDate(at("2026-09-24 00:00"), now, "still not a locale", warn), "in 2 days");
		assert.equal(relativeDate(at("2026-09-19 00:00"), now, "still not a locale", warn), "3 days ago");
		assert.deepEqual(built, ["still not a locale", "still not a locale"]);
	});
	assert.equal(warnings.length, 2);
});

test("reading a relative date changes neither date", () => {
	const date = at("2026-09-24 23:00");
	const now = at("2026-09-22 14:00");
	relativeDate(date, now, "en", noWarning);
	assert.equal(date.format("YYYY-MM-DD HH:mm"), "2026-09-24 23:00");
	assert.equal(now.format("YYYY-MM-DD HH:mm"), "2026-09-22 14:00");
});

test("days compare by the calendar day, whatever the time", () => {
	assert.ok(sameDay(at("2026-01-15 00:00"), at("2026-01-15 23:59")));
	assert.ok(!sameDay(at("2026-01-15 23:59"), at("2026-01-16 00:00")));
	assert.ok(beforeDay(at("2026-01-14 23:00"), at("2026-01-15 01:00")));
	assert.ok(!beforeDay(at("2026-01-15 01:00"), at("2026-01-15 23:00")));
	assert.ok(sameYear(at("2026-01-01 00:00"), at("2026-12-31 23:59")));
	assert.ok(!sameYear(at("2025-12-31 23:59"), at("2026-01-01 00:00")));
});

test("instants compare to the millisecond", () => {
	assert.ok(afterInstant(at("2026-01-15 09:01"), at("2026-01-15 09:00")));
	assert.ok(!afterInstant(at("2026-01-15 09:00"), at("2026-01-15 09:00")));
	const instant = (text: string) => moment(text, "YYYY-MM-DD HH:mm:ss.SSS", true);
	assert.ok(afterInstant(instant("2026-01-15 09:00:00.001"), instant("2026-01-15 09:00:00.000")));
	assert.ok(!afterInstant(instant("2026-01-15 09:00:00.000"), instant("2026-01-15 09:00:00.001")));
});

test("between leaves out both end days, as moment's isBetween does by default", () => {
	const from = day("2026-01-14");
	const to = day("2026-01-16");
	assert.ok(betweenDaysExclusive(at("2026-01-15 12:00"), from, to));
	assert.ok(!betweenDaysExclusive(at("2026-01-14 12:00"), from, to));
	assert.ok(!betweenDaysExclusive(at("2026-01-16 00:00"), from, to));
});

// Issue #54: an option to show the latest dates on top

test("days and years are shown from the earliest by default", () => {
	assert.deepEqual(inDisplayOrder(["2023-08-01", "2023-02-01", "2023-05-01"], false), [
		"2023-02-01",
		"2023-05-01",
		"2023-08-01",
	]);
	assert.deepEqual(inDisplayOrder([2025, 2023, 2026], false), [2023, 2025, 2026]);
});

test("days and years are shown from the latest with newest first", () => {
	assert.deepEqual(inDisplayOrder(["2023-08-01", "2023-02-01", "2023-05-01"], true), [
		"2023-08-01",
		"2023-05-01",
		"2023-02-01",
	]);
	assert.deepEqual(inDisplayOrder([2025, 2023, 2026], true), [2026, 2025, 2023]);
});
