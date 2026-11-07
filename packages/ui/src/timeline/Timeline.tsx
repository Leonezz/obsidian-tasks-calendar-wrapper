import * as React from "react";
import {
	counterClass,
	createQuery,
	dayKey,
	taskRowModel,
	quickEntryTargets,
	type ArrangeSettings,
	type ResolveSettings,
	type QuickEntryTargetOptions,
	type CounterFilter,
	type Counts,
	type DateValue,
	type QueryEnv,
	type QuickFilter,
	type Resolved,
	type ResolvedTask,
	type RowOptions,
	type TaskRowModel,
	type Task,
} from "@tasks-calendar-wrapper/core";
import {
	RowWriteContext,
	TodayFocusEventHandlersContext,
	UserOptionContext,
	useHost,
	type RowOverlayStore,
} from "../contexts";
import { recordProvider, timelineRendered } from "../renderprobe";
import { sameJsonValue } from "../sameJsonValue";
import { Year } from "./Year";
import type { EntryProps } from "./Day";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** The static markup tests render rows without a DOM, where React warns about layout effects. */
const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

export type TimelineOptions = ResolveSettings &
	ArrangeSettings &
	QuickEntryTargetOptions & {
		readonly useCounters: boolean;
		readonly useQuickEntry: boolean;
		readonly useYearHeader: boolean;
		readonly useFileBadge: boolean;
		readonly usePriority: boolean;
		readonly useRecurrence: boolean;
		readonly useRelative: boolean;
		readonly useSection: boolean;
		readonly useTags: boolean;
		readonly useModifyBadge: boolean;
		readonly counterBehavior: "Filter" | "Focus";
		readonly defaultFilters: string;
		readonly defaultTodayFocus: boolean;
		readonly hideTags: string[];
		readonly tagColorPalette: Record<string, string>;
		readonly dateFormat: string;
		readonly inbox: string;
		readonly useBuiltinStyle: boolean;
	};

export type TimelineProps = {
	readonly userOptions: TimelineOptions;
	readonly tasks: readonly Task[];
	readonly pendingWrites?: RowOverlayStore;
	readonly quickFilter?: QuickFilter;
	readonly queryEnv: (now: DateValue) => { env: QueryEnv; prepared?: Resolved };
	/** Tests can count model builds while using core's implementation. */
	readonly taskRowModel?: typeof taskRowModel;
};

const warn = (message: string, error: unknown) => console.warn(message, error);

const counterFilters: readonly CounterFilter[] = ["todoFilter", "overdueFilter", "unplannedFilter"];

/**
 * The counter whose Filter rules the timeline's class turned on: the stylesheet matched the class counterClass gives, so
 * a saved "todo" filtered as "todoFilter" did, and Focus filtered nothing. A value that names several counters, which
 * no setting saves, filters by the first of todo, overdue and unplanned.
 */
function counterFilterOf(filter: string, behavior: string): CounterFilter {
	const classes = counterClass(filter, behavior).split(/\s+/);
	return counterFilters.find((name) => classes.includes(name)) ?? "";
}

interface TimelineMemo {
	readonly rowWrites: React.ContextType<typeof RowWriteContext>;
	committedIds: readonly string[];
	committed: boolean;
	/** Remembers the last layout, so a click on a counter or on Focus on today resolves no task again. */
	readonly query: ReturnType<typeof createQuery>;
	/** The options with the Filter behaviour, kept while the options are the same, see settingsFor. */
	filtering?: { readonly options: TimelineOptions; readonly settings: TimelineOptions };
	readonly todayHandlers: React.ContextType<typeof TodayFocusEventHandlersContext>;
	readonly counterHandlers: Readonly<Record<"todo" | "overdue" | "unplanned", () => void>>;
	userOptionValue?: React.ContextType<typeof UserOptionContext>;
	entry?: EntryProps;
	tags?: { readonly tasks: readonly Task[]; readonly tags: readonly string[] };
	rows?: {
		readonly options: RowOptions;
		readonly day: string;
		readonly locale: string;
		readonly clock: { now: DateValue };
		readonly modelFor: (task: ResolvedTask) => TaskRowModel;
	};
}

