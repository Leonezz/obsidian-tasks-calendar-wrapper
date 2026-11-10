/** Types for the mobile screenshot plan, rendered target measurements and problem report. */
import type { ScreenshotShot } from "./screenshots-themes.mjs";

export type TouchTarget = {
	readonly name: string;
	readonly selector: string;
	readonly required: boolean;
};

/** Selectors are relative to .taskido; missing optional targets do not fail a state. */
export const TOUCH_TARGETS: readonly TouchTarget[];
export const MOBILE_WIDTH: 390;
export const MOBILE_STATES: readonly string[];

export type MobileShot = Pick<ScreenshotShot, "name" | "position" | "todayFocus" | "counter" | "behavior"> & {
	theme: "light";
};

/** The seven ordered states, filtered by a name substring; omitted only means all states. */
export function mobilePlan(only?: string): MobileShot[];

export type TouchTargetMeasurement = {
	target: string;
	/** One-based index among all selector matches, including skipped hidden matches. */
	index: number;
	width: number;
	height: number;
	hit: boolean;
};

/**
 * Standalone window function with only document as an external reference. Inside container's .taskido,
 * measure every match passing checkVisibility({ checkVisibilityCSS: true }), preserving target order
 * and one-based selector-match indices, including skipped hidden matches. Intersect its bounding rect
 * with every ancestor's padding box up to and including document.documentElement, independently on
 * each axis whose computed overflow is not visible (using document.defaultView.getComputedStyle).
 * The padding box starts at rect.left/top + clientLeft/Top and spans clientWidth/Height; reported
 * dimensions are clamped to zero. For a non-empty rect, hit requires elementFromPoint to return the
 * element or a descendant at its centre, then top, right, bottom and left edge midpoints inset by 1 px.
 * Stop at the first miss; an empty rect has hit false and makes no elementFromPoint calls.
 */
export function collectTouchTargets(arg: {
	container: string;
	targets: readonly TouchTarget[];
}): TouchTargetMeasurement[];

export type TouchTargetProblem =
	| {
			state: string;
			target: string;
			index: number;
			width: number;
			height: number;
			reason: "size" | "covered";
	  }
	| { state: string; target: string; reason: "missing" };

/**
 * Emit size then covered problems per measurement; either dimension below minimum fails, equality passes.
 * Append missing required TOUCH_TARGETS in target order. Optional targets may have no measurements.
 */
export function touchTargetProblems(
	stateName: string,
	measurements: readonly TouchTargetMeasurement[],
	minimum?: number,
): TouchTargetProblem[];

/**
 * One line per problem and a final "Mobile touch targets: N problem(s)." summary; exitCode is 1 iff any.
 * Covered: "<state>: <target> #<index> is covered by another element at its centre or an edge".
 */
export function formatTouchTargetReport(
	problems: readonly TouchTargetProblem[],
	minimum?: number,
): { lines: string[]; exitCode: 0 | 1 };
