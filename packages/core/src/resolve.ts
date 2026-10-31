/**
 * Turns parsed tasks into the tasks the timeline shows, for given settings and a given now: the note filters, the
 * daily note's date, the status, forwarding to today, the status order, the 24-hour option, the sort and the task
 * filters. It follows the plugin's former parser chain (utils/tasklist.ts and utils/taskmapable.ts, removed in phase 1
 * step 9) and its note filters. It never changes the tasks it is given.
 */
import {
	afterInstant,
	beforeDay,
	convert24HourPrefix,
	createDailyNoteDateCache,
	dayKey,
	parseDailyNoteName,
	sameDay,
} from "./dates";
import type { DailyNoteDateCache, DateEntries, DateValue, DayKey, MomentFactory } from "./dates";
import { copyJsonValue, deepFreeze } from "./options";
import { matchesProperties, type PropertyRules } from "./properties";
import { getSortComparator, type SortableTask } from "./sort";
import { TaskStatus, TaskStatusMarkerMap } from "./status";
import { innerDateFormat } from "./syntax";
import type { Task, TaskDates } from "./task";

/** The settings that decide which notes the tasks are taken from. */
export interface NoteFilterSettings {
	readonly includePaths?: readonly string[];
	readonly excludePaths?: readonly string[];
	readonly fileIncludeTags?: readonly string[];
	readonly fileExcludeTags?: readonly string[];
	readonly excludeProperties?: PropertyRules;
}

/** The settings resolveTasks reads. The plugin's user options have them all. */
export interface ResolveSettings extends NoteFilterSettings {
	readonly dailyNoteFormat?: string;
	readonly forward?: boolean;
	readonly forwardPastStartAndScheduled?: boolean;
	readonly convert24HourTimePrefix?: boolean;
	readonly taskStatusOrder?: readonly string[];
	readonly sort?: string;
	readonly hideSubTasks?: boolean;
	readonly hideStatusTasks?: readonly string[];
	readonly useIncludeTags?: boolean;
	readonly taskIncludeTags?: readonly string[];
	readonly useExcludeTags?: boolean;
	readonly taskExcludeTags?: readonly string[];
	readonly filterEmpty?: boolean;
}

const resolveSettingKeys = {
	includePaths: true,
	excludePaths: true,
	fileIncludeTags: true,
	fileExcludeTags: true,
	excludeProperties: true,
	dailyNoteFormat: true,
	forward: true,
	forwardPastStartAndScheduled: true,
	convert24HourTimePrefix: true,
	taskStatusOrder: true,
	sort: true,
	hideSubTasks: true,
	hideStatusTasks: true,
	useIncludeTags: true,
	taskIncludeTags: true,
	useExcludeTags: true,
	taskExcludeTags: true,
	filterEmpty: true,
} satisfies Record<keyof ResolveSettings, true>;

const resolveKeys = Object.keys(resolveSettingKeys) as (keyof ResolveSettings)[];

/** A frozen copy of exactly the settings resolveTasks reads, for remembering the conditions of a resolve. */
export function pickResolveSettings(settings: ResolveSettings): ResolveSettings {
	return deepFreeze(Object.fromEntries(resolveKeys.map((key) => [key, copyJsonValue(settings[key])])));
}

/** Resolve settings compare by value, including arrays and property rules, not by the options object's identity. */
export function sameResolveSettings(a: ResolveSettings, b: ResolveSettings): boolean {
	return resolveKeys.every((key) => sameSettingValue(a[key], b[key]));
}

function sameSettingValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameSettingValue(left[key], right[key]))
	);
}

/** What the clock and the app give: the current time, and Obsidian's moment. */
export interface QueryEnv {
	readonly now: DateValue;
	readonly moment: MomentFactory;
	readonly dateCache?: DailyNoteDateCache;
	/** Requires dateCache, whose identity stands for the parse environment. */
	readonly taskCache?: ResolvedTaskCache;
}

