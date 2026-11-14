import * as React from "react";
import {
	copy,
	counterClass,
	createQuery,
	dayKey,
	focusToday,
	taskRowModel,
	quickEntryTargets,
	type ArrangeSettings,
	type ResolveSettings,
	type QuickEntryTargetOptions,
	type CounterFilter,
	type Counts,
	type DateValue,
	type QueryEnv,
	type QueryResult,
	type QuickFilter,
	type Resolved,
	type ResolvedTask,
	type RowOptions,
	type TaskRowModel,
	type Task,
	type Store,
} from "@tasks-calendar-wrapper/core";
import {
	RowWriteContext,
	ViewActionsContext,
	rowInstanceKey,
	useHost,
	type RowOverlayStore,
	type ViewState,
	type ViewActions,
} from "../contexts";
import { useStore } from "../hooks/useStore";
import { recordProvider, timelineRendered } from "../renderprobe";
import { sameJsonValue } from "../sameJsonValue";
import { Year } from "./Year";
import type { EntryProps } from "./Day";
import { useWindowed, type TimelineWindow } from "./Windowed";

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
	readonly viewState: Store<ViewState>;
	readonly viewActions: ViewActions;
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

const selectCounter = (state: ViewState): string => state.counter;
const selectTodayFocus = (state: ViewState): boolean => state.todayFocus;

interface UserOptionValue {
	readonly taskFiles: string[];
	readonly select: string;
	readonly dateFormat: string;
	readonly tagPalette: Record<string, string>;
	readonly hideTags: string[];
	readonly useBuiltinStyle: boolean;
}

