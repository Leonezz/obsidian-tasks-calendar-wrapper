import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import moment from "moment";
import "moment/locale/ar";

import { dayKey } from "@tasks-calendar-wrapper/core";

import { expandShortcuts } from "../utils/quickentry";
import { parse } from "./helpers";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// The date words wrote the day in the locale's own digits, e.g. "📅 ٢٠٢٦-١٠-١٦" in Arabic. Neither this
// plugin nor the Tasks plugin reads those, so the new task had no due date and was listed as unplanned.

/** A Thursday. */
const TODAY = "2026-10-15";

/** Each date word and the day it stands for on TODAY. */
const dateWords: [word: string, day: string][] = [
	["today", "2026-10-15"],
	["tomorrow", "2026-10-16"],
	["yesterday", "2026-10-14"],
	["in 3 days", "2026-10-18"],
	["in 2 weeks", "2026-10-29"],
	["in 1 month", "2026-11-15"],
	["in 1 year", "2027-10-15"],
	["saturday", "2026-10-17"],
	// The day of the week itself, or one before it, is next week's.
	["thursday", "2026-10-22"],
	["monday", "2026-10-19"],
];

/**
 * Types a date word after the due date symbol on TODAY, then reads the task that quick entry adds, all with
 * moment in the given locale, as Obsidian sets it for its app language.
 */
async function enterDueDate(word: string, locale: string): Promise<{ text: string; due?: string }> {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale(locale), locale, `moment locale ${locale} is not loaded`);
		const today = moment(TODAY, "YYYY-MM-DD", true);
		const text = expandShortcuts(`call 📅 ${word} `, today);
		const task = await parse("- [ ] " + text, today);
		return { text, due: task.due && dayKey(task.due) };
	} finally {
		moment.locale(previous);
	}
}

test("the date words write the day in ASCII digits in a locale with digits of its own", async () => {
	for (const [word, day] of dateWords) {
		const { text, due } = await enterDueDate(word, "ar");
		assert.equal(text, `call 📅 ${day} `, `"${word}" in Arabic`);
		assert.equal(due, day, `the due date of "${word}" in Arabic`);
	}
});

test("the date words write the same text in English", async () => {
	for (const [word, day] of dateWords) {
		const { text, due } = await enterDueDate(word, "en");
		assert.equal(text, `call 📅 ${day} `, `"${word}" in English`);
		assert.equal(due, day, `the due date of "${word}" in English`);
	}
});

test("the symbol words become task symbols", () => {
	const today = moment(TODAY, "YYYY-MM-DD", true);
	assert.equal(expandShortcuts("call due ", today), "call 📅 ");
	assert.equal(expandShortcuts("call start ", today), "call 🛫 ");
	assert.equal(expandShortcuts("call scheduled ", today), "call ⏳ ");
	assert.equal(expandShortcuts("call done ", today), "call ✅ ");
	assert.equal(expandShortcuts("call repeat ", today), "call 🔁 ");
	assert.equal(expandShortcuts("call recurring ", today), "call 🔁 ");
});

test("a word is only replaced once a space follows it", () => {
	assert.equal(expandShortcuts("call 📅 tomorrow", moment(TODAY, "YYYY-MM-DD", true)), "call 📅 tomorrow");
});

test("when several words match at once only the last rule's replacement is kept", () => {
	assert.equal(expandShortcuts("call due tomorrow ", moment(TODAY, "YYYY-MM-DD", true)), "call due 2026-10-16 ");
});
