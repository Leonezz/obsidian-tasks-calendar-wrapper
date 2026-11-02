/**
 * Records benchmark traces and attributes renderer long-task time to bundle modules, MarkdownRenderer and browser
 * work. The trace arithmetic and report formatting are independent of Obsidian; page recording functions are sent
 * as source and use no imports.
 */

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { round } from "./bench-results.mjs";

/** The displayed long-task categories, in table order. */
export const PROFILE_CATEGORIES = Object.freeze([
	"core",
	"react-dom",
	"MarkdownRenderer",
	"other script",
	"style",
	"layout",
	"paint",
	"GC",
]);
/** One traced pass is recorded for each of these scenarios in each arm. */
export const PROFILE_SCENARIOS = Object.freeze([
	"initialLoad",
	"saveWithTasks",
	"toggle",
	"focusToday.on",
	"focusToday.off",
	"counterFilter",
	"scroll",
]);
/** Chrome categories required for task boundaries, browser events and sampled JavaScript stacks. */
export const TRACE_CATEGORIES = Object.freeze([
	"devtools.timeline",
	"disabled-by-default-devtools.timeline",
	"v8.execute",
	"disabled-by-default-v8.cpu_profiler",
	"disabled-by-default-v8.gc",
	"toplevel",
]);
/** Top-level tasks at least this long are included, in milliseconds. */
export const LONG_TASK_MS = 50;
/** Allowed CPU-sample drift outside its profile start and trace end, in microseconds. */
export const PROFILE_SAMPLE_SLACK_US = 1_000_000;
/** Chrome names for renderer task boundaries. */
export const TOP_LEVEL_EVENTS = Object.freeze(["RunTask", "ThreadControllerImpl::RunTask"]);
/** Chrome names for style computation. */
export const STYLE_EVENTS = Object.freeze([
	"UpdateLayoutTree",
	"RecalculateStyles",
	"ParseAuthorStyleSheet",
	"ScheduleStyleRecalculation",
]);
/** Chrome names for layout computation. */
export const LAYOUT_EVENTS = Object.freeze(["Layout", "UpdateLayout", "InvalidateLayout", "LayoutShift"]);
/** Chrome names for paint and compositing work. */
export const PAINT_EVENTS = Object.freeze([
	"PrePaint",
	"Paint",
	"PaintImage",
	"Layerize",
	"UpdateLayer",
	"UpdateLayerTree",
	"CompositeLayers",
	"Commit",
]);
/** Chrome names for garbage collection, including collection nested inside script work. */
export const GC_EVENTS = Object.freeze(["MinorGC", "MajorGC", "GCEvent"]);
/** Prefixes for additional V8 and Blink garbage-collection events. */
export const GC_EVENT_PREFIXES = Object.freeze(["V8.GC", "BlinkGC."]);
/** Script events whose exclusive time is split by sampled stacks; ParseHTML is included as script work. */
export const SCRIPT_EVENTS = Object.freeze([
	"FunctionCall",
	"EvaluateScript",
	"V8.Execute",
	"TimerFire",
	"FireAnimationFrame",
	"EventDispatch",
	"RunMicrotasks",
	"v8.callFunction",
	"v8.run",
	"v8.compile",
	"CompileScript",
	"v8.evaluateModule",
	"FireIdleCallback",
	"XHRReadyStateChange",
	"ParseHTML",
]);
/** The public MarkdownRenderer frame name used to recognise its entire sampled stack. */
export const MARKDOWN_FUNCTION = "renderMarkdown";

/** V8 names a method frame after the object it was assigned on, so Obsidian's frame reads t.renderMarkdown. */
function isMarkdownFrame({ functionName }) {
	return functionName === MARKDOWN_FUNCTION || functionName.endsWith(`.${MARKDOWN_FUNCTION}`);
}

