import type { ResolvedTask, TaskRowModel, YearGroup } from "@tasks-calendar-wrapper/core";
import { YearHeader } from "./YearHeader";
import { Day, type EntryProps } from "./Day";
import { WindowGap, type WindowRender } from "./Windowed";

type YearProps = {
	readonly year: YearGroup;
	readonly entry: EntryProps;
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
	readonly window?: WindowRender;
	readonly yearIndex?: number;
};

/** A year of the timeline: its header, when core shows one, and its days, as core arranged them. */
export function Year({ year, entry, modelFor, window, yearIndex = 0 }: YearProps) {
	const plan = window?.year(yearIndex);
	return (
		<div ref={plan?.ref}>
			{year.showHeader &&
				(!plan || plan.showHeader ? <YearHeader year={year} /> : <WindowGap height={plan.height} />)}
			{/* Keyed by the day, so a day added above does not make React rebuild every day below it. */}
			{year.days.map((day) => (
				<Day
					day={day}
					yearLabel={year.label}
					entry={day.isEntry ? entry : undefined}
					modelFor={modelFor}
					window={window?.day(day.key)}
					key={day.key}
				/>
			))}
		</div>
	);
}
