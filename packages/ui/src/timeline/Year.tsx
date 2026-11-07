import type { ResolvedTask, TaskRowModel, YearGroup } from "@tasks-calendar-wrapper/core";
import { YearHeader } from "./YearHeader";
import { Day, type EntryProps } from "./Day";

type YearProps = {
	readonly year: YearGroup;
	readonly entry: EntryProps;
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

/** A year of the timeline: its header, when core shows one, and its days, as core arranged them. */
export function Year({ year, entry, modelFor }: YearProps) {
	return (
		<div>
			{year.showHeader && <YearHeader year={year} />}
			{/* Keyed by the day, so a day added above does not make React rebuild every day below it. */}
			{year.days.map((day) => (
				<Day
					day={day}
					yearLabel={year.label}
					entry={day.isEntry ? entry : undefined}
					modelFor={modelFor}
					key={day.key}
				/>
			))}
		</div>
	);
}
