/**
 * Turns parsed tasks into the tasks the timeline shows, for given settings and a given now: the note filters, the
 * daily note's date, the status, forwarding to today, the status order, the 24-hour option, the sort and the task
 * filters. It follows the plugin's former parser chain (utils/tasklist.ts and utils/taskmapable.ts, removed in phase 1
 * step 9) and its note filters. It never changes the tasks it is given.
 */
import { afterInstant, beforeDay, convert24HourPrefix, dayKey, parseDailyNoteName, sameDay } from "./dates";
import type { DateEntries, DateValue, DayKey, MomentFactory } from "./dates";
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
	/** Whether a done task with no date at all is listed on today. Unset means it is. */
	readonly forwardUndatedDone?: boolean;
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

/** What the clock and the app give: the current time, and Obsidian's moment. */
export interface QueryEnv {
	readonly now: DateValue;
	readonly moment: MomentFactory;
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
 * option for it, so is a task that has started or whose scheduled date has passed, see #84. The undated done task is
 * only listed when forwardUndatedDone is set.
 */
export function forwardKey(
	status: TaskStatus,
	dates: TaskDates,
	extraDates: DateEntries,
	now: DateValue,
	pastStartAndScheduled: boolean,
	undatedDone = true,
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
		undatedDone &&
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
	const dailyNoteFormat = settings.dailyNoteFormat ?? innerDateFormat;
	const noteDates = new Map<string, DateValue | undefined>();
	const noteDate = (path: string) => {
		if (!noteDates.has(path)) noteDates.set(path, parseDailyNoteName(moment, path, dailyNoteFormat));
		return noteDates.get(path);
	};

	const resolved = [...tasks]
		.sort(byPathThenLine)
		.filter((task) => noteVisible(task.note, settings))
		.map((task) => resolveTask(task, noteDate(task.path), settings, env));

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

	return Object.freeze({ today: dayKey(now), shown: Object.freeze(sorted.filter(shownBy(settings))) });
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
		? forwardKey(
				status,
				dates,
				task.extraDates,
				now,
				!!settings.forwardPastStartAndScheduled,
				settings.forwardUndatedDone !== false,
			)
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
