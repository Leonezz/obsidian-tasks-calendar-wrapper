import * as React from "react";
import { copy, createStore, dayKey, dayKeyAfter, type QuickFilter, type Store } from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext, ViewActionsContext, useHost, type CounterId } from "../contexts";
import { checkIcon, chevronDownIcon } from "../icons";
import { useStore } from "../hooks/useStore";
import { TagFilter, type createTagFilterDraft } from "./TagFilter";

type QuickFiltersProps = {
	readonly applied?: QuickFilter;
	readonly tags: readonly string[];
	readonly todayFocus?: boolean;
	readonly activeCounter?: CounterId;
	readonly todayKey?: string;
	readonly priorityMenu?: Store<boolean>;
	readonly tagDraft?: ReturnType<typeof createTagFilterDraft>;
};

const priorityNames = ["Highest", "High", "Medium", "No", "Low", "Lowest"];
const normalized = (priorities: readonly string[]) => [
	...new Set(priorities.map((value) => (value === "" ? "No" : value))),
];
const storedPriorities = (priorities: readonly string[]) =>
	priorities.flatMap((value) => (value === "No" ? ["No", ""] : [value]));
const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

function milliseconds(value: string): number {
	const duration = Number.parseFloat(value);
	return Number.isFinite(duration) && duration > 0 ? duration * (value.trim().endsWith("ms") ? 1 : 1000) : 0;
}

