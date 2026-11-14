import * as React from "react";
import {
	createWindowGeometry,
	flattenWindowSegments,
	windowingEnabled,
	type QueryResult,
	type WindowAnchor,
	type WindowGeometry,
} from "@tasks-calendar-wrapper/core";
import type { TimelineHandle, TimelineWindowHost, UiHost } from "../host";

const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

export type WindowRowPart =
	| { readonly kind: "row"; readonly index: number }
	| { readonly kind: "gap"; readonly start: number; readonly end: number; readonly height: number };

export interface WindowDayPlan {
	readonly showHeader: boolean;
	readonly headerHeight: number;
	readonly parts: readonly WindowRowPart[];
	readonly ref: React.RefCallback<HTMLDivElement>;
}

interface DaySegments {
	readonly header: number;
	readonly rowStart: number;
	readonly count: number;
}

interface ViewportAnchor {
	readonly segment: WindowAnchor | undefined;
	/** Core offsets start at zero; the viewport can still be above the timeline's leading margin. */
	readonly leadingInset: number;
}

interface WindowSnapshot {
	readonly active: boolean;
	readonly result: QueryResult;
	readonly geometry: WindowGeometry;
	readonly showYears: boolean;
	readonly plans: ReadonlyMap<string, WindowDayPlan>;
	readonly mounted: ReadonlySet<number>;
	readonly signature: string;
	readonly anchor?: ViewportAnchor;
}

export interface WindowRender {
	readonly active: boolean;
	readonly controller: TimelineWindow;
	day(key: string): WindowDayPlan | undefined;
	year(
		index: number,
	):
		| { readonly showHeader: boolean; readonly height: number; readonly ref: React.RefCallback<HTMLDivElement> }
		| undefined;
	commit(root: HTMLElement | null): void;
}

/** Gaps deliberately match no task, date, year, or screenshot probe selector. */
export function WindowGap({ height }: { readonly height: number }) {
	return (
		<div
			className="tcw-gap"
			aria-hidden="true"
			style={{ "--tcw-gap-height": `${height}px` } as React.CSSProperties}
		/>
	);
}

const rounded = (value: number) => Math.round(value * 1_000) / 1_000;
const sameParts = (a: readonly WindowRowPart[], b: readonly WindowRowPart[]) =>
	a.length === b.length &&
	a.every((part, index) => {
		const next = b[index];
		return part.kind === "row"
			? next.kind === "row" && next.index === part.index
			: next.kind === "gap" && next.start === part.start && next.end === part.end && next.height === part.height;
	});

/** Per-view viewport state. The React year/day ancestors remain in place in both rendering modes. */
export class TimelineWindow implements TimelineHandle {
	active = false;
	private geometry: WindowGeometry = createWindowGeometry([]);
	private result?: QueryResult;
	private geometryResult?: QueryResult;
	private showYears = true;
	private host?: TimelineWindowHost;
	private mobile = false;
	private root?: HTMLElement;
	private scroll?: HTMLElement;
	private rows: ReadonlyMap<string, HTMLElement> = new Map();
	private focusId?: string;
	private pendingReveal?: string;
	private readonly dayIndexes = new WeakMap<WindowGeometry, ReadonlyMap<string, DaySegments>>();
	private plans: ReadonlyMap<string, WindowDayPlan> = new Map();
	private readonly measurements = new Map<string, number>();
	private readonly dayElements = new Map<string, HTMLDivElement>();
	private readonly yearElements = new Map<number, HTMLDivElement>();
	private readonly dayRefs = new Map<string, React.RefCallback<HTMLDivElement>>();
	private readonly yearRefs = new Map<number, React.RefCallback<HTMLDivElement>>();
	private signature = "";
	private readonly changed: () => void;
	private stop?: () => void;
	private boundElement?: HTMLElement;
	private boundWindow?: Window;
	private observer?: ResizeObserver;
	private observed = new Set<Element>();
	private frame?: number;
	private frameWindow?: Window;
	private settleTimer?: number;
	private touching = false;
	private touchScrolling = false;
	private pendingAdjustment = 0;
	private pendingAnchor?: ViewportAnchor;
	private width = 0;
	private disposed = false;
	private revealSequence = 0;
	private readonly revealFrames = new Map<number, { readonly view: Window; readonly resolve: () => void }>();