function optionsFor(
	memo: TimelineMemo,
	options: TimelineOptions,
	now: DateValue,
): React.ContextType<typeof UserOptionContext> {
	const targets = quickEntryTargets(options, now);
	const taskFiles =
		memo.userOptionValue && sameJsonValue(memo.userOptionValue.taskFiles, targets)
			? memo.userOptionValue.taskFiles
			: targets;
	const value = {
		hideTags: options.hideTags,
		tagPalette: options.tagColorPalette,
		dateFormat: options.dateFormat,
		taskFiles,
		select: options.inbox,
		useBuiltinStyle: options.useBuiltinStyle,
	};
	if (!memo.userOptionValue || !sameJsonValue(memo.userOptionValue, value)) memo.userOptionValue = value;
	return memo.userOptionValue;
}

/** Every tag on the tasks, once whatever its case, sorted. */
function tagsFor(memo: TimelineMemo, tasks: readonly Task[]): readonly string[] {
	if (memo.tags?.tasks !== tasks) {
		const byKey = new Map<string, string>();
		for (const task of tasks)
			for (const tag of task.tags) if (!byKey.has(tag.toLowerCase())) byKey.set(tag.toLowerCase(), tag);
		const tags = [...byKey.values()].sort((a, b) => a.localeCompare(b));
		// The same tags keep their array, so an edit that changes none re-renders no entry.
		memo.tags = { tasks, tags: memo.tags && sameJsonValue(memo.tags.tags, tags) ? memo.tags.tags : tags };
	}
	return memo.tags.tags;
}

function entryFor(
	memo: TimelineMemo,
	counts: Counts,
	taskFiles: readonly string[],
	tags: readonly string[],
): EntryProps {
	const previous = memo.entry;
	const counters =
		previous &&
		previous.counters[0].cnt === counts.todo &&
		previous.counters[1].cnt === counts.overdue &&
		previous.counters[2].cnt === counts.unplanned
			? previous.counters
			: [
					{
						onClick: memo.counterHandlers.todo,
						cnt: counts.todo,
						label: "Todo",
						id: "todo",
						ariaLabel: "Todo Tasks",
					},
					{
						onClick: memo.counterHandlers.overdue,
						cnt: counts.overdue,
						id: "overdue",
						label: "Overdue",
						ariaLabel: "Overdue Tasks",
					},
					{
						onClick: memo.counterHandlers.unplanned,
						cnt: counts.unplanned,
						id: "unplanned",
						label: "Unplanned",
						ariaLabel: "Unplanned Tasks",
					},
				];
	if (!previous || previous.counters !== counters || previous.taskFiles !== taskFiles || previous.tags !== tags)
		memo.entry = { counters, taskFiles, tags };
	return memo.entry!;
}

/** Rows share this render's clock; only a new day, locale or row option discards their models. */
function modelsFor(
	memo: TimelineMemo,
	options: RowOptions,
	now: DateValue,
	host: ReturnType<typeof useHost>,
	buildModel: typeof taskRowModel,
): (task: ResolvedTask) => TaskRowModel {
	const day = dayKey(now);
	const locale = host.moment.locale();
	if (
		!memo.rows ||
		memo.rows.day !== day ||
		memo.rows.locale !== locale ||
		!sameJsonValue(memo.rows.options, options)
	) {
		const models = new WeakMap<ResolvedTask, TaskRowModel>();
		const clock = { now };
		memo.rows = {
			options,
			day,
			locale,
			clock,
			modelFor: (task) => {
				let model = models.get(task);
				if (!model) {
					model = buildModel(task, options, { now: clock.now, moment: host.moment, warn });
					models.set(task, model);
				}
				return model;
			},
		};
	} else memo.rows.clock.now = now;
	return memo.rows.modelFor;
}

/**
 * The settings query reads. A counter whose Filter class is on filters whatever the behaviour says, as the class
 * did: a hand-edited "todoFilter " with Focus gives that class too.
 */
function settingsFor(memo: TimelineMemo, options: TimelineOptions, counter: CounterFilter): TimelineOptions {
	if (counter === "" || options.counterBehavior === "Filter") return options;
	if (memo.filtering?.options !== options)
		memo.filtering = { options, settings: { ...options, counterBehavior: "Filter" } };
	return memo.filtering.settings;
}

