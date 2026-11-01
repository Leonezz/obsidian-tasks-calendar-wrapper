/** Computed-style fingerprints and baseline comparisons for screenshot states. */

export const STYLE_PROBES = Object.freeze([]);
export const STYLE_PROPERTIES = Object.freeze([]);
export const ROOT_CUSTOM_PROPERTIES = Object.freeze([]);

export function collectStyles(arg) {
	throw new Error("not implemented");
}

export function serializeStyles(record) {
	throw new Error("not implemented");
}

export function compareStyles(base, candidate) {
	throw new Error("not implemented");
}

export function formatStyleDifference(state, difference) {
	throw new Error("not implemented");
}

export function stylesFile(theme, state) {
	throw new Error("not implemented");
}

export function stylesBaselineProblems(taken, baselines) {
	throw new Error("not implemented");
}
