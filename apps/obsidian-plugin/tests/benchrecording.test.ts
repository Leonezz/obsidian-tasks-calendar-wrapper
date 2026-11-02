import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";

import {
	debuggerTracing,
	traceRecorder,
	tracingAbort,
	tracingStart,
	tracingStop,
	TRACE_CATEGORIES,
	type TraceCli,
	type TraceEvent,
} from "../scripts/bench-profile.mjs";

function debuggerPage(attached = false, failStart = false, complete = true) {
	const calls: { command: string; params?: unknown }[] = [];
	const window: Record<string, unknown> = {};
	let attaches = 0;
	let detaches = 0;
	const debuggee = Object.assign(new EventEmitter(), {
		isAttached: () => attached,
		attach(version: string) {
			assert.equal(version, "1.3");
			attached = true;
			attaches++;
		},
		detach() {
			attached = false;
			detaches++;
		},
		async sendCommand(command: string, params?: unknown) {
			calls.push({ command, params });
			if (command === "Tracing.start" && failStart) throw new Error("debugger start refused");
			if (command === "Tracing.end" && complete) {
				queueMicrotask(() => debuggee.emit("message", {}, "Tracing.tracingComplete", {}));
			}
		},
	});
	return {
		calls,
		window,
		debuggee,
		attachments: () => ({ attaches, detaches, attached }),
		async evaluate(arg: Parameters<typeof debuggerTracing>[0]) {
			return await runInNewContext(`(${debuggerTracing.toString()})(argument)`, {
				argument: arg,
				window,
				process: { pid: 1234 },
				setTimeout: (callback: () => void, timeout: number) => setTimeout(callback, complete ? timeout : 0),
				clearTimeout,
				require(name: string) {
					assert.equal(name, "@electron/remote");
					return { getCurrentWebContents: () => ({ debugger: debuggee }) };
				},
			});
		},
	};
}

test("debugger tracing streams events, refuses an overlapping run and releases its own attachment", async () => {
	const page = debuggerPage();
	assert.deepEqual(JSON.parse(JSON.stringify(await page.evaluate({ step: "start", categories: TRACE_CATEGORIES }))), {
		method: "webContents.debugger",
		pid: 1234,
	});
	assert.equal(page.debuggee.listenerCount("message"), 1);
	assert.deepEqual(JSON.parse(JSON.stringify(page.calls[0])), {
		command: "Tracing.start",
		params: {
			traceConfig: { includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] },
			transferMode: "ReportEvents",
		},
	});
	await assert.rejects(page.evaluate({ step: "start", categories: TRACE_CATEGORIES }), /already being recorded/);
	const events = [{ ph: "X", name: "RunTask", pid: 1, tid: 2, ts: 0, dur: 60_000 }];
	page.debuggee.emit("message", {}, "Tracing.dataCollected", { value: events });
	page.debuggee.emit("message", {}, "unrelated event", { value: [{ bad: true }] });
	await page.evaluate({ step: "stop" });
	assert.deepEqual(
		JSON.parse(JSON.stringify(await page.evaluate({ step: "chunk", from: 0, count: 20_000 }))),
		events,
	);
	await page.evaluate({ step: "abort" });
	assert.equal(page.window.__tcwTrace, undefined);
	assert.equal(page.debuggee.listenerCount("message"), 0);
	assert.deepEqual(page.attachments(), { attaches: 1, detaches: 1, attached: false });
	assert.equal(page.calls.filter(({ command }) => command === "Tracing.end").length, 1);
	await page.evaluate({ step: "abort" });
	assert.equal(page.calls.filter(({ command }) => command === "Tracing.end").length, 1);
});

test("debugger tracing aborts a running trace without detaching a reused connection", async () => {
	const page = debuggerPage(true);
	await page.evaluate({ step: "start", categories: TRACE_CATEGORIES });
	await page.evaluate({ step: "abort" });
	assert.equal(page.calls.filter(({ command }) => command === "Tracing.end").length, 1);
	assert.equal(page.debuggee.listenerCount("message"), 0);
	assert.equal(page.window.__tcwTrace, undefined);
	assert.deepEqual(page.attachments(), { attaches: 0, detaches: 0, attached: true });
});

