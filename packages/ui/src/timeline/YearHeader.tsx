import type { YearGroup } from "@tasks-calendar-wrapper/core";

export function YearHeader({ year }: { readonly year: YearGroup }) {
	return (
		<div className={"year" + (year.isCurrent ? " current" : "")} data-types={year.statuses.join(" ")}>
			{year.label}
		</div>
	);
}