export function Timeline(props: TimelineProps) {
	const host = useHost();
	const [filter, setFilter] = React.useState(() => props.userOptions.defaultFilters);
	const [todayFocus, setTodayFocus] = React.useState(() => props.userOptions.defaultTodayFocus);
	const ref = React.useRef<TimelineMemo>();
	const memo: TimelineMemo = (ref.current ??= {
		query: createQuery(),
		committedIds: [],
		committed: false,
		rowWrites: {
			pendingWrites: props.pendingWrites ?? { getSnapshot: () => undefined, subscribe: () => () => {} },
			clock: { lastListChangeAt: -Infinity },
		},
		todayHandlers: { handleTodayFocusClick: () => setTodayFocus((focus) => !focus) },
		counterHandlers: {
			todo: () => setFilter((filter) => (filter !== "todoFilter" ? "todoFilter" : "")),
			overdue: () => setFilter((filter) => (filter !== "overdueFilter" ? "overdueFilter" : "")),
			unplanned: () => setFilter((filter) => (filter !== "unplannedFilter" ? "unplannedFilter" : "")),
		},
	});
	const { rowWrites, todayHandlers } = memo;
	const { userOptions } = props;
	const now = host.now();
	const { env, prepared } = props.queryEnv(now);
	const counter = counterFilterOf(filter, userOptions.counterBehavior);
	const { counts, years } = memo.query(
		props.tasks,
		{ settings: settingsFor(memo, userOptions, counter), counter, quickFilter: props.quickFilter },
		env,
		prepared,
	);
	const renderedIds = years.flatMap((year) => year.days.flatMap((day) => day.tasks.map(({ task }) => task.id)));

	useClientLayoutEffect(() => {
		if (memo.committed) {
			if (
				renderedIds.length !== memo.committedIds.length ||
				renderedIds.some((id, index) => id !== memo.committedIds[index])
			)
				rowWrites.clock.lastListChangeAt = performance.now();
		} else memo.committed = true;
		memo.committedIds = renderedIds;
	});

	const styles = new Array<string>();
	if (!props.userOptions.useCounters) styles.push("noCounters");
	if (!props.userOptions.useQuickEntry) styles.push("noQuickEntry");
	if (!props.userOptions.useYearHeader) styles.push("noYear");
	if (
		!props.userOptions.useFileBadge &&
		!props.userOptions.usePriority &&
		!props.userOptions.useRecurrence &&
		!props.userOptions.useRelative &&
		!props.userOptions.useSection &&
		!props.userOptions.useTags
	)
		styles.push("noInfo");
	else {
		if (!props.userOptions.useFileBadge) styles.push("noFile");
		if (!props.userOptions.usePriority) styles.push("noPriority");
		if (!props.userOptions.useRecurrence) styles.push("noRepeat");
		if (!props.userOptions.useRelative) styles.push("noRelative");
		if (!props.userOptions.useSection) styles.push("noHeader");
		if (!props.userOptions.useTags) styles.push("noTag");
		if (!props.userOptions.useModifyBadge) styles.push("noModify");
	}

	const baseStyles = [...new Set(styles)].join(" ");
	const counterFilter = counterClass(filter, props.userOptions.counterBehavior);
	const todayFocusClass = todayFocus ? "todayFocus" : "";
	const userOptionValue = optionsFor(memo, userOptions, now);
	const entry = entryFor(memo, counts, userOptionValue.taskFiles, tagsFor(memo, props.tasks));
	const { dateFormat, hideTags, tagPalette, useBuiltinStyle } = userOptionValue;
	const modelFor = modelsFor(
		memo,
		{ dateFormat, hideTags, tagPalette, useBuiltinStyle },
		now,
		host,
		props.taskRowModel ?? taskRowModel,
	);
	process.env.NODE_ENV !== "production" && recordProvider("TodayFocusEventHandlersContext", todayHandlers);
	process.env.NODE_ENV !== "production" && recordProvider("UserOptionContext", userOptionValue);
	const tree = (
		<div className={`taskido ${baseStyles} ${counterFilter} ${todayFocusClass}`}>
			<RowWriteContext.Provider value={rowWrites}>
				<TodayFocusEventHandlersContext.Provider value={todayHandlers}>
					<UserOptionContext.Provider value={userOptionValue}>
						<span>
							{years.map((year, i) => (
								// Keyed by place, then by year, as before: a year added in front of the entry's year makes
								// React build the entry day, and with it the quick entry panel, again.
								<React.Fragment key={i}>
									<Year year={year} entry={entry} modelFor={modelFor} key={year.year} />
								</React.Fragment>
							))}
						</span>
					</UserOptionContext.Provider>
				</TodayFocusEventHandlersContext.Provider>
			</RowWriteContext.Provider>
		</div>
	);
	return process.env.NODE_ENV !== "production" ? timelineRendered(props, tree, rowWrites.clock) : tree;
}