/** Why a task is also listed on today, when the forward option is on. */
export type ForwardKey =
	| "unplanned"
	| "done-unplanned"
	| "cancelled-unplanned"
	| "overdue"
	| "due"
	| "scheduled"
	| "start"
	| "process"
	| "forwarded";

/** A task with what the settings and now make of it. Frozen. */
export interface ResolvedTask {
	readonly task: Task;
	readonly status: TaskStatus;
	/** The status's place in the status order, from 1, or 0 when the order does not name it. */
	readonly order: number;
	/** The task is in a daily note. */
	readonly dailyNote: boolean;
	/** The task's own dates, or, when it has none, the daily note's date as its start, scheduled and created date. */
	readonly dates: TaskDates;
	readonly extraDates: DateEntries;
	/** Set when the task is also listed on today. */
	readonly forwarded?: ForwardKey;
	/** The text shown, after the 24-hour option. */
	readonly visual: string;
}

export interface Resolved {
	readonly today: DayKey;
	/** The tasks shown, in order. */
	readonly shown: readonly ResolvedTask[];
}

/** Reuses a resolved task while its settings, day and parse environment stay the same. */
export interface ResolvedTaskCache {
	/** Cumulative number of resolveTask calls, exposed only to verify reuse in tests. */
	readonly resolutionCount: number;
}

interface TaskCacheState {
	tasks: WeakMap<Task, ResolvedTask>;
	under?: { settings: ResolveSettings; day: DayKey; dateCache: DailyNoteDateCache };
	resolutionCount: number;
}

const taskCaches = new WeakMap<ResolvedTaskCache, TaskCacheState>();

export function createResolvedTaskCache(): ResolvedTaskCache {
	const state: TaskCacheState = { tasks: new WeakMap(), resolutionCount: 0 };
	const cache = Object.freeze({
		get resolutionCount() {
			return state.resolutionCount;
		},
	});
	taskCaches.set(cache, state);
	return cache;
}

function taskCacheFor(settings: ResolveSettings, day: DayKey, env: QueryEnv): TaskCacheState | undefined {
	if (!env.taskCache) return undefined;
	if (!env.dateCache) throw new Error("taskCache requires a dateCache");
	const cache = taskCaches.get(env.taskCache);
	if (!cache) throw new Error("taskCache must be created by createResolvedTaskCache");
	const under = cache.under;
	if (
		!under ||
		under.day !== day ||
		under.dateCache !== env.dateCache ||
		!sameResolveSettings(under.settings, settings)
	) {
		cache.tasks = new WeakMap();
		cache.under = { settings: pickResolveSettings(settings), day, dateCache: env.dateCache };
	}
	return cache;
}

/** Whether `parent` names the folder or note at `path`. "Daily/" names nothing, and "/" names nothing either. */
function isParent(parent: string, path: string): boolean {
	if (parent.length > path.length) return false;
	const paths = path.split("/");
	return parent.split("/").every((segment, i) => segment === paths[i]);
}

/** Whether the note filters keep a note's tasks. */
export function noteVisible(
	note: {
		readonly path: string;
		readonly tags: readonly string[];
		readonly frontmatter?: Readonly<Record<string, unknown>>;
	},
	settings: NoteFilterSettings,
): boolean {
	const include = settings.includePaths ?? [];
	if (include.length !== 0 && !include.some((path) => isParent(path, note.path))) return false;
	const exclude = settings.excludePaths ?? [];
	if (exclude.length !== 0 && exclude.some((path) => isParent(path, note.path))) return false;
	const includeTags = settings.fileIncludeTags ?? [];
	if (includeTags.length !== 0 && !includeTags.some((tag) => note.tags.includes(tag))) return false;
	const excludeTags = settings.fileExcludeTags ?? [];
	if (excludeTags.length !== 0 && !excludeTags.every((tag) => !note.tags.includes(tag))) return false;
	const rules = settings.excludeProperties ?? {};
	if (Object.keys(rules).length !== 0 && matchesProperties(note.frontmatter, rules)) return false;
	return true;
}

