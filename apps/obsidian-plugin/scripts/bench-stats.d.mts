/** Types for scripts/bench-stats.mjs, which the tests import. */

export interface SignedRank {
	/** The pairs that differ; the others are left out. */
	readonly n: number;
	/** The sum of the ranks of the positive differences. */
	readonly wPlus: number;
	/** Two-sided. */
	readonly p: number;
}

export interface Estimate {
	readonly estimate: number;
	readonly low: number;
	readonly high: number;
	/** The confidence the interval reaches, at least the one asked for when there are enough pairs. */
	readonly level: number;
}

export function signedRank(differences: readonly number[]): SignedRank;
export function hodgesLehmann(differences: readonly number[], confidence?: number): Estimate;
