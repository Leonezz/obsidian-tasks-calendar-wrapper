import { moment } from "../../../utils/moment";
import * as React from "react";
import { UserOption } from "../../../src/useroptions";
import {
	counterClass,
	createQuery,
	quickEntryTargets,
	type CounterFilter,
	type QuickFilter,
	type Task,
} from "@tasks-calendar-wrapper/core";
import { TodayFocusEventHandlersContext, UserOptionContext } from "./context";
import { YearView } from "./yearview";

interface TimelineProps {
	readonly userOptions: UserOption;
	readonly tasks: readonly Task[];
	readonly quickFilter?: QuickFilter;
}
const defaultTimelineStates = {
	filter: "" as string,
	todayFocus: false as boolean,
};
type TimelineStates = typeof defaultTimelineStates;

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
	/** The options with the Filter behaviour, kept while the options are the same, see settingsFor. */
	private filtering?: { readonly options: UserOption; readonly settings: UserOption };

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
		const counter = counterFilterOf(this.state.filter, userOptions.counterBehavior);
		const { counts, years } = this.query(
			this.props.tasks,
			{ settings: this.settingsFor(userOptions, counter), counter, quickFilter: this.props.quickFilter },
			{ now: moment(), moment },
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
		return (
			<div
				className={`taskido ${baseStyles} ${counterFilter} ${todayFocus}`}
				id={`taskido${new Date().getTime()}`}
			>
				<TodayFocusEventHandlersContext.Provider value={{ handleTodayFocusClick: this.handleTodayFocus }}>
					<UserOptionContext.Provider
						value={{
							hideTags: this.props.userOptions.hideTags,
							tagPalette: this.props.userOptions.tagColorPalette,
							dateFormat: this.props.userOptions.dateFormat,
							taskFiles: quickEntryTargets(this.props.userOptions, moment()),
							select: this.props.userOptions.inbox,
							useBuiltinStyle: this.props.userOptions.useBuiltinStyle,
							counters: [
								{
									onClick: () => {
										this.handleCounterFilterClick("todoFilter");
									},
									cnt: counts.todo,
									label: "Todo",
									id: "todo",
									ariaLabel: "Todo Tasks",
								},
								{
									onClick: () => {
										this.handleCounterFilterClick("overdueFilter");
									},
									cnt: counts.overdue,
									id: "overdue",
									label: "Overdue",
									ariaLabel: "Overdue Tasks",
								},
								{
									onClick: () => {
										this.handleCounterFilterClick("unplannedFilter");
									},
									cnt: counts.unplanned,
									id: "unplanned",
									label: "Unplanned",
									ariaLabel: "Unplanned Tasks",
								},
							],
						}}
					>
						<span>
							{years.map((year, i) => (
								// Keyed by place, then by year, as before: a year added in front of the entry's year makes
								// React build the entry day, and with it the quick entry panel, again.
								<React.Fragment key={i}>
									<YearView year={year} key={year.year} />
								</React.Fragment>
							))}
						</span>
					</UserOptionContext.Provider>
				</TodayFocusEventHandlersContext.Provider>
			</div>
		);
	}
}