	constructor(changed: () => void) {
		this.changed = changed;
	}

	prepare(
		result: QueryResult,
		host: UiHost,
		rows: ReadonlyMap<string, HTMLElement>,
		focusId?: string,
		showYears = true,
	): WindowRender {
		this.host = host.windowing;
		this.mobile = host.isMobile;
		this.rows = rows;
		this.focusId = focusId;
		this.scroll = this.host?.getScrollElement();
		const count = result.years.reduce(
			(total, year) => total + year.days.reduce((sum, day) => sum + day.tasks.length, 0),
			0,
		);
		const active = !!this.scroll && windowingEnabled(count, this.active, this.host?.getMinRows());
		let geometry = this.geometry;
		let anchor: ViewportAnchor | undefined;
		if (active && (this.geometryResult !== result || this.showYears !== showYears)) {
			anchor = this.active ? this.captureAnchor() : undefined;
			geometry = createWindowGeometry(
				flattenWindowSegments(result).filter((segment) => showYears || segment.kind !== "year"),
			);
			geometry.measureBatch(this.measurements);
			if (anchor?.segment && geometry.indexOf(anchor.segment.key) < 0) {
				const segment = anchor.segment;
				const order = this.geometry.segments;
				const neighbour =
					order.slice(segment.index + 1).find((segment) => geometry.indexOf(segment.key) >= 0) ??
					[...order.slice(0, segment.index)].reverse().find((segment) => geometry.indexOf(segment.key) >= 0);
				if (neighbour) anchor = { ...anchor, segment: { ...segment, key: neighbour.key } };
			}
		}
		const snapshot = this.snapshot(geometry, result, active, showYears, anchor);
		return {
			active,
			controller: this,
			day: (key) => (active ? snapshot.plans.get(key) : undefined),
			year: (index) => this.yearPlan(snapshot, index),
			commit: (root) => this.commit(snapshot, root),
		};
	}

	private top() {
		if (!this.scroll) return 0;
		if (!this.root) return Math.max(0, this.scroll.scrollTop);
		let origin = this.root.getBoundingClientRect().top;
		const first = this.geometry.segments[0];
		const view = this.window();
		if (view && first?.kind === "year") {
			const header = this.yearElements.get(first.yearIndex)?.querySelector<HTMLElement>(":scope > .year");
			if (header) origin = this.bounds(header, view)?.top ?? origin;
		} else if (view && first?.kind === "entry") {
			const entry = this.dayElements.get(first.dayKey);
			if (entry) {
				const tops = this.entryChildren(entry, view).flatMap((child) => {
					const box = this.bounds(child, view);
					return box ? [box.top] : [];
				});
				if (tops.length) origin = Math.min(...tops);
			}
		}
		return this.scroll.getBoundingClientRect().top + this.scroll.clientTop - origin;
	}

	private captureAnchor(): ViewportAnchor {
		const top = this.top();
		return { segment: this.geometry.captureAnchor(top), leadingInset: Math.min(top, 0) };
	}

	private bounds(element: HTMLElement, view: Window) {
		const style = view.getComputedStyle(element);
		if (style.display === "none") return undefined;
		const rect = element.getBoundingClientRect();
		const top = rect.top - (parseFloat(style.marginTop) || 0);
		const bottom = rect.bottom + (parseFloat(style.marginBottom) || 0);
		return bottom > top ? { top, bottom } : undefined;
	}

	private entryChildren(element: HTMLElement, view: NonNullable<Document["defaultView"]>) {
		return [...element.children].filter(
			(child): child is HTMLElement => child instanceof view.HTMLElement && !child.classList.contains("details"),
		);
	}

