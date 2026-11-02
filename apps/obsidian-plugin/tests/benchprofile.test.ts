import { test } from "node:test";
import assert from "node:assert/strict";

import {
	bucketTrace,
	moduleCategory,
	moduleMap,
	pluginLineOffset,
	profileMarker,
	profileTable,
	type ProfileNode,
	type ProfileSummary,
	type TraceEvent,
} from "../scripts/bench-profile.mjs";
import { realProfileEvents, realThread } from "./benchprofile-chunks";

const pluginId = "tasks-calendar-wrapper";
const pluginUrl = `plugin:${pluginId}`;
const lineOffset = 2;
const mainJs = [
	"function outsideModule() {}",
	"// src/main.ts",
	"function pluginMain() {",
	"  return true;",
	"}",
	"// ordinary comment",
	"// ../../packages/core/src/parse.ts",
	"function parseTasks() {",
	"  return [];",
	"}",
	"// ../../node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.production.min.js",
	"function renderRoot() {",
	"  return null;",
	"}",
].join("\n");
const pid = 100;
const tid = 7;

function node(id: number, functionName: string, url: string, lineNumber: number, parent?: number): ProfileNode {
	return { id, callFrame: { functionName, url, scriptId: "1", lineNumber, columnNumber: 0 }, parent };
}

const nodes = [
	node(1, "(root)", "", -1),
	node(2, "pluginMain", pluginUrl, 2 + lineOffset, 1),
	node(3, "parseTasks", pluginUrl, 7 + lineOffset, 1),
	node(4, "renderRoot", pluginUrl, 11 + lineOffset, 1),
	node(5, "renderMarkdown", "app://obsidian.md/app.js", 900, 1),
	node(6, "parseTasks", pluginUrl, 7 + lineOffset, 5),
	node(7, "hostWork", "app://obsidian.md/app.js", 901, 1),
];

/** Chrome timestamps and durations are in microseconds; the test's arithmetic is in milliseconds. */
function complete(name: string, start: number, duration: number, thread = tid): TraceEvent {
	return { ph: "X", name, pid, tid: thread, ts: start * 1000, dur: duration * 1000, cat: "devtools.timeline" };
}

function traceOf({
	events = [
		complete("RunTask", 0, 200),
		complete("FunctionCall", 0, 100),
		complete("MinorGC", 40, 10),
		complete("UpdateLayoutTree", 100, 20),
		complete("Layout", 120, 20),
		complete("Paint", 140, 30),
	],
	samples = [3, 3, 3, 4, 3, 4, 6, 6, 2, 7],
	times = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95],
	profileNodes = nodes,
}: { events?: TraceEvent[]; samples?: number[]; times?: number[]; profileNodes?: ProfileNode[] } = {}): TraceEvent[] {
	assert.equal(samples.length, times.length);
	return [
		{ ph: "M", name: "thread_name", pid, tid, args: { name: "CrRendererMain" } },
		{ ph: "M", name: "thread_name", pid, tid: 8, args: { name: "Compositor" } },
		...(["start", "end"] as const).map((edge, index) => ({
			ph: "I",
			name: "TimeStamp",
			pid,
			tid,
			ts: index * 300_000,
			args: { data: { message: profileMarker("initialLoad", edge) } },
		})),
		...events,
		// These tasks must not contribute: too short, outside the markers, and on the compositor.
		complete("RunTask", 220, 20),
		complete("Paint", 220, 20),
		complete("RunTask", 400, 100),
		complete("Layout", 400, 100),
		complete("RunTask", 0, 1000, 8),
		complete("Paint", 0, 1000, 8),
		{ ph: "P", name: "Profile", id: "0x1", pid, tid, ts: 0, args: { data: { startTime: 0 } } },
		{
			ph: "P",
			name: "ProfileChunk",
			id: "0x1",
			pid,
			tid,
			ts: 200_000,
			args: {
				data: {
					cpuProfile: { nodes: profileNodes, samples },
					timeDeltas: times.map((time, index) => (time - (times[index - 1] ?? 0)) * 1000),
				},
			},
		},
	];
}

const options = { scenario: "initialLoad", mainJs, pluginId };

