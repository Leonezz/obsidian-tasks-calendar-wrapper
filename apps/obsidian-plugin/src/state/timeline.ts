import isEqual from "underscore/modules/isEqual.js";
import {
	copyJsonValue,
	deepFreeze,
	type DayKey,
	type Resolved,
	type ResolvedTask,
	type ResolveSettings,
	type Task,
} from "@tasks-calendar-wrapper/core";
import type { ParseKey } from "../../utils/parsekey";
import { defaultUserOptions, type UserOption } from "../useroptions";

/**
 * What the old view's list held of a task it showed. Backbone compared that list to decide whether the timeline had
 * changed. The old view dropped the quick filter then; it now stays. It kept a task's forwarded and other dates in a
 * Map, which Backbone's comparison does not look into, and it had neither the note's tags nor what comes before the
 * list marker.
 */
export function heldOf(resolved: ResolvedTask) {
	const { task } = resolved;
	return {
		id: task.id,
		position: task.position,
		lineCount: task.lineCount,
		text: task.text,
		symbol: task.symbol,
		statusMarker: task.statusMarker,
		completed: task.completed,
		fullyCompleted: task.fullyCompleted,
		checked: task.checked,
		isTasksTask: task.isTasksTask,
		priority: task.priority,
		recurrence: task.recurrence,
		tags: task.tags,
		section: task.section,
		outlinks: task.outlinks,
		frontmatter: task.note.frontmatter,
		status: resolved.status,
		order: resolved.order,
		dailyNote: resolved.dailyNote,
		dates: resolved.dates,
		visual: resolved.visual,
	};
}

export type HeldTask = ReturnType<typeof heldOf>;

/**
 * What a timeline view holds: its options, the tasks read last, and what the old view's list held of the ones shown
 * then, see heldOf. The bridge renders again when the options are replaced, and when the list shown is, keeping the
 * quick filter.
 */
export interface TimelineState {
	readonly options: UserOption;
	readonly tasks: readonly Task[];
	readonly shown: readonly HeldTask[];
	/** Resolved from this state's tasks, under these conditions; not necessarily the tasks the bridge still holds. */
	readonly resolved?: {
		readonly shown: Resolved;
		readonly under: {
			readonly settings: ResolveSettings;
			readonly day: DayKey;
			readonly parseKey: ParseKey;
		};
	};
}

/** A frozen copy of the default options, and nothing read yet. */
export function initialTimelineState(): TimelineState {
	return {
		options: deepFreeze(copyJsonValue(defaultUserOptions)),
		tasks: Object.freeze([]),
		shown: Object.freeze([]),
	};
}

/**
 * The state with a frozen copy of these options; a new one also for the same options, as each push renders again.
 * What was handed in is not frozen.
 */
export function withOptions(state: TimelineState, options: Readonly<UserOption>): TimelineState {
	return { ...state, options: deepFreeze(copyJsonValue(options)) };
}

/**
 * The state after a reload: the tasks read, in a new frozen array, and the list shown, which stays the one before when
 * it holds the same, compared as Backbone compared it, with underscore's isEqual. Task files that are not set become
 * none, as the old view set them after every reload.
 */
export function withReload(
	state: TimelineState,
	tasks: readonly Task[],
	shown: readonly HeldTask[],
	resolved?: TimelineState["resolved"],
): TimelineState {
	return {
		options: state.options.taskFiles ? state.options : deepFreeze({ ...state.options, taskFiles: [] }),
		tasks: Object.freeze([...tasks]),
		shown: isEqual(state.shown, shown) ? state.shown : shown,
		...(resolved ? { resolved: Object.freeze({ ...resolved, under: Object.freeze({ ...resolved.under }) }) } : {}),
	};
}