test("an unsuccessful debugger start can be undone without leaving its listener or attachment", async () => {
	const page = debuggerPage(false, true);
	await assert.rejects(page.evaluate({ step: "start", categories: TRACE_CATEGORIES }), /debugger start refused/);
	await page.evaluate({ step: "abort" });
	assert.equal(page.debuggee.listenerCount("message"), 0);
	assert.equal(page.window.__tcwTrace, undefined);
	assert.deepEqual(page.attachments(), { attaches: 1, detaches: 1, attached: false });
});

test("a missing tracingComplete still removes the debugger listener and owned attachment on abort", async () => {
	const page = debuggerPage(false, false, false);
	await page.evaluate({ step: "start", categories: TRACE_CATEGORIES });
	await assert.rejects(page.evaluate({ step: "abort" }), /tracingComplete.*60 seconds/);
	assert.equal(page.debuggee.listenerCount("message"), 0);
	assert.equal(page.window.__tcwTrace, undefined);
	assert.deepEqual(page.attachments(), { attaches: 1, detaches: 1, attached: false });
});

test("the contentTracing page recorder uses the requested categories and stops into its supplied file", async () => {
	const window: Record<string, unknown> = {};
	const starts: unknown[] = [];
	const stops: string[] = [];
	const contentTracing = {
		async startRecording(options: unknown) {
			starts.push(options);
		},
		async stopRecording(output: string) {
			stops.push(output);
			return output;
		},
	};
	async function evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) {
		return (await runInNewContext(`(${fn.toString()})(argument)`, {
			argument: arg,
			window,
			process: { pid: 5678 },
			setTimeout,
			clearTimeout,
			require(name: string) {
				assert.equal(name, "@electron/remote");
				return { contentTracing };
			},
		})) as Result;
	}
	const output = "/tmp/profile-page-test.json";
	assert.deepEqual(
		JSON.parse(JSON.stringify(await evaluate(tracingStart, { categories: TRACE_CATEGORIES, path: output }))),
		{ method: "contentTracing", pid: 5678 },
	);
	assert.deepEqual(JSON.parse(JSON.stringify(starts)), [
		{ included_categories: TRACE_CATEGORIES, excluded_categories: ["*"] },
	]);
	assert.deepEqual(JSON.parse(JSON.stringify(await evaluate(tracingStop, undefined))), {
		method: "contentTracing",
		path: output,
	});
	assert.deepEqual(JSON.parse(JSON.stringify(await evaluate(tracingAbort, { path: output }))), {
		stoppedLeftover: false,
	});
	assert.equal(window.__tcwTrace, undefined);
	assert.deepEqual(stops, [output]);
	await evaluate(tracingStart, { categories: TRACE_CATEGORIES, path: output });
	assert.deepEqual(JSON.parse(JSON.stringify(await evaluate(tracingAbort, { path: output }))), {
		stoppedLeftover: false,
	});
	assert.deepEqual(stops, [output, output]);
	assert.equal(window.__tcwTrace, undefined);
});

function abortWithoutPageState(stopRecording: (output: string) => Promise<string>) {
	return runInNewContext(`(${tracingAbort.toString()})(argument)`, {
		argument: { path: "/tmp/profile-abort-test.json" },
		window: {},
		require(name: string) {
			assert.equal(name, "@electron/remote");
			return { contentTracing: { stopRecording } };
		},
	}) as Promise<{ stoppedLeftover: boolean }>;
}

test("tracingAbort stops a recording whose page state is gone", async () => {
	const stops: string[] = [];
	const result = await abortWithoutPageState(async (output) => {
		stops.push(output);
		return output;
	});
	assert.deepEqual(stops, ["/tmp/profile-abort-test.json"]);
	assert.deepEqual(JSON.parse(JSON.stringify(result)), { stoppedLeftover: true });
});

test("tracingAbort tolerates no trace in progress", async () => {
	const stops: string[] = [];
	const result = await abortWithoutPageState(async (output) => {
		stops.push(output);
		throw new Error("Failed to stop tracing - no trace in progress");
	});
	assert.deepEqual(stops, ["/tmp/profile-abort-test.json"]);
	assert.deepEqual(JSON.parse(JSON.stringify(result)), { stoppedLeftover: false });
});

