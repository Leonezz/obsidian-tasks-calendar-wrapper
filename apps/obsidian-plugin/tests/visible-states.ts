/**
 * The states scripts/screenshots.mjs takes, and what it wrote for each in fixtures/screenshots/visible/<state>.txt:
 * one line per year, entry panel element, date and task that a real Obsidian displayed for fixtures/golden-vault. The
 * tests that compare against them share this: what a state's name means, the settings it was taken with, and how a
 * snapshot's lines are compared. Colours are left out: they depend on the theme, not on the data. A row's text is
 * compared where it has no markdown syntax; where it has, Obsidian displayed it rendered, e.g. [[Inbox]] as Inbox.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { taskRowModel, type QueryResult, type ResolvedTask, type TaskStatus } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { moment } from "../utils/moment";
import { FIXTURES } from "./golden-vault";

const VISIBLE = path.join(FIXTURES, "screenshots", "visible");

/** What scripts/screenshots.mjs set: today pinned to noon, and English. */
export const SCREENSHOT_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
export const NOW = moment(SCREENSHOT_NOW).locale("en");

export type Counter = "todo" | "overdue" | "unplanned";

export interface State {
	readonly position: "top" | "today" | "bottom";
	readonly todayFocus: boolean;
	readonly counter?: Counter;
	readonly behavior?: "Filter" | "Focus";
}

const statePattern =
	/^light-(top|today|bottom)-(all-days|today-focus)-(?:no-counter|(todo|overdue|unplanned)-(filter|focus))$/;

export function stateOf(name: string): State {
	const match = statePattern.exec(name);
	if (!match) assert.fail(`${name} is not a state scripts/screenshots.mjs takes`);
	const [, position, days, counter, behavior] = match;
	return {
		position: position as State["position"],
		todayFocus: days === "today-focus",
		counter: counter as Counter | undefined,
		behavior: behavior === undefined ? undefined : behavior === "filter" ? "Filter" : "Focus",
	};
}

/** The statuses the Focus behaviour highlights, as styles.css lists them. */
export const highlightedBy: Record<Counter, readonly TaskStatus[]> = {
	todo: ["due", "scheduled", "process", "start"],
	overdue: ["overdue"],
	unplanned: ["unplanned"],
};

/** The settings the screenshots were taken with: the defaults, without a counter or Focus on today at load. */
export function settingsOf(state: State): UserOption {
	return {
		...structuredClone(defaultUserOptions),
		defaultFilters: "",
		defaultTodayFocus: false,
		entryPosition: state.position,
		counterBehavior: state.behavior ?? "Filter",
	};
}

export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Text whose rendered form could read differently: links, footnotes, emphasis, code, HTML, escapes, block markers. */
const markdown = /[[\]*_`~=<>\\$^|!&]|^\s*(?:#|>|\d+[.)]\s|[-+*]\s)/;

/** A line the script writes, with a row's text taken out of it, so that the text can be compared on its own. */
export interface Line {
	readonly line: string;
	/** The row's text, for a row. */
	readonly text?: string;
}

/** A row's line without its text: its status, whether it is highlighted, and the texts of its badges. */
export const rowLine = (status: string, highlighted: boolean, badges: readonly string[]) =>
	`  task ${status}${highlighted ? " highlighted" : ""}: … | ${badges.join(" · ")}`;

/** The lines of the entry panel. */
export const entryLines = (counts: { readonly todo: number; readonly overdue: number; readonly unplanned: number }) => [
	`today header "Focus On Today"`,
	`counter ${counts.todo} Todo`,
	`counter ${counts.overdue} Overdue`,
	`counter ${counts.unplanned} Unplanned`,
	"quick entry",
];

const taskPattern = /^( {2}task [^:]+): (.*) \| (.*)$/;

/** A snapshot's lines, without the colours. */
function snapshotLines(text: string): Line[] {
	return text
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => {
			if (line.startsWith("today header ") || line.startsWith("counter "))
				return { line: line.replace(/, color .*$/, "") };
			const task = taskPattern.exec(line);
			return task ? { line: `${task[1]}: … | ${task[3]}`, text: task[2] } : { line };
		});
}

/** The names of the states that have a snapshot, sorted. */
export const stateNames = readdirSync(VISIBLE)
	.filter((file) => file.endsWith(".txt"))
	.map((file) => file.slice(0, -4))
	.sort();

/** Asserts that `actual` is what the state's snapshot says was displayed. */
export function assertDisplayed(actual: readonly Line[], name: string): void {
	const expected = snapshotLines(readFileSync(path.join(VISIBLE, `${name}.txt`), "utf8"));
	assert.deepEqual(
		actual.map((line) => line.line),
		expected.map((line) => line.line),
		name,
	);
	const plain = actual.flatMap((line, i) =>
		line.text !== undefined && !markdown.test(line.text) ? [[i, line.text, expected[i].text]] : [],
	);
	assert.ok(plain.length > 0, `${name} has rows without markdown`);
	assert.deepEqual(
		plain.map(([i, text]) => [i, text]),
		plain.map(([i, , text]) => [i, text]),
		`${name}: the text of rows without markdown`,
	);
}

/** A row as the script writes it: its status, whether it is highlighted, its text and the texts of its badges. */
function taskLine(resolved: ResolvedTask, settings: UserOption, highlighted: boolean): Line {
	const row = taskRowModel(
		resolved,
		{
			dateFormat: settings.dateFormat,
			hideTags: settings.hideTags,
			tagPalette: settings.tagColorPalette,
			useBuiltinStyle: settings.useBuiltinStyle,
		},
		{ now: NOW, moment, warn: (message) => assert.fail(message) },
	);
	const badges = [
		...row.badges.map((badge) => badge.label),
		row.fileTitle + (row.subPath !== "" ? " > " + row.subPath : ""),
		...row.tags.map((tag) => tag.tag.replace("#", "")),
	]
		.map(collapse)
		.filter(Boolean);
	return { line: rowLine(row.status, highlighted, badges), text: collapse(row.display) };
}

/** The lines the script writes for what core arranges, laid out as the views render it, colours left out. */
export function displayed(arranged: QueryResult, state: State, settings: UserOption): Line[] {
	const highlights = state.behavior === "Focus" && state.counter ? highlightedBy[state.counter] : [];
	const lines: Line[] = [];
	const add = (...texts: string[]) => lines.push(...texts.map((line) => ({ line })));
	for (const year of arranged.years) {
		// Focus on today hides the year headers and every day but today.
		if (year.showHeader && !state.todayFocus) add(`year ${year.label}`);
		for (const day of year.days) {
			if (day.isEntry) add(...entryLines(arranged.counts));
			if (day.tasks.length === 0 || (state.todayFocus && !day.isToday)) continue;
			add(`date ${day.label}`);
			for (const resolved of day.tasks) {
				lines.push(taskLine(resolved, settings, highlights.includes(resolved.status)));
			}
		}
	}
	return lines;
}
