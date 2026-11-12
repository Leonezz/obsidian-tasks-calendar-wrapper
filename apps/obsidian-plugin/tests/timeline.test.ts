// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import "moment/locale/ar";

import { query, taskRowModel, type QuickFilter, type Task } from "@tasks-calendar-wrapper/core";
import { onTimelineRender } from "@tasks-calendar-wrapper/ui";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { timelineElement } from "./timeline-element";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { goldenApp, loadVault } from "./golden-vault";
import { notesApp } from "./view-harness";
import { cssRules } from "./css-rules";
import { allWithClass, classesOf, displayedLines, findClass, parseMarkup, textOf, type Element } from "./markup";
import {
	assertDisplayed,
	displayed,
	entryLines,
	NOW,
	SCREENSHOT_NOW,
	settingsOf,
	stateNames,
	stateOf,
	highlightedBy,
	type State,
} from "./visible-states";

/**
 * The timeline's views, rendered to markup from fixtures/golden-vault the way the plugin renders them, against what a
 * real Obsidian displayed (see visible-states.ts). The views take their layout from core's query, so only the
 * stylesheet's rules that are left (Focus on today, the Focus highlight) hide or mark anything.
 */

// The screenshots were taken with today pinned to noon, in English. Loading the Arabic locale switched moment to it.
moment.now = () => SCREENSHOT_NOW;
moment.locale("en");

/** The timeline as it opens with the state's counter and Focus on today active. */
function rendered(tasks: readonly Task[], state: State, extra: Partial<UserOption> = {}, quickFilter?: QuickFilter) {
	const userOptions: UserOption = {
		...settingsOf(state),
		defaultFilters: state.counter ? `${state.counter}Filter` : "",
		defaultTodayFocus: state.todayFocus,
		...extra,
	};
	return renderToStaticMarkup(timelineElement({ userOptions, tasks, quickFilter }));
}

let golden: Promise<Task[]> | undefined;
const goldenTasks = () => (golden ??= readTasks(goldenApp(loadVault()), defaultUserOptions, moment));

const focusTasks = (todayText = "today") =>
	readTasks(
		notesApp({
			"Before.md": "- [ ] before 📅 2026-01-14",
			"Today.md": `- [ ] ${todayText} 📅 2026-01-15`,
			"After.md": "- [ ] after 📅 2026-01-16",
		}) as never,
		defaultUserOptions,
		moment,
	);

const focusEntryLines = (todo: number) => entryLines({ todo, overdue: 1, unplanned: 0 }).map((line) => ({ line }));
const focusTodayLines = [{ line: "date Thursday, Jan, 15" }, { line: "  task due: … | Today · Today", text: "today" }];

test("timeline: Focus on today shows the entry panel at the top and today's rows", async () => {
	const tasks = await focusTasks();
	assert.deepEqual(displayedLines(rendered(tasks, { position: "top", todayFocus: true }, { forward: false })), [
		...focusEntryLines(2),
		...focusTodayLines,
	]);
});

test("timeline: Focus on today shows the entry panel at today and today's rows", async () => {
	const tasks = await focusTasks();
	assert.deepEqual(displayedLines(rendered(tasks, { position: "today", todayFocus: true }, { forward: false })), [
		...focusEntryLines(2),
		...focusTodayLines,
	]);
});

test("timeline: Focus on today shows the entry panel at the bottom and today's rows", async () => {
	const tasks = await focusTasks();
	assert.deepEqual(displayedLines(rendered(tasks, { position: "bottom", todayFocus: true }, { forward: false })), [
		...focusTodayLines,
		...focusEntryLines(2),
	]);
});