/** The console.timeStamp message delimiting a scenario's trace window. */
export function profileMarker(scenario, edge) {
	return `tcw-profile:${scenario}:${edge}`;
}

/** Maps zero-based bundle lines to esbuild module path comments, excluding ordinary comments. */
export function moduleMap(mainJs) {
	return mainJs.split(/\r?\n/).flatMap((text, line) => {
		const match = /^\/\/ (\S+\.(?:js|mjs|cjs|ts|tsx|jsx|mts))$/.exec(text);
		return match ? [{ line, path: match[1] }] : [];
	});
}

/** Categorises a bundle module, including React and scheduler in the react-dom bucket. */
export function moduleCategory(path) {
	if (path.includes("packages/core/src/")) return "core";
	return /(?:^|\/)node_modules\/(?:react-dom|react|scheduler)(?:\/|$)/.test(path) ? "react-dom" : "other script";
}

/** Recognises the plugin's evaluated bundle URL in a sampled frame; V8's own frames, such as (root), have no url. */
export function isPluginScript(url, pluginId) {
	return url !== undefined && url.includes(`plugin:${pluginId}`);
}

/** Finds the unique wrapper-line offset that aligns sampled function names with the bundle source. */
export function pluginLineOffset(frames, mainJs) {
	const lines = mainJs.split(/\r?\n/);
	const scores = Array.from(
		{ length: 11 },
		(_, offset) =>
			frames.filter(
				({ functionName, lineNumber }) => functionName && lines[lineNumber - offset]?.includes(functionName),
			).length,
	);
	const best = Math.max(...scores);
	if (best === 0 || scores.filter((score) => score === best).length !== 1)
		throw new Error(
			"profile: cannot line up the plugin's frames with main.js; is the plugin script url or the bundle wrong?",
		);
	return scores.indexOf(best);
}

function completeEvents(events, thread) {
	const complete = [];
	const stack = [];
	for (const event of events
		.filter((event) => event.pid === thread.pid && event.tid === thread.tid && Number.isFinite(event.ts))
		.sort((a, b) => a.ts - b.ts)) {
		if (event.ph === "X" && Number.isFinite(event.dur) && event.dur > 0) complete.push(event);
		else if (event.ph === "B") stack.push(event);
		else if (event.ph === "E" && stack.length) {
			const start = stack.pop();
			if (event.ts > start.ts) complete.push({ ...start, ph: "X", dur: event.ts - start.ts });
		}
	}
	return complete.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
}

function eventCategory(name) {
	if (GC_EVENTS.includes(name) || GC_EVENT_PREFIXES.some((prefix) => name.startsWith(prefix))) return "GC";
	if (STYLE_EVENTS.includes(name)) return "style";
	if (LAYOUT_EVENTS.includes(name)) return "layout";
	if (PAINT_EVENTS.includes(name)) return "paint";
	if (SCRIPT_EVENTS.includes(name)) return "script";
	return null;
}

