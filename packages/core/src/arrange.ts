/**
 * Arranges the tasks resolveTasks shows the way the timeline lays them out: the quick filter, the counts, the years and
 * their days, the day the entry panel sits on, and the counter filter. It does what the plugin's views (TimelineView,
 * YearView, DateView), its quick filter (ObsidianBridge.handleFilterEnable) and the Filter rules of styles.css did
 * before phase 1 step 8; those rules hid the tasks, days and year headers without the counter's statuses. Focus on
 * today and the Focus counter behaviour stay in the stylesheet: they hide or highlight, and change no data.
 */
import {
	betweenDaysExclusive,
	dayKey,
	inDisplayOrder,
	parseLooseDate,
	readDayKey,
	sameDay,
	yearLabel,
	yearOfDay,
} from "./dates";
import type { DateValue, DayKey } from "./dates";
import {
	pickResolveSettings,
	resolveTasks,
	sameResolveSettings,
	type QueryEnv,
	type Resolved,
	type ResolvedTask,
	type ResolveSettings,
} from "./resolve";
import { TaskStatus } from "./status";
import type { Task } from "./task";

export type EntryPosition = "today" | "top" | "bottom";
export type CounterBehavior = "Filter" | "Focus";

/** The settings arrange reads. The plugin's user options have them all. */
export interface ArrangeSettings {
	readonly forward?: boolean;
	readonly newestFirst?: boolean;
	/** Where the entry panel (focus on today, counters, quick entry) sits; today by default. */
	readonly entryPosition?: EntryPosition;
	/** How a day's heading is written. */
	readonly dateFormat: string;
	/** Filter hides what the active counter does not count; Focus only highlights it, in the stylesheet. */
	readonly counterBehavior?: CounterBehavior;
}

/** The active counter, as the "Activate Filter On Load" setting saves it, or "" for none. */
export type CounterFilter = "" | "todoFilter" | "overdueFilter" | "unplannedFilter";

/** The quick entry panel's filter. A range needs both of its days, which are left out of it, read as moment(day) reads them. */
export interface QuickFilter {
	readonly from?: DayKey;
	readonly to?: DayKey;
	/** Priority labels, compared as written. */
	readonly priorities: readonly string[];
}

/** What the view shows: the settings and the state of the view's controls. */
export interface ViewState {
	readonly settings: ResolveSettings & ArrangeSettings;
	readonly counter: CounterFilter;
	readonly quickFilter?: QuickFilter;
}

export interface Counts {
	/** Every task that is not overdue, unplanned, done or cancelled. */
	readonly todo: number;
	readonly overdue: number;
	readonly unplanned: number;
	readonly done: number;
	readonly cancelled: number;
}

export interface DayGroup {
	readonly key: DayKey;
	/** The day written in the date format. */
	readonly label: string;
	/** The day is today. Its key is read as the views read it, see readDayKey. */
	readonly isToday: boolean;
	/** The entry panel sits on this day. Its key is read as the views read it, see readDayKey. */
	readonly isEntry: boolean;
	/** Some task has a date on this day. Only the entry day can be shown without one. */
	readonly dated: boolean;
	/** The tasks listed on the day, after the counter filter. The day's heading is shown only when there are some. */
	readonly tasks: readonly ResolvedTask[];
	/** The statuses of the tasks listed on the day before the counter filter, each once. */
	readonly statuses: readonly TaskStatus[];
}

export interface YearGroup {
	readonly year: number;
	/** The year in the locale's digits. */
	readonly label: string;
	readonly isCurrent: boolean;
	/** The year has a task, and the counter filter keeps one of the year's statuses. */
	readonly showHeader: boolean;
	/** The statuses of the tasks with a date in the year, each once. */
	readonly statuses: readonly TaskStatus[];
	/** In display order. */
	readonly days: readonly DayGroup[];
}

/** What the timeline shows. Frozen. */
export interface QueryResult {
	readonly today: DayKey;
	/** Today, or the day at the top or the bottom of the view, as the entry position says. */
	readonly entryDay: DayKey;
	/** The tasks resolveTasks shows, before the quick filter. */
	readonly shown: readonly ResolvedTask[];
	/** The tasks after the quick filter, which are counted and arranged. */
	readonly tasks: readonly ResolvedTask[];
	/** Taken before the counter filter. */
	readonly counts: Counts;
	/** Every year from the earliest day with a task to the latest, today included, in display order. */
	readonly years: readonly YearGroup[];
}

/** The statuses each counter counts, which its filter keeps. */
const counterStatuses: Readonly<Record<Exclude<CounterFilter, "">, readonly TaskStatus[]>> = {
	todoFilter: [TaskStatus.due, TaskStatus.scheduled, TaskStatus.process, TaskStatus.start],
	overdueFilter: [TaskStatus.overdue],
	unplannedFilter: [TaskStatus.unplanned],
};

