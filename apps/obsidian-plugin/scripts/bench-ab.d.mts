/** Types for scripts/bench-ab.mjs, which the tests import. */

import type { Counts } from "./bench-results.mjs";

export type Arm = "base" | "candidate";

export interface AbOptions {
	/** The git ref of the base. */
	readonly base: string;
	/** The git ref of the candidate, or null for this checkout's build. */
	readonly candidate: string | null;
	readonly rounds: number;
	/** null for a random one. */
	readonly seed: number | null;
	/** Where to write the report, or null. */
	readonly report: string | null;
	readonly allowOtherBase: boolean;
}

/** One traced pass per scenario, either for this checkout or for two specified builds. */
export interface ProfileOptions {
	readonly base: string | null;
	readonly candidate: string | null;
	readonly allowOtherBase: boolean;
	readonly report: string | null;
}

/** Parses the plain benchmark, A/B comparison and standalone profile modes without starting a run. */
export function parseBenchArgs(argv: readonly string[]): {
	scale: number;
	update: boolean;
	ab: AbOptions | null;
	profile: ProfileOptions | null;
};

/** What one arm measured in one round: bench.mjs's results, the same shape as a baseline's. */
export interface Slot {
	readonly round: number;
	readonly arm: Arm;
	readonly results: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export type TimingVerdict = "slower" | "faster" | "small" | "none" | "not judged";

export interface TimingRow {
	readonly name: string;
	readonly judged: boolean;
	/** The median over the rounds of each arm's fastest run, in milliseconds. */
	readonly base: number;
	readonly candidate: number;
	/** The candidate's time over the base's, and its confidence interval. */
	readonly ratio: number;
	readonly low: number;
	readonly high: number;
	readonly level: number;
	/** The candidate's time minus the base's, in milliseconds. */
	readonly deltaMs: number;
	readonly p: number;
	readonly rounds: number;
	/** The rounds in which the candidate was slower than the base. */
	readonly slowerRounds: number;
	readonly verdict: TimingVerdict;
}

export interface CountRow {
	readonly name: string;
	readonly base: Pick<Counts, "min" | "median" | "max">;
	readonly candidate: Pick<Counts, "min" | "median" | "max">;
	readonly changed: boolean;
	readonly reportOnly: boolean;
}

export interface UnpairedRow {
	readonly name: string;
	readonly kind: "timing" | "count";
	readonly base: null;
	readonly candidate: number;
	readonly judged: false;
	readonly verdict: "not judged";
}

export interface AbVerdict {
	readonly rows: readonly TimingRow[];
	readonly counts: readonly CountRow[];
	/** Candidate-only measurements, kept apart from the paired rows. */
	readonly unpaired: readonly UnpairedRow[];
	/** How often a save without tasks reloaded the timeline, in each arm, and of how many such saves each. */
	readonly reloads: { readonly base: number; readonly candidate: number; readonly runs: number };
	readonly warnings: readonly string[];
	readonly lines: readonly string[];
	/** The measurements that got slower, and the reloads after saves without tasks. */
	readonly slower: number;
}

export interface AbBuild {
	readonly ref: string;
	readonly commit: string;
	readonly mainJsSha256: string;
	readonly [key: string]: unknown;
}

export interface AbReport {
	readonly measuredAt: string;
	readonly scale: number;
	readonly vault: string;
	readonly rounds: number;
	readonly seed: number;
	readonly order: readonly (readonly Arm[])[];
	readonly base: AbBuild;
	readonly candidate: AbBuild;
	readonly identicalBuilds: boolean;
	readonly env: {
		readonly obsidianVersion: string;
		readonly machine: { readonly cpu: string; readonly [key: string]: unknown };
		readonly [key: string]: unknown;
	};
	readonly loadAverage: { readonly before: number; readonly after: number; readonly cores: number };
	readonly slots: readonly Slot[];
	readonly verdict: AbVerdict;
}

export const AB_ROUNDS: Readonly<Record<number, number>>;
export const MIN_ROUNDS: number;
export const AB_RUNS: Readonly<
	Record<number, { readonly loads: number; readonly saves: number; readonly optionChanges: number }>
>;
export const SIGNIFICANCE: number;
export function abArgs(args: readonly string[], scale: number): { ab: AbOptions | null; rest: string[] };
export function checkAbBase(options: {
	readonly ref: string;
	readonly baseCommit: string;
	readonly mergeBase: string;
	readonly allowOtherBase?: boolean;
}): string | null;
export function abOrder(rounds: number, seed: number): Arm[][];
export function compareAb(slots: readonly Slot[], scale: number): AbVerdict;

/** A ratio as a change in percent, "+6.2 %" or "-3 %". */
export function percentChange(ratio: number): string;

/** Runs git synchronously with these arguments and returns stdout; the caller owns cwd and execution options. */
export type GitRunner = (args: readonly string[]) => string;

/**
 * Returns trimmed `git rev-parse --abbrev-ref <ref>@{upstream}` stdout, or ref unchanged when that lookup throws.
 * The injected runner keeps this helper independent of a checkout or a child process implementation.
 */
export function upstreamOf(ref: string, git: GitRunner): string;

/**
 * Returns trimmed commits from `git rev-parse --verify --end-of-options <base>^{commit}` and
 * `git merge-base -- <upstreamOf(base)> <candidate ?? HEAD>`. Base and merge-base errors propagate unchanged.
 */
export function abMergeBase(options: {
	readonly base: string;
	readonly candidate: string | null;
	readonly git: GitRunner;
}): { baseCommit: string; mergeBase: string };
