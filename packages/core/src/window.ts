/** Geometry for a windowed timeline. It reads arranged data and measured heights, never the DOM. */
import type { DayGroup, QueryResult, YearGroup } from "./arrange";
import type { DayKey } from "./dates";
import type { ResolvedTask } from "./resolve";

export const WINDOW_MIN_ROWS = 1_000;
export const WINDOW_RELEASE_ROWS = 800;
export const WINDOW_STOP_ROWS = WINDOW_RELEASE_ROWS;

type InYear = { readonly key: string; readonly yearIndex: number };
type InDay = InYear & { readonly dayIndex: number; readonly dayKey: DayKey; readonly day: DayGroup };

export type WindowSegment =
	| (InYear & { readonly kind: "year"; readonly year: YearGroup })
	| (InDay & { readonly kind: "entry" })
	| (InDay & { readonly kind: "day" })
	| (InDay & {
			readonly kind: "row";
			readonly rowIndex: number;
			readonly taskId: string;
			/** The UI's rowInstanceKey, without the segment key's t: prefix. */
			readonly instanceId: string;
			readonly task: ResolvedTask;
	  });

export type WindowSegmentKind = WindowSegment["kind"];
export type WindowEstimates = Readonly<Partial<Record<WindowSegmentKind, number>>>;

export interface WindowGap {
	/** Half-open segment indexes that this gap replaces. */
	readonly start: number;
	readonly end: number;
	readonly height: number;
}

export interface WindowRange {
	/** The viewport plus overscan, before adding resident segments and their day headers. */
	readonly start: number;
	readonly end: number;
	/** Every mounted segment, once, in display order. */
	readonly indices: readonly number[];
	/** The omitted runs; resident segments can split them. */
	readonly gaps: readonly WindowGap[];
	readonly totalHeight: number;
}

export interface WindowAnchor {
	readonly key: string;
	readonly index: number;
	/** scrollTop minus this segment's top. */
	readonly offset: number;
}

export interface WindowGeometry {
	readonly segments: readonly WindowSegment[];
	setSegments(segments: readonly WindowSegment[]): void;
	/** Ignores unknown keys and non-positive/non-finite measurements. Returns whether geometry changed. */
	measure(key: string, height: number): boolean;
	measureBatch(measurements: Iterable<readonly [string, number]>): boolean;
	/** For a width change; keys remain but measured heights and their rolling estimates are discarded. */
	invalidateMeasurements(): boolean;
	/** Offsets include the final segment's end at index segments.length. */
	offsetAt(index: number): number;
	heightAt(index: number): number;
	indexOf(key: string): number;
	totalHeight(): number;
	/** Overscan is pixels on each side, not a number of rows or screens. */
	rangeFor(scrollTop: number, viewportHeight: number, overscan: number, residentKeys?: Iterable<string>): WindowRange;
	captureAnchor(scrollTop: number): WindowAnchor | undefined;
	restoreAnchor(anchor: WindowAnchor | undefined): number;
}

const DEFAULT_ESTIMATES: Readonly<Record<WindowSegmentKind, number>> = Object.freeze({
	year: 22,
	entry: 180,
	day: 38,
	row: 60,
});

/** The key includes its date column: one task can have rows under several dates. */
export const windowRowKey = (dayKey: string, taskId: string): string =>
	`t:${encodeURIComponent(dayKey)}-${encodeURIComponent(taskId)}`;

/** Segments follow the existing year/day DOM order, including the entry panel before its day's heading. */
export function flattenWindowSegments(result: QueryResult): readonly WindowSegment[] {
	const segments: WindowSegment[] = [];
	result.years.forEach((year, yearIndex) => {
		if (year.showHeader) segments.push(Object.freeze({ kind: "year", key: `y:${year.year}`, yearIndex, year }));
		year.days.forEach((day, dayIndex) => {
			const inDay = { yearIndex, dayIndex, dayKey: day.key, day };
			if (day.isEntry) segments.push(Object.freeze({ kind: "entry", key: "entry", ...inDay }));
			if (day.tasks.length === 0) return;
			segments.push(Object.freeze({ kind: "day", key: `d:${day.key}`, ...inDay }));
			day.tasks.forEach((task, rowIndex) => {
				const key = windowRowKey(day.key, task.task.id);
				segments.push(
					Object.freeze({
						kind: "row",
						key,
						instanceId: key.slice(2),
						rowIndex,
						taskId: task.task.id,
						task,
						...inDay,
					}),
				);
			});
		});
	});
	return Object.freeze(segments);
}