test("timeline: Focus on today keeps today and its entry panel when filtered empty tasks leave it without rows", async () => {
	const tasks = await focusTasks("");
	const state: State = { position: "today", todayFocus: true };
	const extra = { forward: false, filterEmpty: true };
	assert.equal(tasks.length, 3, "the empty task is present before resolving");
	const result = query(tasks, { settings: { ...settingsOf(state), ...extra }, counter: "" }, { now: NOW, moment });
	const today = result.years.flatMap((year) => year.days).find((day) => day.isToday);
	assert.ok(today?.isEntry);
	assert.deepEqual(today.tasks, []);
	assert.deepEqual(displayedLines(rendered(tasks, state, extra)), focusEntryLines(1));
	assert.deepEqual(displayedLines(rendered(tasks, { ...state, todayFocus: false }, extra)), [
		{ line: "year 2026" },
		{ line: "date Wednesday, Jan, 14" },
		{ line: "  task overdue: … | Yesterday · Before", text: "before" },
		...focusEntryLines(1),
		{ line: "date Friday, Jan, 16" },
		{ line: "  task scheduled: … | Tomorrow · After", text: "after" },
	]);
});

test("timeline: Focus on today renders only today's rows", async () => {
	const tasks = await goldenTasks();
	const names = stateNames.filter((name) => stateOf(name).todayFocus);
	assert.equal(names.length, 21);
	for (const name of names) {
		const state = stateOf(name);
		const counter = state.counter ? (`${state.counter}Filter` as const) : "";
		const result = query(tasks, { settings: settingsOf(state), counter }, { now: NOW, moment });
		const today = result.years.flatMap((year) => year.days).find((day) => day.isToday);
		assert.ok(today, name);
		const markup = parseMarkup(rendered(tasks, state));
		assert.equal(allWithClass(markup, "year").length, 0, `${name}: no year headers`);
		assert.deepEqual(
			allWithClass(markup, "task").map(({ attrs }) => [
				attrs["data-line"],
				attrs["data-task"],
				attrs["data-link"],
			]),
			today.tasks.map(({ task }) => [
				String(task.line),
				task.statusMarker,
				task.section.path.replace("'", "&apos;"),
			]),
			`${name}: today's rows in order`,
		);
		assert.ok(
			allWithClass(markup, "details").every((element) => classesOf(element).includes("today")),
			`${name}: only today's details`,
		);
		for (const panel of ["todayHeader", "counters", "quickEntryPanel"])
			assert.equal(allWithClass(markup, panel).length, 1, `${name}: ${panel}`);
	}
});

test("timeline: the views display what the timeline displayed in Obsidian, in every state", async () => {
	const tasks = await goldenTasks();
	for (const name of stateNames) assertDisplayed(displayedLines(rendered(tasks, stateOf(name))), name);
});

test("timeline: the views display the quick filter's tasks, laid out as core arranges them", async () => {
	const tasks = await goldenTasks();
	const state = stateOf("light-today-all-days-no-counter");
	const settings = settingsOf(state);
	for (const quickFilter of [
		{ from: "2026-01-10", to: "2026-01-20", priorities: [] },
		{ priorities: ["High"] },
		{ from: "2026-01-10", priorities: [] },
	]) {
		const expected = displayed(
			query(tasks, { settings, counter: "", quickFilter }, { now: NOW, moment }),
			state,
			settings,
		);
		assert.deepEqual(
			displayedLines(rendered(tasks, state, {}, quickFilter)),
			expected,
			JSON.stringify(quickFilter),
		);
	}
});

test("timeline: each row carries its row model's place, marker, link and status, keyed by the task", async () => {
	const tasks = await goldenTasks();
	const state = stateOf("light-today-all-days-no-counter");
	const settings = settingsOf(state);
	const result = query(tasks, { settings, counter: "" }, { now: NOW, moment });
	const rows = allWithClass(parseMarkup(rendered(tasks, state)), "task");
	const listed = result.years.flatMap((year) => year.days).flatMap((day) => day.tasks);
	assert.equal(rows.length, listed.length);
	assert.ok(rows.length > 50);
	listed.forEach((resolved, i) => {
		const model = taskRowModel(
			resolved,
			{
				dateFormat: settings.dateFormat,
				hideTags: settings.hideTags,
				tagPalette: settings.tagColorPalette,
				useBuiltinStyle: settings.useBuiltinStyle,
			},
			{ now: NOW, moment, warn: (message) => assert.fail(message) },
		);
		const { attrs } = rows[i];
		assert.deepEqual(
			[attrs["data-line"], attrs["data-task"], attrs["data-col"], attrs["data-link"], attrs["data-dailynote"]],
			[String(model.line), model.statusMarker, String(model.col), model.link, String(model.isDailyNote)],
			resolved.task.id,
		);
		assert.deepEqual(
			[attrs["class"], attrs["role"], attrs["aria-label"]],
			[`task ${model.status}`, "listitem", undefined],
		);
		const ids = attrs["aria-labelledby"].split(" ");
		assert.equal(ids.length, 2);
		const content = allWithClass(rows[i], "content")[0];
		const summary = allWithClass(rows[i], "tcw-sr-only")[0];
		assert.deepEqual([content.attrs["id"], summary.attrs["id"]], ids);
		assert.equal(attrs["style"], `--task-color:${(model.color as string | undefined) || "var(--text-muted)"}`);
	});
});