function profileSamples(events, thread, scenario) {
	const traceEnd = events.reduce(
		(end, event) =>
			Number.isFinite(event.ts) ? Math.max(end, event.ts + (Number.isFinite(event.dur) ? event.dur : 0)) : end,
		-Infinity,
	);
	const sameProcess = events.filter((event) => event.pid === thread.pid);
	const profiles = new Map();
	// Profiles without a usable startTime remain ignored, since their sample times cannot be accumulated.
	for (const event of sameProcess) {
		if (
			event.ph === "P" &&
			event.name === "Profile" &&
			(event.tid === undefined || event.tid === thread.tid) &&
			Number.isFinite(event.args?.data?.startTime)
		)
			profiles.set(event.id, {
				startTime: event.args.data.startTime,
				time: event.args.data.startTime,
				nodes: new Map(),
				samples: [],
			});
	}
	// V8 may emit a profile's chunks from its own sampler thread; the Profile event's id ties them to the main thread.
	// As in DevTools, a chunk's nodes and samples append to its profile, and a sample may name a node from any chunk.
	for (const event of sameProcess.filter((event) => event.name === "ProfileChunk").sort((a, b) => a.ts - b.ts)) {
		const profile = profiles.get(event.id);
		if (!profile) continue;
		const data = event.args?.data;
		for (const node of data?.cpuProfile?.nodes ?? []) profile.nodes.set(node.id, node);
		const ids = data?.cpuProfile?.samples ?? [];
		const deltas = data?.timeDeltas ?? [];
		const chunk = `profile ${scenario}: the ProfileChunk of profile ${event.id} at ts ${event.ts}`;
		if (ids.length !== deltas.length)
			throw new Error(`${chunk} has ${ids.length} samples but ${deltas.length} timeDeltas.`);
		const bad = deltas.findIndex((delta) => !Number.isFinite(delta));
		if (bad >= 0) throw new Error(`${chunk} has timeDelta ${bad} = ${deltas[bad]}, not a finite number.`);
		// A delta may be negative: V8 emits some samples after later ones. The time sort below orders them, as DevTools does.
		ids.forEach((id, index) => {
			profile.time += deltas[index];
			profile.samples.push({ time: profile.time, id });
		});
	}
	return [...profiles.entries()]
		.flatMap(([profileId, { startTime, nodes, samples }]) =>
			samples.map(({ time, id }) => {
				if (time < startTime - PROFILE_SAMPLE_SLACK_US || time > traceEnd + PROFILE_SAMPLE_SLACK_US)
					throw new Error(
						`profile ${scenario}: a CPU-profile sample is at ${time}, outside the trace (${startTime} to ${traceEnd}); the timeDeltas are corrupt.`,
					);
				const frames = [];
				const visited = new Set();
				for (let node = nodes.get(id); node;) {
					if (visited.has(node.id))
						throw new Error(`profile ${scenario}: a CPU-profile stack has a parent cycle.`);
					visited.add(node.id);
					frames.push(node.callFrame);
					if (node.parent === undefined) break;
					const parent = nodes.get(node.parent);
					if (!parent)
						throw new Error(
							`profile ${scenario}: CPU-profile node ${node.id} names parent ${node.parent}, which no chunk of profile ${profileId} defines.`,
						);
					node = parent;
				}
				if (!frames.length) throw new Error(`profile ${scenario}: CPU-profile sample ${id} has no stack node.`);
				return { time, frames };
			}),
		)
		.sort((a, b) => a.time - b.time);
}

// Sweep event boundaries to retain each event's exclusive intervals, including uncategorised children.
function selfIntervals(task, events) {
	const start = task.ts;
	const end = start + task.dur;
	const nodes = [{ start, end, category: null }];
	for (const event of events) {
		if (event === task || TOP_LEVEL_EVENTS.includes(event.name) || event.ts >= end || event.ts + event.dur <= start)
			continue;
		nodes.push({
			start: Math.max(start, event.ts),
			end: Math.min(end, event.ts + event.dur),
			category: eventCategory(event.name),
		});
	}
	nodes.sort((a, b) => a.start - b.start || b.end - a.end);
	const boundaries = nodes.flatMap((node, index) => [
		{ time: node.start, index, start: true },
		{ time: node.end, index, start: false },
	]);
	boundaries.sort((a, b) => a.time - b.time || Number(a.start) - Number(b.start) || a.index - b.index);
	const active = [];
	const slices = new Map();
	for (let i = 0; i < boundaries.length;) {
		const time = boundaries[i].time;
		while (i < boundaries.length && boundaries[i].time === time) {
			const edge = boundaries[i++];
			if (edge.start) active.push(edge.index);
			else active.splice(active.indexOf(edge.index), 1);
		}
		if (!active.length || i === boundaries.length) continue;
		const leaf = active.at(-1);
		const category = active.map((index) => nodes[index].category).findLast((value) => value !== null) ?? null;
		const key = `${leaf}:${category}`;
		if (!slices.has(key)) slices.set(key, { category, intervals: [] });
		slices.get(key).intervals.push([time, boundaries[i].time]);
	}
	return [...slices.values()];
}