/** Every date a task is placed on: its own, its other dates, and today when it is forwarded there. */
function datesOf(resolved: ResolvedTask, now: DateValue): DateValue[] {
	const { due, scheduled, created, start, completion } = resolved.dates;
	return [
		...[due, scheduled, created, start, completion].filter((date): date is DateValue => date !== undefined),
		...resolved.extraDates.map(([, date]) => date),
		...(resolved.forwarded ? [now] : []),
	];
}

/** Every day a task has a date on, each once. */
function daysOf(resolved: ResolvedTask, now: DateValue): Set<DayKey> {
	return new Set(datesOf(resolved, now).map(dayKey));
}

/**
 * Lists every task under each day it has a date on, keeping the order of the list. Each date is keyed once, instead
 * of comparing every day of the timeline against every task, which froze Obsidian for seconds in large vaults, see #63.
 */
export function groupTasksByDay(tasks: readonly ResolvedTask[], now: DateValue): Map<DayKey, ResolvedTask[]> {
	return groupBy(tasks, (task) => daysOf(task, now));
}

/** Lists every item under each of its keys, keeping the order of the list. The lists are new, so they are filled in place. */
function groupBy<K, T>(items: readonly T[], keysOf: (item: T) => Iterable<K>): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		for (const key of keysOf(item)) {
			const group = groups.get(key);
			if (group) group.push(item);
			else groups.set(key, [item]);
		}
	}
	return groups;
}

/**
 * The tasks a day lists. With forwarding on, overdue tasks and tasks forwarded past their start or scheduled date are
 * listed on today only, so they are not listed twice.
 */
export function tasksListedOnDay(
	tasksOfDay: readonly ResolvedTask[],
	isToday: boolean,
	forward: boolean,
): readonly ResolvedTask[] {
	if (!forward || isToday) return tasksOfDay;
	return tasksOfDay.filter((r) => r.status !== TaskStatus.overdue && r.forwarded !== "forwarded");
}

/** The quick filter, as ObsidianBridge.handleFilterEnable applied it. */
function quickFiltered(shown: readonly ResolvedTask[], quick: QuickFilter | undefined, env: QueryEnv) {
	if (!quick) return shown;
	let tasks = shown;
	if (quick.from && quick.to) {
		const from = parseLooseDate(env.moment, quick.from);
		const to = parseLooseDate(env.moment, quick.to);
		// The days come from date inputs. One moment cannot read matched no task, which the view shows as it is.
		tasks =
			from && to
				? tasks.filter((r) => datesOf(r, env.now).some((date) => betweenDaysExclusive(date, from, to)))
				: [];
	}
	if (quick.priorities.length !== 0) tasks = tasks.filter((r) => quick.priorities.includes(r.task.priority));
	return tasks;
}

function countsOf(tasks: readonly ResolvedTask[]): Counts {
	const count = (status: TaskStatus) => tasks.filter((r) => r.status === status).length;
	const overdue = count(TaskStatus.overdue);
	const unplanned = count(TaskStatus.unplanned);
	const done = count(TaskStatus.done);
	const cancelled = count(TaskStatus.cancelled);
	return { todo: tasks.length - overdue - unplanned - done - cancelled, overdue, unplanned, done, cancelled };
}

