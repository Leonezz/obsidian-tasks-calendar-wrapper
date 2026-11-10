/** Pins the mobile measurement/profile contract and the unchanged desktop screenshot plans. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseScreenshotArgs, type ScreenshotArgs } from "../scripts/screenshots-ab.mjs";
import {
	MOBILE_STATES,
	MOBILE_WIDTH,
	TOUCH_TARGETS,
	mobilePlan,
	touchTargetProblems,
	formatTouchTargetReport,
	type MobileShot,
	type TouchTargetMeasurement,
	type TouchTargetProblem,
} from "../scripts/screenshots-mobile.mjs";
import { THEMES, plan, themeOfState } from "../scripts/screenshots-themes.mjs";

const states = [
	"mobile-light-today-all-days-no-counter",
	"mobile-light-today-today-focus-no-counter",
	"mobile-light-today-all-days-todo-filter",
	"mobile-light-today-all-days-overdue-filter",
	"mobile-light-today-all-days-unplanned-filter",
	"mobile-light-top-all-days-no-counter",
	"mobile-light-bottom-all-days-no-counter",
];
const stateName = states[0];

function measurements(): TouchTargetMeasurement[] {
	return TOUCH_TARGETS.map(({ name }) => ({ target: name, index: 1, width: 44, height: 44, hit: true }));
}

function measuredProblem(measurement: TouchTargetMeasurement, reason: "size" | "covered"): TouchTargetProblem {
	const { target, index, width, height } = measurement;
	return { state: stateName, target, index, width, height, reason };
}

function desktopPlans(): void {
	for (const themes of ["default", "all"] as const) {
		const pngCount = themes === "default" ? 84 : 168;
		const styleCount = themes === "default" ? 86 : 172;
		for (const mode of ["screenshots", "styles", "ab"] as const) {
			const shots = plan("", mode, themes).flatMap((group) => group.shots);
			assert.equal(shots.length, mode === "screenshots" ? pngCount : styleCount);
			assert.equal(shots.filter(({ png }) => png).length, mode === "styles" ? 0 : pngCount);
			assert.equal(shots.filter(({ visible }) => visible).length, mode === "styles" ? 0 : 42);
			assert.equal(shots.filter(({ styles }) => styles).length, mode === "screenshots" ? 0 : styleCount);
			assert.ok(shots.every(({ name }) => !name.startsWith("mobile-")));
			assert.equal(new Set(shots.map(({ name }) => name)).size, shots.length);
		}
	}
	for (const name of states) assert.throws(() => themeOfState(name), { name: "Error" });
}

function profileError(args: readonly string[], words: readonly string[]): void {
	assert.throws(
		() => parseScreenshotArgs(args),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.doesNotMatch(error.message, /[\r\n]/);
			for (const word of words) assert.ok(error.message.includes(word), `${error.message} must name ${word}`);
			return true;
		},
	);
}

function desktopArgs(): void {
	const defaults: Omit<ScreenshotArgs, "profile"> = {
		mode: "screenshots",
		update: false,
		only: "",
		ab: null,
		themes: "default",
	};
	const cases: { args: string[]; changes: Partial<ScreenshotArgs> }[] = [
		{ args: [], changes: {} },
		{ args: ["--update"], changes: { update: true } },
		{ args: ["--only=light"], changes: { only: "light" } },
		{ args: ["--themes=default"], changes: {} },
		{ args: ["--themes=all"], changes: { themes: "all" } },
		{ args: ["--styles", "--only=dark"], changes: { mode: "styles", only: "dark" } },
		{ args: ["--styles", "--themes=all", "--update"], changes: { mode: "styles", themes: "all", update: true } },
		{
			args: ["--ab=master"],
			changes: { mode: "ab", ab: { base: "master", candidate: null, report: null, allowOtherBase: false } },
		},
		{
			args: [
				"--ab",
				"master",
				"--candidate=other",
				"--report=out.md",
				"--any-base",
				"--themes=all",
				"--only=top",
			],
			changes: {
				mode: "ab",
				ab: { base: "master", candidate: "other", report: "out.md", allowOtherBase: true },
				themes: "all",
				only: "top",
			},
		},
		{ args: ["--pin-theme"], changes: { mode: "pin-theme" } },
	];
	// A desktop run parses to exactly today's object; only a mobile run carries a profile.
	for (const { args, changes } of cases)
		for (const prefix of [[], ["--profile=desktop"]])
			assert.deepEqual(parseScreenshotArgs([...prefix, ...args]), { ...defaults, ...changes });
	for (const prefix of [[], ["--profile=desktop"]])
		assert.throws(() => parseScreenshotArgs([...prefix, "--only=light", "--update"]), {
			message: "--only cannot be combined with --update, which replaces all screenshots.",
		});
}

test("a target below 44 px in either dimension fails the mobile profile", () => {
	for (const [width, height] of [
		[43, 60],
		[60, 43],
	]) {
		const values = measurements();
		values[0] = { ...values[0], width, height };
		assert.deepEqual(touchTargetProblems(stateName, values), [measuredProblem(values[0], "size")]);
	}
	assert.deepEqual(touchTargetProblems(stateName, measurements()), []);
	const large = measurements().map((value) => ({ ...value, width: 48, height: 48 }));
	assert.deepEqual(touchTargetProblems(stateName, large, 48), []);
	large[0].height = 47;
	assert.deepEqual(touchTargetProblems(stateName, large, 48), [measuredProblem(large[0], "size")]);
});

test("a target covered at its centre fails", () => {
	const values = measurements();
	values[0].hit = false;
	assert.deepEqual(touchTargetProblems(stateName, values), [measuredProblem(values[0], "covered")]);
	values[0].width = 43;
	assert.deepEqual(touchTargetProblems(stateName, values), [
		measuredProblem(values[0], "size"),
		measuredProblem(values[0], "covered"),
	]);
});

test("a required target with no element fails, a missing ✏️ does not", () => {
	assert.deepEqual(
		TOUCH_TARGETS.filter(({ required }) => required).map(({ selector }) => selector),
		[
			".task .timeline label.icon",
			".task a.menu",
			".counter",
			".todayHeader",
			".quickEntryPanel select",
			".quickEntryPanel input",
			".quickEntryPanel button",
		],
	);
	assert.deepEqual(
		TOUCH_TARGETS.filter(({ required }) => !required).map(({ selector }) => selector),
		[".task a.modify", ".task .info > :is(.tag, .relative, .repeat, .priority, .file)", ".tagFilterBar input"],
	);
	assert.equal(new Set(TOUCH_TARGETS.map(({ name }) => name)).size, TOUCH_TARGETS.length);
	for (const { name, required } of TOUCH_TARGETS) {
		const values = measurements().filter(({ target }) => target !== name);
		assert.deepEqual(
			touchTargetProblems(stateName, values),
			required ? [{ state: stateName, target: name, reason: "missing" }] : [],
		);
	}
	assert.deepEqual(
		touchTargetProblems(stateName, []),
		TOUCH_TARGETS.filter(({ required }) => required).map(({ name }) => ({
			state: stateName,
			target: name,
			reason: "missing",
		})),
	);
});

test("the mobile plan is 7 light states at 390 px with distinct names outside the desktop plan", () => {
	desktopPlans();
	assert.equal(MOBILE_WIDTH, 390);
	assert.deepEqual(MOBILE_STATES, states);
	assert.deepEqual(THEMES.light, { base: "moonstone", cssTheme: "" });
	const settings: [MobileShot["position"], boolean, MobileShot["counter"]][] = [
		["today", false, "none"],
		["today", true, "none"],
		["today", false, "todo"],
		["today", false, "overdue"],
		["today", false, "unplanned"],
		["top", false, "none"],
		["bottom", false, "none"],
	];
	const expected = settings.map(([position, todayFocus, counter], index) => ({
		name: states[index],
		theme: "light",
		position,
		todayFocus,
		counter,
		behavior: counter === "none" ? null : "Filter",
	}));
	assert.deepEqual(mobilePlan(), expected);
	assert.deepEqual(mobilePlan(""), expected);
	assert.equal(new Set(mobilePlan().map(({ name }) => name)).size, 7);
	for (const only of ["today-focus", "-filter", "bottom", "absent"])
		assert.deepEqual(
			mobilePlan(only),
			expected.filter(({ name }) => name.includes(only)),
		);
});

test("--profile takes desktop or mobile, and mobile refuses --ab, --styles, --themes=all and --pin-theme", () => {
	const mobile = { mode: "screenshots", update: false, only: "", ab: null, themes: "default", profile: "mobile" };
	assert.deepEqual(parseScreenshotArgs(["--profile=mobile"]), mobile);
	for (const args of [
		["--only=top"],
		["--update"],
		["--only=top", "--update"],
		["--themes=default"],
		["--profile=mobile"],
	])
		assert.deepEqual(parseScreenshotArgs(["--profile=mobile", ...args]), {
			...mobile,
			update: args.includes("--update"),
			only: args.includes("--only=top") ? "top" : "",
		});
	for (const option of ["--ab=master", "--styles", "--themes=all", "--pin-theme"])
		for (const args of [
			["--profile=mobile", option],
			[option, "--profile=mobile"],
		])
			profileError(args, ["mobile", option.split("=")[0]]);
	for (const args of [
		["--profile="],
		["--profile=tablet"],
		["--profile=desktop", "--profile=mobile"],
		["--profile=mobile", "--profile=desktop"],
	])
		profileError(args, ["--profile", "desktop", "mobile"]);
	desktopArgs();
});

test("the problem report names the state, target, index and size", () => {
	const problems: TouchTargetProblem[] = [
		{ state: stateName, target: "row menu", index: 2, width: 43, height: 60, reason: "size" },
		{ state: states[1], target: "badge", index: 3, width: 44, height: 44, reason: "covered" },
		{ state: states[2], target: "counter", reason: "missing" },
	];
	assert.deepEqual(formatTouchTargetReport(problems), {
		lines: [
			`${stateName}: row menu #2 is 43×60 px, below 44`,
			`${states[1]}: badge #3 is covered by another element at its centre or an edge`,
			`${states[2]}: counter has no rendered element (required)`,
			"Mobile touch targets: 3 problems.",
		],
		exitCode: 1,
	});
	assert.deepEqual(formatTouchTargetReport([]), { lines: ["Mobile touch targets: 0 problems."], exitCode: 0 });
	assert.deepEqual(formatTouchTargetReport([problems[0]], 48), {
		lines: [`${stateName}: row menu #2 is 43×60 px, below 48`, "Mobile touch targets: 1 problem."],
		exitCode: 1,
	});
});
