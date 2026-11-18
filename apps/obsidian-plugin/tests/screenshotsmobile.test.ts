/** Pins the mobile measurement/profile contract and the unchanged desktop screenshot plans. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

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
import { cropPng, decodePng, encodePng, type Image } from "../scripts/png.mjs";

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
			".quickEntryPanel select",
			".quickEntryPanel input",
			".quickEntryPanel button",
			".quickFilterBar select",
			".todayHeader",
			".tagFilterBar input",
			".priorityFilter summary",
		],
	);
	assert.deepEqual(
		TOUCH_TARGETS.filter(({ required }) => !required).map(({ selector }) => selector),
		[
			".task a.modify",
			".task .info > :is(.tag, .relative, .repeat, .priority, .file)",
			".priorityOptions label",
			".dateRange input",
			".applyDateRange",
			".clearFilters",
		],
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

// Importing screenshots.mjs would run its native entry point. Execute its actual function declarations instead.
const screenshotSource = ts.createSourceFile(
	"scripts/screenshots.mjs",
	readFileSync("scripts/screenshots.mjs", "utf8"),
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.JS,
);

function declaration(name: string, source = screenshotSource): string {
	let found: ts.FunctionDeclaration | undefined;
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
		ts.forEachChild(node, visit);
	};
	visit(source);
	assert.ok(found, `${source.fileName} must contain ${name}`);
	return found.getText(source).replace(/^export /u, "");
}

type CaptureViewport = { width: number; height: number; devicePixelRatio: number };
type CaptureBox = {
	x: number;
	y: number;
	width: number;
	height: number;
	scrollHeight: number;
	clientHeight: number;
	below: number;
	viewport: CaptureViewport;
};
type CaptureCli = {
	cdp(method: string, params: Record<string, unknown>): { data?: string };
	evaluate(fn: unknown, argument: { action: string; viewType: string }): CaptureBox;
};
type Viewport = (cli: CaptureCli, height: number) => CaptureBox;

function numericScreenshotConstants(): Record<string, number> {
	const constants: Record<string, number> = {};
	for (const statement of screenshotSource.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const item of statement.declarationList.declarations) {
			if (ts.isIdentifier(item.name) && item.initializer && ts.isNumericLiteral(item.initializer))
				constants[item.name.text] = Number(item.initializer.text);
		}
	}
	return constants;
}

function capturePipeline(
	options: {
		box?: (width: number, height: number, read: number) => Partial<CaptureBox>;
		metrics?: Partial<CaptureViewport>;
		pngSize?: { width: number; height: number };
		missingData?: boolean;
	} = {},
) {
	const constants = numericScreenshotConstants();
	const events: string[] = [];
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	let width = 0;
	let height = 0;
	let reads = 0;
	let surface: Image | undefined;
	const cli: CaptureCli = {
		cdp(method, params) {
			calls.push({ method, params: JSON.parse(JSON.stringify(params)) as Record<string, unknown> });
			if (method === "Emulation.setDeviceMetricsOverride") {
				width = Number(params.width);
				height = Number(params.height);
				events.push(`resize:${width}x${height}`);
				return {};
			}
			assert.equal(method, "Page.captureScreenshot");
			events.push("screenshot");
			if (options.missingData) return {};
			const size = options.pngSize ?? { width, height };
			const data = Buffer.alloc(size.width * size.height * 4);
			for (let y = 0; y < size.height; y++) {
				for (let x = 0; x < size.width; x++)
					data.set([x % 256, y % 256, (x + y) % 256, 255], (y * size.width + x) * 4);
			}
			surface = { ...size, data };
			return { data: encodePng(surface).toString("base64") };
		},
		evaluate(_fn, argument) {
			assert.deepEqual(argument.action, "measure");
			assert.equal(argument.viewType, "tasks_timeline_view");
			events.push("measure");
			return {
				x: 1.4,
				y: 2.6,
				width: 4.4,
				height: 3.4,
				scrollHeight: 3,
				clientHeight: 3,
				below: height - 6,
				viewport: { width, height, devicePixelRatio: 1, ...options.metrics },
				...options.box?.(width, height, ++reads),
			};
		},
	};
	const functions = runInNewContext(
		`${declaration("setViewport")}\n${declaration("setMobileViewport")}\n${declaration("capture")}\n({ capture, setMobileViewport })`,
		{
			...constants,
			MOBILE_WIDTH,
			Buffer,
			cropPng,
			ScriptError: Error,
			timeline: () => {},
			TIMELINE_VIEW: "tasks_timeline_view",
		},
	) as {
		capture(cli: CaptureCli, viewport?: Viewport, beforeScreenshot?: () => void): Buffer;
		setMobileViewport: Viewport;
	};
	return { ...functions, cli, events, calls, surface: () => surface };
}

test("the actual timeline measurement includes the current CSS viewport and DPR", () => {
	const box = runInNewContext(`(${declaration("measure")})()`, {
		content: () => ({
			getBoundingClientRect: () => ({ left: 5, top: 7, width: 370, height: 740, bottom: 747 }),
			scrollHeight: 740,
			clientHeight: 740,
		}),
		innerWidth: 390,
		innerHeight: 800,
		devicePixelRatio: 1,
	}) as CaptureBox;
	assert.deepEqual(JSON.parse(JSON.stringify(box.viewport)), { width: 390, height: 800, devicePixelRatio: 1 });
	assert.equal(box.below, 53);
});

test("the actual capture takes one full surface without a clip and crops the original rounded timeline box", () => {
	const pipeline = capturePipeline();
	const actual = decodePng(pipeline.capture(pipeline.cli));
	assert.deepEqual(pipeline.events, ["resize:600x600", "measure", "screenshot"]);
	assert.deepEqual(
		pipeline.calls.filter(({ method }) => method === "Page.captureScreenshot"),
		[
			{
				method: "Page.captureScreenshot",
				params: { format: "png", fromSurface: true, captureBeyondViewport: false },
			},
		],
	);
	assert.equal(actual.width, 4);
	assert.equal(actual.height, 3);
	const surface = pipeline.surface()!;
	for (let y = 0; y < actual.height; y++)
		assert.deepEqual(
			actual.data.subarray(y * 16, (y + 1) * 16),
			surface.data.subarray(((y + 3) * 600 + 1) * 4, ((y + 3) * 600 + 5) * 4),
		);
});

test("capture grows the viewport before the single canonical image and uses its final dimensions", () => {
	const pipeline = capturePipeline({
		box: (_width, height) => ({ height: height - 12, scrollHeight: 650, clientHeight: height - 12, below: 9.4 }),
	});
	const png = pipeline.capture(pipeline.cli, undefined, () => pipeline.events.push("hook"));
	assert.deepEqual(pipeline.events, ["resize:600x600", "measure", "resize:600x662", "measure", "hook", "screenshot"]);
	assert.equal(decodePng(png).height, 650);
});

test("the mobile custom viewport and touch hook use the same once-only capture path", () => {
	const pipeline = capturePipeline();
	pipeline.capture(pipeline.cli, pipeline.setMobileViewport, () => pipeline.events.push("touch-targets"));
	assert.deepEqual(pipeline.events, ["resize:390x600", "measure", "touch-targets", "screenshot"]);
	assert.deepEqual(pipeline.calls[0], {
		method: "Emulation.setDeviceMetricsOverride",
		params: { width: 390, height: 600, deviceScaleFactor: 1, mobile: true },
	});
	assert.equal(pipeline.calls.filter(({ method }) => method === "Page.captureScreenshot").length, 1);
});

test("capture refuses missing, fractional or nonpositive CSS dimensions and any DPR other than one", () => {
	for (const metrics of [
		{ width: 0 },
		{ height: -1 },
		{ width: 600.5 },
		{ height: Number.NaN },
		{ devicePixelRatio: 2 },
		{ devicePixelRatio: 0 },
	]) {
		const pipeline = capturePipeline({ metrics });
		assert.throws(() => pipeline.capture(pipeline.cli), /positive integer CSS viewport at DPR 1/u);
		assert.equal(pipeline.calls.filter(({ method }) => method === "Page.captureScreenshot").length, 0);
	}
	const pipeline = capturePipeline({ box: () => ({ viewport: undefined }) });
	assert.throws(() => pipeline.capture(pipeline.cli), /positive integer CSS viewport at DPR 1/u);
});

test("capture rejects a PNG whose full surface size disagrees with the measured CSS viewport", () => {
	const pipeline = capturePipeline({ pngSize: { width: 600, height: 599 } });
	assert.throws(() => pipeline.capture(pipeline.cli), /viewport|dimensions|size/u);
	assert.equal(pipeline.calls.filter(({ method }) => method === "Page.captureScreenshot").length, 1);
});

test("capture refuses a rounded timeline crop that falls outside the full viewport", () => {
	const pipeline = capturePipeline({ box: () => ({ x: 599.6 }) });
	assert.throws(() => pipeline.capture(pipeline.cli), /crop|bounds|rectangle|viewport/u);
	assert.equal(pipeline.calls.filter(({ method }) => method === "Page.captureScreenshot").length, 1);
});

test("capture keeps the original empty-response, resize and zero-size failure boundaries", () => {
	const empty = capturePipeline({ missingData: true });
	assert.throws(() => empty.capture(empty.cli), /returned no image/u);
	const oversized = capturePipeline({ box: () => ({ scrollHeight: 16_001 }) });
	assert.throws(() => oversized.capture(oversized.cli), /more than the 16000 px/u);
	const growing = capturePipeline({ box: (_width, height) => ({ scrollHeight: height + 1 }) });
	assert.throws(() => growing.capture(growing.cli), /does not fit the page/u);
	const zero = capturePipeline({ box: () => ({ width: 0 }) });
	assert.throws(() => zero.capture(zero.cli), /has no size/u);
	assert.equal(zero.events.filter((event) => event === "measure").length, 4);
	const recovered = capturePipeline({ box: (_width, _height, read) => (read === 1 ? { width: 0 } : {}) });
	recovered.capture(recovered.cli);
	assert.deepEqual(recovered.events, ["resize:600x600", "measure", "measure", "screenshot"]);
});

test("capture failures propagate through the actual normal undo routine without taking another image", () => {
	const fixtureSource = ts.createSourceFile(
		"scripts/fixture-app.mjs",
		readFileSync("scripts/fixture-app.mjs", "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const runAndUndo = runInNewContext(`(${declaration("runAndUndo", fixtureSource)})`, { ScriptError: Error }) as (
		work: () => unknown,
		undo: [string, () => void][],
	) => unknown;
	const pipeline = capturePipeline({ pngSize: { width: 599, height: 600 } });
	const restored: string[] = [];
	assert.throws(
		() =>
			runAndUndo(
				() => pipeline.capture(pipeline.cli),
				[
					[
						"viewport",
						() => {
							restored.push("viewport");
						},
					],
					[
						"plugin",
						() => {
							restored.push("plugin");
						},
					],
					[
						"appearance",
						() => {
							restored.push("appearance");
						},
					],
				],
			),
		/viewport|dimensions|size/u,
	);
	assert.deepEqual(restored, ["viewport", "plugin", "appearance"]);
	assert.equal(pipeline.calls.filter(({ method }) => method === "Page.captureScreenshot").length, 1);
	const skipped = capturePipeline();
	restored.length = 0;
	assert.throws(
		() =>
			runAndUndo(
				() =>
					skipped.capture(skipped.cli, undefined, () => {
						throw new Error("auto-skipped element");
					}),
				["viewport", "plugin", "appearance"].map((name): [string, () => void] => [
					name,
					() => {
						restored.push(name);
					},
				]),
			),
		/auto-skipped/u,
	);
	assert.deepEqual(restored, ["viewport", "plugin", "appearance"]);
	assert.equal(skipped.calls.filter(({ method }) => method === "Page.captureScreenshot").length, 0);
});

/** Tests the real state runner's capture wiring; capture itself is exercised above with actual synthetic PNGs. */
function screenshotRunner(mode: "screenshots" | "styles" | "ab", options: { force?: boolean; visible?: boolean } = {}) {
	const fullHeight = 1_000;
	const theme = options.visible === false ? "dark" : "light";
	const name = `${theme}-today-all-days-no-counter`;
	const events: string[] = [];
	const writes = new Map<string, string | Buffer>();
	const visibleArguments: Record<string, unknown>[] = [];
	const captureCalls: { hooked: boolean }[] = [];
	const styleHeights: number[] = [];
	const canonicalPng = Buffer.from("one canonical surface");
	let height = 0;
	let insideCaptureHook = false;
	const timeline = () => {};
	const collectStyles = () => {};
	const cli = {
		cdp(method: string, argument: Record<string, unknown>) {
			assert.equal(method, "Emulation.setDeviceMetricsOverride");
			height = Number(argument.height);
			events.push(`resize:${height}`);
		},
		evaluate(fn: unknown, argument: Record<string, unknown>) {
			if (fn === collectStyles) {
				styleHeights.push(height);
				events.push(`S:${height}`);
				return { measuredAtHeight: height };
			}
			if (argument.action === "measure") {
				events.push(`measure:${height}`);
				return {};
			}
			if (argument.action === "visible") {
				visibleArguments.push(JSON.parse(JSON.stringify(argument)) as Record<string, unknown>);
				assert.equal(
					height,
					fullHeight,
					"V must read the fully prepared timeline, not the initial short viewport",
				);
				assert.equal(
					insideCaptureHook,
					!options.force,
					"ordinary V belongs inside capture's hook; forced V retains its post-P order",
				);
				events.push(`V:${height}`);
				return ["year 2026", "  task due: Visible after full measurement | Note"];
			}
			if (argument.action === "windowing-info") {
				events.push("windowing-info");
				return { rowCount: 2, windowed: true };
			}
			return undefined;
		},
	};
	const capture = (driver: typeof cli, viewport?: unknown, beforeScreenshot?: () => void) => {
		assert.strictEqual(driver, cli);
		assert.equal(viewport, undefined);
		captureCalls.push({ hooked: typeof beforeScreenshot === "function" });
		cli.cdp("Emulation.setDeviceMetricsOverride", { height: fullHeight });
		cli.evaluate(timeline, { action: "measure" });
		insideCaptureHook = true;
		try {
			beforeScreenshot?.();
		} finally {
			insideCaptureHook = false;
		}
		events.push(`P:${height}`);
		return canonicalPng;
	};
	const take = runInNewContext(`${declaration("setViewport")}\n${declaration("takeScreenshots")}\ntakeScreenshots`, {
		...numericScreenshotConstants(),
		path,
		THEMES,
		timeline,
		collectStyles,
		capture,
		VISIBLE: "visible",
		TIMELINE_VIEW: "tasks_timeline_view",
		TODAY_FOCUS: "Focus today",
		manifest: { id: "tasks-calendar-wrapper" },
		plan: () => [
			{
				settings: {},
				shots: [
					{
						name,
						theme,
						position: "today",
						todayFocus: false,
						counter: "none",
						behavior: null,
						png: mode !== "styles",
						visible: mode !== "styles" && options.visible !== false,
						styles: mode !== "screenshots",
					},
				],
			},
		],
		quietSettings: (settings: unknown) => settings,
		selectCssTheme: () => {},
		unhover: () => {},
		mkdirSync: () => {},
		writeFileSync: (file: string, value: string | Buffer) => writes.set(file, value),
		serializeStyles: (value: unknown) => JSON.stringify(value),
		decodePng: (png: Buffer) => {
			assert.strictEqual(png, canonicalPng);
			return { width: 556, height: 880 };
		},
		STYLE_PROBES: [],
		STYLE_PROPERTIES: [],
		ROOT_CUSTOM_PROPERTIES: [],
		ScriptError: Error,
		console: { log: () => {} },
	}) as (
		driver: typeof cli,
		plugin: { writeSettings(value: unknown): void },
		outDir: string,
		only: string,
		mode: string,
		themes: string,
		pins: Record<string, unknown>,
		label: string,
		force: boolean,
	) => Record<string, { visibleLines: number | null; png: unknown }>;
	const shots = take(cli, { writeSettings: () => {} }, "/memory", "", mode, "default", {}, "test", !!options.force);
	return { name, events, writes, shots, visibleArguments, captureCalls, styleHeights, canonicalPng };
}

