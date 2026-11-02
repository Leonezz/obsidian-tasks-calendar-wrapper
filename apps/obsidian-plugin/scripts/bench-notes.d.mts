/** Types for scripts/bench-notes.mjs, which the tests import. */

export declare const BENCH_SCALES: readonly number[];
export declare const BENCH_TARGETS: {
	readonly withTasks: string;
	readonly withoutTasks: string;
	readonly toggle: string;
};
/** The task line edited by saveWithTasks, identified by its vault path and zero-based line. */
export declare const SAVE_MARKER: {
	readonly path: string;
	readonly line: number;
	readonly text: string;
};
/** Inserts a save token after the marker's task text while preserving every other byte of the note. */
export declare function withSaveToken(original: string, token: string): string;
export declare function benchVaultName(scale: number): string;
export declare function benchVaultNotes(scale?: number): Map<string, string>;
export declare function scaleOf(args: readonly string[]): number;
export declare function withoutScale(args: readonly string[]): string[];
