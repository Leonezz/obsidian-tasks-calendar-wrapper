import * as React from "react";
import type { YearGroup } from "@tasks-calendar-wrapper/core";
import { DateView } from "./dateview";

type YearViewProps = { readonly year: YearGroup };

/** A year of the timeline: its header, when core shows one, and its days, as core arranged them. */
export class YearView extends React.Component<YearViewProps> {
	render(): React.ReactNode {
		const { year } = this.props;
		return (
			<div>
				{year.showHeader && <YearHeader year={year} />}
				{/* Keyed by the day, so a day added above does not make React rebuild every day below it. */}
				{year.days.map((day) => (
					<DateView day={day} yearLabel={year.label} key={day.key} />
				))}
			</div>
		);
	}
}

class YearHeader extends React.Component<YearViewProps> {
	render(): React.ReactNode {
		const { year } = this.props;
		return (
			<div className={"year" + (year.isCurrent ? " current" : "")} data-types={year.statuses.join(" ")}>
				{year.label}
			</div>
		);
	}
}
