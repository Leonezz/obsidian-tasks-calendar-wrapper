/** Computed-style fingerprints and baseline comparisons for screenshot states. */

/** The first match for each representative part of the timeline, including the status strip's pseudo-element. */
export const STYLE_PROBES = Object.freeze(
	[
		".taskido",
		".year",
		".year.current",
		".details:not(.today)",
		".details.today",
		".dateLine",
		".date",
		".weekday",
		".todayHeader",
		".counters",
		".counter#todo",
		".counter#overdue",
		".counter#unplanned",
		".counter#todo .count",
		".counter#todo .label",
		".task.due",
		".task.overdue",
		".task.process",
		".task.scheduled",
		".task.start",
		".task.unplanned",
		'.task[data-task=">"]',
		'.task[data-task="<"]',
		'.task[data-task="/"]',
		".task .lines",
		".task .content",
		".task .info",
		".task .header",
		".task .timeline",
		".task .timeline .icon",
		".task .timeline label.icon svg",
		".task.overdue .timeline .icon svg",
		".task.process .timeline .icon svg",
		".task.unplanned .timeline::after",
		".task.scheduled .timeline::after",
		".task.overdue .timeline::after",
		".task.process .timeline::after",
		'.task[data-task=">"] .timeline::after',
		".task .info .relative",
		".task.overdue .info .relative",
		".task .info .repeat",
		".task .info .priority",
		".task .info .file",
		".task .info .tag",
		".task .modify",
		".quickEntryPanel",
		".quickEntryPanel .left",
		".quickEntryPanel .actionSelect",
		".quickEntryPanel .actionName",
		".quickEntryPanel .fileSelect",
		".quickEntryPanel .newTask",
		".quickEntryPanel .ok",
		".quickEntryPanel .right",
		".quickEntryPanel svg",
		'.task[aria-busy="true"]',
		'.task[aria-busy="true"] .content',
		'.task[aria-busy="true"] .info .file',
		'.task[aria-busy="true"] .timeline .icon svg',
	].map((name) =>
		Object.freeze(
			name.endsWith("::after")
				? { name, selector: name.slice(0, -"::after".length), pseudo: "::after" }
				: { name, selector: name },
		),
	),
);

/** Computed properties whose values describe layout, text, decoration and SVG status icons. */
export const STYLE_PROPERTIES = Object.freeze([
	"color",
	"background-color",
	"background-image",
	"display",
	"visibility",
	"position",
	"padding",
	"margin",
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"line-height",
	"text-decoration-line",
	"text-align",
	"white-space",
	"border",
	"border-radius",
	"box-shadow",
	"outline",
	"width",
	"height",
	"opacity",
	"z-index",
	"cursor",
	"overflow",
	"flex-direction",
	"flex-wrap",
	"align-items",
	"justify-content",
	"stroke",
	"stroke-width",
	"content",
]);

/** These custom properties are recorded on .taskido only, where the timeline defines them. */
export const ROOT_CUSTOM_PROPERTIES = Object.freeze([
	"--taskido-color-warning",
	"--taskido-color-focus",
	"--taskido-color-focus-hsl",
	"--taskido-color-overdue",
	"--taskido-color-done",
	"--taskido-color-process",
]);

/** Self-contained for cli.evaluate: the caller settles the page, then sends this function's source and arguments. */
export function collectStyles({ container, probes, properties, rootCustomProperties }) {
	const parent = document.querySelector(container);
	if (!parent) throw new Error(`could not find the style container ${container}.`);
	const root = parent.querySelector(".taskido");
	if (!root) throw new Error(`could not find the .taskido root in ${container}.`);
	const record = {};
	for (const probe of probes) {
		const element = probe.selector === ".taskido" ? root : root.querySelector(probe.selector);
		if (!element) {
			record[probe.name] = null;
			continue;
		}
		const style = getComputedStyle(element, probe.pseudo ?? null);
		const names = probe.selector === ".taskido" ? [...properties, ...rootCustomProperties] : properties;
		record[probe.name] = Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
	}
	return record;
}

/** Sort both levels by code-unit order so collection order never changes the saved bytes. */
export function serializeStyles(record) {
	const sorted = Object.fromEntries(
		Object.keys(record)
			.sort()
			.map((probe) => [
				probe,
				record[probe] === null
					? null
					: Object.fromEntries(
							Object.keys(record[probe])
								.sort()
								.map((property) => [property, record[probe][property]]),
						),
			]),
	);
	return JSON.stringify(sorted, null, "\t") + "\n";
}

/** Every differing value, including absent probes or properties, in sorted probe and property order. */
export function compareStyles(base, candidate) {
	const differences = [];
	for (const probe of [...new Set([...Object.keys(base), ...Object.keys(candidate)])].sort()) {
		const before = Object.hasOwn(base, probe) ? base[probe] : undefined;
		const after = Object.hasOwn(candidate, probe) ? candidate[probe] : undefined;
		if (before == null || after == null) {
			if (before !== after) {
				const presence = (value) => (value === undefined ? "missing" : value === null ? null : "element");
				differences.push({ probe, property: null, base: presence(before), candidate: presence(after) });
			}
			continue;
		}
		for (const property of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
			const baseValue = Object.hasOwn(before, property) ? before[property] : null;
			const candidateValue = Object.hasOwn(after, property) ? after[property] : null;
			if (baseValue !== candidateValue)
				differences.push({ probe, property, base: baseValue, candidate: candidateValue });
		}
	}
	return differences;
}

/** A state-prefixed style difference, retaining empty strings and spelling out missing elements. */
export function formatStyleDifference(state, difference) {
	const { probe, property, base, candidate } = difference;
	return `${state} ${probe} ${property ?? "<element>"}: ${base} → ${candidate}`;
}

/** The repository-relative path, independent of the host platform's path separators. */
export function stylesFile(theme, state) {
	return `fixtures/screenshots/styles/${theme}/${state}.json`;
}

/** Compare only taken states, reporting missing or malformed baselines and every differing value. */
export function stylesBaselineProblems(taken, baselines) {
	const problems = [];
	for (const [state, actual] of taken) {
		const [theme, name] = state.split("/");
		const file = stylesFile(theme, name);
		const expected = baselines.get(state);
		if (expected === undefined) {
			problems.push(`${file} has no baseline; run \`pnpm screenshots --styles --update\` to record it.`);
			continue;
		}
		let baseline;
		try {
			baseline = JSON.parse(expected);
		} catch (error) {
			problems.push(`could not parse ${file} as JSON: ${error.message}`);
			continue;
		}
		if (expected === actual) continue;
		const differences = compareStyles(baseline, JSON.parse(actual));
		if (differences.length)
			problems.push(...differences.map((difference) => formatStyleDifference(state, difference)));
		else problems.push(`${file}: serialized fingerprint differs (property values match).`);
	}
	return problems;
}