const ownDates = (dates: TaskDates) => [dates.due, dates.scheduled, dates.start, dates.created, dates.completion];

function hasAnyDate(dates: TaskDates, extraDates: DateEntries): boolean {
	return ownDates(dates).some((date) => !!date) || extraDates.length > 0;
}

/**
 * A task's status: the one its marker sets ("x", "-", "/", "<", ">"), or else the one its dates give on the day of
 * `now`. `dates` are the dates the task is placed on, the daily note's included.
 */
export function taskStatus(
	task: Pick<Task, "statusMarker" | "completed">,
	dates: TaskDates,
	extraDates: DateEntries,
	now: DateValue,
): TaskStatus {
	if (Object.keys(TaskStatusMarkerMap).includes(task.statusMarker)) {
		return TaskStatusMarkerMap[task.statusMarker as keyof typeof TaskStatusMarkerMap];
	}
	const { due, scheduled, start, completion } = dates;
	if (!due && !scheduled && !start && !completion && extraDates.length === 0) {
		return task.completed ? TaskStatus.done : TaskStatus.unplanned;
	}
	if (task.completed && ((scheduled && afterInstant(scheduled, now)) || (start && afterInstant(start, now))))
		return TaskStatus.cancelled;
	if (task.completed) return TaskStatus.done;
	if (due && beforeDay(due, now)) return TaskStatus.overdue;
	if (due && sameDay(due, now)) return TaskStatus.due;
	if (start && beforeDay(start, now)) return TaskStatus.process;
	if (scheduled && beforeDay(scheduled, now)) return TaskStatus.start;
	return TaskStatus.scheduled;
}

const todoStatuses: readonly TaskStatus[] = [
	TaskStatus.due,
	TaskStatus.scheduled,
	TaskStatus.start,
	TaskStatus.process,
];

/**
 * Why the forward option also lists a task on today, if it does: an unplanned, undated done or cancelled, or undated
 * to-do task has no other day to be on; an overdue task is listed on today too, unless it is already; and, with the
 * option for it, so is a task that has started or whose scheduled date has passed, see #84.
 */
export function forwardKey(
	status: TaskStatus,
	dates: TaskDates,
	extraDates: DateEntries,
	now: DateValue,
	pastStartAndScheduled: boolean,
): ForwardKey | undefined {
	const onToday = [
		dates.due,
		dates.scheduled,
		dates.created,
		dates.completion,
		dates.start,
		...extraDates.map(([, date]) => date),
	].some((date) => date !== undefined && sameDay(now, date));
	if (status === TaskStatus.unplanned) return "unplanned";
	if (
		status === TaskStatus.done &&
		!dates.completion &&
		!dates.due &&
		!dates.start &&
		!dates.scheduled &&
		!dates.created
	)
		return "done-unplanned";
	// Like an undated done task, an undated cancelled task has no other day to be shown on, see #66.
	if (status === TaskStatus.cancelled && !hasAnyDate(dates, extraDates)) return "cancelled-unplanned";
	if (status === TaskStatus.overdue && !onToday) return "overdue";
	// A marker such as [/] or [<] makes a task to-do even without a date; it is counted as to-do, so it is shown too.
	if (todoStatuses.includes(status) && !hasAnyDate(dates, extraDates)) return status as ForwardKey;
	if (pastStartAndScheduled && (status === TaskStatus.process || status === TaskStatus.start) && !onToday)
		return "forwarded";
	return undefined;
}

/** Path in code-unit order, then line: the order the plugin read the notes in, so ties in the sort stay put. */
const byPathThenLine = (a: Task, b: Task) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);

