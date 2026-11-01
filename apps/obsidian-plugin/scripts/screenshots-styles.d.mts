/** Types for computed-style fingerprints and baseline comparisons. */

/** Select the first matching element inside .taskido, or the root itself for selector .taskido. */
export type StyleProbe = {
	readonly name: string;
	readonly selector: string;
	readonly pseudo?: "::after";
};

/** The 58 ordered probes; each name is its selector followed by its optional pseudo-element. */
export const STYLE_PROBES: readonly StyleProbe[];

/** The 33 ordered CSS properties recorded for every matching probe. */
export const STYLE_PROPERTIES: readonly string[];

/** The six --taskido-color-* custom properties additionally recorded on .taskido only. */
export const ROOT_CUSTOM_PROPERTIES: readonly string[];

/** Unchanged computed property strings by probe name; null means no matching element. */
export type StyleRecord = Readonly<Record<string, Readonly<Record<string, string>> | null>>;

/**
 * Synchronously collect the first match, visible or not, for each probe inside the container's .taskido root.
 * Read getComputedStyle(element, pseudo ?? null).getPropertyValue(property) without changing its value.
 * Add rootCustomProperties only to .taskido. Throw an Error identifying a missing container or .taskido root.
 * This function is evaluated from source in Obsidian: its only external references are document and
 * getComputedStyle globals, with no module closures or helpers. The caller must settle the page before calling.
 */
export function collectStyles(arg: {
	container: string;
	probes: readonly StyleProbe[];
	properties: readonly string[];
	rootCustomProperties: readonly string[];
}): StyleRecord;

/** Sort probe and property keys by plain code-unit order, then JSON.stringify with tabs and one trailing newline. */
export function serializeStyles(record: StyleRecord): string;

/**
 * One unequal value. A missing property has value null; an empty CSS value remains "".
 * For a probe-presence difference, property is null: "missing" means no probe key, null means a recorded
 * non-match, and "element" means a matching element. A missing probe differs even from a recorded null probe.
 */
export type StyleDifference = {
	probe: string;
	property: string | null;
	base: string | null;
	candidate: string | null;
};

/** Compare the union of probe/property keys, returning each unequal value once in sorted probe/property order. */
export function compareStyles(base: StyleRecord, candidate: StyleRecord): StyleDifference[];

/** Format "<theme>/<state> <probe> <property>: <base> → <candidate>"; null property is "<element>", null value "null". */
export function formatStyleDifference(state: string, difference: StyleDifference): string;

/** Return the repo-relative forward-slash path fixtures/screenshots/styles/<theme>/<state>.json. */
export function stylesFile(theme: string, state: string): string;

/**
 * Compare serialized fingerprints keyed by "<theme>/<state>" in both maps, examining only taken states.
 * Return one problem for each missing baseline (naming stylesFile and `pnpm screenshots --styles --update`),
 * each baseline that does not parse (naming its file), and each differing value (using formatStyleDifference).
 * Matching fingerprints return no problems.
 */
export function stylesBaselineProblems(
	taken: ReadonlyMap<string, string>,
	baselines: ReadonlyMap<string, string | undefined>,
): string[];