test("tracingAbort propagates any other stopRecording failure", async () => {
	for (const failure of [new Error("trace output is not writable"), "stop failed", undefined]) {
		await assert.rejects(
			abortWithoutPageState(async () => {
				throw failure;
			}),
			(error: unknown) => error === failure,
		);
	}
});

function recordingCli({
	events,
	debuggerError,
	contentError,
	pid = 1234,
	arrayFile = false,
	stoppedLeftover = false,
}: {
	events: TraceEvent[];
	debuggerError?: string;
	contentError?: string;
	pid?: number;
	arrayFile?: boolean;
	stoppedLeftover?: boolean;
}) {
	const calls: string[] = [];
	const chunks: { from: number; count: number }[] = [];
	let outputPath = "";
	let running = false;
	const cli: TraceCli = {
		evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Result {
			const input = arg as Record<string, unknown> | undefined;
			const pageFunction: unknown = fn;
			if (pageFunction === debuggerTracing) {
				calls.push(`debugger:${input?.step}`);
				if (input?.step === "start") {
					if (debuggerError) throw new Error(debuggerError);
					running = true;
					return { method: "webContents.debugger", pid } as Result;
				}
				if (input?.step === "chunk") {
					const from = Number(input.from);
					const count = Number(input.count);
					chunks.push({ from, count });
					return events.slice(from, from + count) as Result;
				}
				if (input?.step === "stop") {
					running = false;
					return { method: "webContents.debugger", events: events.length } as Result;
				}
				if (input?.step === "abort") {
					running = false;
					return undefined as Result;
				}
			}
			if (pageFunction === tracingStart) {
				calls.push("content:start");
				outputPath = String(input?.path);
				if (contentError) throw new Error(contentError);
				running = true;
				return { method: "contentTracing", pid } as Result;
			}
			if (pageFunction === tracingStop) {
				calls.push("content:stop");
				writeFileSync(outputPath, JSON.stringify(arrayFile ? events : { traceEvents: events }));
				running = false;
				return { method: "contentTracing", path: outputPath } as Result;
			}
			if (pageFunction === tracingAbort) {
				calls.push("abort");
				assert.equal(input?.path, outputPath);
				running = false;
				return { stoppedLeftover } as Result;
			}
			throw new Error("unexpected page function");
		},
	};
	return {
		cli,
		calls,
		chunks,
		outputPath: () => outputPath,
		running: () => running,
		setPid(value: number) {
			pid = value;
		},
	};
}

