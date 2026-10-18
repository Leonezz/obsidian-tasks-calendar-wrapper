import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/ar";

import { dayKey } from "../src/dates";
import { parseTaskLine } from "../src/parse";
import { expandShortcuts } from "../src/quickentry";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// Ported from the plugin's tests/quickentry.test.ts. The date words wrote the day in the locale's own digits, e.g.
// "📅 ٢٠٢٦-١٠-١٦" in Arabic. Neither this plugin nor the Tasks plugin reads those, so the new task had no due date and
// was listed as unplanned.

/** A Thursday. */
const TODAY = "2026-10-15";
const today = () => moment(TODAY, "YYYY-MM-DD", true);

/** Each date word and the day it stands for on TODAY. */
const dateWords: [word: string, day: string][] = [
	["today", "2026-10-15"],
	["tomorrow", "2026-10-16"],
	["yesterday", "2026-10-14"],
	["in 3 days", "2026-10-18"],
	["in 1 day", "2026-10-16"],
	["in 2 weeks", "2026-10-29"],
	["in 1 week", "2026-10-22"],
	["in 1 month", "2026-11-15"],
	["in 1 year", "2027-10-15"],
	["in 2 years", "2028-10-15"],
	["saturday", "2026-10-17"],
	// The day of the week itself, or one before it, is next week's.
	["thursday", "2026-10-22"],
	["monday", "2026-10-19"],
];

/**
 * Types a date word after the due date symbol on TODAY, then reads the task that quick entry adds, all with moment in
 * the given locale, as Obsidian sets it for its app language.
 */
function enterDueDate(word: string, locale: string): { text: string; due?: string } {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale(locale), locale, `moment locale ${locale} is not loaded`);
		const text = expandShortcuts(`call 📅 ${word} `, today());
		const task = parseTaskLine("- [ ] " + text, { moment });
		assert.ok(task, text);
		return { text, due: task.dates.due && dayKey(task.dates.due) };
	} finally {
		moment.locale(previous);
	}
}

test("the date words write the day in ASCII digits in a locale with digits of its own", () => {
	for (const [word, day] of dateWords) {
		const { text, due } = enterDueDate(word, "ar");
		assert.equal(text, `call 📅 ${day} `, `"${word}" in Arabic`);
		assert.equal(due, day, `the due date of "${word}" in Arabic`);
	}
});

test("the date words write the same text in English", () => {
	for (const [word, day] of dateWords) {
		const { text, due } = enterDueDate(word, "en");
		assert.equal(text, `call 📅 ${day} `, `"${word}" in English`);
		assert.equal(due, day, `the due date of "${word}" in English`);
	}
});

test("the symbol words become task symbols", () => {
	assert.equal(expandShortcuts("call due ", today()), "call 📅 ");
	assert.equal(expandShortcuts("call start ", today()), "call 🛫 ");
	assert.equal(expandShortcuts("call scheduled ", today()), "call ⏳ ");
	assert.equal(expandShortcuts("call done ", today()), "call ✅ ");
	assert.equal(expandShortcuts("call repeat ", today()), "call 🔁 ");
	assert.equal(expandShortcuts("call recurring ", today()), "call 🔁 ");
});

test("a word is only replaced once a space follows it", () => {
	assert.equal(expandShortcuts("call 📅 tomorrow", today()), "call 📅 tomorrow");
	assert.equal(expandShortcuts("call 📅 in 3 days", today()), "call 📅 in 3 days");
});

test("when several words match at once only the last rule's replacement is kept", () => {
	assert.equal(expandShortcuts("call due tomorrow ", today()), "call due 2026-10-16 ");
});

test("text with nothing to replace is returned as it is", () => {
	assert.equal(expandShortcuts("call the plumber", today()), "call the plumber");
	assert.equal(expandShortcuts("", today()), "");
});

// Known quirks, kept until they are fixed on purpose.

test("the counted words are matched as written: months, capitals and four-digit counts are left alone", () => {
	for (const text of ["call 📅 in 2 months ", "call 📅 in 2 Days ", "call 📅 in 1000 days ", "call 📅 Monday "]) {
		assert.equal(expandShortcuts(text, today()), text);
	}
	assert.equal(expandShortcuts("call 📅 in-3-days ", today()), "call 📅 2026-10-18 ");
});

test("a weekday on a Sunday is in the week after it", () => {
	const sunday = moment("2026-10-18", "YYYY-MM-DD", true);
	assert.equal(expandShortcuts("call 📅 monday ", sunday), "call 📅 2026-10-19 ");
	assert.equal(expandShortcuts("call 📅 sunday ", sunday), "call 📅 2026-10-25 ");
	assert.equal(expandShortcuts("call 📅 saturday ", sunday), "call 📅 2026-10-24 ");
});

test("today's date is not changed", () => {
	const date = today();
	expandShortcuts("call 📅 in 3 days tomorrow monday ", date);
	assert.equal(date.format("YYYY-MM-DD HH:mm"), "2026-10-15 00:00");
});
