import { dayKey, inDisplayOrder, yearOfDay, type DayKey } from "@tasks-calendar-wrapper/core";
import type { UserOption } from "../../src/useroptions";
import { forwardedDateKey } from "../../utils/taskmapable";
import { TaskDataModel, TaskStatus } from "../../utils/tasks";

// inDisplayOrder moved to packages/core; re-exported for the modules that import it from here.
export { inDisplayOrder };

/**
 * The tasks a day of the timeline lists. With forwarding on, overdue tasks and tasks forwarded to today
 * are listed on today only, so they are not listed twice.
 */
export function tasksListedOnDay(tasksOfDay: TaskDataModel[], isToday: boolean, forward: boolean): TaskDataModel[] {
	if (!forward || isToday) return tasksOfDay;
	return tasksOfDay.filter((t) => t.status !== TaskStatus.overdue && !t.dates.has(forwardedDateKey));
}

/** Every day a task has a date on. */
function daysOfTask(task: TaskDataModel): Set<DayKey> {
	const days = new Set<DayKey>();
	for (const date of [task.due, task.scheduled, task.created, task.start, task.completion, ...task.dates.values()]) {
		if (date) days.add(dayKey(date));
	}
	return days;
}

/**
 * Lists every task under each day it has a date on, keeping the order of the list.
 * Each date is keyed once, instead of comparing every day of the timeline against every task,
 * which froze Obsidian for seconds in large vaults (issue #63).
 */
export function groupTasksByDate(taskList: TaskDataModel[]): Map<DayKey, TaskDataModel[]> {
	const byDate = new Map<DayKey, TaskDataModel[]>();
	for (const task of taskList) {
		for (const day of daysOfTask(task)) {
			const tasksOfDay = byDate.get(day);
			if (tasksOfDay) tasksOfDay.push(task);
			else byDate.set(day, [task]);
		}
	}
	return byDate;
}

/** The years the timeline shows, and the day its entry (focus toggle, counters, quick entry) sits on. */
export interface TimelineSpan {
	/** Every year from the earliest day with a task to the latest, today included, in display order. */
	years: number[];
	/** Today, or the day at the top or the bottom of the view, as the entry position says. */
	entryDay: DayKey;
}

/** Orders day keys by their year first, so a year before 0000 or after 9999 is placed right too. */
const byDay = (a: DayKey, b: DayKey) => yearOfDay(a) - yearOfDay(b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Works out the timeline's years from the day keys rather than from formatted dates: in Arabic, Persian,
 * Hindi and other locales moment writes its own digits, which gave the timeline no years at all.
 */
export function timelineSpan(
	taskList: TaskDataModel[],
	today: DayKey,
	entryPosition: UserOption["entryPosition"],
	newestFirst: boolean,
): TimelineSpan {
	const days = new Set<DayKey>([today]);
	for (const task of taskList) {
		for (const day of daysOfTask(task)) days.add(day);
	}
	const sorted = [...days].sort(byDay);
	const earliest = sorted[0];
	const latest = sorted[sorted.length - 1];
	const firstYear = yearOfDay(earliest);
	const years = inDisplayOrder(
		Array.from({ length: yearOfDay(latest) - firstYear + 1 }, (_, i) => firstYear + i),
		newestFirst,
	);
	// Newest first turns the view around, so the latest day is at the top.
	const [top, bottom] = newestFirst ? [latest, earliest] : [earliest, latest];
	return { years, entryDay: entryPosition === "top" ? top : entryPosition === "bottom" ? bottom : today };
}
