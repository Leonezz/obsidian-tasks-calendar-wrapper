import { test } from "node:test";
import assert from "node:assert/strict";

import {
	abExitCode,
	abReport,
	compareArms,
	firstDifference,
	parseScreenshotArgs,
	type AbBuildInfo,
	type AbComparison,
	type ArmState,
	type ArmStates,
} from "../scripts/screenshots-ab.mjs";
import { serializeStyles } from "../scripts/screenshots-styles.mjs";
import { decodePng, DRIFT_DELTA, encodePng, NOISE_DELTA, NOISE_PIXELS, type Image } from "../scripts/png.mjs";

/** A state with only the records the test takes. */
function state(records: Partial<ArmState>): ArmState {
	return { visible: null, png: null, styles: null, ...records };
}

/** An opaque gray image, optionally changing the red channel at selected pixels. */
function image(width: number, height: number, delta = 0, pixels?: readonly number[]): Image {
	const data = Buffer.alloc(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel++) data.set([100, 100, 100, 255], pixel * 4);
	for (const pixel of pixels ?? Array.from({ length: width * height }, (_, i) => i)) data[pixel * 4] += delta;
	return { width, height, data };
}

const builds: { base: AbBuildInfo; candidate: AbBuildInfo } = {
	base: {
		ref: "master",
		commit: "a".repeat(40),
		mainJsSha256: "1".repeat(64),
		stylesCssSha256: "2".repeat(64),
	},
	candidate: {
		ref: "working tree",
		commit: "b".repeat(40),
		mainJsSha256: "3".repeat(64),
		stylesCssSha256: "4".repeat(64),
		uncommittedChanges: true,
	},
};

function report(comparison: AbComparison): string {
	return abReport({ builds, env: { obsidianVersion: "1.14.4" }, workDir: "/tmp/screenshots-ab", comparison });
}

function lastLine(text: string): string {
	const lines = text.trimEnd().split("\n");
	return lines[lines.length - 1];
}

test("--ab needs a ref", () => {
	for (const args of [["--ab"], ["--ab="], ["--ab", "--update"]])
		assert.throws(() => parseScreenshotArgs(args), {
			name: "Error",
			message: "--ab needs a git ref to compare against, such as --ab master.",
		});
	for (const args of [["--ab", "master"], ["--ab=master"]])
		assert.deepEqual(parseScreenshotArgs(args), {
			mode: "ab",
			update: false,
			only: "",
			ab: { base: "master", candidate: null, report: null, allowOtherBase: false },
		});
});

test("--update cannot be combined with --ab", () => {
	for (const args of [
		["--ab", "master", "--update"],
		["--update", "--ab=master"],
		["--ab=master", "--styles", "--only=light", "--update"],
	])
		assert.throws(() => parseScreenshotArgs(args), {
			name: "Error",
			message: "--ab compares two builds and records no baseline; leave out --update.",
		});
	assert.deepEqual(parseScreenshotArgs(["--update"]), {
		mode: "screenshots",
		update: true,
		only: "",
		ab: null,
	});
});

test("--candidate, --report and --any-base only go with --ab", () => {
	for (const [args, stray] of [
		[["--candidate", "other"], "--candidate"],
		[["--report=report.md"], "--report"],
		[["--any-base"], "--any-base"],
		[
			["--candidate=other", "--report", "report.md", "--any-base", "--update", "--only=light"],
			"--candidate, --report, --any-base",
		],
	] as const)
		assert.throws(() => parseScreenshotArgs(args), {
			name: "Error",
			message: `${stray} only go with --ab <ref>.`,
		});
	for (const [option, message] of [
		["--candidate", "--candidate needs a git ref to build the candidate from."],
		["--report", "--report needs a file to write the report to."],
	])
		for (const args of [
			["--ab=master", option],
			["--ab=master", `${option}=`],
			["--ab=master", option, "--update"],
		])
			assert.throws(() => parseScreenshotArgs(args), { name: "Error", message });
	for (const args of [
		["--ab", "master", "--candidate", "other", "--report", "report.md", "--any-base", "--only=light"],
		["--ab=master", "--candidate=other", "--report=report.md", "--any-base", "--only=light"],
	])
		assert.deepEqual(parseScreenshotArgs(args), {
			mode: "ab",
			update: false,
			only: "light",
			ab: { base: "master", candidate: "other", report: "report.md", allowOtherBase: true },
		});
});

