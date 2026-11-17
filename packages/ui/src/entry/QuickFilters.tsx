import * as React from "react";
import { copy, dayKey, dayKeyAfter, type QuickFilter } from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext, ViewActionsContext, useHost, type CounterId } from "../contexts";
import { TagFilter } from "./TagFilter";

type QuickFiltersProps = {
	readonly applied?: QuickFilter;
	readonly tags: readonly string[];
	readonly todayFocus?: boolean;
	readonly activeCounter?: CounterId;
	readonly todayKey?: string;
};

const priorityNames = ["Highest", "High", "Medium", "No", "Low", "Lowest"];
const normalized = (priorities: readonly string[]) => [
	...new Set(priorities.map((value) => (value === "" ? "No" : value))),
];
const storedPriorities = (priorities: readonly string[]) =>
	priorities.flatMap((value) => (value === "No" ? ["No", ""] : [value]));

export function QuickFilters({ applied, tags, todayFocus = false, activeCounter, todayKey }: QuickFiltersProps) {
	const host = useHost();
	const callback = React.useContext(QuickEntryHandlerContext);
	const actions = React.useContext(ViewActionsContext);
	const [custom, setCustom] = React.useState(false);
	const [range, setRange] = React.useState(() => ({ from: applied?.from ?? "", to: applied?.to ?? "" }));
	const [rangeError, setRangeError] = React.useState("");
	const appliedRange = `${applied?.from ?? ""}/${applied?.to ?? ""}`;
	const lastRange = React.useRef(appliedRange);
	const selectedWeek = React.useRef("");
	React.useEffect(() => {
		if (lastRange.current === appliedRange) return;
		lastRange.current = appliedRange;
		setRange({ from: applied?.from ?? "", to: applied?.to ?? "" });
		setRangeError("");
	}, [appliedRange, applied?.from, applied?.to]);
	const priorities = normalized(applied?.priorities ?? []);
	const hasRange = Boolean(applied?.from || applied?.to);
	const isWeek = React.useMemo(() => {
		if (!applied?.from || !applied?.to) return false;
		if (!todayKey) return appliedRange === selectedWeek.current;
		return applied.from === todayKey && applied.to === dayKeyAfter(host.moment(todayKey), 6, "days");
	}, [host, todayKey, appliedRange, applied?.from, applied?.to]);
	const scope = todayFocus ? "today" : custom ? "custom" : hasRange ? (isWeek ? "week" : "custom") : "all";
	const hasFilters =
		todayFocus || hasRange || priorities.length > 0 || Boolean(applied?.tags?.length) || Boolean(activeCounter);

	function applyDates(from?: string, to?: string): void {
		callback.handleFilterEnable(from, to, [...(applied?.priorities ?? [])], [...(applied?.tags ?? [])]);
	}

	function chooseScope(value: string): void {
		setRangeError("");
		if (value === "custom") {
			setCustom(true);
			if (todayFocus) actions.toggleTodayFocus();
			return;
		}
		setCustom(false);
		if (todayFocus !== (value === "today")) actions.toggleTodayFocus();
		if (value === "week") {
			const now = host.now();
			const from = dayKey(now);
			const to = dayKeyAfter(now, 6, "days");
			selectedWeek.current = `${from}/${to}`;
			applyDates(from, to);
		} else applyDates();
	}

	function applyRange(): void {
		if (!range.from || !range.to) {
			setRangeError(copy.quickEntry.rangeIncomplete);
			return;
		}
		if (range.from > range.to) {
			setRangeError(copy.quickEntry.rangeReversed);
			return;
		}
		setRangeError("");
		if (todayFocus) actions.toggleTodayFocus();
		applyDates(range.from, range.to);
	}
	function editRange(field: "from" | "to", value: string): void {
		setRange((current) => (current[field] === value ? current : { ...current, [field]: value }));
		setRangeError("");
	}

	return (
		<div className="quickFilterBar">
			<select
				className="dateScope"
				aria-label={copy.quickEntry.dateScopeAria}
				value={scope}
				onChange={(event) => chooseScope(event.target.value)}
			>
				<option value="all">{copy.quickEntry.allDates}</option>
				<option value="today">{copy.timeline.focusOnToday}</option>
				<option value="week">{copy.quickEntry.nextWeek}</option>
				<option value="custom">{copy.quickEntry.customRange}</option>
			</select>
			<TagFilter applied={applied} tags={tags} />
			<details
				className="priorityFilter"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.currentTarget.open = false;
						event.currentTarget.querySelector("summary")?.focus();
					}
				}}
			>
				<summary aria-label={copy.quickEntry.priorityAria}>
					{priorities.length
						? priorities.map((priority) => (priority === "No" ? copy.quickEntry.none : priority)).join(", ")
						: copy.quickEntry.priority}
				</summary>
				<div className="priorityOptions">
					{priorityNames.map((priority) => (
						<label key={priority}>
							<input
								type="checkbox"
								value={priority}
								checked={priorities.includes(priority)}
								onChange={() => {
									const selected = priorities.includes(priority)
										? priorities.filter((value) => value !== priority)
										: [...priorities, priority];
									callback.handleFilterEnable(
										applied?.from,
										applied?.to,
										storedPriorities(selected),
										[...(applied?.tags ?? [])],
									);
								}}
							/>
							{priority === "No" ? copy.quickEntry.none : priority}
						</label>
					))}
				</div>
			</details>
			{hasFilters && (
				<button
					className="clearFilters"
					type="button"
					aria-label={copy.quickEntry.clearFiltersAria}
					onClick={() => {
						setCustom(false);
						setRange({ from: "", to: "" });
						setRangeError("");
						if (todayFocus) actions.toggleTodayFocus();
						if (activeCounter) actions.toggleCounter(activeCounter);
						callback.handleFilterEnable(undefined, undefined, [], []);
					}}
				>
					{copy.quickEntry.clearFilters}
				</button>
			)}
			{scope === "custom" && (
				<div className="dateRange">
					<label>
						{copy.quickEntry.from}
						<input
							type="date"
							aria-label={copy.quickEntry.fromAria}
							value={range.from}
							onInput={(event) => editRange("from", event.currentTarget.value)}
							onChange={(event) => editRange("from", event.currentTarget.value)}
						/>
					</label>
					<label>
						{copy.quickEntry.to}
						<input
							type="date"
							aria-label={copy.quickEntry.toAria}
							value={range.to}
							onInput={(event) => editRange("to", event.currentTarget.value)}
							onChange={(event) => editRange("to", event.currentTarget.value)}
						/>
					</label>
					<button className="applyDateRange" type="button" onClick={applyRange}>
						{copy.quickEntry.applyDates}
					</button>
				</div>
			)}
			{rangeError && (
				<div className="filterError" role="alert">
					{rangeError}
				</div>
			)}
		</div>
	);
}