function lowerSample(samples, time) {
	let low = 0;
	let high = samples.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (samples[mid].time < time) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** Attributes renderer long-task self time and sampled script stacks inside one marked scenario window. */
export function bucketTrace(
	trace,
	{ scenario, mainJs, pluginId, pid, requireMarkdown = false, requireReactDom = false },
) {
	const events = Array.isArray(trace) ? trace : trace.traceEvents;
	const window = ["start", "end"].map((edge) => {
		const marker = profileMarker(scenario, edge);
		const event = events.find((event) => event.name === "TimeStamp" && event.args?.data?.message === marker);
		if (!event || !Number.isFinite(event.ts))
			throw new Error(`profile ${scenario}: the trace has no ${marker} marker.`);
		return event.ts;
	});
	if (window[1] < window[0]) throw new Error(`profile ${scenario}: the end marker precedes the start marker.`);
	const inWindow = (event) => event.ts >= window[0] && event.ts < window[1];
	const threads = events
		.filter(
			(event) =>
				event.ph === "M" &&
				event.name === "thread_name" &&
				event.args?.name === "CrRendererMain" &&
				(pid === undefined || event.pid === pid),
		)
		.map(({ pid, tid }) => {
			const complete = completeEvents(events, { pid, tid });
			let outerEnd = -Infinity;
			const tasks = complete.filter((event) => {
				if (!TOP_LEVEL_EVENTS.includes(event.name)) return false;
				const end = event.ts + event.dur;
				if (end <= outerEnd) return false;
				outerEnd = end;
				return inWindow(event);
			});
			return { thread: { pid, tid }, complete, tasks, time: tasks.reduce((sum, event) => sum + event.dur, 0) };
		})
		.sort((a, b) => b.time - a.time);
	const selected = threads[0];
	if (!selected && pid !== undefined)
		throw new Error(
			`profile ${scenario}: the trace has no main thread for this window's renderer (pid ${pid}); check the renderer pid and trace categories (toplevel, devtools.timeline).`,
		);
	if (!selected?.tasks.length)
		throw new Error(
			`profile ${scenario}: the trace has no renderer main-thread tasks (CrRendererMain with RunTask events); check the trace categories (toplevel, devtools.timeline).`,
		);
	const { thread, complete } = selected;
	const tasks = selected.tasks.filter((event) => event.dur >= LONG_TASK_MS * 1000);
	const samples = profileSamples(events, thread, scenario);
	const pluginFrames = samples.flatMap(({ frames }) => frames.filter((frame) => isPluginScript(frame.url, pluginId)));
	const lineOffset = pluginFrames.length ? pluginLineOffset(pluginFrames, mainJs) : null;
	const modules = moduleMap(mainJs);
	const lineCount = mainJs.split(/\r?\n/).length;
	for (const sample of samples) {
		if (sample.frames.some(isMarkdownFrame)) sample.category = "MarkdownRenderer";
		else {
			const frame = sample.frames[0];
			sample.category = "other script";
			if (isPluginScript(frame.url, pluginId)) {
				const line = frame.lineNumber - lineOffset;
				// Esbuild's runtime helpers precede the first module comment and count as other script.
				if (line >= 0 && line < modules[0]?.line) continue;
				const module = modules.findLast((module) => module.line <= line);
				if (!module || line >= lineCount || line < 0)
					throw new Error(
						`profile ${scenario}: a plugin frame at line ${frame.lineNumber} (${frame.functionName}) maps to no module comment in main.js; the line offset or the script url is wrong.`,
					);
				sample.category = moduleCategory(module.path);
			}
		}
	}
	const totals = Object.fromEntries(PROFILE_CATEGORIES.map((category) => [category, 0]));
	for (const task of tasks) {
		for (const { category, intervals } of selfIntervals(task, complete)) {
			const duration = intervals.reduce((sum, [start, end]) => sum + end - start, 0);
			if (category === null) continue;
			if (category !== "script") {
				totals[category] += duration;
				continue;
			}
			if (!samples.length)
				throw new Error(
					`profile ${scenario}: the trace has long tasks but no CPU-profile samples; is disabled-by-default-v8.cpu_profiler recorded?`,
				);
			const counts = new Map();
			let count = 0;
			for (const [start, end] of intervals) {
				for (let i = lowerSample(samples, start); i < samples.length && samples[i].time < end; i++) {
					const name = samples[i].category;
					counts.set(name, (counts.get(name) ?? 0) + 1);
					count++;
				}
			}
			if (!count) totals["other script"] += duration;
			else for (const [name, n] of counts) totals[name] += (duration * n) / count;
		}
	}
	if (requireMarkdown && !totals.MarkdownRenderer)
		throw new Error(
			`profile ${scenario}: no renderMarkdown frame in the trace although rows rendered; the MarkdownRenderer bucket cannot be found.`,
		);
	if (requireReactDom && !totals["react-dom"])
		throw new Error(
			`profile ${scenario}: no react-dom sample in the plugin bundle; check isPluginScript and the line offset.`,
		);
	const total = tasks.reduce((sum, task) => sum + task.dur, 0);
	const remainder = total - Object.values(totals).reduce((sum, value) => sum + value, 0);
	if (remainder < -0.001)
		throw new Error(`profile ${scenario}: internal error: attributed time exceeds long-task time.`);
	const totalMs = round(total / 1000);
	const categories = Object.fromEntries(Object.entries(totals).map(([name, value]) => [name, round(value / 1000)]));
	return {
		scenario,
		thread,
		longTasks: tasks.length,
		totalMs,
		categories,
		unattributedMs: round(Math.max(0, totalMs - Object.values(categories).reduce((sum, value) => sum + value, 0))),
		samples: samples.length,
		lineOffset,
	};
}

/** Prints per-scenario long-task categories with base and candidate values side by side. */
export function profileTable(columns) {
	const arms = columns.base ? ["base", "candidate"] : ["candidate"];
	const lines = [];
	const row = (name, values) =>
		`bench:   ${name.padEnd(18)}${values.map((value) => String(value).padStart(11)).join("")}`;
	for (const scenario of PROFILE_SCENARIOS) {
		if (!arms.some((arm) => columns[arm]?.[scenario])) continue;
		lines.push(`bench: profile ${scenario} (ms of long-task time)`, row("", columns.base ? arms : ["ms"]));
		for (const name of [...PROFILE_CATEGORIES, "unattributed", "total", "long tasks"])
			lines.push(
				row(
					name,
					arms.map((arm) => {
						const summary = columns[arm]?.[scenario];
						if (!summary) return "—";
						if (summary.skipped) return "skipped";
						return name === "unattributed"
							? summary.unattributedMs
							: name === "total"
								? summary.totalMs
								: name === "long tasks"
									? summary.longTasks
									: summary.categories[name];
					}),
				),
			);
		for (const arm of arms) {
			const reason = columns[arm]?.[scenario]?.skipped;
			if (reason) lines.push(`bench:   (${arm} skipped: ${reason})`);
		}
	}
	return lines;
}

/** Controls debugger recording in the page; this function is sent as source and imports nothing. */
export async function debuggerTracing({ step, categories, from = 0, count = 20_000 }) {
	if (step === "start") {
		if (window.__tcwTrace)
			throw new Error(
				"a trace is already being recorded; a crashed run left it, run again after restarting Obsidian",
			);
		const remoteModule = "@electron/remote";
		const debuggee = require(remoteModule).getCurrentWebContents().debugger;
		const state = {
			method: "webContents.debugger",
			events: [],
			attached: false,
			running: false,
			complete: false,
			ending: false,
		};
		window.__tcwTrace = state;
		let finish;
		const completed = new Promise((resolve) => {
			finish = resolve;
		});
		const listener = (_event, method, params) => {
			if (method === "Tracing.dataCollected") for (const event of params.value) state.events.push(event);
			if (method === "Tracing.tracingComplete") {
				state.complete = true;
				state.running = false;
				finish();
			}
		};
		state.stop = async () => {
			if (!state.complete) {
				let timer;
				try {
					await Promise.race([
						(async () => {
							if (!state.ending) {
								state.ending = true;
								await debuggee.sendCommand("Tracing.end");
							}
							await completed;
						})(),
						new Promise((_, reject) => {
							timer = setTimeout(
								() => reject(new Error("profile: tracingComplete did not arrive within 60 seconds.")),
								60_000,
							);
						}),
					]);
				} finally {
					clearTimeout(timer);
				}
			}
			return { method: state.method, events: state.events.length };
		};
		state.abort = async () => {
			const result = { ended: state.running, listenerRemoved: false, detached: false };
			try {
				if (state.running) await state.stop();
			} finally {
				try {
					debuggee.removeListener("message", listener);
					result.listenerRemoved = true;
					if (state.attached && debuggee.isAttached()) {
						debuggee.detach();
						result.detached = true;
					}
				} finally {
					if (window.__tcwTrace === state) delete window.__tcwTrace;
				}
			}
			return result;
		};
		if (!debuggee.isAttached()) {
			debuggee.attach("1.3");
			state.attached = true;
		}
		debuggee.on("message", listener);
		state.running = true;
		await debuggee.sendCommand("Tracing.start", {
			traceConfig: { includedCategories: categories, excludedCategories: ["*"] },
			transferMode: "ReportEvents",
		});
		return { method: state.method, pid: process.pid };
	}
	const state = window.__tcwTrace;
	if (step === "abort")
		return state ? await state.abort() : { ended: false, listenerRemoved: false, detached: false };
	if (!state || state.method !== "webContents.debugger")
		throw new Error("profile: no debugger trace is being recorded.");
	if (step === "stop") return await state.stop();
	if (step === "chunk") return state.events.slice(from, from + count);
	throw new Error(`profile: unknown debugger recording step ${step}.`);
}

/** Starts page-side contentTracing; this function is sent as source and imports nothing. */
export async function tracingStart({ categories, path }) {
	if (window.__tcwTrace)
		throw new Error(
			"a trace is already being recorded; a crashed run left it, run again after restarting Obsidian",
		);
	const remoteModule = "@electron/remote";
	const tracing = require(remoteModule).contentTracing;
	const state = { method: "contentTracing", running: true, path };
	window.__tcwTrace = state;
	state.stop = async () => {
		if (state.running) {
			const output = await tracing.stopRecording(state.path);
			state.path = output || state.path;
			state.running = false;
		}
		return { method: state.method, path: state.path };
	};
	state.abort = async () => {
		try {
			if (state.running) await state.stop();
		} finally {
			if (window.__tcwTrace === state) delete window.__tcwTrace;
		}
	};
	await tracing.startRecording({ included_categories: categories, excluded_categories: ["*"] });
	return { method: state.method, pid: process.pid };
}

/** Stops page-side recording and returns the location or size of the collected trace. */
export async function tracingStop() {
	if (!window.__tcwTrace) throw new Error("profile: no trace is being recorded.");
	return await window.__tcwTrace.stop();
}

/** Reads a bounded chunk of debugger trace events collected in the page. */
export function tracingReadChunk({ offset, limit }) {
	if (window.__tcwTrace?.method !== "webContents.debugger")
		throw new Error("profile: no debugger trace is being recorded.");
	return window.__tcwTrace.events.slice(offset, offset + limit);
}

/** Aborts page-side recording, or a main-process recording left behind when the page state was lost. */
export async function tracingAbort({ path }) {
	if (window.__tcwTrace) {
		await window.__tcwTrace.abort();
		return { stoppedLeftover: false };
	}
	const remoteModule = "@electron/remote";
	try {
		await require(remoteModule).contentTracing.stopRecording(path);
	} catch (error) {
		if (typeof error?.message !== "string" || !error.message.includes("no trace in progress")) throw error;
		return { stoppedLeftover: false };
	}
	return { stoppedLeftover: true };
}

/** Controls page recording through an injected CLI, returning cleanup steps for the enclosing run. */
export function traceRecorder(cli, { tmpDir, log }) {
	let method = null;
	let pid = null;
	const tracePath = path.join(tmpDir, "trace.json");
	const abort = () => {
		const result = cli.evaluate(tracingAbort, { path: tracePath }, 70_000);
		if (result.stoppedLeftover)
			log("bench: profile: stopped a recording left behind by a crashed or reloaded window.");
		return result;
	};
	const start = (selected) => {
		const result =
			selected === "contentTracing"
				? cli.evaluate(tracingStart, { categories: TRACE_CATEGORIES, path: tracePath }, 70_000)
				: cli.evaluate(debuggerTracing, { step: "start", categories: TRACE_CATEGORIES }, 70_000);
		if (!Number.isInteger(result?.pid))
			throw new Error(`profile: ${selected} did not report this window's renderer pid.`);
		pid = result.pid;
	};
	return {
		method: () => method,
		pid: () => pid,
		start() {
			mkdirSync(tmpDir, { recursive: true });
			if (method) {
				start(method);
				return;
			}
			try {
				start("contentTracing");
				method = "contentTracing";
			} catch (first) {
				log(`bench: profile: contentTracing failed: ${first.message ?? first}; trying webContents.debugger.`);
				try {
					abort();
				} catch (error) {
					log(`bench: profile: contentTracing cleanup failed: ${error.message ?? error}`);
				}
				try {
					start("webContents.debugger");
					method = "webContents.debugger";
				} catch (second) {
					throw new Error(
						`profile: could not record a trace: contentTracing: ${first.message ?? first}; webContents.debugger: ${second.message ?? second}.`,
					);
				}
			}
			log(`bench: profile: recording with ${method}.`);
		},
		stop() {
			if (!method) throw new Error("profile: no recording method has started.");
			try {
				if (method === "webContents.debugger") {
					const { events: count } = cli.evaluate(debuggerTracing, { step: "stop" }, 70_000);
					if (!Number.isInteger(count) || count < 0)
						throw new Error("profile: the debugger returned no event count.");
					const events = [];
					for (let from = 0; from < count; from += 20_000) {
						const chunk = cli.evaluate(debuggerTracing, { step: "chunk", from, count: 20_000 });
						if (!Array.isArray(chunk) || chunk.length !== Math.min(20_000, count - from))
							throw new Error("profile: the debugger returned an incomplete trace chunk.");
						events.push(...chunk);
					}
					return events;
				}
				const result = cli.evaluate(tracingStop, null, 70_000);
				log(`bench: profile: trace ${(statSync(result.path).size / 1e6).toFixed(1)} MB.`);
				const trace = JSON.parse(readFileSync(result.path, "utf8"));
				const events = Array.isArray(trace) ? trace : trace.traceEvents;
				if (!Array.isArray(events))
					throw new Error("profile: contentTracing returned neither an event array nor traceEvents.");
				return events;
			} finally {
				try {
					abort();
				} finally {
					rmSync(tracePath, { force: true });
				}
			}
		},
		undoSteps: [
			["stop profile recording", abort],
			["remove the profile trace folder", () => rmSync(tmpDir, { recursive: true, force: true })],
		],
	};
}