/** Orders day keys by their year first, so a year before 0000 or after 9999 is placed right too. */
const byYearThenDay = (a: DayKey, b: DayKey) => yearOfDay(a) - yearOfDay(b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The years from the earliest day with a task to the latest, today included, and the entry day. The years come from
 * the day keys rather than from formatted dates: Arabic, Persian, Hindi and other locales write their own digits.
 */
function timelineSpan(days: Iterable<DayKey>, today: DayKey, settings: ArrangeSettings) {
	const sorted = [...new Set([today, ...days])].sort(byYearThenDay);
	const earliest = sorted[0];
	const latest = sorted[sorted.length - 1];
	const firstYear = yearOfDay(earliest);
	const newestFirst = !!settings.newestFirst;
	const years = inDisplayOrder(
		Array.from({ length: yearOfDay(latest) - firstYear + 1 }, (_, i) => firstYear + i),
		newestFirst,
	);
	// Newest first turns the view around, so the latest day is at the top.
	const [top, bottom] = newestFirst ? [latest, earliest] : [earliest, latest];
	const position = settings.entryPosition ?? "today";
	return { years, entryDay: position === "top" ? top : position === "bottom" ? bottom : today };
}

const distinctStatuses = (tasks: readonly ResolvedTask[]) => Object.freeze([...new Set(tasks.map((r) => r.status))]);

/** Arranges resolved tasks for a view. It never changes what it is given. */
export function arrange(resolved: Resolved, view: ViewState, env: QueryEnv): QueryResult {
	const { settings } = view;
	const { today } = resolved;
	// The caller's list is left as it is: one that is not frozen yet is copied, and the copy is frozen.
	const shown = Object.isFrozen(resolved.shown) ? resolved.shown : Object.freeze([...resolved.shown]);
	const tasks = quickFiltered(shown, view.quickFilter, env);
	const byDay = groupTasksByDay(tasks, env.now);
	const { years, entryDay } = timelineSpan(byDay.keys(), today, settings);
	const kept =
		view.counter !== "" && settings.counterBehavior === "Filter" ? counterStatuses[view.counter] : undefined;
	const keeps = (status: TaskStatus) => !kept || kept.includes(status);

	const tasksOfYear = groupBy(tasks, (task) => new Set([...daysOf(task, env.now)].map(yearOfDay)));
	const daysOfYear = groupBy([...new Set([...byDay.keys(), entryDay])], (day) => [yearOfDay(day)]);

	const entry = readDayKey(env.moment, entryDay).format("YYYYMMDD");
	const dayGroup = (key: DayKey): DayGroup => {
		const date = readDayKey(env.moment, key);
		const isToday = sameDay(date, env.now);
		const listed = tasksListedOnDay(byDay.get(key) ?? [], isToday, !!settings.forward);
		return Object.freeze({
			key,
			label: date.format(settings.dateFormat),
			isToday,
			isEntry: date.format("YYYYMMDD") === entry,
			dated: byDay.has(key),
			tasks: Object.freeze(listed.filter((r) => keeps(r.status))),
			statuses: distinctStatuses(listed),
		});
	};
	const yearGroup = (year: number): YearGroup => {
		const yearTasks = tasksOfYear.get(year) ?? [];
		const statuses = distinctStatuses(yearTasks);
		return Object.freeze({
			year,
			label: yearLabel(env.now, year),
			isCurrent: year === env.now.year(),
			showHeader: yearTasks.length > 0 && statuses.some(keeps),
			statuses,
			days: Object.freeze(inDisplayOrder(daysOfYear.get(year) ?? [], !!settings.newestFirst).map(dayGroup)),
		});
	};

	// Frozen part by part: the resolved tasks are frozen already, and freezing them again would walk every one. tasks is
	// either shown, frozen above, or a list quickFiltered made.
	return Object.freeze({
		today,
		entryDay,
		shown,
		tasks: Object.freeze(tasks),
		counts: Object.freeze(countsOf(tasks)),
		years: Object.freeze(years.map(yearGroup)),
	});
}

/** The tasks of a view: resolveTasks, then arrange. */
export function query(tasks: readonly Task[], view: ViewState, env: QueryEnv): QueryResult {
	return arrange(resolveTasks(tasks, view.settings, env), view, env);
}

/**
 * query with a memory of its last result, for a view that renders again on every click. Resolving is remembered for
 * the same tasks, equal resolve settings, day and date cache. Without a date cache it resolves each time, since the
 * language may have changed. Arranging uses the same environment and also compares the full settings, counter
 * and quick filter by identity.
 * A caller that already resolved the tasks under these conditions can pass that result to arrange it directly.
 */
export function createQuery(): (
	tasks: readonly Task[],
	view: ViewState,
	env: QueryEnv,
	prepared?: Resolved,
) => QueryResult {
	let resolvedFor:
		| {
				tasks: readonly Task[];
				settings: ResolveSettings;
				day: DayKey;
				dateCache: QueryEnv["dateCache"];
				resolved: Resolved;
		  }
		| undefined;
	let arrangedFor:
		| {
				resolved: Resolved;
				settings: ViewState["settings"];
				day: DayKey;
				dateCache: QueryEnv["dateCache"];
				counter: CounterFilter;
				quickFilter: QuickFilter | undefined;
				result: QueryResult;
		  }
		| undefined;
	return (tasks, view, env, prepared) => {
		const day = dayKey(env.now);
		let resolved = prepared;
		if (resolved) {
			// A later render may no longer supply prepared, even while the tasks and resolve conditions stay equal.
			resolvedFor = {
				tasks,
				settings: pickResolveSettings(view.settings),
				day,
				dateCache: env.dateCache,
				resolved,
			};
		} else {
			const settings = pickResolveSettings(view.settings);
			if (
				!env.dateCache ||
				resolvedFor?.tasks !== tasks ||
				!sameResolveSettings(resolvedFor.settings, settings) ||
				resolvedFor.day !== day ||
				resolvedFor.dateCache !== env.dateCache
			) {
				resolvedFor = {
					tasks,
					settings,
					day,
					dateCache: env.dateCache,
					resolved: resolveTasks(tasks, view.settings, env),
				};
			}
			resolved = resolvedFor.resolved;
		}
		if (
			!env.dateCache ||
			arrangedFor?.resolved !== resolved ||
			arrangedFor.settings !== view.settings ||
			arrangedFor.day !== day ||
			arrangedFor.dateCache !== env.dateCache ||
			arrangedFor.counter !== view.counter ||
			arrangedFor.quickFilter !== view.quickFilter
		) {
			arrangedFor = {
				resolved,
				settings: view.settings,
				day,
				dateCache: env.dateCache,
				counter: view.counter,
				quickFilter: view.quickFilter,
				result: arrange(resolved, view, env),
			};
		}
		return arrangedFor.result;
	};
}