test("--styles is redundant with --ab", () => {
	for (const args of [
		["--styles", "--ab", "master"],
		["--ab=master", "--styles"],
	])
		assert.throws(() => parseScreenshotArgs(args), {
			name: "Error",
			message: "leave out --styles, --ab compares styles already.",
		});
	assert.deepEqual(parseScreenshotArgs(["--styles"]), { mode: "styles", update: false, only: "", ab: null });
	assert.deepEqual(parseScreenshotArgs(["--styles", "--update"]), {
		mode: "styles",
		update: true,
		only: "",
		ab: null,
	});
});

test("--only cannot be combined with --update", () => {
	for (const args of [
		["--only=light", "--update"],
		["--styles", "--update", "--only=dark"],
	])
		assert.throws(() => parseScreenshotArgs(args), {
			name: "Error",
			message: "--only cannot be combined with --update, which replaces all screenshots.",
		});
	assert.deepEqual(parseScreenshotArgs(["--only=light"]), {
		mode: "screenshots",
		update: false,
		only: "light",
		ab: null,
	});
	assert.deepEqual(parseScreenshotArgs(["--styles", "--only=dark"]), {
		mode: "styles",
		update: false,
		only: "dark",
		ab: null,
	});
});

test("an unknown argument is an error", () => {
	for (const [args, unknown] of [
		[
			["--unknown", "extra"],
			["--unknown", "extra"],
		],
		[
			["--only", "light"],
			["--only", "light"],
		],
		[["--unknown", "--ab"], ["--unknown"]],
		[["--candidate", "other", "--unknown"], ["--unknown"]],
		[["--ab=master", "--update", "--unknown"], ["--unknown"]],
	] as const)
		assert.throws(() => parseScreenshotArgs(args), {
			name: "Error",
			message: `unknown arguments ${JSON.stringify(unknown)}; use --update, --only=<text>, --styles, or --ab <ref> with --candidate <ref>, --report <file> and --any-base.`,
		});
	assert.deepEqual(parseScreenshotArgs([]), { mode: "screenshots", update: false, only: "", ab: null });
});

test("identical visible text, PNGs and styles report no differences and exit 0", () => {
	const png = encodePng(image(2, 2));
	const styles = serializeStyles({
		".taskido": { color: "rgb(100, 100, 100)", opacity: "1" },
		".task .modify": null,
	});
	const base: ArmStates = new Map([
		["light-today", state({ visible: "Today\nA task\n", png, styles })],
		["dark-today", state({ png, styles })],
		["light-row-dimmed", state({ styles })],
	]);
	const candidate: ArmStates = new Map(
		[...base].map(([name, taken]) => [name, { ...taken, png: taken.png && Buffer.from(taken.png) }]),
	);
	const comparison = compareArms(base, candidate);
	assert.deepEqual(comparison, {
		visible: { taken: 1, differences: [] },
		png: { taken: 2, same: 2, noise: 0, drift: 0, changed: [] },
		styles: { taken: 3, values: 6, differences: [] },
		onlyInOne: [],
		counts: { v: 0, p: 0, s: 0 },
	});
	assert.equal(abExitCode(comparison), 0);
	const text = report(comparison);
	for (const line of [
		"V: 1 light states, 0 differ",
		"P: 2 PNGs: same 2, noise 0, drift 0, changed 0",
		"S: 3 fingerprints (6 values), 0 differ",
	])
		assert.ok(text.includes(line), line);
	assert.equal(lastLine(text), "V P S: no differences");
});