test("buckets a recorded trace into the categories", () => {
	const result = bucketTrace({ traceEvents: traceOf() }, options);
	assert.deepEqual(result.thread, { pid, tid });
	assert.equal(result.scenario, "initialLoad");
	assert.deepEqual(result.categories, {
		core: 30,
		"react-dom": 20,
		MarkdownRenderer: 20,
		"other script": 20,
		style: 20,
		layout: 20,
		paint: 30,
		GC: 10,
	});
	assert.equal(result.unattributedMs, 30);
	assert.equal(result.totalMs, 200);
	assert.equal(result.longTasks, 1);
	assert.equal(Object.values(result.categories).reduce((sum, value) => sum + value, 0) + result.unattributedMs, 200);
});

test("a RunTask nested in ThreadControllerImpl::RunTask counts as one long task", () => {
	const expected = bucketTrace(traceOf(), options);
	const wrapper = { ...complete("ThreadControllerImpl::RunTask", 0, 200), cat: "toplevel" };
	for (const trace of [
		[wrapper, ...traceOf()],
		[...traceOf(), wrapper],
	]) {
		const result = bucketTrace(trace, options);
		assert.deepEqual(result, expected);
		assert.equal(result.longTasks, 1);
		assert.equal(result.totalMs, 200);
		assert.equal(result.unattributedMs, 30);
	}
	const nested = traceOf().map((event) =>
		event.name === "RunTask" && event.tid === tid && event.ts === 0 ? complete("RunTask", 10, 180) : event,
	);
	assert.deepEqual(bucketTrace([wrapper, ...nested], options), expected);
});

test("top-level task containment is checked before filtering by the scenario window", () => {
	const result = bucketTrace(
		[...traceOf(), complete("ThreadControllerImpl::RunTask", -10, 260), complete("RunTask", 250, 50)],
		options,
	);
	assert.equal(result.longTasks, 1);
	assert.equal(result.totalMs, 50);
	assert.equal(result.unattributedMs, 50);
	assert.equal(
		Object.values(result.categories).reduce((sum, value) => sum + value, 0),
		0,
	);
});

test("renderer thread selection uses de-duplicated top-level task time", () => {
	const result = bucketTrace(
		[
			...traceOf(),
			complete("ThreadControllerImpl::RunTask", 0, 200),
			{ ph: "M", name: "thread_name", pid, tid: 9, args: { name: "CrRendererMain" } },
			complete("RunTask", 0, 250, 9),
			complete("Paint", 0, 250, 9),
		],
		options,
	);
	assert.deepEqual(result.thread, { pid, tid: 9 });
	assert.equal(result.longTasks, 1);
	assert.equal(result.totalMs, 250);
	assert.equal(result.categories.paint, 250);
});

test("bucketTrace with a pid ignores other windows' renderer main threads", () => {
	const otherPid = pid + 1;
	const trace = [
		...traceOf(),
		{ ph: "M", name: "thread_name", pid: otherPid, tid, args: { name: "CrRendererMain" } },
		{ ...complete("RunTask", 0, 250), pid: otherPid },
		{ ...complete("Paint", 0, 250), pid: otherPid },
	];
	assert.deepEqual(bucketTrace(trace, options).thread, { pid: otherPid, tid });
	assert.deepEqual(bucketTrace(trace, { ...options, pid }), bucketTrace(traceOf(), options));
});

test("bucketTrace with a pid that has no renderer main thread is an error", () => {
	const missingPid = pid + 1;
	const trace = [
		...traceOf(),
		{ ph: "M", name: "thread_name", pid: missingPid, tid, args: { name: "Compositor" } },
		{ ...complete("RunTask", 0, 250), pid: missingPid },
	];
	assert.throws(() => bucketTrace(trace, { ...options, pid: missingPid }), {
		message: /profile initialLoad: the trace has no main thread for this window's renderer \(pid 101\);/,
	});
});