	private snapshot(
		geometry: WindowGeometry,
		result: QueryResult,
		active: boolean,
		showYears: boolean,
		anchor?: ViewportAnchor,
	): WindowSnapshot {
		if (!active || !this.scroll)
			return { active, result, geometry, showYears, plans: new Map(), mounted: new Set(), signature: "" };
		const windowHeight = this.scroll.ownerDocument.defaultView?.innerHeight ?? 0;
		const maximumHeight = windowHeight > 0 ? windowHeight : 600;
		// A new popout can grow with its contents until its layout styles arrive.
		const height = Math.min(this.scroll.clientHeight || maximumHeight, maximumHeight);
		const residents = [
			...(this.focusId === undefined ? [] : [`t:${this.focusId}`]),
			...(this.pendingReveal === undefined ? [] : [this.pendingReveal]),
		];
		const range = geometry.rangeFor(this.top(), height, height * (this.mobile ? 2 : 1), residents);
		const signature =
			range.indices.join(",") +
			":" +
			range.gaps.map((gap) => `${gap.start}/${gap.end}/${rounded(gap.height)}`).join(",");
		const mounted = new Set(range.indices);
		let days = this.dayIndexes.get(geometry);
		if (!days) {
			const next = new Map<string, DaySegments>();
			geometry.segments.forEach((segment, index) => {
				if (segment.kind === "entry") next.set(segment.dayKey, { header: -1, rowStart: index + 1, count: 0 });
				if (segment.kind === "day")
					next.set(segment.dayKey, { header: index, rowStart: index + 1, count: segment.day.tasks.length });
			});
			days = next;
			this.dayIndexes.set(geometry, days);
		}
		const plans = new Map<string, WindowDayPlan>();
		const visibleRows = new Map<string, number[]>();
		for (const index of range.indices) {
			const segment = geometry.segments[index];
			if (segment.kind !== "row") continue;
			const items = visibleRows.get(segment.dayKey) ?? [];
			items.push(segment.rowIndex);
			visibleRows.set(segment.dayKey, items);
		}
		for (const [key, day] of days) {
			const indices = visibleRows.get(key) ?? [];
			const parts: WindowRowPart[] = [];
			let from = 0;
			for (const index of indices) {
				if (index > from)
					parts.push({
						kind: "gap",
						start: from,
						end: index,
						height: geometry.offsetAt(day.rowStart + index) - geometry.offsetAt(day.rowStart + from),
					});
				parts.push({ kind: "row", index });
				from = index + 1;
			}
			if (from < day.count)
				parts.push({
					kind: "gap",
					start: from,
					end: day.count,
					height: geometry.offsetAt(day.rowStart + day.count) - geometry.offsetAt(day.rowStart + from),
				});
			const showHeader = mounted.has(day.header);
			const headerHeight = day.header < 0 ? 0 : geometry.heightAt(day.header);
			const previous = this.plans.get(key);
			if (
				previous?.showHeader === showHeader &&
				previous.headerHeight === headerHeight &&
				sameParts(previous.parts, parts)
			) {
				plans.set(key, previous);
				continue;
			}
			let ref = this.dayRefs.get(key);
			if (!ref) {
				ref = (element) => {
					if (element) this.dayElements.set(key, element);
					else this.dayElements.delete(key);
				};
				this.dayRefs.set(key, ref);
			}
			plans.set(key, { showHeader, headerHeight, parts, ref });
		}
		return { active, result, geometry, showYears, plans, mounted, signature, anchor };
	}

	private yearPlan(snapshot: WindowSnapshot, index: number) {
		if (!snapshot.active) return undefined;
		let ref = this.yearRefs.get(index);
		if (!ref) {
			ref = (element) => {
				if (element) this.yearElements.set(index, element);
				else this.yearElements.delete(index);
			};
			this.yearRefs.set(index, ref);
		}
		const segment = snapshot.geometry.indexOf(`y:${snapshot.result.years[index].year}`);
		return {
			showHeader: snapshot.mounted.has(segment),
			height: segment < 0 ? 0 : snapshot.geometry.heightAt(segment),
			ref,
		};
	}

	private rangeChanged() {
		return (
			!!this.result &&
			this.snapshot(this.geometry, this.result, this.active, this.showYears).signature !== this.signature
		);
	}

	setFocus(id: string | undefined) {
		if (this.focusId === id) return;
		this.focusId = id;
		this.schedule();
	}

	private window() {
		return this.scroll?.ownerDocument.defaultView;
	}

