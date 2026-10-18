// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Moment } from "moment";

import {
	arrange,
	dayKey,
	resolveTasks,
	type DateValue,
	type ResolvedTask,
	type Task,
} from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, UserOption } from "../src/useroptions";
import { ObsidianTaskAdapter, readTasks } from "../timeline/src/taskadapter";
import { groupTasksByDate, tasksListedOnDay } from "../timeline/src/taskdates";
import { moment } from "../utils/moment";
import { sortOptionLabels } from "../utils/sort";
import { filterTasks, parseTasks } from "../utils/tasklist";
import { innerDateFormat, TaskDataModel } from "../utils/tasks";
import { FIXTURES, goldenApp, loadVault, type CapturedVault, type ReadOrder } from "./golden-vault";

/**
 * Golden snapshots of what the plugin makes of the notes in fixtures/golden-vault today: every task's
 * parsed fields, the tasks each settings variant shows, the tasks each day lists, and their order under
 * every sort. They pin the current behaviour before the parsing moves to packages/core. A difference means
 * the behaviour changed; if that is intended, regenerate with `UPDATE_GOLDEN=1 pnpm test` and review the diff.
 * The metadata comes from Obsidian itself, see scripts/capture-golden.mjs.
 */

const GOLDEN = path.join(FIXTURES, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/**
 * Reads, parses, sorts and filters the vault the way TasksTimelineView.onReloadTasks does, with moment set to
 * `locale` (Obsidian's moment follows the app's language). Every run sets the locale itself, so no test depends
 * on what an earlier one left behind.
 */
async function taskList(
	vault: CapturedVault,
	options: UserOption,
	order: ReadOrder = {},
	locale = "en",
): Promise<TaskDataModel[]> {
	const previous = moment.locale();
	if (moment.locale(locale) !== locale) assert.fail(`moment has no "${locale}" locale loaded`);
	try {
		const adapter = new ObsidianTaskAdapter(goldenApp(vault, order));
		await adapter.generateTasksList(
			options.includePaths,
			options.excludePaths,
			options.fileIncludeTags,
			options.fileExcludeTags,
			options.excludeProperties,
		);
		const parsed = await parseTasks(adapter.getTaskList(), options, moment());
		return filterTasks(parsed, options);
	} finally {
		moment.locale(previous);
	}
}

/** The same, through packages/core: readTasks reads and parses the notes, resolveTasks does the rest. */
async function coreTaskList(
	vault: CapturedVault,
	options: UserOption,
	order: ReadOrder = {},
	locale = "en",
): Promise<ResolvedTask[]> {
	const previous = moment.locale();
	if (moment.locale(locale) !== locale) assert.fail(`moment has no "${locale}" locale loaded`);
	try {
		const tasks = await readTasks(goldenApp(vault, order), options, moment);
		return [...resolveTasks(tasks, options, { now: moment(), moment }).shown];
	} finally {
		moment.locale(previous);
	}
}

const id = (task: TaskDataModel) => `${task.path}:${task.line}`;

function day(date: Moment | DateValue | undefined): string | null {
	if (!date) return null;
	return date.format(date.hours() || date.minutes() ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD");
}

/** Every field of a task that the views, the sorting or opening and toggling the task read. */
function details(task: TaskDataModel) {
	return {
		id: id(task),
		position: task.position,
		lineCount: task.lineCount,
		text: task.text,
		visual: task.visual,
		symbol: task.symbol,
		statusMarker: task.statusMarker,
		status: task.status,
		completed: task.completed,
		checked: task.checked,
		fullyCompleted: task.fullyCompleted,
		isTasksTask: task.isTasksTask,
		priority: task.priority,
		recurrence: task.recurrence,
		tags: task.tags,
		dailyNote: task.dailyNote,
		order: task.order,
		due: day(task.due),
		scheduled: day(task.scheduled),
		start: day(task.start),
		created: day(task.created),
		completion: day(task.completion),
		dates: [...task.dates].map(([key, date]) => [key, day(date)]),
		section: task.section.toObject(),
		outlinks: task.outlinks.map((link) => link.toObject()),
		frontmatter: task.fontMatter,
	};
}

/** One line per task: enough to see what a settings variant changes, short enough to review. */
function summary(task: TaskDataModel): string {
	const dates = (
		[
			["due", task.due],
			["scheduled", task.scheduled],
			["start", task.start],
			["created", task.created],
			["completion", task.completion],
			...task.dates,
		] as [string, Moment | undefined][]
	)
		.filter(([, date]) => date)
		.map(([key, date]) => `${key}=${day(date)}`)
		.join(" ");
	return `${id(task)} | ${task.status} | ${dates} | ${task.visual}`;
}

const coreId = (resolved: ResolvedTask) => resolved.task.id;

/** The legacy pipeline keeps the day a task is forwarded to as one more date; core keeps only its key. */
function coreDates(resolved: ResolvedTask): (readonly [string, DateValue])[] {
	return [...resolved.extraDates, ...(resolved.forwarded ? [[resolved.forwarded, moment()] as const] : [])];
}

/** details() of a task that went through core. */
function coreDetails(resolved: ResolvedTask) {
	const { task, dates } = resolved;
	return {
		id: coreId(resolved),
		position: task.position,
		lineCount: task.lineCount,
		text: task.text,
		visual: resolved.visual,
		symbol: task.symbol,
		statusMarker: task.statusMarker,
		status: resolved.status,
		completed: task.completed,
		checked: task.checked,
		fullyCompleted: task.fullyCompleted,
		isTasksTask: task.isTasksTask,
		priority: task.priority,
		recurrence: task.recurrence,
		tags: task.tags,
		dailyNote: resolved.dailyNote,
		order: resolved.order,
		due: day(dates.due),
		scheduled: day(dates.scheduled),
		start: day(dates.start),
		created: day(dates.created),
		completion: day(dates.completion),
		dates: coreDates(resolved).map(([key, date]) => [key, day(date)]),
		section: task.section,
		outlinks: task.outlinks,
		frontmatter: task.note.frontmatter,
	};
}

/** summary() of a task that went through core. */
function coreSummary(resolved: ResolvedTask): string {
	const { dates } = resolved;
	const all = (
		[
			["due", dates.due],
			["scheduled", dates.scheduled],
			["start", dates.start],
			["created", dates.created],
			["completion", dates.completion],
			...coreDates(resolved),
		] as (readonly [string, DateValue | undefined])[]
	)
		.filter(([, date]) => date)
		.map(([key, date]) => `${key}=${day(date)}`)
		.join(" ");
	return `${coreId(resolved)} | ${resolved.status} | ${all} | ${resolved.visual}`;
}

/**
 * Asserts what core makes of the vault against a snapshot the legacy pipeline wrote, or against one field of it.
 * Core never writes a snapshot, even with UPDATE_GOLDEN=1: only the legacy pipeline does, until core replaces it.
 */
function expectGoldenFromCore(name: string, actual: unknown, field?: string) {
	const file = path.join(GOLDEN, `${name}.json`);
	if (!existsSync(file)) assert.fail(`${file} is missing; the legacy test that writes it has to run first.`);
	const snapshot = JSON.parse(readFileSync(file, "utf8"));
	assert.deepEqual(
		JSON.parse(JSON.stringify(actual)),
		field ? snapshot[field] : snapshot,
		`core differs from fixtures/golden/${name}.json${field ? ` (${field})` : ""}, which the legacy pipeline wrote.`,
	);
}

/** The tasks each day of the timeline lists, as DateView lists them. */
function days(tasks: TaskDataModel[], options: UserOption): Record<string, string[]> {
	const today = moment().format(innerDateFormat);
	const byDate = groupTasksByDate(tasks);
	return Object.fromEntries(
		[...byDate.keys()]
			.sort()
			.map((date) => [date, tasksListedOnDay(byDate.get(date)!, date === today, options.forward).map(id)]),
	);
}

/** days() of the tasks core shows: the days arrange lays out that have a task, without a counter or quick filter. */
function coreDays(shown: readonly ResolvedTask[], options: UserOption): Record<string, string[]> {
	const env = { now: moment(), moment };
	const { years } = arrange({ today: dayKey(env.now), shown }, { settings: options, counter: "" }, env);
	return Object.fromEntries(
		years
			.flatMap((year) => year.days)
			.filter((day) => day.dated)
			.map((day) => [day.key, day.tasks.map(coreId)]),
	);
}

/** The snapshots the tests produce, so the last test can find files no test produces any more. */
const snapshotNames = new Set<string>();

function expectGolden(name: string, actual: unknown) {
	snapshotNames.add(name);
	const file = path.join(GOLDEN, `${name}.json`);
	const text = JSON.stringify(actual, null, "\t") + "\n";
	if (UPDATE) {
		mkdirSync(GOLDEN, { recursive: true });
		writeFileSync(file, text);
		return;
	}
	if (!existsSync(file)) assert.fail(`${file} is missing. Create it with \`UPDATE_GOLDEN=1 pnpm test\`.`);
	assert.deepEqual(
		JSON.parse(text),
		JSON.parse(readFileSync(file, "utf8")),
		`the result differs from fixtures/golden/${name}.json. If the change is intended, run \`UPDATE_GOLDEN=1 pnpm test\` and review the diff.`,
	);
}

const defaults = (): UserOption => structuredClone(defaultUserOptions);
const withOptions = (changes: Partial<UserOption>): UserOption => ({ ...defaults(), ...changes });

/** Shows every task, so the details snapshot covers all of them. */
const everything = withOptions({ hideStatusTasks: [], filterEmpty: false });

const variants: Record<string, UserOption> = {
	default: defaults(),
	"forward-off": withOptions({ forward: false }),
	"forward-past-start-and-scheduled": withOptions({ forwardPastStartAndScheduled: true }),
	"show-all-statuses": withOptions({ hideStatusTasks: [] }),
	"hide-in-progress-and-forwarded": withOptions({ hideStatusTasks: ["/", ">"] }),
	"hide-subtasks": withOptions({ hideSubTasks: true }),
	"keep-empty": withOptions({ filterEmpty: false, hideStatusTasks: [] }),
	"include-tags": withOptions({ useIncludeTags: true, taskIncludeTags: ["#work"] }),
	"include-tags-empty": withOptions({ useIncludeTags: true, taskIncludeTags: [] }),
	"exclude-tags": withOptions({ useExcludeTags: true, taskExcludeTags: ["#work", "#project"] }),
	"exclude-tags-empty": withOptions({ useExcludeTags: true, taskExcludeTags: [] }),
	"include-paths": withOptions({ includePaths: ["Daily", "Frontmatter/Active.md"] }),
	"include-paths-trailing-slash": withOptions({ includePaths: ["Daily/"] }),
	"exclude-paths": withOptions({ excludePaths: ["Excluded", "Big note.md"] }),
	"exclude-paths-root": withOptions({ excludePaths: ["/"] }),
	"file-include-tags": withOptions({ fileIncludeTags: ["#project"] }),
	"file-exclude-tags": withOptions({ fileExcludeTags: ["#project"] }),
	"exclude-properties": withOptions({ excludeProperties: { status: ["archived"] } }),
	"exclude-properties-list": withOptions({ excludeProperties: { tags: ["project"] } }),
	"exclude-properties-number": withOptions({ excludeProperties: { priority: ["2"] } }),
	"exclude-properties-boolean": withOptions({ excludeProperties: { pinned: ["true"] } }),
	"daily-note-format-folders": withOptions({ dailyNoteFormat: "YYYY/MM/DD" }),
	"daily-note-format-iso": withOptions({ dailyNoteFormat: "YYYY-MM-DD" }),
	"daily-note-format-weeks": withOptions({ dailyNoteFormat: "YYYY/MMM/Wo/ddd" }),
	"convert-24-hour-time-prefix": withOptions({ convert24HourTimePrefix: true }),
	"status-order": withOptions({
		taskStatusOrder: ["done", "cancelled", "unplanned", "overdue", "due", "scheduled", "start", "process"],
	}),
};

test("golden: the metadata was captured from Obsidian from exactly the fixture notes", () => {
	const vault = loadVault();
	assert.match(vault.obsidianVersion, /^\d+\.\d+/, "the capture records the Obsidian version it came from");
});

test("golden: every task's parsed fields", async () => {
	const tasks = await taskList(loadVault(), everything);
	expectGolden("tasks", tasks.map(details));
	expectGoldenFromCore("tasks", (await coreTaskList(loadVault(), everything)).map(coreDetails));
});

for (const [name, options] of Object.entries(variants)) {
	test(`golden: tasks shown with the ${name} settings`, async () => {
		const tasks = await taskList(loadVault(), options);
		expectGolden(`variant-${name}`, { shown: tasks.map(summary), days: days(tasks, options) });
		const shown = await coreTaskList(loadVault(), options);
		expectGoldenFromCore(`variant-${name}`, shown.map(coreSummary), "shown");
		expectGoldenFromCore(`variant-${name}`, coreDays(shown, options), "days");
	});
}

// Obsidian sets its moment to the app's language, which decides which note names are daily notes.
test("golden: tasks shown with Obsidian set to Chinese", async () => {
	const vault = loadVault();
	const chinese = await taskList(vault, defaults(), {}, "zh-cn");
	const english = await taskList(vault, defaults());
	// A daily note named in Chinese is only recognised in Chinese, and one named in English only in English.
	assert.notDeepEqual(
		chinese.map(summary),
		english.map(summary),
		"the app language changes which notes are daily notes",
	);
	expectGolden("variant-locale-zh-cn", { shown: chinese.map(summary), days: days(chinese, defaults()) });
	const chineseCore = await coreTaskList(vault, defaults(), {}, "zh-cn");
	expectGoldenFromCore("variant-locale-zh-cn", chineseCore.map(coreSummary), "shown");
	expectGoldenFromCore("variant-locale-zh-cn", coreDays(chineseCore, defaults()), "days");
});

test("golden: the order under every sort option", async () => {
	const vault = loadVault();
	const orders: Record<string, string[]> = {};
	const coreOrders: Record<string, string[]> = {};
	for (const sort of [...Object.keys(sortOptionLabels), "no-such-sort"]) {
		orders[sort] = (await taskList(vault, { ...everything, sort })).map(id);
		coreOrders[sort] = (await coreTaskList(vault, { ...everything, sort })).map(coreId);
	}
	expectGolden("sort-orders", orders);
	expectGoldenFromCore("sort-orders", coreOrders);
});

test("golden: the result does not depend on the order or timing of the reads", async () => {
	const vault = loadVault();
	const usual = (await taskList(vault, everything)).map(details);
	const shuffled = (await taskList(vault, everything, { reversed: true, staggered: true })).map(details);
	assert.deepEqual(shuffled, usual);
	const coreUsual = (await coreTaskList(vault, everything)).map(coreDetails);
	const coreShuffled = (await coreTaskList(vault, everything, { reversed: true, staggered: true })).map(coreDetails);
	assert.deepEqual(coreShuffled, coreUsual);
});

// The snapshots pin core where the fixtures reach; the legacy pipeline, which core replaces, is compared with it
// everywhere else: every settings variant under every sort, in both languages, field by field and day by day.
/** JSON with the keys of every object sorted, so two values that only list their keys in another order give the same text. */
const canonicalJson = (value: unknown) =>
	JSON.stringify(value, (_key, item: unknown) =>
		item !== null && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: item,
	);

test("golden: core gives what the legacy pipeline gives for every variant, sort and language", async () => {
	const vault = loadVault();
	for (const locale of ["en", "zh-cn"]) {
		// Read and parsed once: resolveTasks applies the note filters readTasks skips notes with, which the variant
		// tests above check through readTasks.
		const previous = moment.locale();
		if (moment.locale(locale) !== locale) assert.fail(`moment has no "${locale}" locale loaded`);
		const parsed = await readTasks(goldenApp(vault), {}, moment);
		moment.locale(previous);
		for (const [name, options] of Object.entries(variants)) {
			for (const sort of [...Object.keys(sortOptionLabels), "no-such-sort"]) {
				const withSort = { ...options, sort };
				const legacyTasks = await taskList(vault, withSort, {}, locale);
				const legacy = canonicalJson({ tasks: legacyTasks.map(details), days: days(legacyTasks, withSort) });
				moment.locale(locale);
				const shown = resolveTasks(parsed, withSort, { now: moment(), moment }).shown;
				const core = canonicalJson({ tasks: shown.map(coreDetails), days: coreDays(shown, withSort) });
				moment.locale(previous);
				// Comparing the text is fast; only a difference is compared field by field, for a readable message.
				if (core !== legacy)
					assert.deepEqual(JSON.parse(core), JSON.parse(legacy), `${name}, ${sort}, ${locale}`);
			}
		}
	}
});

/** Every array and plain object reachable from a value, dates left out: moments are typed read-only, not frozen. */
function containers(value: unknown, found: object[] = []): object[] {
	if (value === null || typeof value !== "object" || moment.isMoment(value) || found.includes(value)) return found;
	found.push(value);
	for (const item of Object.values(value)) containers(item, found);
	return found;
}

test("golden: core's tasks cannot be changed, and resolving changes no date and none of Obsidian's metadata", async () => {
	const vault = loadVault();
	const handedOut: unknown[] = [];
	const tasks: Task[] = await readTasks(goldenApp(vault, {}, handedOut), everything, moment);
	assert.ok(tasks.length > 100);
	const unfrozen = tasks.flatMap((task) => containers(task)).filter((container) => !Object.isFrozen(container));
	assert.deepEqual(unfrozen, [], "every array and object of a Task is frozen");
	// Parsing copies what it keeps, so the objects Obsidian handed out stay as they were.
	assert.ok(handedOut.length > 0);
	assert.deepEqual(
		handedOut.flatMap((cache) => containers(cache)).filter((container) => Object.isFrozen(container)),
		[],
	);

	const datesOf = (task: Task) =>
		[...Object.values(task.dates), ...task.extraDates.map(([, date]) => date)].filter(
			(date): date is DateValue => !!date,
		);
	const before = tasks.flatMap(datesOf).map((date) => date.valueOf());
	for (const options of Object.values(variants)) resolveTasks(tasks, options, { now: moment(), moment });
	assert.deepEqual(
		tasks.flatMap(datesOf).map((date) => date.valueOf()),
		before,
		"resolving changes no date of a task",
	);
});

// Declared last, so it runs after every test that produces a snapshot.
test("golden: every snapshot file is one a test produces", () => {
	const orphans = readdirSync(GOLDEN).filter(
		(name) => name.endsWith(".json") && !snapshotNames.has(name.slice(0, -5)),
	);
	if (UPDATE) {
		for (const orphan of orphans) rmSync(path.join(GOLDEN, orphan));
		return;
	}
	assert.deepEqual(
		orphans,
		[],
		"these snapshots belong to no test any more; `UPDATE_GOLDEN=1 pnpm test` removes them",
	);
});