test("a frame in the plugin bundle is bucketed by the module its esbuild path comment names", () => {
	assert.deepEqual(moduleMap(mainJs), [
		{ line: 1, path: "src/main.ts" },
		{ line: 6, path: "../../packages/core/src/parse.ts" },
		{
			line: 10,
			path: "../../node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.production.min.js",
		},
	]);
	for (const path of [
		"../../node_modules/.pnpm/react@18.3.1/node_modules/react/cjs/react.production.min.js",
		"../../node_modules/.pnpm/scheduler@0.23.2/node_modules/scheduler/cjs/scheduler.production.min.js",
		"../../node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.production.min.js",
	])
		assert.equal(moduleCategory(path), "react-dom", path);
	assert.equal(moduleCategory("../../packages/core/src/parse.ts"), "core");
	assert.equal(moduleCategory("src/main.ts"), "other script");
	assert.equal(
		pluginLineOffset(
			nodes.filter(({ callFrame }) => callFrame.url === pluginUrl).map(({ callFrame }) => callFrame),
			mainJs,
		),
		lineOffset,
	);
	const result = bucketTrace(
		traceOf({
			events: [complete("RunTask", 0, 90), complete("FunctionCall", 0, 90)],
			samples: [3, 4, 2],
			times: [15, 45, 75],
		}),
		options,
	);
	assert.equal(result.lineOffset, lineOffset);
	assert.deepEqual(result.categories, {
		core: 30,
		"react-dom": 30,
		MarkdownRenderer: 0,
		"other script": 30,
		style: 0,
		layout: 0,
		paint: 0,
		GC: 0,
	});
});

test("samples under renderMarkdown count as MarkdownRenderer whatever is below them", () => {
	const result = bucketTrace(
		traceOf({
			events: [complete("RunTask", 0, 80), complete("FunctionCall", 0, 80)],
			samples: [6],
			times: [20],
		}),
		options,
	);
	assert.equal(result.categories.MarkdownRenderer, 80);
	assert.equal(result.categories.core, 0);
	assert.equal(result.unattributedMs, 0);
	assert.equal(result.totalMs, 80);
});

test("V8's method frame name t.renderMarkdown counts as MarkdownRenderer, a longer name does not", () => {
	const renamed = (functionName: string) =>
		bucketTrace(
			traceOf({
				events: [complete("RunTask", 0, 80), complete("FunctionCall", 0, 80)],
				samples: [6],
				times: [20],
				profileNodes: nodes.map((profileNode) =>
					profileNode.id === 5
						? { ...profileNode, callFrame: { ...profileNode.callFrame, functionName } }
						: profileNode,
				),
			}),
			options,
		).categories;
	// Obsidian's app.js defines it as a method, and V8 names the frame after the object it was assigned on.
	assert.equal(renamed("t.renderMarkdown").MarkdownRenderer, 80);
	assert.equal(renamed("t.renderMarkdownLater").MarkdownRenderer, 0);
	assert.equal(renamed("prerenderMarkdown").MarkdownRenderer, 0);
});

test("GC inside script time counts as GC, not as script", () => {
	const result = bucketTrace(
		traceOf({
			events: [complete("RunTask", 0, 100), complete("FunctionCall", 0, 100), complete("MinorGC", 20, 40)],
			samples: [3, 4, 3, 3],
			times: [10, 30, 70, 90],
		}),
		options,
	);
	assert.equal(result.categories.GC, 40);
	assert.equal(result.categories.core, 60);
	assert.equal(result.categories["react-dom"], 0, "a sample during GC does not split script self time");
	assert.equal(result.unattributedMs, 0);
	assert.equal(result.totalMs, 100);
	assert.equal(
		Object.values(result.categories).reduce((sum, value) => sum + value, 0),
		100,
	);
});

test("a trace without renderer main-thread tasks is an error", () => {
	const trace = traceOf();
	assert.throws(
		() =>
			bucketTrace(
				trace.filter((event) => event.args?.name !== "CrRendererMain"),
				options,
			),
		/CrRendererMain/,
	);
	assert.throws(
		() =>
			bucketTrace(
				trace.filter((event) => event.name !== "RunTask"),
				options,
			),
		/CrRendererMain/,
	);
});

test("an initial load trace without renderMarkdown frames is an error", () => {
	const trace = traceOf({
		events: [complete("RunTask", 0, 100), complete("FunctionCall", 0, 100)],
		samples: [3, 3],
		times: [20, 80],
		profileNodes: nodes.filter(({ id }) => id !== 5 && id !== 6),
	});
	assert.throws(() => bucketTrace(trace, { ...options, requireMarkdown: true }), /renderMarkdown/);
});