	private request(callback: FrameRequestCallback): number | undefined {
		const view = this.window();
		if (!view) return undefined;
		return view.requestAnimationFrame(callback);
	}

	private schedule() {
		if (!this.active || this.disposed) return;
		if (this.scroll && (this.boundElement !== this.scroll || this.boundWindow !== this.window()))
			this.bind(this.scroll);
		if (this.frame !== undefined) return;
		this.frameWindow = this.window() ?? undefined;
		this.frame = this.request(() => {
			this.frame = undefined;
			if (this.disposed) return;
			this.measure();
			if (this.rangeChanged()) this.changed();
		});
	}

	private adjust(delta: number) {
		if (!this.scroll || Math.abs(delta) < 0.5) return;
		if (this.touching || this.touchScrolling) this.pendingAdjustment += delta;
		else this.scroll.scrollTop += delta;
	}

	private measure() {
		if (!this.active || !this.scroll || !this.root) return;
		const view = this.window();
		if (!view) return;
		const pending = this.pendingAnchor !== undefined;
		const anchor = this.pendingAnchor ?? this.captureAnchor();
		this.pendingAnchor = undefined;
		const width = this.scroll.clientWidth;
		if (width !== this.width && this.width !== 0) {
			this.geometry.invalidateMeasurements();
			this.measurements.clear();
		}
		this.width = width;
		const boxes: { readonly key: string; readonly index: number; readonly top: number; readonly bottom: number }[] =
			[];
		const elements = new Set<Element>([this.scroll]);
		const add = (key: string, element: HTMLElement | null) => {
			const index = this.geometry.indexOf(key);
			if (!element || index < 0) return;
			elements.add(element);
			const box = this.bounds(element, view);
			if (box) boxes.push({ key, index, ...box });
		};
		for (const [index, element] of this.yearElements) {
			const year = this.result?.years[index];
			if (year) add(`y:${year.year}`, element.querySelector<HTMLElement>(":scope > .year"));
		}
		for (const [key, element] of this.dayElements) {
			add(`d:${key}`, element.querySelector<HTMLElement>(":scope > .details > .dateLine"));
			if (key === this.result?.entryDay) {
				const children = this.entryChildren(element, view);
				const visible = children.flatMap((child) => {
					const box = this.bounds(child, view);
					return box ? [box] : [];
				});
				if (visible.length) {
					for (const child of children) elements.add(child);
					// Adjacent block margins collapse. Their actual first/last positions, not a sum of outerHeights,
					// define the prefix; the following segment refines its shared flow boundary below.
					boxes.push({
						key: "entry",
						index: this.geometry.indexOf("entry"),
						top: Math.min(...visible.map((box) => box.top)),
						bottom: Math.max(...visible.map((box) => box.bottom)),
					});
				}
			}
		}
		for (const [id, element] of this.rows) add(`t:${id}`, element);
		boxes.sort((a, b) => a.index - b.index);
		const measurements: [string, number][] = boxes.map((box, index) => {
			const next = boxes[index + 1];
			const height =
				next?.index === box.index + 1 && next.top > box.top ? next.top - box.top : box.bottom - box.top;
			return [box.key, rounded(height)];
		});
		if (this.observer) {
			for (const element of this.observed) if (!elements.has(element)) this.observer.unobserve(element);
			for (const element of elements) if (!this.observed.has(element)) this.observer.observe(element);
			this.observed = elements;
		}
		const changed = this.geometry.measureBatch(measurements);
		for (const [key, value] of measurements)
			if (value > 0 && Number.isFinite(value)) this.measurements.set(key, value);
		if (changed || pending)
			this.adjust(this.geometry.restoreAnchor(anchor.segment) + anchor.leadingInset - this.top());
	}

