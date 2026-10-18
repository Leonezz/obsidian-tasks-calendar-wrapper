import { Pos } from "obsidian";
import { moment } from "../../utils/moment";
import type { Moment } from "moment";
import { getFileTitle } from "@tasks-calendar-wrapper/core";
import { recurrenceSymbol, TaskDataModel } from "../../utils/tasks";
import { isTagHidden, relativeDate } from "../../utils/utils";

export type BadgeKind = "created" | "start" | "scheduled" | "due" | "done" | "repeat" | "priority";

export interface RowOptions {
	dateFormat: string;
	hideTags: string[];
	tagPalette: Record<string, string>;
	useBuiltinStyle: boolean;
}

/**
 * Everything one row of the timeline shows, as plain data. The row renders only from this, so two
 * rows with the same data look the same, and a row whose data did not change can skip rendering.
 * Every save creates new task objects, so comparing the tasks themselves would never match (issue #63).
 */
export interface TaskRowModel {
	display: string;
	path: string;
	position: Pos;
	line: number;
	col: number;
	link: string;
	isDailyNote: boolean;
	color: string | undefined;
	fileTitle: string;
	subPath: string;
	statusMarker: string;
	status: string;
	useBuiltinStyle: boolean;
	badges: { kind: BadgeKind; ariaLabel: string; label: string }[];
	tags: { tag: string; color: string | undefined }[];
}

export function taskRowModel(item: TaskDataModel, options: RowOptions, now: Moment = moment()): TaskRowModel {
	const dateBadge = (kind: BadgeKind, prefix: string, date: Moment | undefined) =>
		date ? [{ kind, ariaLabel: prefix + date.format(options.dateFormat), label: relativeDate(date, now) }] : [];
	const recurrence = item.recurrence ? item.recurrence.replace(recurrenceSymbol, "") : undefined;
	const badges = [
		...dateBadge("created", "create at ", item.created),
		...dateBadge("start", "start at ", item.start),
		...dateBadge("scheduled", "scheduled to ", item.scheduled),
		...dateBadge("due", "due at ", item.due),
		...dateBadge("done", "complete at ", item.completion),
		...(recurrence !== undefined
			? [{ kind: "repeat" as const, ariaLabel: "recurrent: " + recurrence, label: recurrence }]
			: []),
		...(item.priority
			? [
					{
						kind: "priority" as const,
						ariaLabel: "priority: " + item.priority,
						label: item.priority + " Priority",
					},
				]
			: []),
	];
	const tags = [...new Set(item.tags)]
		.filter((tag) => !isTagHidden(tag, options.hideTags))
		.map((tag) => ({
			tag,
			color: Object.keys(options.tagPalette).includes(tag) ? options.tagPalette[tag] : undefined,
		}));
	return {
		display: item.visual || item.text,
		path: item.path,
		position: item.position,
		line: item.line,
		col: item.position.end.col,
		link: item.link.path.replace("'", "&apos;"),
		isDailyNote: item.dailyNote,
		color: item.fontMatter["color"],
		fileTitle: getFileTitle(item.path),
		subPath: item.section.subpath || "",
		statusMarker: item.statusMarker,
		status: item.status,
		useBuiltinStyle: options.useBuiltinStyle,
		badges,
		tags,
	};
}