test("a plugin frame outside main.js is an error", () => {
	for (const invalid of [
		node(8, "outsideRange", pluginUrl, mainJs.split("\n").length + lineOffset, 1),
		node(8, "negativeLine", pluginUrl, 0, 1),
	]) {
		const trace = traceOf({
			events: [complete("RunTask", 0, 100), complete("FunctionCall", 0, 100)],
			samples: [3, 8],
			times: [25, 75],
			profileNodes: [...nodes, invalid],
		});
		assert.equal(pluginLineOffset([nodes[2].callFrame, invalid.callFrame], mainJs), lineOffset);
		assert.throws(() => bucketTrace(trace, options), {
			message: `profile initialLoad: a plugin frame at line ${invalid.callFrame.lineNumber} (${invalid.callFrame.functionName}) maps to no module comment in main.js; the line offset or the script url is wrong.`,
		});
	}
});

test("a plugin frame in the bundle prelude before the first module comment counts as other script", () => {
	const result = bucketTrace(
		traceOf({
			events: [complete("RunTask", 0, 100), complete("FunctionCall", 0, 100)],
			samples: [3, 8],
			times: [25, 75],
			profileNodes: [...nodes, node(8, "outsideModule", pluginUrl, lineOffset, 1)],
		}),
		options,
	);
	assert.equal(result.lineOffset, lineOffset);
	assert.equal(result.longTasks, 1);
	assert.equal(result.totalMs, 100);
	assert.equal(result.unattributedMs, 0);
	assert.deepEqual(result.categories, {
		core: 50,
		"react-dom": 0,
		MarkdownRenderer: 0,
		"other script": 50,
		style: 0,
		layout: 0,
		paint: 0,
		GC: 0,
	});
});

test("a plugin bundle without module comments is an error", () => {
	assert.throws(
		() => bucketTrace(traceOf(), { ...options, mainJs: mainJs.replace(/^\/\/ .*$/gm, "") }),
		/module comment/,
	);
});

function summary(categories: ProfileSummary["categories"], unattributedMs: number, longTasks: number): ProfileSummary {
	return {
		scenario: "initialLoad",
		thread: { pid, tid },
		categories,
		unattributedMs,
		longTasks,
		totalMs: Object.values(categories).reduce((sum, value) => sum + value, unattributedMs),
		samples: 10,
		lineOffset,
	};
}

function cells(lines: readonly string[], name: string): string[] {
	const prefix = `bench:   ${name.padEnd(18)}`;
	const line = lines.find((candidate) => candidate.startsWith(prefix));
	assert.ok(line, `missing ${name} row`);
	return line.slice(prefix.length).trim().split(/\s+/);
}

test("the table prints base and candidate side by side", () => {
	const base = summary(
		{ core: 12.5, "react-dom": 8, MarkdownRenderer: 7, "other script": 6, style: 5, layout: 4, paint: 3, GC: 2 },
		1,
		1,
	);
	const candidate = summary(
		{ core: 10, "react-dom": 9, MarkdownRenderer: 8, "other script": 7, style: 6, layout: 5, paint: 4, GC: 3 },
		2,
		2,
	);
	const lines = profileTable({ base: { initialLoad: base }, candidate: { initialLoad: candidate } });
	assert.equal(lines[0], "bench: profile initialLoad (ms of long-task time)");
	assert.match(lines[1], /base\s+candidate/);
	const values = (value: ProfileSummary) => ({
		...value.categories,
		unattributed: value.unattributedMs,
		total: value.totalMs,
		"long tasks": value.longTasks,
	});
	const baseValues = values(base);
	const candidateValues = values(candidate);
	for (const name of Object.keys(baseValues) as (keyof typeof baseValues)[]) {
		assert.deepEqual(cells(lines, name), [String(baseValues[name]), String(candidateValues[name])]);
	}
	const skipped = profileTable({
		base: { initialLoad: { skipped: "control unavailable" } },
		candidate: { initialLoad: candidate },
	});
	for (const name of Object.keys(candidateValues) as (keyof typeof candidateValues)[]) {
		assert.deepEqual(cells(skipped, name), ["skipped", String(candidateValues[name])]);
	}
	assert.ok(skipped.includes("bench:   (base skipped: control unavailable)"));
	const single = profileTable({ candidate: { initialLoad: candidate } });
	assert.match(single[1], /\bms\s*$/);
	assert.doesNotMatch(single[1], /base|candidate/);
	for (const name of Object.keys(candidateValues) as (keyof typeof candidateValues)[]) {
		assert.deepEqual(cells(single, name), [String(candidateValues[name])]);
	}
});