/** Resolves the tasks for the settings and now, and returns the ones shown, sorted. */
export function resolveTasks(tasks: readonly Task[], settings: ResolveSettings, env: QueryEnv): Resolved {
	const { now, moment } = env;
	const today = dayKey(now);
	const cache = taskCacheFor(settings, today, env);
	const dateCache = env.dateCache ?? createDailyNoteDateCache();
	const dailyNoteFormat = settings.dailyNoteFormat ?? innerDateFormat;
	const noteDates = new Map<string, DateValue | undefined>();
	const noteDate = (path: string) => {
		if (!noteDates.has(path)) noteDates.set(path, parseDailyNoteName(moment, path, dailyNoteFormat, dateCache));
		return noteDates.get(path);
	};

	const resolved = [...tasks]
		.sort(byPathThenLine)
		.filter((task) => noteVisible(task.note, settings))
		.map((task) => {
			const previous = cache?.tasks.get(task);
			if (previous) return previous;
			const resolved = resolveTask(task, noteDate(task.path), settings, env);
			if (cache) {
				cache.tasks.set(task, resolved);
				cache.resolutionCount++;
			}
			return resolved;
		});

	const comparator = getSortComparator(settings.sort ?? "");
	const sortable = (r: ResolvedTask): SortableTask => ({
		order: r.order,
		visual: r.visual,
		start: r.dates.start,
		due: r.dates.due,
		priority: r.task.priority,
		tags: r.task.tags,
	});
	const sorted = resolved
		.map((r) => ({ r, by: sortable(r) }))
		.sort((a, b) => comparator(a.by, b.by))
		.map(({ r }) => r);

	return Object.freeze({ today, shown: Object.freeze(sorted.filter(shownBy(settings))) });
}

function resolveTask(
	task: Task,
	noteDate: DateValue | undefined,
	settings: ResolveSettings,
	env: QueryEnv,
): ResolvedTask {
	const { now, moment } = env;
	// The note's date is only a fallback. Adding it to a task with dates of its own put the task on several days at
	// once, see #114 and #118.
	const dates =
		noteDate && !hasAnyDate(task.dates, task.extraDates)
			? Object.freeze({ ...task.dates, start: noteDate, scheduled: noteDate, created: noteDate })
			: task.dates;
	const status = taskStatus(task, dates, task.extraDates, now);
	const forwarded = settings.forward
		? forwardKey(status, dates, task.extraDates, now, !!settings.forwardPastStartAndScheduled)
		: undefined;
	const statusOrder = settings.taskStatusOrder;
	return Object.freeze({
		task,
		status,
		order: statusOrder?.includes(status) ? statusOrder.indexOf(status) + 1 : 0,
		dailyNote: noteDate !== undefined,
		dates,
		extraDates: task.extraDates,
		forwarded,
		visual:
			settings.convert24HourTimePrefix && task.visual ? convert24HourPrefix(moment, task.visual) : task.visual,
	});
}

/** The task filters of the settings: subtasks, hidden statuses, included and excluded tags, and empty tasks. */
function shownBy(settings: ResolveSettings): (resolved: ResolvedTask) => boolean {
	return ({ task, status, visual }) => {
		// Task items indented under another list item start at a column other than zero, see #61.
		if (settings.hideSubTasks && task.position.start.col !== 0) return false;
		const hidden = settings.hideStatusTasks;
		if (hidden?.length !== 0) {
			if (hidden?.includes(task.statusMarker)) return false;
			if (hidden?.some((marker) => status === TaskStatusMarkerMap[marker as keyof typeof TaskStatusMarkerMap]))
				return false;
		}
		const include = settings.taskIncludeTags;
		if (
			settings.useIncludeTags &&
			include &&
			include.length !== 0 &&
			!include.some((tag) => task.tags.includes(tag))
		)
			return false;
		const exclude = settings.taskExcludeTags;
		if (
			settings.useExcludeTags &&
			exclude &&
			exclude.length !== 0 &&
			!exclude.every((tag) => !task.tags.includes(tag))
		)
			return false;
		if (settings.filterEmpty && !(visual && visual.trim() !== "")) return false;
		return true;
	};
}