test("the recorder's undo logs when it stops a leftover recording", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "bench-recording-test-"));
	const page = recordingCli({ events: [], stoppedLeftover: true });
	const logs: string[] = [];
	const recorder = traceRecorder(page.cli, { tmpDir: directory, log: (line) => logs.push(line) });
	try {
		recorder.start();
		recorder.undoSteps[0][1]();
		assert.equal(page.running(), false);
		assert.deepEqual(logs, [
			"bench: profile: recording with contentTracing.",
			"bench: profile: stopped a recording left behind by a crashed or reloaded window.",
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the recorder reads debugger events in bounded chunks and logs its transport only once", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "bench-recording-test-"));
	const events = Array.from({ length: 40_001 }, (_, ts) => ({ ph: "X", name: "RunTask", pid: 1, ts }));
	const page = recordingCli({ events, contentError: "content unavailable" });
	const logs: string[] = [];
	const recorder = traceRecorder(page.cli, { tmpDir: directory, log: (line) => logs.push(line) });
	try {
		assert.equal(recorder.method(), null);
		for (let run = 0; run < 2; run++) {
			recorder.start();
			assert.equal(recorder.method(), "webContents.debugger");
			assert.deepEqual(recorder.stop(), events);
			assert.equal(page.running(), false);
		}
		assert.deepEqual(
			page.chunks.map(({ from }) => from),
			[0, 20_000, 40_000, 0, 20_000, 40_000],
		);
		assert.ok(page.chunks.every(({ count }) => count > 0 && count <= 20_000));
		assert.equal(page.calls.filter((call) => call === "content:start").length, 1);
		assert.equal(logs.filter((line) => line === "bench: profile: recording with webContents.debugger.").length, 1);
	} finally {
		for (const [, undo] of recorder.undoSteps) undo();
		assert.equal(existsSync(directory), false);
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the recorder tries contentTracing first and falls back to webContents.debugger", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "bench-recording-test-"));
	const page = recordingCli({ events: [], contentError: "content unavailable" });
	const logs: string[] = [];
	const recorder = traceRecorder(page.cli, { tmpDir: directory, log: (line) => logs.push(line) });
	try {
		recorder.start();
		assert.deepEqual(page.calls, ["content:start", "abort", "debugger:start"]);
		assert.equal(recorder.method(), "webContents.debugger");
		assert.deepEqual(logs, [
			"bench: profile: contentTracing failed: content unavailable; trying webContents.debugger.",
			"bench: profile: recording with webContents.debugger.",
		]);
		recorder.stop();
		recorder.start();
		assert.equal(page.calls.filter((call) => call === "content:start").length, 1);
		assert.equal(page.calls.filter((call) => call === "debugger:start").length, 2);
		assert.equal(logs.length, 2);
	} finally {
		for (const [, undo] of recorder.undoSteps) undo();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the recorder remembers the renderer pid that tracingStart reports", () => {
	for (const contentError of [undefined, "content unavailable"]) {
		const directory = mkdtempSync(path.join(tmpdir(), "bench-recording-test-"));
		const page = recordingCli({ events: [], contentError, pid: 5678 });
		const recorder = traceRecorder(page.cli, { tmpDir: directory, log: () => {} });
		try {
			assert.equal(recorder.pid(), null);
			for (let run = 0; run < 2; run++) {
				page.setPid(5678 + run);
				recorder.start();
				assert.equal(recorder.method(), contentError ? "webContents.debugger" : "contentTracing");
				assert.equal(recorder.pid(), 5678 + run);
				recorder.stop();
				assert.equal(recorder.pid(), 5678 + run);
			}
		} finally {
			for (const [, undo] of recorder.undoSteps) undo();
			rmSync(directory, { recursive: true, force: true });
		}
	}
});

test("the recorder keeps contentTracing and removes both trace JSON formats after reading", () => {
	for (const arrayFile of [false, true]) {
		const directory = mkdtempSync(path.join(tmpdir(), "bench-recording-test-"));
		const events: TraceEvent[] = [{ ph: "M", name: "thread_name", pid: 1, tid: 2 }];
		const page = recordingCli({ events, arrayFile });
		const logs: string[] = [];
		const recorder = traceRecorder(page.cli, { tmpDir: directory, log: (line) => logs.push(line) });
		try {
			for (let run = 0; run < 2; run++) {
				recorder.start();
				assert.equal(recorder.method(), "contentTracing");
				assert.deepEqual(recorder.stop(), events);
				assert.equal(existsSync(page.outputPath()), false);
			}
			assert.equal(page.calls.filter((call) => call === "debugger:start").length, 0);
			assert.equal(page.calls.filter((call) => call === "content:start").length, 2);
			assert.deepEqual(logs, [
				"bench: profile: recording with contentTracing.",
				"bench: profile: trace 0.0 MB.",
				"bench: profile: trace 0.0 MB.",
			]);
		} finally {
			for (const [, undo] of recorder.undoSteps) undo();
			assert.equal(existsSync(directory), false);
			rmSync(directory, { recursive: true, force: true });
		}
	}
});

test("the recorder reports both failed transports and its undo also cleans an interrupted run", () => {
	for (const failBoth of [false, true]) {
		const directory = mkdtempSync(path.join(tmpdir(), "bench-recording-test-"));
		const page = recordingCli({
			events: [],
			debuggerError: failBoth ? "debugger unavailable" : undefined,
			contentError: failBoth ? "content unavailable" : undefined,
		});
		const recorder = traceRecorder(page.cli, { tmpDir: directory, log: () => {} });
		try {
			if (failBoth) {
				assert.throws(
					() => recorder.start(),
					new Error(
						"profile: could not record a trace: contentTracing: content unavailable; webContents.debugger: debugger unavailable.",
					),
				);
				assert.equal(recorder.method(), null);
				assert.equal(recorder.pid(), null);
			} else {
				recorder.start();
				assert.equal(page.running(), true);
			}
		} finally {
			for (const [, undo] of recorder.undoSteps) undo();
			assert.equal(page.running(), false);
			assert.equal(existsSync(directory), false);
			rmSync(directory, { recursive: true, force: true });
		}
	}
});