test("CPU-profile chunks from V8's sampler thread count for the main thread's profile", () => {
	const trace = traceOf().map((event) => (event.name === "ProfileChunk" ? { ...event, tid: 9 } : event));
	assert.deepEqual(bucketTrace(trace, options).categories, bucketTrace(traceOf(), options).categories);
	// A profile started on another thread of the process, such as a worker, is not the main thread's.
	const worker = traceOf().map((event) => (event.name === "Profile" ? { ...event, tid: 9 } : event));
	assert.throws(() => bucketTrace(worker, options), /no CPU-profile samples/);
});

/** Replaces the trace's single ProfileChunk's data, leaving the other events as they are. */
function withChunkData(
	change: (
		data: NonNullable<NonNullable<TraceEvent["args"]>["data"]>,
	) => NonNullable<NonNullable<TraceEvent["args"]>["data"]>,
	profileNodes = nodes,
): TraceEvent[] {
	return traceOf({ profileNodes }).map((event) =>
		event.name === "ProfileChunk" ? { ...event, args: { data: change(event.args?.data ?? {}) } } : event,
	);
}

test("out-of-order samples (negative timeDeltas) are placed by their time, as DevTools does", () => {
	// V8 emits a sample before an earlier one; the cumulative time goes back and the sample lands where it belongs.
	const reordered = traceOf({
		samples: [3, 3, 3, 3, 4, 4, 6, 6, 2, 7],
		times: [5, 15, 25, 45, 35, 55, 65, 75, 85, 95],
	});
	const chunk = reordered.find((event) => event.name === "ProfileChunk");
	assert.ok(chunk?.args?.data?.timeDeltas?.some((delta) => delta < 0));
	assert.deepEqual(bucketTrace(reordered, options), bucketTrace(traceOf(), options));
});

test("a real renderer trace excerpt with out-of-order samples and nodes from earlier chunks is bucketed", () => {
	const pluginNodes = realProfileEvents
		.flatMap((event) => event.args?.data?.cpuProfile?.nodes ?? [])
		.filter((profileNode) => profileNode.callFrame.url === pluginUrl);
	// A bundle with each sampled plugin function on its own line, under one module comment, aligns at offset 0.
	const lines = Array.from(
		{ length: Math.max(...pluginNodes.map((n) => n.callFrame.lineNumber ?? 0)) + 1 },
		() => "",
	);
	lines[0] = "// src/main.ts";
	for (const { callFrame } of pluginNodes)
		if (callFrame.functionName) lines[callFrame.lineNumber ?? 0] += ` function ${callFrame.functionName}() {}`;
	const startTime = realProfileEvents[0].args?.data?.startTime ?? 0;
	const thread = (event: TraceEvent): TraceEvent => ({ ...event, ...realThread });
	const trace: TraceEvent[] = [
		thread({ ph: "M", name: "thread_name", pid: 0, args: { name: "CrRendererMain" } }),
		...(["start", "end"] as const).map((edge, index) =>
			thread({
				ph: "I",
				name: "TimeStamp",
				pid: 0,
				ts: startTime - 1000 + index * 100_000,
				args: { data: { message: profileMarker("initialLoad", edge) } },
			}),
		),
		thread({ ph: "X", name: "RunTask", pid: 0, ts: startTime, dur: 60_000 }),
		thread({ ph: "X", name: "FunctionCall", pid: 0, ts: startTime, dur: 60_000 }),
		...realProfileEvents,
	];
	const deltas = realProfileEvents.flatMap((event) => event.args?.data?.timeDeltas ?? []);
	assert.ok(deltas.some((delta) => delta < 0));
	const result = bucketTrace(trace, { ...options, mainJs: lines.join("\n"), requireMarkdown: true });
	assert.equal(result.samples, 24);
	assert.equal(result.lineOffset, 0);
	assert.equal(result.totalMs, 60);
	assert.equal(result.unattributedMs, 0);
	assert.ok(result.categories.MarkdownRenderer > 0);
	assert.ok(result.categories["other script"] > 0);
});

