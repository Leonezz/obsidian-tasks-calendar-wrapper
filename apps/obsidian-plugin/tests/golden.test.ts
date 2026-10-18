// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	arrange,
	dayKey,
	resolveTasks,
	sortOptionLabels,
	type DateValue,
	type ResolvedTask,
	type Task,
	type TextPoint,
} from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, UserOption } from "../src/useroptions";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { FIXTURES, goldenApp, loadVault, type CapturedVault, type ReadOrder } from "./golden-vault";

/**
 * Golden snapshots of what the plugin makes of the notes in fixtures/golden-vault today: every task's parsed fields,
 * the tasks each settings variant shows, the tasks each day lists, and their order under every sort. The legacy
 * pipeline wrote them before the parsing moved to packages/core, and core gave the same for every variant, sort and
 * language before it replaced that pipeline. A difference means the behaviour changed; if that is intended, regenerate
 * with `UPDATE_GOLDEN=1 pnpm test` and review the diff. The metadata comes from Obsidian itself, see
 * scripts/capture-golden.mjs.
 */

const GOLDEN = path.join(FIXTURES, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/**
 * Reads the vault with readTasks and resolves the tasks shown, as TasksTimelineView and the timeline do, with moment set
 * to `locale` (Obsidian's moment follows the app's language). Every run sets the locale itself, so no test depends on
 * what an earlier one left behind.
 */
async function taskList(
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

const id = (resolved: ResolvedTask) => resolved.task.id;

function day(date: DateValue | undefined): string | null {
	if (!date) return null;
	return date.format(date.hours() || date.minutes() ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD");
}

/** A task's other dates, and today under the key it is forwarded by, which the snapshots list as one more date. */
function otherDates(resolved: ResolvedTask): (readonly [string, DateValue])[] {
	return [...resolved.extraDates, ...(resolved.forwarded ? [[resolved.forwarded, moment()] as const] : [])];
}

/** A place in a note, its keys in the order the captured metadata has them, which the snapshots were written in. */
const point = ({ line, col, offset }: TextPoint) => ({ col, line, offset });

/** Every field of a task that the views, the sorting or opening and toggling the task read. */
function details(resolved: ResolvedTask) {
	const { task, dates } = resolved;
	return {
		id: id(resolved),
		position: { end: point(task.position.end), start: point(task.position.start) },
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
		dates: otherDates(resolved).map(([key, date]) => [key, day(date)]),
		section: task.section,
		outlinks: task.outlinks,
		frontmatter: task.note.frontmatter,
	};
}

/** One line per task: enough to see what a settings variant changes, short enough to review. */
function summary(resolved: ResolvedTask): string {
	const { dates } = resolved;
	const all = (
		[
			["due", dates.due],
			["scheduled", dates.scheduled],
			["start", dates.start],
			["created", dates.created],
			["completion", dates.completion],
			...otherDates(resolved),
		] as (readonly [string, DateValue | undefined])[]
	)
		.filter(([, date]) => date)
		.map(([key, date]) => `${key}=${day(date)}`)
		.join(" ");
	return `${id(resolved)} | ${resolved.status} | ${all} | ${resolved.visual}`;
}

/** The tasks each day of the timeline lists, without a counter or quick filter: the days arrange lays out that have a task. */
function days(shown: readonly ResolvedTask[], options: UserOption): Record<string, string[]> {
	const env = { now: moment(), moment };
	const { years } = arrange({ today: dayKey(env.now), shown }, { settings: options, counter: "" }, env);
	return Object.fromEntries(
		years
			.flatMap((year) => year.days)
			.filter((day) => day.dated)
			.map((day) => [day.key, day.tasks.map(id)] as const)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
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
	expectGolden("tasks", (await taskList(loadVault(), everything)).map(details));
});

for (const [name, options] of Object.entries(variants)) {
	test(`golden: tasks shown with the ${name} settings`, async () => {
		const shown = await taskList(loadVault(), options);
		expectGolden(`variant-${name}`, { shown: shown.map(summary), days: days(shown, options) });
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
});

test("golden: the order under every sort option", async () => {
	const vault = loadVault();
	const orders: Record<string, string[]> = {};
	for (const sort of [...Object.keys(sortOptionLabels), "no-such-sort"]) {
		orders[sort] = (await taskList(vault, { ...everything, sort })).map(id);
	}
	expectGolden("sort-orders", orders);
});

test("golden: the result does not depend on the order or timing of the reads", async () => {
	const vault = loadVault();
	const usual = (await taskList(vault, everything)).map(details);
	const shuffled = (await taskList(vault, everything, { reversed: true, staggered: true })).map(details);
	assert.deepEqual(shuffled, usual);
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