export function QuickFilters({
	applied,
	tags,
	todayFocus = false,
	activeCounter,
	todayKey,
	priorityMenu: suppliedMenu,
	tagDraft,
}: QuickFiltersProps) {
	const host = useHost();
	const callback = React.useContext(QuickEntryHandlerContext);
	const actions = React.useContext(ViewActionsContext);
	const fallbackMenu = React.useRef<Store<boolean>>();
	if (!fallbackMenu.current) fallbackMenu.current = createStore(false);
	const priorityMenu = suppliedMenu ?? fallbackMenu.current;
	const priorityOpen = useStore(priorityMenu);
	const menuElement = React.useRef<HTMLDetailsElement>(null);
	const menuTrigger = React.useRef<HTMLElement>(null);
	const menuOptions = React.useRef<HTMLDivElement>(null);
	// A closing surface stays painted briefly, while its controls stop accepting focus immediately.
	const [menuPhase, setMenuPhase] = React.useState<"closed" | "open" | "closing">(priorityOpen ? "open" : "closed");
	const lastPhase = React.useRef(menuPhase);
	const menuPresent = priorityOpen || menuPhase !== "closed";
	useClientLayoutEffect(() => {
		const options = menuOptions.current;
		const view = options?.ownerDocument.defaultView;
		if (!options || !view) return;
		if (priorityOpen) {
			// Commit the resting scale after native details becomes visible, before starting its entrance.
			if (lastPhase.current === "closed") void options.offsetWidth;
			lastPhase.current = "open";
			setMenuPhase("open");
			return;
		}
		if (lastPhase.current === "closed") return;
		const reduced = view.matchMedia?.("(prefers-reduced-motion: reduce)");
		const closeMs = reduced?.matches
			? 0
			: milliseconds(view.getComputedStyle(options).getPropertyValue("--tcw-dropdown-close-dur"));
		const finish = () => {
			lastPhase.current = "closed";
			setMenuPhase("closed");
		};
		if (!closeMs) {
			finish();
			return;
		}
		lastPhase.current = "closing";
		setMenuPhase("closing");
		const timer = view.setTimeout(finish, closeMs);
		const reduce = () => {
			if (!reduced?.matches) return;
			view.clearTimeout(timer);
			finish();
		};
		reduced?.addEventListener?.("change", reduce);
		return () => {
			view.clearTimeout(timer);
			reduced?.removeEventListener?.("change", reduce);
		};
	}, [priorityOpen]);
	const [menuPlacement, setMenuPlacement] = React.useState<{ side: "above" | "below"; maxHeight: number } | null>(
		null,
	);
	useClientLayoutEffect(() => {
		if (!menuPresent) {
			setMenuPlacement(null);
			return;
		}
		if (!priorityOpen) return;
		const trigger = menuTrigger.current;
		const options = menuOptions.current;
		const view = trigger?.ownerDocument.defaultView;
		if (!trigger || !options || !view) return;
		const document = trigger.ownerDocument;
		const clipping: HTMLElement[] = [];
		for (let ancestor = trigger.parentElement; ancestor; ancestor = ancestor.parentElement) {
			const style = view.getComputedStyle(ancestor);
			if (/(?:auto|scroll|hidden|clip|overlay)/u.test(style.overflowY || style.overflow)) clipping.push(ancestor);
		}
		const measure = () => {
			if (!priorityMenu.getSnapshot() || !trigger.isConnected || !options.isConnected) return;
			const viewport = view.visualViewport;
			let top = viewport?.offsetTop ?? 0;
			let bottom = top + (viewport?.height ?? view.innerHeight);
			for (const ancestor of clipping) {
				const rect = ancestor.getBoundingClientRect();
				top = Math.max(top, rect.top + ancestor.clientTop);
				bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
			}
			const rect = trigger.getBoundingClientRect();
			const style = view.getComputedStyle(options);
			const anchor = menuElement.current?.getBoundingClientRect();
			const offset = Number.parseFloat(options.dataset.placement === "above" ? style.bottom : style.top);
			const gap = Number.isFinite(offset) && anchor ? Math.max(0, offset - anchor.height) : 0;
			const border =
				(Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
			const height = Math.max(options.scrollHeight + border, options.getBoundingClientRect().height);
			const below = Math.max(0, bottom - rect.bottom - gap);
			const above = Math.max(0, rect.top - top - gap);
			const side = height > below && above > below ? "above" : "below";
			const maxHeight = Math.floor(side === "above" ? above : below);
			setMenuPlacement((current) =>
				current?.side === side && current.maxHeight === maxHeight ? current : { side, maxHeight },
			);
		};
		measure();
		view.addEventListener("resize", measure);
		document.addEventListener("scroll", measure, true);
		view.visualViewport?.addEventListener("resize", measure);
		view.visualViewport?.addEventListener("scroll", measure);
		const observer = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(measure) : undefined;
		for (const element of [trigger, options, ...clipping]) observer?.observe(element);
		return () => {
			view.removeEventListener("resize", measure);
			document.removeEventListener("scroll", measure, true);
			view.visualViewport?.removeEventListener("resize", measure);
			view.visualViewport?.removeEventListener("scroll", measure);
			observer?.disconnect();
		};
	}, [priorityMenu, priorityOpen, menuPresent]);
	useClientLayoutEffect(() => {
		const trigger = menuTrigger.current;
		if (!trigger || !priorityMenu.getSnapshot()) return;
		if (trigger.ownerDocument.activeElement === trigger.ownerDocument.body) trigger.focus();
	}, [priorityMenu]);
	React.useEffect(() => {
		if (!priorityOpen || !menuElement.current) return;
		const document = menuElement.current.ownerDocument;
		const outside = (event: PointerEvent) => {
			if (!menuElement.current?.contains(event.target as Node)) priorityMenu.setState(false);
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [priorityMenu, priorityOpen]);
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
	const priorityLabels = priorities.map((priority) => (priority === "No" ? copy.quickEntry.none : priority));
	const prioritySummary =
		priorities.length > 1
			? copy.quickEntry.selectedPriorities({ count: priorities.length })
			: (priorityLabels[0] ?? copy.quickEntry.priority);
	const hasRange = Boolean(applied?.from || applied?.to);
	const isWeek = React.useMemo(() => {
		if (!applied?.from || !applied?.to) return false;
		if (!todayKey) return appliedRange === selectedWeek.current;
		return applied.from === todayKey && applied.to === dayKeyAfter(host.moment(todayKey), 6, "days");
	}, [host, todayKey, appliedRange, applied?.from, applied?.to]);
	const scope = custom ? "custom" : hasRange ? (isWeek ? "week" : "custom") : "all";
	const hasFilters =
		todayFocus || hasRange || priorities.length > 0 || Boolean(applied?.tags?.length) || Boolean(activeCounter);

	function applyDates(from?: string, to?: string): void {
		callback.handleFilterEnable(from, to, [...(applied?.priorities ?? [])], [...(applied?.tags ?? [])]);
	}

	function chooseScope(value: string): void {
		setRangeError("");
		if (value === "custom") {
			setCustom(true);
			return;
		}
		setCustom(false);
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
				<option value="week">{copy.quickEntry.nextWeek}</option>
				<option value="custom">{copy.quickEntry.customRange}</option>
			</select>
			<TagFilter applied={applied} tags={tags} draft={tagDraft} />
			<details
				className="priorityFilter t-acc"
				ref={menuElement}
				open={menuPresent}
				data-open={priorityOpen}
				onBlur={(event) => {
					if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
						priorityMenu.setState(false);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						priorityMenu.setState(false);
						menuTrigger.current?.focus();
					}
				}}
			>
				<summary
					ref={menuTrigger}
					aria-label={copy.quickEntry.priorityAria}
					aria-description={priorityLabels.length ? priorityLabels.join(", ") : undefined}
					aria-expanded={priorityOpen}
					data-active={priorities.length > 0}
					onClick={(event) => {
						event.preventDefault();
						priorityMenu.setState((open) => !open);
					}}
				>
					<span className="prioritySummary">{prioritySummary}</span>
					<span className="priorityChevron t-acc-chevron" aria-hidden="true">
						{chevronDownIcon}
					</span>
				</summary>
				<div
					className={`priorityOptions t-dropdown${priorityOpen && menuPhase !== "closed" ? " is-open" : !priorityOpen && menuPhase !== "closed" ? " is-closing" : ""}`}
					role="group"
					aria-label={copy.quickEntry.priorityAria}
					aria-hidden={!priorityOpen}
					{...(!priorityOpen ? { inert: "" } : {})}
					ref={menuOptions}
					data-placement={menuPlacement?.side}
					data-origin={menuPlacement?.side === "above" ? "bottom-right" : "top-right"}
					style={
						menuPlacement
							? ({
									"--tcw-priority-menu-max-height": `${menuPlacement.maxHeight}px`,
								} as React.CSSProperties)
							: undefined
					}
				>
					{priorityNames.map((priority) => (
						<label className="priorityOption" data-selected={priorities.includes(priority)} key={priority}>
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
							<span className="priorityOptionLabel">
								{priority === "No" ? copy.quickEntry.none : priority}
							</span>
							<span className="priorityCheck" aria-hidden="true">
								{checkIcon}
							</span>
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
						priorityMenu.setState(false);
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
