/** Types for scripts/bench-pr.mjs, which the tests import. */

import type { AbReport } from "./bench-ab.mjs";

/** A PR as `gh pr list --json` gives it. */
export interface PullRequest {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly headRefName: string;
	readonly headRefOid: string;
	readonly baseRefName: string;
	readonly isCrossRepository: boolean;
	readonly headRepositoryOwner: { readonly login: string };
	readonly labels: readonly { readonly name: string }[];
}

/** A comment as `gh pr view --json comments` gives it. */
export interface PrComment {
	readonly author: { readonly login: string } | null;
	readonly body: string;
	readonly url: string;
	readonly createdAt: string;
}

/** One scale's A/B run: its report, or why it failed. */
export interface BenchRun {
	readonly scale: number;
	readonly report?: AbReport;
	readonly error?: string;
}

/** The options of scripts/bench-nightly.mjs. */
export interface NightlyOptions {
	readonly label: string;
	readonly scales: readonly number[];
	readonly dryRun: boolean;
	readonly force: boolean;
	readonly maxWaitMinutes: number;
	readonly load: number;
	readonly idleMinutes: number;
	readonly harness: string;
}

export const COMMENT_MARKER: string;
export function nightlyArgs(args: readonly string[]): NightlyOptions;
export function benchablePrs(
	prs: readonly PullRequest[],
	options: { readonly label: string; readonly owner: string },
): { measure: PullRequest[]; refused: PullRequest[] };
export function commentPlan(
	comments: readonly PrComment[],
	viewer: string,
): { action: "create" } | { action: "update"; id: string };
export function upToDate(
	comments: readonly PrComment[],
	viewer: string,
	wanted: { readonly head: string; readonly base: string; readonly scales: readonly number[] },
): boolean;
export function benchComment(input: {
	readonly head: string;
	readonly base: string;
	readonly baseRefName: string;
	readonly runs: readonly BenchRun[];
}): string;