/** Runs with moment in a language, as Obsidian's moment follows the app's. */
function inLocale<T>(locale: string, run: () => T): T {
	const previous = moment.locale();
	try {
		assert.equal(moment.locale(locale), locale, `moment has no "${locale}" locale loaded`);
		return run();
	} finally {
		moment.locale(previous);
	}
}

test("timeline: days and years are marked with today, their year in the locale's digits and their statuses", async () => {
	const tasks = await goldenTasks();
	for (const [name, locale] of [
		["light-today-all-days-no-counter", "en"],
		// Under a filter, data-types keeps the statuses the day lists before it, as the stylesheet's rules read them.
		["light-today-all-days-todo-filter", "en"],
		["light-top-all-days-no-counter", "ar"],
	] as const) {
		const state = stateOf(name);
		const counter = state.counter ? (`${state.counter}Filter` as const) : "";
		const { result, markup } = inLocale(locale, () => ({
			// Now in moment's language, as the timeline takes it when it renders.
			result: query(tasks, { settings: settingsOf(state), counter }, { now: moment(), moment }),
			markup: parseMarkup(rendered(tasks, state)),
		}));
		const outer = allWithClass(markup, "details").filter((element) => findClass(element, "dateLine"));
		const shown = result.years.flatMap((year) =>
			year.days.filter((day) => day.tasks.length > 0).map((day) => ({ year, day })),
		);
		assert.equal(outer.length, shown.length, name);
		shown.forEach(({ year, day }, i) => {
			const expected = {
				class: day.isToday ? "details today" : "details",
				"data-year": year.label,
				"data-types": day.statuses.join(" "),
			};
			const inner = outer[i].children.find(
				(child): child is Element => typeof child !== "string" && classesOf(child).includes("details"),
			);
			for (const element of [outer[i], inner]) {
				assert.ok(element);
				assert.deepEqual(
					{
						class: element.attrs["class"],
						"data-year": element.attrs["data-year"],
						"data-types": element.attrs["data-types"],
					},
					element === outer[i]
						? { ...expected, class: expected.class + (day.isEntry ? "" : " tcw-day") }
						: expected,
					`${name}, ${day.key}`,
				);
			}
		});
		const years = allWithClass(markup, "year");
		assert.deepEqual(
			years.map((element) => [element.attrs["class"], element.attrs["data-types"], textOf(element)]),
			result.years
				.filter((year) => year.showHeader)
				.map((year) => [year.isCurrent ? "year current" : "year", year.statuses.join(" "), year.label]),
			name,
		);
		if (counter !== "")
			assert.ok(
				outer.some((element) => /overdue|unplanned/.test(element.attrs["data-types"])),
				"a filtered day keeps the statuses it filters out",
			);
		if (locale === "ar")
			assert.ok(
				years.every((element) => /^[٠-٩]+$/.test(textOf(element))),
				"years are written in Arabic digits",
			);
	}
});