	private commit(snapshot: WindowSnapshot, root: HTMLElement | null) {
		this.active = snapshot.active;
		this.result = snapshot.result;
		if (snapshot.active) {
			this.geometry = snapshot.geometry;
			this.geometryResult = snapshot.result;
			this.showYears = snapshot.showYears;
			for (const key of this.measurements.keys())
				if (this.geometry.indexOf(key) < 0) this.measurements.delete(key);
		}
		this.plans = snapshot.plans;
		this.signature = snapshot.signature;
		this.pendingAnchor = snapshot.anchor;
		this.root = root ?? undefined;
		for (const [id, element] of this.rows) {
			const segment = snapshot.active ? this.geometry.segments[this.geometry.indexOf(`t:${id}`)] : undefined;
			if (segment?.kind === "row") {
				element.setAttribute("aria-posinset", String(segment.rowIndex + 1));
				element.setAttribute("aria-setsize", String(segment.day.tasks.length));
			} else {
				element.removeAttribute("aria-posinset");
				element.removeAttribute("aria-setsize");
			}
		}
		if (!this.active || !this.scroll) {
			this.unbind();
			return;
		}
		if (this.boundElement !== this.scroll || this.boundWindow !== this.window()) this.bind(this.scroll);
		this.measure();
		if (this.rangeChanged()) this.changed();
	}