test("a visible line that differs is reported with its first difference", () => {
	const base = new Map([["light-today", state({ visible: "Today\nFirst task\nLast task\n" })]]);
	const candidate = new Map([["light-today", state({ visible: "Today\nChanged task\nAlso changed\n" })]]);
	const comparison = compareArms(base, candidate);
	const detail = 'line 2: "First task" became "Changed task"';
	assert.deepEqual(comparison.visible, { taken: 1, differences: [{ state: "light-today", detail }] });
	assert.deepEqual(comparison.counts, { v: 1, p: 0, s: 0 });
	assert.equal(abExitCode(comparison), 1);
	assert.equal(firstDifference("one\ntwo", "one\nthree"), 'line 2: "two" became "three"');
	assert.equal(firstDifference("one", "one\ntwo"), 'line 2: "(end)" became "two"');
	assert.equal(firstDifference("one\ntwo", "one"), 'line 2: "two" became "(end)"');
	assert.ok(report(comparison).includes(detail));
	assert.equal(lastLine(report(comparison)), "V P S: 1 / 0 / 0 differences");
});

test("noise and drift PNGs count as the same; a changed PNG is a difference", () => {
	const width = NOISE_PIXELS + 1;
	const original = encodePng(image(width, 2));
	const changedPixels = Array.from({ length: 32 }, (_, i) => Math.floor(i / 16) * width + (i % 16));
	const variants = new Map([
		["same", original],
		[
			"noise",
			encodePng(
				image(
					width,
					2,
					NOISE_DELTA,
					Array.from({ length: NOISE_PIXELS }, (_, i) => i),
				),
			),
		],
		["drift", encodePng(image(width, 2, DRIFT_DELTA))],
		["changed", encodePng(image(width, 2, 100, changedPixels))],
	]);
	const base: ArmStates = new Map([...variants.keys()].map((name) => [name, state({ png: original })]));
	const candidate: ArmStates = new Map([...variants].map(([name, png]) => [name, state({ png })]));
	const comparison = compareArms(base, candidate);
	assert.deepEqual(
		[comparison.png.taken, comparison.png.same, comparison.png.noise, comparison.png.drift],
		[4, 1, 1, 1],
	);
	assert.equal(comparison.png.changed.length, 1);
	const changed = comparison.png.changed[0];
	assert.equal(changed.state, "changed");
	assert.equal(
		changed.detail,
		`32 of ${width * 2} pixels differ, by up to 100 (${((100 * 32) / (width * 2)).toFixed(2)} %)`,
	);
	assert.ok(changed.diff);
	const diff = decodePng(changed.diff);
	assert.deepEqual([diff.width, diff.height], [width, 2]);
	assert.deepEqual([...diff.data.subarray(0, 4)], [255, 0, 0, 255]);
	assert.deepEqual(comparison.counts, { v: 0, p: 1, s: 0 });
	assert.equal(abExitCode(comparison), 1);
	const passingNames = ["same", "noise", "drift"];
	const passing = compareArms(
		new Map(passingNames.map((name) => [name, base.get(name)!])),
		new Map(passingNames.map((name) => [name, candidate.get(name)!])),
	);
	assert.deepEqual(passing.counts, { v: 0, p: 0, s: 0 });
	assert.equal(abExitCode(passing), 0);
	const resized = compareArms(
		new Map([["size", state({ png: encodePng(image(2, 2)) })]]),
		new Map([["size", state({ png: encodePng(image(2, 3)) })]]),
	);
	assert.equal(resized.png.changed[0].detail, "2 of 6 pixels differ, by up to 255 (33.33 %) (2×2 → 2×3)");
	assert.equal(abExitCode(resized), 1);
	assert.ok(report(comparison).includes("P: 4 PNGs: same 1, noise 1, drift 1, changed 1"));
	assert.ok(report(comparison).includes(changed.state));
	assert.ok(report(comparison).includes(changed.detail));
	assert.equal(lastLine(report(comparison)), "V P S: 0 / 1 / 0 differences");
});

