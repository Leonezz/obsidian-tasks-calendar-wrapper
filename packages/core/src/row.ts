/**
 * Everything one row of the timeline shows, as plain data, ported from the plugin's timeline/src/taskrow.ts (removed in
 * phase 1 step 9). The row
 * renders only from this, so two rows with the same data look the same, and a row whose data did not change can skip
 * rendering. Every save gives new task objects, so comparing the tasks themselves would never match, see #63.
 */
import { relativeDate, type DateValue, type MomentFactory } from "./dates";
import { getFileTitle } from "./paths";
import type { ResolvedTask } from "./resolve";
import type { TaskStatus } from "./status";
import { recurrenceSymbol } from "./syntax";
import { isTagHidden } from "./tags";
import type { TextRange } from "./task";

export type BadgeKind = "created" | "start" | "scheduled" | "due" | "done" | "repeat" | "priority";

export interface RowOptions {
	readonly dateFormat: string;
	readonly hideTags: readonly string[];
	readonly tagPalette: Readonly<Record<string, string>>;
	readonly useBuiltinStyle: boolean;
}

export interface RowEnv {
	readonly now: DateValue;
	readonly moment: MomentFactory;
	/** Told when the platform has no relative date format for the locale. */
	readonly warn: (message: string, error: unknown) => void;
}

export interface Badge {
	readonly kind: BadgeKind;
	readonly ariaLabel: string;
	readonly label: string;
}

export interface RowTag {
	readonly tag: string;
	readonly color: string | undefined;
}

/** Frozen. */
export interface TaskRowModel {
	readonly display: string;
	readonly path: string;
	readonly position: TextRange;
	readonly line: number;
	readonly col: number;
	readonly link: string;
	readonly isDailyNote: boolean;
	/** The note's color property, as written. */
	readonly color: unknown;
	readonly fileTitle: string;
	readonly subPath: string;
	readonly statusMarker: string;
	readonly status: TaskStatus;
	readonly useBuiltinStyle: boolean;
	readonly badges: readonly Badge[];
	readonly tags: readonly RowTag[];
}

/** A re-read note can give an equal row with new objects for its position, badges and tags. */
export function sameRowModel(left: TaskRowModel, right: TaskRowModel): boolean {
	return (
		left === right ||
		(left.display === right.display &&
			left.path === right.path &&
			left.line === right.line &&
			left.col === right.col &&
			left.link === right.link &&
			left.isDailyNote === right.isDailyNote &&
			left.color === right.color &&
			left.fileTitle === right.fileTitle &&
			left.subPath === right.subPath &&
			left.statusMarker === right.statusMarker &&
			left.status === right.status &&
			left.useBuiltinStyle === right.useBuiltinStyle &&
			left.position.start.line === right.position.start.line &&
			left.position.start.col === right.position.start.col &&
			left.position.start.offset === right.position.start.offset &&
			left.position.end.line === right.position.end.line &&
			left.position.end.col === right.position.end.col &&
			left.position.end.offset === right.position.end.offset &&
			left.badges.length === right.badges.length &&
			left.badges.every(
				(badge, i) =>
					badge.kind === right.badges[i].kind &&
					badge.ariaLabel === right.badges[i].ariaLabel &&
					badge.label === right.badges[i].label,
			) &&
			left.tags.length === right.tags.length &&
			left.tags.every((tag, i) => tag.tag === right.tags[i].tag && tag.color === right.tags[i].color))
	);
}

export function taskRowModel(resolved: ResolvedTask, options: RowOptions, env: RowEnv): TaskRowModel {
	const { task, dates } = resolved;
	const locale = env.moment.locale();
	const dateBadge = (kind: BadgeKind, prefix: string, date: DateValue | undefined): Badge[] =>
		date
			? [
					{
						kind,
						ariaLabel: prefix + date.format(options.dateFormat),
						label: relativeDate(date, env.now, locale, env.warn),
					},
				]
			: [];
	const recurrence = task.recurrence ? task.recurrence.replace(recurrenceSymbol, "") : undefined;
	const badges: Badge[] = [
		...dateBadge("created", "create at ", dates.created),
		...dateBadge("start", "start at ", dates.start),
		...dateBadge("scheduled", "scheduled to ", dates.scheduled),
		...dateBadge("due", "due at ", dates.due),
		...dateBadge("done", "complete at ", dates.completion),
		...(recurrence !== undefined
			? [{ kind: "repeat" as const, ariaLabel: "recurrent: " + recurrence, label: recurrence }]
			: []),
		...(task.priority
			? [
					{
						kind: "priority" as const,
						ariaLabel: "priority: " + task.priority,
						label: task.priority + " Priority",
					},
				]
			: []),
	];
	const tags = [...new Set(task.tags)]
		.filter((tag) => !isTagHidden(tag, options.hideTags))
		.map((tag) =>
			Object.freeze({
				tag,
				color: Object.keys(options.tagPalette).includes(tag) ? options.tagPalette[tag] : undefined,
			}),
		);
	return Object.freeze({
		display: resolved.visual || task.text,
		path: task.path,
		position: task.position,
		line: task.line,
		col: task.position.end.col,
		link: task.section.path.replace("'", "&apos;"),
		isDailyNote: resolved.dailyNote,
		color: task.note.frontmatter["color"],
		fileTitle: getFileTitle(task.path),
		subPath: task.section.subpath || "",
		statusMarker: task.statusMarker,
		status: resolved.status,
		useBuiltinStyle: options.useBuiltinStyle,
		badges: Object.freeze(badges.map((badge) => Object.freeze(badge))),
		tags: Object.freeze(tags),
	});
}
