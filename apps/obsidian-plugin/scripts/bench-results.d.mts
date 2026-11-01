/** Types for scripts/bench-results.mjs, which the tests import. */

export interface Timing {
	readonly medianMs: number;
	readonly minMs: number;
	readonly maxMs: number;
	readonly samplesMs: readonly number[];
}

export interface Counts {
	readonly median: number;
	readonly min: number;
	readonly max: number;
	readonly samples: readonly number[];
}

/** One control click's wall time and long tasks, with optional main-thread CPU time. */
export interface ClickStep {
	readonly paintedMs: number;
	readonly blockedMs: number;
	readonly longestMs: number;
	readonly cpuMs?: number;
}

/** The measured runs of a view control, each timing rounded to a tenth of a millisecond. */
export type ClickResults = {
	readonly runs: number;
	readonly paintedMs: Timing;
	readonly blockedMs: Timing;
	readonly longestTaskMs: Timing;
	readonly cpuMs?: Timing;
};

/** One scroll's animation-frame timestamps and the page's visibility while scrolling. */
export interface ScrollRun {
	readonly timestamps: readonly number[];
	readonly visibilityState: string;
}

/** The measured scroll runs, with frame counts reported separately from timings. */
export type ScrollResults = {
	readonly runs: number;
	readonly p95FrameMs: Timing;
	readonly framesOver50Ms: Counts;
	readonly frames: Counts;
	readonly visibilityState: string;
};

/** Full scenario.metric names of counts reported without change warnings or verdicts. */
export const REPORT_ONLY_COUNTS: ReadonlySet<string>;
/** Summarises a view control's measured clicks, with CPU timings only when requested. */
export function clickResults(steps: readonly ClickStep[], cpu: boolean): ClickResults;
/** Summarises the on and off clicks separately under the flat Focus on today scenario names. */
export function focusTodayResults(
	pairs: readonly { readonly on: ClickStep; readonly off: ClickStep }[],
	cpu: boolean,
): { "focusToday.on": ClickResults; "focusToday.off": ClickResults };
/** Computes nearest-rank p95 and counts; requires at least two strictly increasing timestamps. */
export function frameStats(timestamps: readonly number[]): {
	p95FrameMs: number;
	framesOver50Ms: number;
	frames: number;
};
/** Summarises scroll frame timings and counts, joining distinct visibility states with a comma and space. */
export function scrollResults(runs: readonly ScrollRun[]): ScrollResults;
/** Summarises used heap bytes collected after garbage collection. */
export function heapResults(usedSizes: readonly number[]): { usedBytes: Counts };

export interface Frame {
	readonly startedAt: number;
	readonly paintedAt: number;
}

export interface LongTask {
	readonly start: number;
	readonly duration: number;
}

export interface RawLoad {
	readonly rows: number;
	readonly filesRead: number | null;
	readonly rowsAt: number | null;
	readonly times: readonly number[];
	readonly frames: readonly Frame[];
	readonly tasks: readonly LongTask[];
}

export interface Load {
	readonly renderedMs: number;
	readonly rows: number;
	readonly filesRead: number | null;
	readonly blockedMs: number;
	readonly longestMs: number;
	readonly longTasks: number;
	readonly laterRenders: number;
	readonly laterBlockedMs: number;
	readonly totalBlockedMs: number;
}

export const SLOWER_RATIO: number;
export const SLOWER_MS: number;
export function round(value: number): number;
export function summary(samples: readonly number[]): Timing;
export function counts(samples: readonly number[]): Counts;
export function assertToggleChanges(original: string, actual: string, lines: readonly number[]): void;
export function assertToggleRestored(path: string, original: string, actual: string | null | undefined): void;
export function countIgnoredClicks(log: readonly { readonly overlayMs: number | null }[]): number;
export function sumTasks(tasks: readonly LongTask[]): { blockedMs: number; longestMs: number; longTasks: number };
export function paintedAfter(frames: readonly Frame[], time: number): number;
export function splitLoad(raw: RawLoad, burstGapMs: number): Load;
export function compare(
	baseline: { readonly results: Record<string, Record<string, unknown> | undefined> },
	results: Record<string, Record<string, unknown>> & {
		readonly initialLoad: { readonly rows?: unknown };
		readonly saveWithoutTasks: { readonly runs?: unknown; readonly reloads?: unknown };
	},
	scale?: number,
): { lines: string[]; warnings: string[]; slower: number };
export function notJudgedAt(scale: number): Set<string>;
