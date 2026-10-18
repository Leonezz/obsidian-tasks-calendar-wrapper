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
	["in 10 days", "2026-10-25"],
	["in 100 days", "2027-01-23"],
	["in 2 weeks", "2026-10-29"],
	["in 1 week", "2026-10-22"],
	["in 1 month", "2026-11-15"],
	["in 1 year", "2027-10-15"],
	["in 2 years", "2028-10-15"],
	// The days after today in this week are this week's; the day itself and the ones before it are next week's.
	["friday", "2026-10-16"],
	["saturday", "2026-10-17"],
	["sunday", "2026-10-18"],
	["thursday", "2026-10-22"],
	["monday", "2026-10-19"],
	["tuesday", "2026-10-20"],
	["wednesday", "2026-10-21"],
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

const words = [
	"due",
	"start",
	"scheduled",
	"done",
	"repeat",
	"recurring",
	"today",
	"tomorrow",
	"yesterday",
	"in 3 days",
];
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

test("a word is only replaced once a space follows it", () => {
	for (const word of [...words, ...weekdays]) {
		assert.equal(expandShortcuts(`call ${word}`, today()), `call ${word}`, word);
	}
});

test("when several words match at once only the last rule's replacement is kept", () => {
	const pairs: [typed: string, expanded: string][] = [
		["call due tomorrow ", "call due 2026-10-16 "],
		["due start ", "due 🛫 "],
		["scheduled done ", "scheduled ✅ "],
		["repeat recurring ", "repeat 🔁 "],
		["today tomorrow ", "today 2026-10-16 "],
		["tomorrow yesterday ", "tomorrow 2026-10-14 "],
		["due today ", "due 2026-10-15 "],
		["today in 3 days ", "today 2026-10-18 "],
		["in 3 days monday ", "in 3 days 2026-10-19 "],
		["due monday ", "due 2026-10-19 "],
	];
	for (const [typed, expanded] of pairs) assert.equal(expandShortcuts(typed, today()), expanded, typed);
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

test("a word is replaced where it first appears, even inside another word", () => {
	const typed: [typed: string, expanded: string][] = [
		["pay overdue bill due ", "pay over📅 bill due "],
		["restart server start ", "re🛫 server start "],
		["abandoned project done ", "aban✅d project done "],
		["todays today ", "2026-10-15s today "],
		["call mondays monday ", "call 2026-10-19s monday "],
		["everymonday ", "every2026-10-19 "],
		["call within 3 days ", "call with2026-10-18 "],
	];
	for (const [text, expanded] of typed) assert.equal(expandShortcuts(text, today()), expanded, text);
});

test("a count needs one character on each side of it, and anything may follow its unit's space", () => {
	for (const text of ["call 📅 in  3 days ", "call 📅 in3 days "]) assert.equal(expandShortcuts(text, today()), text);
	assert.equal(expandShortcuts("call 📅 in 3 days #x", today()), "call 📅 2026-10-18 #x");
	assert.equal(expandShortcuts("call 📅 monday #x", today()), "call 📅 2026-10-19 #x");
});

test("the dates are the days of today's own time zone, also late in the evening", () => {
	// A Monday. Core's runner runs this file in a zone ahead of UTC and one behind it too.
	const late = moment("2026-10-12 23:30", "YYYY-MM-DD HH:mm", true);
	assert.equal(expandShortcuts("call 📅 tomorrow ", late), "call 📅 2026-10-13 ");
	assert.equal(expandShortcuts("call 📅 friday ", late), "call 📅 2026-10-16 ");
	assert.equal(expandShortcuts("call 📅 monday ", late), "call 📅 2026-10-19 ");
	assert.equal(expandShortcuts("call 📅 in 1 year ", late), "call 📅 2027-10-12 ");
	// Just after midnight on a Monday, and just before it on a Sunday, the UTC day is in another week in some zones.
	const mondayMorning = moment("2026-10-12 00:30", "YYYY-MM-DD HH:mm", true);
	assert.equal(expandShortcuts("call 📅 friday ", mondayMorning), "call 📅 2026-10-16 ");
	const sundayNight = moment("2026-10-18 23:30", "YYYY-MM-DD HH:mm", true);
	assert.equal(expandShortcuts("call 📅 monday ", sundayNight), "call 📅 2026-10-19 ");
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
