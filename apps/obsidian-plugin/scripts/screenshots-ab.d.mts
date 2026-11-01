/** Types for the screenshot argument parser, pure A/B comparisons and Markdown report. */

/** The selected screenshot mode and the options needed before any git or Obsidian work starts. */
export type ScreenshotArgs = {
	mode: "screenshots" | "styles" | "ab";
	update: boolean;
	/** The substring from --only=<text>, or an empty string when no filter was supplied. */
	only: string;
	ab: {
		base: string;
		/** null means the build from this checkout. */
		candidate: string | null;
		report: string | null;
		allowOtherBase: boolean;
	} | null;
};

/**
 * Parses --ab/--candidate/--report with a separate or = value, --any-base, --styles, --update and --only=<text>.
 * Defaults to { mode: "screenshots", update: false, only: "", ab: null }; --styles selects "styles" and --ab selects "ab".
 * Unsupported arguments are rejected first, then missing A/B values or stray A/B options, then incompatible combinations.
 * Throws plain Errors with these exact messages:
 * - unknown arguments ${JSON.stringify(unknown)}; use --update, --only=<text>, --styles, or --ab <ref> with --candidate <ref>, --report <file> and --any-base.
 * - --ab needs a git ref to compare against, such as --ab master.
 * - --candidate needs a git ref to build the candidate from.
 * - --report needs a file to write the report to.
 * - ${stray.join(", ")} only go with --ab <ref>.
 * - --ab compares two builds and records no baseline; leave out --update.
 * - leave out --styles, --ab compares styles already.
 * - --only cannot be combined with --update, which replaces all screenshots.
 * A missing value includes an empty = value or a following option. --only with a separate value stays unknown.
 */
export function parseScreenshotArgs(argv: readonly string[]): ScreenshotArgs;

/** The records taken for one state; null means that this kind of record was not taken. */
export type ArmState = {
	visible: string | null;
	png: Buffer | null;
	styles: string | null;
};

/** State names mapped to the visible text, PNG bytes and serialized style fingerprint taken by one build. */
export type ArmStates = ReadonlyMap<string, ArmState>;

/** The per-kind results of comparing two arms, including records present in just one arm. */
export type AbComparison = {
	visible: {
		/** States with visible text in either arm, counted once each. */
		taken: number;
		/** Paired text changes; detail is firstDifference(base, candidate), unchanged. */
		differences: { state: string; detail: string }[];
	};
	png: {
		/** States with PNG bytes in either arm, counted once each. */
		taken: number;
		same: number;
		noise: number;
		drift: number;
		/**
		 * Paired PNGs whose screenshotVerdict is "changed". detail is
		 * "N of M pixels differ, by up to D (P %)" with P to two decimals,
		 * followed by " (W×H → W×H)" if dimensions changed.
		 * diff is an encoded diff PNG for <state>.diff.png, or null if no diff image exists.
		 */
		changed: { state: string; detail: string; diff: Buffer | null }[];
	};
	styles: {
		/** States with style fingerprints in either arm, counted once each. */
		taken: number;
		/** Union of present probe/property keys per state, counted once; null probes contribute no values. */
		values: number;
		/** Paired fingerprint changes; lines are the state-prefixed formatStyleDifference results. */
		differences: { state: string; lines: string[] }[];
	};
	/**
	 * arm names the side that has the record. what is "state" for an entirely absent state,
	 * otherwise "visible", "png" or "styles" for a kind taken by only one arm.
	 * Entirely absent states have one entry, not an additional entry for every kind.
	 * These entries are kept apart from the paired difference arrays above.
	 */
	onlyInOne: { state: string; arm: "base" | "candidate"; what: string }[];
	/** Differing states per category, including every kind present in a one-arm-only state. */
	counts: { v: number; p: number; s: number };
};

/**
 * Describes the first differing line using screenshots.mjs's unchanged one-based text format:
 * `line N: ${JSON.stringify(before)} became ${JSON.stringify(after)}`; a missing line is "(end)".
 * Intended for different strings; if equal, preserves the existing end-of-text behavior.
 */
export function firstDifference(expected: string, actual: string): string;

/**
 * Purely compares visible text and serialized styles byte-for-byte, and PNGs through decodePng,
 * comparePngs and screenshotVerdict. "same", "noise" and "drift" PNGs pass; "changed" PNGs fail.
 * A state or record kind present in one arm only fails the corresponding categories.
 * Style changes are expanded through compareStyles and formatStyleDifference. Screenshot state names
 * start with light- or dark-; style lines use the corresponding <theme>/<state> prefix.
 */
export function compareArms(base: ArmStates, candidate: ArmStates): AbComparison;

/** Returns 0 only when counts.v, counts.p and counts.s are all zero; otherwise returns 1. */
export function abExitCode(comparison: AbComparison): 0 | 1;

/** The ref, resolved commit and both artifact hashes identifying a build in the report. */
export type AbBuildInfo = {
	ref: string;
	commit: string;
	mainJsSha256: string;
	stylesCssSha256: string;
	uncommittedChanges?: boolean;
};

/**
 * Formats a Markdown report naming both builds (ref, commit and both hashes), "identical builds" when
 * both hashes match, env in a JSON code block, every difference and workDir where the arm files remain.
 * Counts read "V: n light states, k differ", "P: n PNGs: same a, noise b, drift c, changed d" and
 * "S: n fingerprints (x values), k differ"; changed d includes one-sided PNG records (counts.p).
 * The last line is exactly "V P S: no differences" or "V P S: v / p / s differences".
 */
export function abReport(input: {
	builds: { base: AbBuildInfo; candidate: AbBuildInfo };
	env: unknown;
	workDir: string;
	comparison: AbComparison;
}): string;