	private bind(element: HTMLElement) {
		this.unbind();
		this.boundElement = element;
		const view = element.ownerDocument.defaultView;
		if (!view) return;
		this.boundWindow = view;
		const onScroll = () => {
			this.schedule();
			if (this.touchScrolling) settle();
		};
		const settle = () => {
			if (this.settleTimer !== undefined) view.clearTimeout(this.settleTimer);
			this.settleTimer = view.setTimeout(() => {
				this.settleTimer = undefined;
				if (this.touching) return;
				this.touchScrolling = false;
				const delta = this.pendingAdjustment;
				this.pendingAdjustment = 0;
				this.adjust(delta);
				this.schedule();
			}, 120);
		};
		const beginTouch = () => {
			this.touching = true;
			this.touchScrolling = true;
		};
		const endTouch = () => {
			this.touching = false;
			settle();
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		element.addEventListener("touchstart", beginTouch, { passive: true });
		element.addEventListener("touchend", endTouch, { passive: true });
		element.addEventListener("touchcancel", endTouch, { passive: true });
		const Observer = view.ResizeObserver;
		if (Observer) this.observer = new Observer(() => this.schedule());
		this.stop = () => {
			element.removeEventListener("scroll", onScroll);
			element.removeEventListener("touchstart", beginTouch);
			element.removeEventListener("touchend", endTouch);
			element.removeEventListener("touchcancel", endTouch);
			if (this.settleTimer !== undefined) view.clearTimeout(this.settleTimer);
			this.settleTimer = undefined;
			this.observer?.disconnect();
			this.observer = undefined;
			this.observed.clear();
		};
	}

	private unbind() {
		this.stop?.();
		this.stop = undefined;
		this.boundElement = undefined;
		this.boundWindow = undefined;
		if (this.frame !== undefined) this.frameWindow?.cancelAnimationFrame(this.frame);
		this.frame = undefined;
		this.touching = false;
		this.touchScrolling = false;
		this.pendingAdjustment = 0;
		this.revealSequence++;
		this.pendingReveal = undefined;
		for (const [id, pending] of this.revealFrames) {
			pending.view.cancelAnimationFrame(id);
			pending.resolve();
		}
		this.revealFrames.clear();
	}

	dispose() {
		this.disposed = true;
		this.unbind();
	}

	mount() {
		this.disposed = false;
	}

	private async reveal(key: string): Promise<boolean> {
		const index = this.geometry.indexOf(key);
		const view = this.window();
		if (!this.active || !this.scroll || !view || index < 0 || this.disposed) return false;
		const sequence = ++this.revealSequence;
		this.pendingReveal = key;
		this.scroll.scrollTop += this.geometry.offsetAt(index) - this.top();
		if (this.rangeChanged()) this.changed();
		for (let attempt = 0; attempt < 12 && !this.disposed; attempt++) {
			await new Promise<void>((resolve) => {
				const id = view.requestAnimationFrame(() => {
					this.revealFrames.delete(id);
					resolve();
				});
				this.revealFrames.set(id, { view, resolve });
			});
			if (sequence !== this.revealSequence || this.disposed) return false;
			const currentIndex = this.geometry.indexOf(key);
			if (currentIndex < 0) return false;
			const segment = this.geometry.segments[currentIndex];
			const element =
				segment?.kind === "row"
					? this.rows.get(segment.instanceId)
					: segment && "dayKey" in segment
						? (this.dayElements
								.get(segment.dayKey)
								?.querySelector<HTMLElement>(":scope > .details > .dateLine") ??
							this.dayElements.get(segment.dayKey))
						: undefined;
			if (!element) continue;
			const viewport = this.scroll.getBoundingClientRect();
			const rect = element.getBoundingClientRect();
			this.scroll.scrollTop += rect.top - viewport.top - this.scroll.clientTop;
			this.pendingReveal = undefined;
			this.schedule();
			return true;
		}
		this.pendingReveal = undefined;
		return false;
	}

	async revealInstance(instanceId: string): Promise<boolean> {
		if (!this.active) {
			const element = this.rows.get(instanceId);
			element?.scrollIntoView?.({ block: "nearest" });
			return !!element;
		}
		return this.reveal(`t:${instanceId}`);
	}

	async revealTask(taskId: string): Promise<boolean> {
		const found =
			this.result?.years.flatMap((year) =>
				year.days.flatMap((day) =>
					day.tasks
						.filter(({ task }) => task.id === taskId)
						.map(() => ({
							dayKey: day.key,
							instanceId: `${encodeURIComponent(day.key)}-${encodeURIComponent(taskId)}`,
						})),
				),
			) ?? [];
		const viewport = this.scroll?.getBoundingClientRect();
		const visible = found.find(({ instanceId }) => {
			const rect = this.rows.get(instanceId)?.getBoundingClientRect();
			return rect && viewport && rect.bottom > viewport.top && rect.top < viewport.bottom;
		});
		const choice =
			visible ??
			(this.active
				? [...found].sort((a, b) => {
						const distance = (id: string) =>
							Math.abs(this.geometry.offsetAt(this.geometry.indexOf(`t:${id}`)) - this.top());
						return distance(a.instanceId) - distance(b.instanceId);
					})[0]
				: found[0]);
		return choice ? this.revealInstance(choice.instanceId) : false;
	}

	async revealDay(dayKey: string): Promise<boolean> {
		if (!this.active) {
			if (!this.scroll || !this.root || this.disposed) return false;
			const day = this.result?.years.flatMap((year) => year.days).find((day) => day.key === dayKey);
			if (!day) return false;
			const row = day.tasks[0];
			const element = row
				? this.rows
						.get(`${encodeURIComponent(day.key)}-${encodeURIComponent(row.task.id)}`)
						?.closest(".details")
						?.parentElement?.querySelector<HTMLElement>(":scope > .dateLine")
				: day.isEntry && day.key === this.result?.entryDay
					? this.root.querySelector<HTMLElement>(".todayHeader")
					: undefined;
			if (!element) return false;
			const rect = element.getBoundingClientRect();
			if (rect.height <= 0) return false;
			const viewport = this.scroll.getBoundingClientRect();
			this.scroll.scrollTop += rect.top - viewport.top - this.scroll.clientTop;
			return true;
		}
		return this.reveal(
			this.geometry.indexOf(`d:${dayKey}`) >= 0
				? `d:${dayKey}`
				: dayKey === this.result?.entryDay
					? "entry"
					: `d:${dayKey}`,
		);
	}

	getWindowingInfo() {
		return {
			rowCount:
				this.result?.years.reduce(
					(sum, year) => sum + year.days.reduce((total, day) => total + day.tasks.length, 0),
					0,
				) ?? 0,
			windowed: this.active,
		};
	}
}

export function useWindowed(
	result: QueryResult,
	host: UiHost,
	rows: ReadonlyMap<string, HTMLElement>,
	focusId?: string,
	showYears = true,
) {
	const [, render] = React.useReducer((value: number) => value + 1, 0);
	const ref = React.useRef<TimelineWindow>();
	const controller = (ref.current ??= new TimelineWindow(render));
	const snapshot = controller.prepare(result, host, rows, focusId, showYears);
	useClientLayoutEffect(() => {
		const connection = host.windowing;
		controller.mount();
		connection?.connect(controller);
		return () => {
			controller.dispose();
			connection?.connect(undefined);
		};
	}, [controller, host.windowing]);
	return snapshot;
}