test("timeline: every day content carries the estimate", async (t) => {
	const tasks = await goldenTasks();
	const cases: { name: string; quickFilter?: QuickFilter }[] = [
		{ name: "light-today-all-days-no-counter" },
		{ name: "light-top-all-days-no-counter" },
		{ name: "light-bottom-all-days-no-counter" },
		{ name: "light-today-all-days-no-counter", quickFilter: { priorities: ["High"] } },
	];
	let hasMultipleRows = false;
	for (const { name, quickFilter } of cases) {
		await t.test(`${name}${quickFilter ? " with High priority" : ""}`, () => {
			const state = stateOf(name);
			const result = query(
				tasks,
				{ settings: settingsOf(state), counter: "", quickFilter },
				{ now: NOW, moment },
			);
			const shown = result.years.flatMap((year) => year.days).filter((day) => day.tasks.length > 0);
			const markup = parseMarkup(rendered(tasks, state, {}, quickFilter));
			const outer = allWithClass(markup, "details").filter((element) => findClass(element, "dateLine"));
			assert.equal(outer.length, shown.length, name);
			shown.forEach((day, i) => {
				assert.equal(classesOf(outer[i]).includes("tcw-day"), !day.isEntry, `${name}, ${day.key}`);
				assert.equal(
					outer[i].attrs["style"],
					day.isEntry
						? undefined
						: `--tcw-day-estimate:calc(${day.tasks.length} * var(--tcw-day-row-estimate) + 41px)`,
					`${name}, ${day.key}`,
				);
			});
			const skipped = shown.filter((day) => !day.isEntry);
			assert.equal(allWithClass(markup, "tcw-day").length, skipped.length, name);
			const withEstimate = (element: Element): Element[] => [
				...(element.attrs["style"]?.includes("--tcw-day-estimate") ? [element] : []),
				...element.children.flatMap((child) => (typeof child === "string" ? [] : withEstimate(child))),
			];
			assert.equal(withEstimate(markup).length, skipped.length, name);
			hasMultipleRows ||= skipped.some((day) => day.tasks.length > 1);
			const skippedToday = allWithClass(markup, "details").filter((element) => {
				const classes = classesOf(element);
				return classes.includes("today") && classes.includes("tcw-day");
			});
			assert.equal(skippedToday.length > 0, state.position !== "today", name);
		});
	}
	assert.ok(hasMultipleRows, "a non-entry day has more than one row");
});

test("timeline: a saved counter is read as its class was, so a saved todo filters as todoFilter did", async () => {
	const tasks = await goldenTasks();
	const state = stateOf("light-today-all-days-todo-filter");
	const expected = displayedLines(rendered(tasks, state));
	for (const saved of ["todo", "todoFilter"]) {
		assert.deepEqual(displayedLines(rendered(tasks, state, { defaultFilters: saved })), expected, saved);
	}
	const unfiltered = displayedLines(rendered(tasks, stateOf("light-today-all-days-no-counter")));
	for (const saved of ["todoFocus", "nothing", ""]) {
		const lines = displayedLines(rendered(tasks, state, { defaultFilters: saved }));
		assert.deepEqual(
			lines.map((line) => line.line).filter((line) => !line.startsWith("counter")),
			unfiltered.map((line) => line.line).filter((line) => !line.startsWith("counter")),
			saved,
		);
	}
});

test("timeline: a saved counter whose class turns its Filter on filters, whatever the behaviour value says", async () => {
	const tasks = await goldenTasks();
	const expected = displayedLines(rendered(tasks, stateOf("light-today-all-days-todo-filter")));
	// Hand-edited values: the class is "todoFilter Focus", and "todoFilter " with a space.
	for (const extra of [
		{ defaultFilters: "todoFilter ", counterBehavior: "Focus" },
		{ defaultFilters: "todo", counterBehavior: "Filter " },
	]) {
		const state = stateOf("light-today-all-days-no-counter");
		const lines = displayedLines(rendered(tasks, state, extra as Partial<UserOption>));
		assert.deepEqual(
			lines.map((line) => line.line),
			expected.map((line) => line.line),
			JSON.stringify(extra),
		);
	}
});

test("timeline: years are keyed by place, then by year, so React builds the entry day again when they shift", async (t) => {
	const tasks = await goldenTasks();
	const userOptions = settingsOf(stateOf("light-today-all-days-no-counter"));
	let tree: unknown;
	t.after(
		onTimelineRender((_props, rendered) => {
			tree = rendered;
			return rendered;
		}),
	);
	renderToStaticMarkup(timelineElement({ userOptions, tasks }));
	const years = query(tasks, { settings: userOptions, counter: "" }, { now: NOW, moment }).years;
	/** The children of the first element under `node` whose children are an array. */
	const listUnder = (node: unknown): { key: unknown; props: { children: { key: unknown } } }[] => {
		const children = (node as { props?: { children?: unknown } }).props?.children;
		if (Array.isArray(children)) return children;
		return listUnder(children);
	};
	const keyed = listUnder(tree);
	assert.deepEqual(
		keyed.map((fragment) => [fragment.key, fragment.props.children.key]),
		years.map((year, i) => [String(i), String(year.year)]),
	);
});

