// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	query,
	taskRowModel,
	type QueryResult,
	type ResolvedTask,
	type TaskStatus,
} from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { FIXTURES, goldenApp, loadVault } from "./golden-vault";

/**
 * What the timeline displayed in a real Obsidian for fixtures/golden-vault, fixtures/screenshots/visible/<state>.txt,
 * against what core arranges for the same notes, settings and state, laid out the way the views render it. The
 * snapshots were taken with the views and the stylesheet's Filter rules, which arrange now does in data. Focus on
 * today and the Focus highlight stay in the stylesheet, so they are applied here as styles.css applies them. Colours are
 * left out: they depend on the theme, not on the data. A row's text is compared where it has no markdown syntax; where
 * it has, Obsidian displayed it rendered, e.g. [[Inbox]] as Inbox.
 */

const VISIBLE = path.join(FIXTURES, "screenshots", "visible");

/** What scripts/screenshots.mjs set: today pinned to noon, and English. */
const NOW = moment("2026-01-15 12:00", "YYYY-MM-DD HH:mm", true);

type Counter = "todo" | "overdue" | "unplanned";

interface State {
	readonly position: "top" | "today" | "bottom";
	readonly todayFocus: boolean;
	readonly counter?: Counter;
	readonly behavior?: "Filter" | "Focus";
}

const statePattern =
	/^light-(top|today|bottom)-(all-days|today-focus)-(?:no-counter|(todo|overdue|unplanned)-(filter|focus))$/;

function stateOf(name: string): State {
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
const highlightedBy: Record<Counter, readonly TaskStatus[]> = {
	todo: ["due", "scheduled", "process", "start"],
	overdue: ["overdue"],
	unplanned: ["unplanned"],
};

/** The settings the screenshots were taken with: the defaults, without a counter or Focus on today at load. */
function settingsOf(state: State): UserOption {
	return {
		...structuredClone(defaultUserOptions),
		defaultFilters: "",
		defaultTodayFocus: false,
		entryPosition: state.position,
		counterBehavior: state.behavior ?? "Filter",
	};
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Text whose rendered form could read differently: links, footnotes, emphasis, code, HTML, escapes, block markers. */
const markdown = /[[\]*_`~=<>\\$^|!&]|^\s*(?:#|>|\d+[.)]\s|[-+*]\s)/;

/** A line the script writes, with a row's text taken out of it, so that the text can be compared on its own. */
interface Line {
	readonly line: string;
	/** The row's text, for a row. */
	readonly text?: string;
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
	return {
		line: `  task ${row.status}${highlighted ? " highlighted" : ""}: … | ${badges.join(" · ")}`,
		text: collapse(row.display),
	};
}

/** The lines the script writes for what is displayed, colours left out. */
function displayed(arranged: QueryResult, state: State, settings: UserOption): Line[] {
	const highlights = state.behavior === "Focus" && state.counter ? highlightedBy[state.counter] : [];
	const { counts } = arranged;
	const lines: Line[] = [];
	const add = (...texts: string[]) => lines.push(...texts.map((line) => ({ line })));
	for (const year of arranged.years) {
		// Focus on today hides the year headers and every day but today.
		if (year.showHeader && !state.todayFocus) add(`year ${year.label}`);
		for (const day of year.days) {
			if (day.isEntry) {
				add(
					`today header "Focus On Today"`,
					`counter ${counts.todo} Todo`,
					`counter ${counts.overdue} Overdue`,
					`counter ${counts.unplanned} Unplanned`,
					"quick entry",
				);
			}
			if (day.tasks.length === 0 || (state.todayFocus && !day.isToday)) continue;
			add(`date ${day.label}`);
			for (const resolved of day.tasks) {
				lines.push(taskLine(resolved, settings, highlights.includes(resolved.status)));
			}
		}
	}
	return lines;
}

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

const names = readdirSync(VISIBLE)
	.filter((file) => file.endsWith(".txt"))
	.map((file) => file.slice(0, -4))
	.sort();

test("visible: every light state has a snapshot", () => {
	// 3 entry positions × Focus on today off and on × no counter, or 3 counters with Filter or Focus.
	assert.equal(names.length, 3 * 2 * 7);
});

test("visible: core arranges what the timeline displayed in Obsidian, in every state", async () => {
	const tasks = await readTasks(goldenApp(loadVault()), defaultUserOptions, moment);
	for (const name of names) {
		const state = stateOf(name);
		const settings = settingsOf(state);
		const arranged = query(
			tasks,
			{ settings, counter: state.counter && state.behavior ? `${state.counter}Filter` : "" },
			{ now: NOW, moment },
		);
		const actual = displayed(arranged, state, settings);
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
});
