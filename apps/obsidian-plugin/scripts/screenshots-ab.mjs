/** Parses screenshot modes, compares the visible text, PNGs and styles of two builds, and formats their A/B report. */
import { comparePngs, decodePng, encodePng, screenshotVerdict } from "./png.mjs";
import { compareStyles, formatStyleDifference } from "./screenshots-styles.mjs";

/** Parses all options before checking their combinations, so unknown arguments are always reported first. */
export function parseScreenshotArgs(argv) {
	const values = {};
	const unknown = [];
	let update = false;
	let styles = false;
	let only;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--update") update = true;
		else if (arg === "--styles") styles = true;
		else if (arg === "--any-base") values[arg] = true;
		else if (arg.startsWith("--only=")) only ??= arg.slice("--only=".length);
		else {
			const name = ["--ab", "--candidate", "--report"].find(
				(option) => arg === option || arg.startsWith(`${option}=`),
			);
			if (!name) {
				unknown.push(arg);
				continue;
			}
			const inline = arg.startsWith(`${name}=`);
			const value = inline ? arg.slice(name.length + 1) : argv[i + 1];
			const missing = value === undefined || value === "" || value.startsWith("--");
			values[name] = missing ? null : value;
			if (!inline && !missing) i++;
		}
	}
	if (unknown.length)
		throw new Error(
			`unknown arguments ${JSON.stringify(unknown)}; use --update, --only=<text>, --styles, or --ab <ref> with --candidate <ref>, --report <file> and --any-base.`,
		);
	if (values["--ab"] === undefined) {
		const stray = ["--candidate", "--report", "--any-base"].filter((name) => values[name] !== undefined);
		if (stray.length) throw new Error(`${stray.join(", ")} only go with --ab <ref>.`);
	} else {
		if (values["--ab"] === null) throw new Error("--ab needs a git ref to compare against, such as --ab master.");
		if (values["--candidate"] === null) throw new Error("--candidate needs a git ref to build the candidate from.");
		if (values["--report"] === null) throw new Error("--report needs a file to write the report to.");
		if (update) throw new Error("--ab compares two builds and records no baseline; leave out --update.");
		if (styles) throw new Error("leave out --styles, --ab compares styles already.");
	}
	if (update && only) throw new Error("--only cannot be combined with --update, which replaces all screenshots.");
	const ab =
		values["--ab"] === undefined
			? null
			: {
					base: values["--ab"],
					candidate: values["--candidate"] ?? null,
					report: values["--report"] ?? null,
					allowOtherBase: values["--any-base"] === true,
				};
	return { mode: ab ? "ab" : styles ? "styles" : "screenshots", update, only: only ?? "", ab };
}

/** The first line where two texts differ, for the report. */
export function firstDifference(expected, actual) {
	const a = expected.split("\n");
	const b = actual.split("\n");
	const line = a.findIndex((text, i) => text !== b[i]);
	const at = line === -1 ? a.length : line;
	return `line ${at + 1}: ${JSON.stringify(a[at] ?? "(end)")} became ${JSON.stringify(b[at] ?? "(end)")}`;
}

/** Counts each probe/property pair once, including values present in only one arm. */
function styleValueCount(base, candidate) {
	let values = 0;
	for (const probe of new Set([...Object.keys(base), ...Object.keys(candidate)]))
		values += new Set([...Object.keys(base[probe] ?? {}), ...Object.keys(candidate[probe] ?? {})]).size;
	return values;
}

