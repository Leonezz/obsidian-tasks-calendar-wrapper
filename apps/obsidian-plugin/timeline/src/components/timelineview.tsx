import { moment } from "../../../utils/moment";
import * as React from "react";
import isEqual from "underscore/modules/isEqual.js";
import { UserOption } from "../../../src/useroptions";
import { createResolveEnv } from "../../../src/state/resolveenv";
import {
	counterClass,
	createQuery,
	dayKey,
	taskRowModel,
	quickEntryTargets,
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
import { TodayFocusEventHandlersContext, UserOptionContext } from "./context";
import { YearView } from "./yearview";
import type { EntryProps } from "./dateview";
import { recordProvider } from "./renderprobe";

interface TimelineProps {
	readonly userOptions: UserOption;
	readonly tasks: readonly Task[];
	readonly quickFilter?: QuickFilter;
	readonly queryEnv?: (now: DateValue) => { env: QueryEnv; prepared?: Resolved };
}
const defaultTimelineStates = {
	filter: "" as string,
	todayFocus: false as boolean,
};
type TimelineStates = typeof defaultTimelineStates;

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

export class TimelineView extends React.Component<TimelineProps, TimelineStates> {
	/** Remembers the last layout, so a click on a counter or on Focus on today resolves no task again. */
	private readonly query = createQuery();
	private readonly resolveEnv = createResolveEnv();
	/** The options with the Filter behaviour, kept while the options are the same, see settingsFor. */
	private filtering?: { readonly options: UserOption; readonly settings: UserOption };
	private readonly todayHandlers: React.ContextType<typeof TodayFocusEventHandlersContext>;
	private readonly counterHandlers: Readonly<Record<"todo" | "overdue" | "unplanned", () => void>>;
	private userOptionValue?: React.ContextType<typeof UserOptionContext>;
	private entry?: EntryProps;
	private rows?: {
		readonly options: RowOptions;
		readonly day: string;
		readonly locale: string;
		readonly clock: { now: DateValue };
		readonly modelFor: (task: ResolvedTask) => TaskRowModel;
	};

	private optionsFor(options: UserOption, now: DateValue): React.ContextType<typeof UserOptionContext> {
		const targets = quickEntryTargets(options, now);
		const taskFiles =
			this.userOptionValue && isEqual(this.userOptionValue.taskFiles, targets)
				? this.userOptionValue.taskFiles
				: targets;
		const value = {
			hideTags: options.hideTags,
			tagPalette: options.tagColorPalette,
			dateFormat: options.dateFormat,
			taskFiles,
			select: options.inbox,
			useBuiltinStyle: options.useBuiltinStyle,
		};
		if (!this.userOptionValue || !isEqual(this.userOptionValue, value)) this.userOptionValue = value;
		return this.userOptionValue;
	}

	private entryFor(counts: Counts, taskFiles: readonly string[]): EntryProps {
		const previous = this.entry;
		const counters =
			previous &&
			previous.counters[0].cnt === counts.todo &&
			previous.counters[1].cnt === counts.overdue &&
			previous.counters[2].cnt === counts.unplanned
				? previous.counters
				: [
						{
							onClick: this.counterHandlers.todo,
							cnt: counts.todo,
							label: "Todo",
							id: "todo",
							ariaLabel: "Todo Tasks",
						},
						{
							onClick: this.counterHandlers.overdue,
							cnt: counts.overdue,
							id: "overdue",
							label: "Overdue",
							ariaLabel: "Overdue Tasks",
						},
						{
							onClick: this.counterHandlers.unplanned,
							cnt: counts.unplanned,
							id: "unplanned",
							label: "Unplanned",
							ariaLabel: "Unplanned Tasks",
						},
					];
		if (!previous || previous.counters !== counters || previous.taskFiles !== taskFiles)
			this.entry = { counters, taskFiles };
		return this.entry!;
	}

	/** Rows share this render's clock; only a new day, locale or row option discards their models. */
	private modelsFor(options: RowOptions, now: DateValue): (task: ResolvedTask) => TaskRowModel {
		const day = dayKey(now);
		const locale = moment.locale();
		if (
			!this.rows ||
			this.rows.day !== day ||
			this.rows.locale !== locale ||
			!isEqual(this.rows.options, options)
		) {
			const models = new WeakMap<ResolvedTask, TaskRowModel>();
			const clock = { now };
			this.rows = {
				options,
				day,
				locale,
				clock,
				modelFor: (task) => {
					let model = models.get(task);
					if (!model) {
						model = taskRowModel(task, options, { now: clock.now, moment, warn });
						models.set(task, model);
					}
					return model;
				},
			};
		} else this.rows.clock.now = now;
		return this.rows.modelFor;
	}

	/**
	 * The settings query reads. A counter whose Filter class is on filters whatever the behaviour says, as the class
	 * did: a hand-edited "todoFilter " with Focus gives that class too.
	 */
	private settingsFor(options: UserOption, counter: CounterFilter): UserOption {
		if (counter === "" || options.counterBehavior === "Filter") return options;
		if (this.filtering?.options !== options)
			this.filtering = { options, settings: { ...options, counterBehavior: "Filter" } };
		return this.filtering.settings;
	}

	constructor(props: TimelineProps) {
		super(props);

		this.handleCounterFilterClick = this.handleCounterFilterClick.bind(this);
		this.handleTodayFocus = this.handleTodayFocus.bind(this);
		this.todayHandlers = { handleTodayFocusClick: this.handleTodayFocus };
		this.counterHandlers = {
			todo: this.handleCounterFilterClick.bind(this, "todoFilter"),
			overdue: this.handleCounterFilterClick.bind(this, "overdueFilter"),
			unplanned: this.handleCounterFilterClick.bind(this, "unplannedFilter"),
		};

		this.state = {
			filter: this.props.userOptions.defaultFilters,
			todayFocus: this.props.userOptions.defaultTodayFocus,
		};
	}

	handleCounterFilterClick(filterName: string) {
		if (this.state.filter !== filterName) {
			this.setState({
				filter: filterName,
			});
		} else {
			this.setState({
				filter: "",
			});
		}
	}

	handleTodayFocus() {
		this.setState({
			todayFocus: !this.state.todayFocus,
		});
	}

	render(): React.ReactNode {
		const { userOptions } = this.props;
		const now = moment();
		const { env, prepared } = this.props.queryEnv?.(now) ?? { ...this.resolveEnv(now), prepared: undefined };
		const counter = counterFilterOf(this.state.filter, userOptions.counterBehavior);
		const { counts, years } = this.query(
			this.props.tasks,
			{ settings: this.settingsFor(userOptions, counter), counter, quickFilter: this.props.quickFilter },
			env,
			prepared,
		);

		const styles = new Array<string>();
		if (!this.props.userOptions.useCounters) styles.push("noCounters");
		if (!this.props.userOptions.useQuickEntry) styles.push("noQuickEntry");
		if (!this.props.userOptions.useYearHeader) styles.push("noYear");
		if (
			!this.props.userOptions.useFileBadge &&
			!this.props.userOptions.usePriority &&
			!this.props.userOptions.useRecurrence &&
			!this.props.userOptions.useRelative &&
			!this.props.userOptions.useSection &&
			!this.props.userOptions.useTags
		)
			styles.push("noInfo");
		else {
			if (!this.props.userOptions.useFileBadge) styles.push("noFile");
			if (!this.props.userOptions.usePriority) styles.push("noPriority");
			if (!this.props.userOptions.useRecurrence) styles.push("noRepeat");
			if (!this.props.userOptions.useRelative) styles.push("noRelative");
			if (!this.props.userOptions.useSection) styles.push("noHeader");
			if (!this.props.userOptions.useTags) styles.push("noTag");
			if (!this.props.userOptions.useModifyBadge) styles.push("noModify");
		}

		const baseStyles = [...new Set(styles)].join(" ");
		const counterFilter = counterClass(this.state.filter, this.props.userOptions.counterBehavior);
		const todayFocus = this.state.todayFocus ? "todayFocus" : "";
		const userOptionValue = this.optionsFor(userOptions, now);
		const entry = this.entryFor(counts, userOptionValue.taskFiles);
		const { dateFormat, hideTags, tagPalette, useBuiltinStyle } = userOptionValue;
		const modelFor = this.modelsFor({ dateFormat, hideTags, tagPalette, useBuiltinStyle }, now);
		process.env.NODE_ENV !== "production" && recordProvider("TodayFocusEventHandlersContext", this.todayHandlers);
		process.env.NODE_ENV !== "production" && recordProvider("UserOptionContext", userOptionValue);
		return (
			<div className={`taskido ${baseStyles} ${counterFilter} ${todayFocus}`}>
				<TodayFocusEventHandlersContext.Provider value={this.todayHandlers}>
					<UserOptionContext.Provider value={userOptionValue}>
						<span>
							{years.map((year, i) => (
								// Keyed by place, then by year, as before: a year added in front of the entry's year makes
								// React build the entry day, and with it the quick entry panel, again.
								<React.Fragment key={i}>
									<YearView year={year} entry={entry} modelFor={modelFor} key={year.year} />
								</React.Fragment>
							))}
						</span>
					</UserOptionContext.Provider>
				</TodayFocusEventHandlersContext.Provider>
			</div>
		);
	}
}