test("a state taken by one arm only is a difference", () => {
	const taken = state({
		visible: "A task\n",
		png: encodePng(image(2, 2)),
		styles: serializeStyles({ ".taskido": { color: "red" } }),
	});
	for (const arm of ["base", "candidate"] as const) {
		const present: ArmStates = new Map([["light-only", taken]]);
		const absent: ArmStates = new Map();
		const comparison = compareArms(arm === "base" ? present : absent, arm === "candidate" ? present : absent);
		assert.deepEqual(comparison.onlyInOne, [{ state: "light-only", arm, what: "state" }]);
		assert.deepEqual(comparison.counts, { v: 1, p: 1, s: 1 });
		assert.deepEqual(
			[comparison.visible.taken, comparison.png.taken, comparison.styles.taken, comparison.styles.values],
			[1, 1, 1, 1],
		);
		assert.equal(abExitCode(comparison), 1);
		const text = report(comparison);
		assert.ok(text.includes("light-only"));
		assert.ok(text.includes(arm));
		assert.ok(text.includes("P: 1 PNGs: same 0, noise 0, drift 0, changed 1"));
		assert.equal(lastLine(text), "V P S: 1 / 1 / 1 differences");
		for (const [kind, counts] of [
			["visible", { v: 1, p: 0, s: 0 }],
			["png", { v: 0, p: 1, s: 0 }],
			["styles", { v: 0, p: 0, s: 1 }],
		] as const) {
			const missingKind = new Map([["light-only", { ...taken, [kind]: null }]]);
			const compared = compareArms(
				arm === "base" ? present : missingKind,
				arm === "candidate" ? present : missingKind,
			);
			assert.deepEqual(compared.onlyInOne, [{ state: "light-only", arm, what: kind }]);
			assert.deepEqual(compared.counts, counts);
			assert.equal(abExitCode(compared), 1);
		}
	}
});

test("a style difference fails the A/B", () => {
	const base = new Map([
		["light-today", state({ styles: serializeStyles({ ".year": { color: "red", opacity: "1" } }) })],
	]);
	const candidate = new Map([
		["light-today", state({ styles: serializeStyles({ ".year": { color: "blue", opacity: "1" } }) })],
	]);
	const comparison = compareArms(base, candidate);
	assert.deepEqual(comparison.counts, { v: 0, p: 0, s: 1 });
	assert.equal(abExitCode(comparison), 1);
	const line = "light/light-today .year color: red → blue";
	assert.deepEqual(comparison.styles, {
		taken: 1,
		values: 2,
		differences: [{ state: "light-today", lines: [line] }],
	});
	const text = report(comparison);
	assert.ok(text.includes(line));
	assert.ok(text.includes("S: 1 fingerprints (2 values), 1 differ"));
	assert.equal(lastLine(text), "V P S: 0 / 0 / 1 differences");
});

test("the report names both builds and says when they are identical", () => {
	const comparison = compareArms(new Map(), new Map());
	const env = { obsidianVersion: "1.14.4", appearance: { theme: "moonstone", fontSize: 16 } };
	const workDir = "/tmp/tcw-screenshots-ab-test";
	const text = abReport({ builds, env, workDir, comparison });
	for (const build of Object.values(builds))
		for (const name of ["ref", "commit", "mainJsSha256", "stylesCssSha256"] as const)
			assert.ok(text.includes(build[name]), name);
	assert.ok(text.includes(workDir));
	const environment = text.match(/```json\n([\s\S]*?)\n```/);
	assert.ok(environment, "the environment is in a JSON code block");
	assert.deepEqual(JSON.parse(environment[1]), env);
	assert.equal(lastLine(text), "V P S: no differences");
	assert.ok(!text.includes("identical builds"));
	const identical = {
		...builds,
		candidate: {
			...builds.candidate,
			mainJsSha256: builds.base.mainJsSha256,
			stylesCssSha256: builds.base.stylesCssSha256,
		},
	};
	assert.ok(abReport({ builds: identical, env, workDir, comparison }).includes("identical builds"));
	for (const key of ["mainJsSha256", "stylesCssSha256"] as const) {
		const different = { ...identical, candidate: { ...identical.candidate, [key]: builds.candidate[key] } };
		assert.ok(!abReport({ builds: different, env, workDir, comparison }).includes("identical builds"), key);
	}
});
