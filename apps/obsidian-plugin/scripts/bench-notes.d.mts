/** Types for scripts/bench-notes.mjs, which the tests import. */

export declare const BENCH_SCALES: readonly number[];
export declare const BENCH_TARGETS: {
	readonly withTasks: string;
	readonly withoutTasks: string;
	readonly toggle: string;
};
export declare function benchVaultName(scale: number): string;
export declare function benchVaultNotes(scale?: number): Map<string, string>;
export declare function scaleOf(args: readonly string[]): number;
export declare function withoutScale(args: readonly string[]): string[];