interface TimelineMemo {
	readonly rowWrites: React.ContextType<typeof RowWriteContext>;
	committedIds: readonly string[];
	committedInstanceIds: readonly string[];
	committed: boolean;
	committedTodayFocus?: boolean;
	focusId?: string;
	focusElement?: HTMLElement;
	/** A focused row left before its surviving neighbour had mounted. */
	pendingFocusRestore?: string;
	/** Whether the stop row held DOM focus when this render began, before its commit could detach it. */
	stopHadFocus: boolean;
	eligibleIds: readonly string[];
	rowElements: Map<string, HTMLElement>;
	window?: TimelineWindow;
	/** Remembers the last layout, so a click on a counter or on Focus on today resolves no task again. */
	readonly query: ReturnType<typeof createQuery>;
	focus?: { readonly result: QueryResult; readonly focused: QueryResult };
	/** The options with the Filter behaviour, kept while the options are the same, see settingsFor. */
	filtering?: { readonly options: TimelineOptions; readonly settings: TimelineOptions };
	readonly counterHandlers: Readonly<Record<"todo" | "overdue" | "unplanned", () => void>>;
	userOptionValue?: UserOptionValue;
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

function setRowTabIndex(row: HTMLElement, tabIndex: number) {
	row.tabIndex = tabIndex;
	for (const control of row.querySelectorAll<HTMLElement>('[role="button"], a.tag, .content a[href]'))
		control.tabIndex = tabIndex;
}

function focusRow(memo: TimelineMemo, id: string | undefined, refresh = false) {
	const row = id === undefined ? undefined : memo.rowElements.get(id);
	if (memo.focusId === id && memo.focusElement === row) {
		if (refresh && row) setRowTabIndex(row, 0);
		return;
	}
	if (memo.focusElement) setRowTabIndex(memo.focusElement, -1);
	if (memo.pendingFocusRestore !== id) memo.pendingFocusRestore = undefined;
	memo.focusId = id;
	memo.focusElement = row;
	memo.window?.setFocus(id);
	if (row) setRowTabIndex(row, 0);
}

/** The nearest row that is still listed: after the old stop in the previous list, else before it. */
function survivingNeighbour(previous: readonly string[], id: string, eligible: readonly string[]): string | undefined {
	const listed = new Set(eligible);
	const index = previous.indexOf(id);
	if (index < 0) return undefined;
	return (
		previous.slice(index + 1).find((id) => listed.has(id)) ??
		previous
			.slice(0, index)
			.reverse()
			.find((id) => listed.has(id))
	);
}

function moveFocus(memo: TimelineMemo, id: string, key: string) {
	const index = memo.eligibleIds.indexOf(id);
	const next =
		key === "Home" ? 0 : key === "End" ? memo.eligibleIds.length - 1 : key === "ArrowDown" ? index + 1 : index - 1;
	if (index >= 0 && next >= 0 && next < memo.eligibleIds.length) {
		const id = memo.eligibleIds[next];
		const row = memo.rowElements.get(id);
		if (row) row.focus();
		else void memo.window?.revealInstance(id).then((shown) => shown && memo.rowElements.get(id)?.focus());
	}
}

function optionsFor(memo: TimelineMemo, options: TimelineOptions, now: DateValue): UserOptionValue {
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
						label: copy.counters.todo,
						id: "todo",
						ariaLabel: copy.counters.todoAria,
					},
					{
						onClick: memo.counterHandlers.overdue,
						cnt: counts.overdue,
						id: "overdue",
						label: copy.counters.overdue,
						ariaLabel: copy.counters.overdueAria,
					},
					{
						onClick: memo.counterHandlers.unplanned,
						cnt: counts.unplanned,
						id: "unplanned",
						label: copy.counters.unplanned,
						ariaLabel: copy.counters.unplannedAria,
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

/** Keeps the focused layout while the query result is the same. */
function focusedFor(memo: TimelineMemo, result: QueryResult): QueryResult {
	if (memo.focus?.result !== result) memo.focus = { result, focused: focusToday(result) };
	return memo.focus.focused;
}

export function Timeline(props: TimelineProps) {
	const host = useHost();
	const counterFilterValue = useStore(props.viewState, selectCounter);
	const todayFocus = useStore(props.viewState, selectTodayFocus);
	const root = React.useRef<HTMLDivElement>(null);
	const id = React.useId();
	const ref = React.useRef<TimelineMemo>();
	const memo: TimelineMemo = (ref.current ??= {
		query: createQuery(),
		committedIds: [],
		committedInstanceIds: [],
		committed: false,
		stopHadFocus: false,
		eligibleIds: [],
		rowElements: new Map(),
		rowWrites: {
			pendingWrites: props.pendingWrites ?? { getSnapshot: () => undefined, subscribe: () => () => {} },
			clock: { lastListChangeAt: -Infinity },
			prefix: `tcw-${id.replace(/:/g, "")}-`,
			focusRow: (id) => focusRow(memo, id, true),
			moveFocus: (id, key) => moveFocus(memo, id, key),
			registerRow: (id, element) => {
				if (element) {
					memo.rowElements.set(id, element);
					if (memo.focusId === id) focusRow(memo, id, true);
					if (memo.pendingFocusRestore === id) {
						memo.pendingFocusRestore = undefined;
						const active = element.ownerDocument.activeElement;
						if (!active || active === element.ownerDocument.body) element.focus();
					}
				} else {
					memo.rowElements.delete(id);
					if (memo.focusId === id) memo.focusElement = undefined;
				}
			},
		},
		counterHandlers: {
			todo: () => props.viewActions.toggleCounter("todo"),
			overdue: () => props.viewActions.toggleCounter("overdue"),
			unplanned: () => props.viewActions.toggleCounter("unplanned"),
		},
	});
	const { rowWrites } = memo;
	const { userOptions } = props;
	const now = host.now();
	const { env, prepared } = props.queryEnv(now);
	const counter = counterFilterOf(counterFilterValue, userOptions.counterBehavior);
	const result = memo.query(
		props.tasks,
		{ settings: settingsFor(memo, userOptions, counter), counter, quickFilter: props.quickFilter },
		env,
		prepared,
	);
	const { counts } = result;
	const renderedIds = result.years.flatMap((year) =>
		year.days.flatMap((day) => day.tasks.map(({ task }) => task.id)),
	);
	const shown = todayFocus ? focusedFor(memo, result) : result;
	const days = shown.years.flatMap((year) => year.days);
	const instanceIds = days.flatMap((day) => day.tasks.map(({ task }) => rowInstanceKey(day.key, task.id)));
	const window = useWindowed(shown, host, memo.rowElements, memo.focusId, userOptions.useYearHeader);
	memo.window = window.controller;
	const active = memo.focusElement?.ownerDocument.activeElement;
	memo.stopHadFocus = !!active && !!memo.focusElement?.contains(active);

	useClientLayoutEffect(() => {
		const listChanged =
			renderedIds.length !== memo.committedIds.length ||
			renderedIds.some((id, index) => id !== memo.committedIds[index]);
		const instancesChanged =
			instanceIds.length !== memo.committedInstanceIds.length ||
			instanceIds.some((id, index) => id !== memo.committedInstanceIds[index]);
		const focusChanged = !memo.committed || instancesChanged || memo.committedTodayFocus !== todayFocus;
		if (memo.committed && listChanged) rowWrites.clock.lastListChangeAt = performance.now();
		memo.committed = true;
		memo.committedIds = renderedIds;
		memo.committedInstanceIds = instanceIds;
		memo.committedTodayFocus = todayFocus;
		if (!root.current) return;
		root.current.querySelector(".todayHeader")?.setAttribute("aria-pressed", String(todayFocus));
		const classes = counterFilter.split(/\s+/);
		for (const counter of root.current.querySelectorAll<HTMLElement>(".counter"))
			counter.setAttribute(
				"aria-pressed",
				String(classes.includes(`${counter.id}Filter`) || classes.includes(`${counter.id}Focus`)),
			);
		// Markdown can render again without a list change; initialize only its new links.
		for (const link of root.current.querySelectorAll<HTMLElement>(".task .content a[href]:not([tabindex])"))
			link.tabIndex = link.closest(".task") === memo.focusElement ? 0 : -1;
		// A control mounted since the last commit, such as a new tag, follows the stop row.
		if (!focusChanged) return focusRow(memo, memo.focusId, true);
		const eligible = days.filter((day) => !todayFocus || day.isToday);
		const previousEligible = memo.eligibleIds;
		memo.eligibleIds = eligible.flatMap((day) => day.tasks.map(({ task }) => rowInstanceKey(day.key, task.id)));
		const afterEntry = days
			.slice(
				Math.max(
					0,
					days.findIndex((day) => day.isEntry),
				),
			)
			.filter((day) => !todayFocus || day.isToday)
			.flatMap((day) => day.tasks.map(({ task }) => rowInstanceKey(day.key, task.id)));
		const stop = memo.focusId;
		if (stop !== undefined && memo.eligibleIds.includes(stop)) return focusRow(memo, stop, true);
		// A focused stop row that leaves (completed, filtered, moved) hands focus to its nearest listed neighbour;
		// a stop without focus goes back to the default, as the markup goldens record.
		const neighbour =
			stop === undefined || !memo.stopHadFocus
				? undefined
				: survivingNeighbour(previousEligible, stop, memo.eligibleIds);
		focusRow(memo, neighbour ?? afterEntry[0] ?? memo.eligibleIds[0], true);
		// Focus fell to the body with the detached stop row; never take it from anywhere else.
		const active = root.current.ownerDocument.activeElement;
		if (memo.stopHadFocus && (!active || active === root.current.ownerDocument.body)) {
			if (memo.focusElement) memo.focusElement.focus();
			else if (memo.focusId !== undefined) {
				memo.pendingFocusRestore = memo.focusId;
				void memo.window?.revealInstance(memo.focusId);
			}
		}
	});
	useClientLayoutEffect(() => window.commit(root.current));

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
	const counterFilter = counterClass(counterFilterValue, props.userOptions.counterBehavior);
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
	process.env.NODE_ENV !== "production" && recordProvider("ViewActions", props.viewActions);
	const tree = (
		<div
			ref={root}
			className={`taskido ${baseStyles} ${counterFilter} ${todayFocusClass}${window.active ? " tcw-windowed" : ""}`}
		>
			<RowWriteContext.Provider value={rowWrites}>
				<ViewActionsContext.Provider value={props.viewActions}>
					<span>
						{shown.years.map((year, i) => (
							// Keyed by place, then by year, as before: a year added in front of the entry's year makes
							// React build the entry day, and with it the quick entry panel, again.
							<React.Fragment key={i}>
								<Year
									year={year}
									entry={entry}
									modelFor={modelFor}
									window={window.active ? window : undefined}
									yearIndex={i}
									key={year.year}
								/>
							</React.Fragment>
						))}
					</span>
				</ViewActionsContext.Provider>
			</RowWriteContext.Provider>
		</div>
	);
	return process.env.NODE_ENV !== "production" ? timelineRendered(props, tree, rowWrites.clock) : tree;
}
