import * as React from "react";
import { type DayGroup, type ResolvedTask, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { Counters, type CounterProps } from "../entry/Counters";
import { QuickEntry } from "../entry/QuickEntry";
import { TagFilter } from "../entry/TagFilter";
import { TodayFocus } from "../entry/TodayFocus";
import { DayHeader } from "./DayHeader";
import { DayContent } from "./DayContent";
import { QuickEntryHandlerContext } from "../contexts";
import { recordRender } from "../renderprobe";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

// The date line's height (20.8 px plus its 10 px margins), rounded up.
const DATE_LINE_ESTIMATE = "41px";

export type EntryProps = {
	readonly counters: readonly CounterProps[];
	readonly taskFiles: readonly string[];
	/** The tags on the tasks, suggested by the tag filter. */
	readonly tags: readonly string[];
};

type DayProps = {
	readonly day: DayGroup;
	/** The day's year in the locale's digits. */
	readonly yearLabel: string;
	readonly entry?: EntryProps;
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

// The comparator is the negation of the old shouldComponentUpdate.
export const sameDayProps = (prev: DayProps, next: DayProps): boolean =>
	next.yearLabel === prev.yearLabel &&
	next.modelFor === prev.modelFor &&
	next.entry === prev.entry &&
	next.day.key === prev.day.key &&
	next.day.label === prev.day.label &&
	next.day.isToday === prev.day.isToday &&
	next.day.isEntry === prev.day.isEntry &&
	next.day.dated === prev.day.dated &&
	next.day.statuses.length === prev.day.statuses.length &&
	next.day.statuses.every((status, index) => status === prev.day.statuses[index]) &&
	next.day.tasks.length === prev.day.tasks.length &&
	next.day.tasks.every((task, index) => task === prev.day.tasks[index]);

// Keep the former Consumer's subscription here so a filter change does not render an unchanged day.
function EntryFilters({ entry }: { readonly entry: EntryProps }) {
	const { quickFilter } = React.useContext(QuickEntryHandlerContext);
	return (
		<>
			<TagFilter applied={quickFilter} tags={entry.tags} />
			<QuickEntry applied={quickFilter} taskFiles={entry.taskFiles} />
		</>
	);
}

/**
 * A day of the timeline, as core arranged it: the entry panel when the entry sits on it, then its heading and its
 * rows when it lists any. The statuses it lists before the counter filter go on its data-types, as before.
 * Days other than the entry day skip their rows' style, layout and paint while off screen.
 */
export const Day = React.memo(function Day(props: DayProps) {
	// Counted for the tests only; the production build drops the call and the probe.
	process.env.NODE_ENV !== "production" && recordRender("DateView", props.day.key);
	const { day, yearLabel, entry, modelFor } = props;
	const className = day.isToday ? "details today" : "details";
	const types = day.statuses.join(" ");
	return (
		<div>
			{entry && <TodayFocus visual={"Focus On Today"} />}
			{entry && <Counters counters={entry.counters} />}
			{entry && <EntryFilters entry={entry} />}
			{day.tasks.length > 0 && (
				<div
					className={className + (entry === undefined ? " tcw-day" : "")}
					data-year={yearLabel}
					data-types={types}
					style={
						entry === undefined
							? ({
									"--tcw-day-estimate": `calc(${day.tasks.length} * var(--tcw-day-row-estimate) + ${DATE_LINE_ESTIMATE})`,
								} as React.CSSProperties)
							: undefined
					}
				>
					<DayHeader thisDate={day.label} />
					<div className={className} data-year={yearLabel} data-types={types}>
						<DayContent tasks={day.tasks} modelFor={modelFor} />
					</div>
				</div>
			)}
		</div>
	);
}, sameDayProps);
