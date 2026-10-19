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