test("ordinary V runs after the full capture measurement and before its only canonical P", () => {
	const run = screenshotRunner("screenshots");
	assert.deepEqual(run.events, ["resize:600", "resize:1000", "measure:1000", "V:1000", "P:1000"]);
	assert.deepEqual(run.captureCalls, [{ hooked: true }]);
	assert.equal(run.visibleArguments.length, 1);
	assert.equal(run.shots[run.name].visibleLines, 2);
	assert.equal(
		run.writes.get(`/memory/visible/${run.name}.txt`),
		"year 2026\n  task due: Visible after full measurement | Note\n",
	);
	assert.strictEqual(run.writes.get(`/memory/${run.name}.png`), run.canonicalPng);
});

test("A/B keeps S at 600 and then collects full-height V in the once-only P hook", () => {
	const run = screenshotRunner("ab");
	assert.deepEqual(run.styleHeights, [600]);
	assert.deepEqual(run.events, [
		"resize:600",
		"resize:600",
		"measure:600",
		"S:600",
		"resize:1000",
		"measure:1000",
		"V:1000",
		"P:1000",
	]);
	assert.deepEqual(run.captureCalls, [{ hooked: true }]);
	assert.equal(run.visibleArguments.length, 1);
	assert.strictEqual(run.writes.get(`/memory/${run.name}.png`), run.canonicalPng);
});