/** Turn on above the upper boundary and off below the lower one, so small changes do not swap modes. */
export function windowingEnabled(rowCount: number, wasEnabled: boolean, minRows = WINDOW_MIN_ROWS): boolean {
	if (!Number.isInteger(rowCount) || rowCount < 0)
		throw new RangeError("window row count must be a non-negative integer");
	if (minRows === Infinity) return false;
	if (!Number.isFinite(minRows) || minRows < 0) throw new RangeError("window row threshold must be non-negative");
	if (minRows === 0) return rowCount > 0;
	return wasEnabled ? rowCount >= minRows * (WINDOW_RELEASE_ROWS / WINDOW_MIN_ROWS) : rowCount > minRows;
}

type HeightSample = { readonly key: string; readonly height: number };
const SAMPLE_COUNT = 31;
const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const nonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

/**
 * Keeps measured heights by segment key. Each kind's latest 31 distinct measured keys estimate its unmeasured
 * segments; prefix offsets are rebuilt only when first needed after a batch, rather than for every ResizeObserver entry.
 */
export function createWindowGeometry(
	initial: readonly WindowSegment[],
	estimates: WindowEstimates = {},
): WindowGeometry {
	const defaults = { ...DEFAULT_ESTIMATES, ...estimates };
	for (const [kind, value] of Object.entries(defaults))
		if (!finitePositive(value)) throw new RangeError(`window ${kind} estimate must be positive and finite`);
	let segments: readonly WindowSegment[] = Object.freeze([]);
	let source: readonly WindowSegment[] | undefined;
	let indexes = new Map<string, number>();
	let headers = new Map<DayKey, number>();
	let entryIndex = -1;
	const heights = new Map<string, number>();
	const samples: Record<WindowSegmentKind, HeightSample[]> = { year: [], entry: [], day: [], row: [] };
	let estimated = { ...defaults };
	let prefix = new Float64Array(1);
	let dirty = true;
	// The most recent old order lets a removed anchor choose a surviving neighbour after setSegments.
	let previousSegments: readonly WindowSegment[] = segments;
	const anchorOrders = new WeakMap<WindowAnchor, readonly WindowSegment[]>();

	function offsets(): Float64Array {
		if (dirty) {
			prefix = new Float64Array(segments.length + 1);
			segments.forEach((segment, i) => {
				prefix[i + 1] = prefix[i] + (heights.get(segment.key) ?? estimated[segment.kind]);
			});
			dirty = false;
		}
		return prefix;
	}

	/** The first segment whose end lies after the point, or length when it is past the end. */
	function indexAt(point: number): number {
		const values = offsets();
		let low = 0;
		let high = segments.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (values[middle + 1] <= point) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	/** The first segment that starts at or after the exclusive bottom. */
	function endAt(point: number): number {
		const values = offsets();
		let low = 0;
		let high = segments.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (values[middle] < point) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	function setSegments(next: readonly WindowSegment[]): void {
		if (next === source || next === segments) return;
		const nextIndexes = new Map<string, number>();
		const nextHeaders = new Map<DayKey, number>();
		let nextEntry = -1;
		next.forEach((segment, i) => {
			if (nextIndexes.has(segment.key)) throw new Error(`duplicate window segment key: ${segment.key}`);
			nextIndexes.set(segment.key, i);
			if (segment.kind === "day") nextHeaders.set(segment.dayKey, i);
			if (segment.kind === "entry") nextEntry = i;
		});
		previousSegments = segments;
		source = next;
		segments = Object.freeze(
			next.map((segment) => (Object.isFrozen(segment) ? segment : Object.freeze({ ...segment }))),
		);
		indexes = nextIndexes;
		headers = nextHeaders;
		entryIndex = nextEntry;
		// Do not retain a deleted task's measurement for the lifetime of a view.
		for (const key of heights.keys()) if (!indexes.has(key)) heights.delete(key);
		for (const kind of Object.keys(samples) as WindowSegmentKind[])
			samples[kind] = samples[kind].filter((sample) => indexes.has(sample.key));
		reestimate();
		dirty = true;
	}

	function reestimate(): boolean {
		const next = { ...defaults };
		for (const kind of Object.keys(samples) as WindowSegmentKind[]) {
			const values = samples[kind].map((sample) => sample.height).sort((a, b) => a - b);
			if (values.length) {
				const middle = Math.floor(values.length / 2);
				next[kind] = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
			}
		}
		const changed = (Object.keys(next) as WindowSegmentKind[]).some((kind) => next[kind] !== estimated[kind]);
		estimated = next;
		return changed;
	}

	function measureBatch(measurements: Iterable<readonly [string, number]>): boolean {
		let changed = false;
		for (const [key, height] of measurements) {
			const index = indexes.get(key);
			if (index === undefined || !finitePositive(height)) continue;
			if (heights.get(key) !== height) {
				heights.set(key, height);
				changed = true;
			}
			const kind = segments[index].kind;
			const recent = samples[kind].filter((sample) => sample.key !== key);
			recent.push({ key, height });
			if (recent.length > SAMPLE_COUNT) recent.shift();
			samples[kind] = recent;
		}
		if (reestimate() || changed) {
			dirty = true;
			return true;
		}
		return false;
	}

	function offsetAt(index: number): number {
		if (!Number.isInteger(index) || index < 0 || index > segments.length)
			throw new RangeError("window segment offset index is out of range");
		return offsets()[index];
	}

	function captureAnchor(scrollTop: number): WindowAnchor | undefined {
		if (segments.length === 0) return undefined;
		const top = Math.min(nonNegative(scrollTop), offsets()[segments.length]);
		const index = Math.min(indexAt(top), segments.length - 1);
		const anchor = Object.freeze({ key: segments[index].key, index, offset: top - offsets()[index] });
		anchorOrders.set(anchor, segments);
		return anchor;
	}

	function restoreAnchor(anchor: WindowAnchor | undefined): number {
		if (!anchor || segments.length === 0) return 0;
		let index = indexes.get(anchor.key);
		if (index === undefined) {
			const oldOrder = anchorOrders.get(anchor) ?? previousSegments;
			const oldIndex = oldOrder.findIndex((segment) => segment.key === anchor.key);
			if (oldIndex >= 0) {
				// Prefer the next surviving segment in display order, then the preceding one.
				for (let i = oldIndex + 1; i < oldOrder.length && index === undefined; i++)
					index = indexes.get(oldOrder[i].key);
				for (let i = oldIndex - 1; i >= 0 && index === undefined; i--) index = indexes.get(oldOrder[i].key);
			}
		}
		index ??= Math.min(
			Math.max(0, Number.isFinite(anchor.index) ? Math.trunc(anchor.index) : 0),
			segments.length - 1,
		);
		const offset = Number.isFinite(anchor.offset) ? anchor.offset : 0;
		return Math.max(0, Math.min(offsets()[segments.length], offsets()[index] + offset));
	}

	function rangeFor(
		scrollTop: number,
		viewportHeight: number,
		overscan: number,
		residentKeys: Iterable<string> = [],
	): WindowRange {
		const top = nonNegative(scrollTop);
		const height = nonNegative(viewportHeight);
		const extra = nonNegative(overscan);
		const start = indexAt(Math.max(0, top - extra));
		const end = height === 0 ? start : Math.max(start, endAt(top + height + extra));
		const included = new Set<number>();
		for (let i = start; i < end; i++) included.add(i);
		if (entryIndex >= 0) included.add(entryIndex);
		for (const key of residentKeys) {
			const index = indexes.get(key);
			if (index !== undefined) included.add(index);
		}
		for (const i of included) {
			const segment = segments[i];
			if (segment.kind === "row") {
				const header = headers.get(segment.dayKey);
				if (header !== undefined) included.add(header);
			}
		}
		const indices = [...included].sort((a, b) => a - b);
		const values = offsets();
		const gaps: WindowGap[] = [];
		let from = 0;
		for (const i of [...indices, segments.length]) {
			if (i > from) gaps.push(Object.freeze({ start: from, end: i, height: values[i] - values[from] }));
			from = i + 1;
		}
		return Object.freeze({
			start,
			end,
			indices: Object.freeze(indices),
			gaps: Object.freeze(gaps),
			totalHeight: values[segments.length],
		});
	}

	setSegments(initial);
	return {
		get segments() {
			return segments;
		},
		setSegments,
		measure: (key, height) => measureBatch([[key, height]]),
		measureBatch,
		invalidateMeasurements() {
			if (heights.size === 0) return false;
			heights.clear();
			for (const kind of Object.keys(samples) as WindowSegmentKind[]) samples[kind] = [];
			estimated = { ...defaults };
			dirty = true;
			return true;
		},
		offsetAt,
		heightAt(index) {
			if (!Number.isInteger(index) || index < 0 || index >= segments.length)
				throw new RangeError("window segment height index is out of range");
			const values = offsets();
			return values[index + 1] - values[index];
		},
		indexOf: (key) => indexes.get(key) ?? -1,
		totalHeight: () => offsets()[segments.length],
		rangeFor,
		captureAnchor,
		restoreAnchor,
	};
}