test("timeline: the counter's class stays on the timeline for its highlight, with any behaviour", async () => {
	const tasks = await goldenTasks();
	for (const [behavior, expected] of [
		["Filter", "todoFilter"],
		["Focus", "todoFocus"],
	] as const) {
		const html = rendered(tasks, { position: "today", todayFocus: false, counter: "todo", behavior });
		const taskido = findClass(parseMarkup(html), "taskido");
		assert.ok(taskido && classesOf(taskido).includes(expected), behavior);
	}
});

// The test runs in the plugin's folder.
const stylesheet = () => cssRules(readFileSync("styles.css", "utf8"));

test("timeline: the day estimate's row height is defined on .taskido", () => {
	const rules = stylesheet();
	assert.ok(
		rules.some(
			({ selectors, body }) =>
				selectors.includes(".taskido") && /(^|[;\s])--tcw-day-row-estimate\s*:\s*43px\s*(;|$)/.test(body),
		),
	);
	const skippedDay = rules.find(({ selectors }) => selectors.includes(".taskido .details.tcw-day"));
	assert.ok(skippedDay);
	assert.ok(
		skippedDay.body
			.split(";")
			.map((declaration) => declaration.replace(/\s+/g, " ").trim())
			.includes("contain-intrinsic-size: auto var(--tcw-day-estimate)"),
	);
});

test("timeline: the stylesheet hides nothing the markup reader does not know of", () => {
	const hiding = stylesheet()
		.filter(({ body }) => /display\s*:\s*none/i.test(body) || /visibility\s*:\s*(hidden|collapse)/i.test(body))
		.flatMap(({ selectors }) => selectors);
	assert.deepEqual(
		hiding.sort(),
		[
			// What displayedLines applies.
			".taskido.noCounters .counters",
			".taskido.noQuickEntry .quickEntryPanel",
			".taskido.noYear .year",
			// Classes the timeline never sets.
			'.taskido.noDone .details[data-types="done"]',
			".taskido.noDone .task.done",
			'.taskido.noDone .year[data-types="done"]',
			".taskido.noUnplanned .counter#unplanned",
			'.taskido.noUnplanned .details[data-types="unplanned"]',
			".taskido.noUnplanned .task.unplanned",
			'.taskido.noUnplanned .year[data-types="unplanned"]',
			// Parts of a row: its badges, as the options turn them off, and its checkbox. The screenshots keep the defaults.
			".taskido .task .info:empty",
			".taskido .timeline input.icon",
			".taskido .timeline input.icon:checked",
			".taskido.noFile .task .file",
			".taskido.noFile .task .info > .file",
			".taskido.noHeader .task .header",
			".taskido.noInfo .task .line:nth-child(2)",
			".taskido.noModify .modify",
			".taskido.noPriority .priority",
			".taskido.noRelative .relative",
			".taskido.noRepeat .repeat",
			".taskido.noTag .tag",
			// Settings are outside the timeline's markup.
			".tasks-calendar-wrapper-settings [hidden]",
		].sort(),
	);
});

test("timeline: the rows the Focus behaviour highlights are the ones the markup reader marks", () => {
	const backgrounds = stylesheet()
		.filter(({ body }) => /background/i.test(body))
		.flatMap(({ selectors }) => selectors)
		.filter((selector) => /\.task(?![\w-])[^ ]*$/.test(selector));
	const focus = Object.entries(highlightedBy).flatMap(([counter, statuses]) =>
		statuses.map((status) => `.taskido.${counter}Focus .task.${status}`),
	);
	assert.deepEqual(backgrounds.sort(), [...focus, ".taskido .task:hover"].sort());
});