/** Compares every state and record kind taken by either arm, without reading or writing files. */
export function compareArms(base, candidate) {
	const comparison = {
		visible: { taken: 0, differences: [] },
		png: { taken: 0, same: 0, noise: 0, drift: 0, changed: [] },
		styles: { taken: 0, values: 0, differences: [] },
		onlyInOne: [],
		counts: { v: 0, p: 0, s: 0 },
	};
	for (const state of [...new Set([...base.keys(), ...candidate.keys()])].sort()) {
		const before = base.get(state);
		const after = candidate.get(state);
		const missingState = before === undefined || after === undefined;
		if (missingState)
			comparison.onlyInOne.push({ state, arm: before === undefined ? "candidate" : "base", what: "state" });
		for (const [kind, count] of [
			["visible", "v"],
			["png", "p"],
			["styles", "s"],
		]) {
			const a = before?.[kind] ?? null;
			const b = after?.[kind] ?? null;
			if (a === null && b === null) continue;
			comparison[kind].taken++;
			const baseStyles = kind === "styles" && a !== null ? JSON.parse(a) : {};
			const candidateStyles = kind === "styles" && b !== null ? JSON.parse(b) : {};
			if (kind === "styles") comparison.styles.values += styleValueCount(baseStyles, candidateStyles);
			if (a === null || b === null) {
				if (!missingState)
					comparison.onlyInOne.push({ state, arm: a === null ? "candidate" : "base", what: kind });
				comparison.counts[count]++;
				continue;
			}
			if (kind === "visible" && a !== b) {
				comparison.visible.differences.push({ state, detail: firstDifference(a, b) });
				comparison.counts.v++;
			} else if (kind === "png") {
				const expected = decodePng(a);
				const actual = decodePng(b);
				const result = comparePngs(expected, actual);
				const verdict = screenshotVerdict(result);
				if (verdict === "changed") {
					const size = result.sameSize
						? ""
						: ` (${expected.width}×${expected.height} → ${actual.width}×${actual.height})`;
					const detail = `${result.differing} of ${result.total} pixels differ, by up to ${result.maxDelta} (${((100 * result.differing) / result.total).toFixed(2)} %)${size}`;
					comparison.png.changed.push({ state, detail, diff: result.diff ? encodePng(result.diff) : null });
					comparison.counts.p++;
				} else comparison.png[verdict]++;
			} else if (kind === "styles" && a !== b) {
				const prefix = `${state.split("-")[0]}/${state}`;
				const lines = compareStyles(baseStyles, candidateStyles).map((difference) =>
					formatStyleDifference(prefix, difference),
				);
				// Equal parsed values still fail the byte-for-byte fingerprint check.
				if (!lines.length) lines.push(`${prefix} serialized fingerprint: ${firstDifference(a, b)}`);
				comparison.styles.differences.push({ state, lines });
				comparison.counts.s++;
			}
		}
	}
	return comparison;
}

/** The A/B passes only when all three categories have no differences. */
export function abExitCode(comparison) {
	const { v, p, s } = comparison.counts;
	return v === 0 && p === 0 && s === 0 ? 0 : 1;
}

/** Describes the builds, environment and every difference, ending with the combined V P S result. */
export function abReport({ builds, env, workDir, comparison }) {
	const { visible, png, styles, onlyInOne, counts } = comparison;
	const lines = ["# Screenshot A/B", ""];
	for (const arm of ["base", "candidate"]) {
		const build = builds[arm];
		lines.push(
			`- ${arm}: ${build.ref} (${build.commit})${build.uncommittedChanges ? "; uncommitted changes" : ""}`,
			`  - mainJsSha256: ${build.mainJsSha256}`,
			`  - stylesCssSha256: ${build.stylesCssSha256}`,
		);
	}
	if (
		builds.base.mainJsSha256 === builds.candidate.mainJsSha256 &&
		builds.base.stylesCssSha256 === builds.candidate.stylesCssSha256
	)
		lines.push("", "identical builds");
	lines.push(
		"",
		"## Environment",
		"",
		"```json",
		JSON.stringify(env, null, "\t"),
		"```",
		"",
		`Arm files: ${workDir}`,
		"",
		`V: ${visible.taken} light states, ${counts.v} differ`,
		`P: ${png.taken} PNGs: same ${png.same}, noise ${png.noise}, drift ${png.drift}, changed ${counts.p}`,
		`S: ${styles.taken} fingerprints (${styles.values} values), ${counts.s} differ`,
	);
	const differences = [
		...onlyInOne.map(({ state, arm, what }) => `${state}: ${what} taken only by ${arm}`),
		...visible.differences.map(({ state, detail }) => `V ${state}: ${detail}`),
		...png.changed.map(({ state, detail }) => `P ${state}: ${detail}`),
		...styles.differences.flatMap(({ lines }) => lines),
	];
	if (differences.length) lines.push("", "## Differences", "", ...differences.map((line) => `- ${line}`));
	lines.push(
		"",
		abExitCode(comparison) === 0
			? "V P S: no differences"
			: `V P S: ${counts.v} / ${counts.p} / ${counts.s} differences`,
	);
	return lines.join("\n") + "\n";
}