test("styles-only and non-V states retain their record kinds without an extra visible capture", () => {
	const styles = screenshotRunner("styles");
	assert.deepEqual(styles.styleHeights, [600]);
	assert.deepEqual(styles.captureCalls, []);
	assert.deepEqual(styles.visibleArguments, []);
	assert.equal(styles.writes.size, 1);
	const dark = screenshotRunner("screenshots", { visible: false });
	assert.deepEqual(dark.captureCalls, [{ hooked: true }]);
	assert.deepEqual(dark.visibleArguments, []);
	assert.equal(dark.shots[dark.name].visibleLines, null);
	assert.equal(dark.writes.size, 1);
});

test("forced windowing retains P then windowing info then V, without a second canonical capture", () => {
	const run = screenshotRunner("screenshots", { force: true });
	assert.deepEqual(run.events, ["resize:600", "resize:1000", "measure:1000", "P:1000", "windowing-info", "V:1000"]);
	assert.deepEqual(run.captureCalls, [{ hooked: false }]);
	assert.equal(run.visibleArguments[0].windowMinRows, 0);
	assert.strictEqual(run.writes.get(`/memory/${run.name}.png`), run.canonicalPng);
});

function visibleCandidate(options: { css: boolean; auto: boolean; text?: string }) {
	const checks: Record<string, unknown>[] = [];
	let reads = 0;
	const element = {
		className: "year",
		checkVisibility(value: Record<string, unknown>) {
			checks.push(JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
			return value.contentVisibilityAuto === true ? options.auto : options.css;
		},
		matches: (selector: string) => selector === ".year",
		get innerText() {
			reads++;
			assert.ok(options.css && options.auto, "hidden or auto-skipped candidates must not be read");
			return options.text ?? "2026";
		},
		get textContent(): never {
			throw new Error("textContent must never replace innerText in V");
		},
	};
	return { element, checks, reads: () => reads };
}

async function collectActualVisible(candidates: ReturnType<typeof visibleCandidate>[]): Promise<string[]> {
	let time = 0;
	const root = { querySelectorAll: () => candidates.map(({ element }) => element) };
	const timeline = runInNewContext(`(${declaration("timeline")})`, {
		document: { querySelector: () => ({ querySelector: () => root }), fonts: { ready: Promise.resolve() } },
		performance: { now: () => (time += 1_000) },
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		requestAnimationFrame: (run: () => void) => {
			run();
			return 0;
		},
		setTimeout: (run: () => void) => {
			run();
			return 0;
		},
		getComputedStyle: () => ({ color: "rgb(1, 2, 3)", backgroundColor: "rgba(0, 0, 0, 0)" }),
	}) as (argument: { action: string; viewType: string }) => Promise<string[]>;
	return Array.from(await timeline({ action: "visible", viewType: "tasks_timeline_view" }));
}

test("the actual visible action rejects CSS-visible auto-skipped elements instead of dropping or reading them", async () => {
	const candidate = visibleCandidate({ css: true, auto: false });
	await assert.rejects(collectActualVisible([candidate]), /auto-skipped/u);
	assert.deepEqual(candidate.checks, [
		{ checkVisibilityCSS: true },
		{ checkVisibilityCSS: true, contentVisibilityAuto: true },
	]);
	assert.equal(candidate.reads(), 0);
});

test("the actual visible action still excludes CSS-hidden elements and reads innerText after both checks", async () => {
	const hidden = visibleCandidate({ css: false, auto: false });
	const visible = visibleCandidate({ css: true, auto: true, text: " 2026\n  " });
	assert.deepEqual(await collectActualVisible([hidden, visible]), ["year 2026"]);
	assert.deepEqual(hidden.checks, [{ checkVisibilityCSS: true }]);
	assert.equal(hidden.reads(), 0);
	assert.equal(visible.reads(), 1);
	assert.deepEqual(visible.checks, [
		{ checkVisibilityCSS: true },
		{ checkVisibilityCSS: true, contentVisibilityAuto: true },
	]);
});