test("a chunk whose samples and timeDeltas differ in length is an error naming the chunk", () => {
	const short = withChunkData((data) => ({ ...data, timeDeltas: data.timeDeltas?.slice(1) }));
	assert.throws(
		() => bucketTrace(short, options),
		/ProfileChunk of profile 0x1 at ts 200000 has 10 samples but 9 timeDeltas/,
	);
	const missing = withChunkData(({ timeDeltas: _deltas, ...data }) => data);
	assert.throws(() => bucketTrace(missing, options), /has 10 samples but 0 timeDeltas/);
});

test("a timeDelta that is not a finite number is an error naming its index", () => {
	const broken = withChunkData((data) => ({
		...data,
		timeDeltas: data.timeDeltas?.map((delta, index) => (index === 3 ? Number.NaN : delta)),
	}));
	assert.throws(() => bucketTrace(broken, options), /ProfileChunk of profile 0x1 at ts 200000 has timeDelta 3 = NaN/);
});

test("a timeDelta that moves samples before the profile start is an error", () => {
	for (const overflow of [0, 1]) {
		const trace = withChunkData((data) => ({
			...data,
			cpuProfile: { ...data.cpuProfile, samples: [3, 3, 3] },
			timeDeltas: [5000, -1_005_000 - overflow, 1_005_000 + overflow],
		})).map((event) => ({
			...event,
			ts: event.ts === undefined ? undefined : event.ts + 500_000,
			...(event.name === "Profile" ? { args: { data: { startTime: 500_000 } } } : {}),
		}));
		if (overflow === 0) assert.doesNotThrow(() => bucketTrace(trace, options));
		else
			assert.throws(() => bucketTrace(trace, options), {
				message:
					"profile initialLoad: a CPU-profile sample is at -500001, outside the trace (500000 to 1500000); the timeDeltas are corrupt.",
			});
	}
});

test("a timeDelta that moves samples past the end of the trace is an error", () => {
	for (const overflow of [0, 1]) {
		const trace = withChunkData((data) => ({
			...data,
			cpuProfile: { ...data.cpuProfile, samples: [3, 3, 3] },
			timeDeltas: [5000, 2_995_000 + overflow, -2_995_000 - overflow],
		}));
		// A different process's event duration still extends the trace beyond this renderer's last timestamp.
		trace.push({ ...complete("Paint", 1500, 500), pid: pid + 1 });
		if (overflow === 0) assert.doesNotThrow(() => bucketTrace(trace, options));
		else
			assert.throws(() => bucketTrace(trace, options), {
				message:
					"profile initialLoad: a CPU-profile sample is at 3000001, outside the trace (0 to 2000000); the timeDeltas are corrupt.",
			});
	}
});

test("small negative timeDeltas are still accepted", () => {
	const trace = traceOf({
		samples: [3, 3, 3, 3, 4, 3, 4, 6, 6, 2, 7],
		times: [-1, 5, 15, 25, 35, 45, 55, 65, 75, 85, 95],
	});
	assert.deepEqual(bucketTrace(trace, options), { ...bucketTrace(traceOf(), options), samples: 11 });
});

test("a sample naming a node that no chunk defines is an error", () => {
	assert.throws(
		() => bucketTrace(traceOf({ samples: [3, 3, 3, 4, 3, 4, 6, 6, 2, 99] }), options),
		/CPU-profile sample 99 has no stack node/,
	);
});

test("a stack node naming a parent that no chunk defines is an error", () => {
	const orphan = nodes.map((profileNode) => (profileNode.id === 3 ? { ...profileNode, parent: 42 } : profileNode));
	assert.throws(
		() => bucketTrace(traceOf({ profileNodes: orphan }), options),
		/CPU-profile node 3 names parent 42, which no chunk of profile 0x1 defines/,
	);
});
