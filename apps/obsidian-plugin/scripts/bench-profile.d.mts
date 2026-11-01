/** Types for trace attribution, profile tables and injected recording control. */

/** The displayed long-task categories, in table order. */
export const PROFILE_CATEGORIES: readonly [
	"core",
	"react-dom",
	"MarkdownRenderer",
	"other script",
	"style",
	"layout",
	"paint",
	"GC",
];
/** One category of exclusive renderer long-task time. */
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];
/** One traced pass is recorded for each of these scenarios in each arm. */
export const PROFILE_SCENARIOS: readonly [
	"initialLoad",
	"saveWithTasks",
	"toggle",
	"focusToday.on",
	"focusToday.off",
	"counterFilter",
	"scroll",
];
/** Chrome categories required for task boundaries, browser events and sampled JavaScript stacks. */
export const TRACE_CATEGORIES: readonly string[];
/** Top-level tasks at least this long are included, in milliseconds. */
export const LONG_TASK_MS: 50;
/** Chrome names for renderer task boundaries. */
export const TOP_LEVEL_EVENTS: readonly string[];
/** Chrome names for style computation. */
export const STYLE_EVENTS: readonly string[];
/** Chrome names for layout computation. */
export const LAYOUT_EVENTS: readonly string[];
/** Chrome names for paint and compositing work. */
export const PAINT_EVENTS: readonly string[];
/** Chrome names for garbage collection, including collection nested inside script work. */
export const GC_EVENTS: readonly string[];
/** Prefixes for additional V8 and Blink garbage-collection events. */
export const GC_EVENT_PREFIXES: readonly string[];
/** Script events whose exclusive time is split by sampled stacks; ParseHTML is included as script work. */
export const SCRIPT_EVENTS: readonly string[];
/** The public MarkdownRenderer frame name used to recognise its entire sampled stack. */
export const MARKDOWN_FUNCTION: "renderMarkdown";

/** A V8 CPU-profile frame, with zero-based source positions. */
export interface ProfileFrame {
	readonly functionName: string;
	readonly url: string;
	readonly scriptId?: string;
	readonly lineNumber: number;
	readonly columnNumber: number;
}

/** A CPU-profile stack node, linked towards its caller by parent. */
export interface ProfileNode {
	readonly id: number;
	readonly callFrame: ProfileFrame;
	readonly parent?: number;
}

/** Chrome event fields consumed by the trace parser; timestamps and durations are microseconds. */
export interface TraceEvent {
	readonly ph: string;
	readonly name: string;
	readonly pid: number;
	readonly tid?: number;
	readonly ts?: number;
	readonly dur?: number;
	readonly cat?: string;
	readonly id?: string | number;
	readonly args?: {
		readonly name?: string;
		readonly data?: {
			readonly message?: string;
			readonly startTime?: number;
			readonly cpuProfile?: {
				readonly nodes?: readonly ProfileNode[];
				readonly samples?: readonly number[];
			};
			readonly timeDeltas?: readonly number[];
		};
	};
}

/** A raw event list or the JSON document written by Chrome tracing. */
export type ProfileTrace = readonly TraceEvent[] | { readonly traceEvents: readonly TraceEvent[] };

/** The marked scenario and matching arm's bundle, with required initial-load buckets when requested. */
export interface BucketOptions {
	readonly scenario: string;
	readonly mainJs: string;
	readonly pluginId: string;
	readonly requireMarkdown?: boolean;
	readonly requireReactDom?: boolean;
}

/** A renderer thread's long-task attribution for one scenario, with times rounded to tenths of milliseconds. */
export interface ProfileSummary {
	readonly scenario: string;
	readonly thread: { readonly pid: number; readonly tid: number };
	readonly longTasks: number;
	readonly totalMs: number;
	readonly categories: Readonly<Record<ProfileCategory, number>>;
	readonly unattributedMs: number;
	readonly samples: number;
	readonly lineOffset: number | null;
}

/** A scenario that the loaded base build cannot exercise. */
export interface SkippedProfile {
	readonly skipped: string;
}

/** The console.timeStamp message delimiting a scenario's trace window. */
export function profileMarker(scenario: string, edge: "start" | "end"): string;
/** Maps zero-based bundle lines to esbuild module path comments, excluding ordinary comments. */
export function moduleMap(mainJs: string): { line: number; path: string }[];
/** Categorises a bundle module, including React and scheduler in the react-dom bucket. */
export function moduleCategory(path: string): "core" | "react-dom" | "other script";
/** Recognises the plugin's evaluated bundle URL in a sampled frame. */
export function isPluginScript(url: string, pluginId: string): boolean;
/** Finds the unique offset from 0 through 10 aligning sampled function names with the bundle source. */
export function pluginLineOffset(
	frames: readonly { readonly functionName: string; readonly lineNumber: number }[],
	mainJs: string,
): number;
/** Attributes renderer long-task self time and sampled script stacks inside one marked scenario window. */
export function bucketTrace(trace: ProfileTrace, options: BucketOptions): ProfileSummary;
/** Prints per-scenario long-task categories with base and candidate values side by side. */
export function profileTable(columns: {
	readonly base?: Readonly<Record<string, ProfileSummary | SkippedProfile>>;
	readonly candidate: Readonly<Record<string, ProfileSummary | SkippedProfile>>;
}): string[];

/** The Electron recording transport selected for this pass. */
export type TraceMethod = "webContents.debugger" | "contentTracing";

/** The recording categories and fallback output path supplied to the page. */
export interface TracingStartOptions {
	readonly categories: readonly string[];
	readonly path: string;
}

/** Where the completed page-side trace can be retrieved. */
export type TracingStopped =
	| { readonly method: "webContents.debugger"; readonly events: number }
	| { readonly method: "contentTracing"; readonly path: string };

/** One debugger recording operation evaluated in the page. */
export interface DebuggerTracingOptions {
	readonly step: "start" | "stop" | "chunk" | "abort";
	readonly categories?: readonly string[];
	readonly from?: number;
	readonly count?: number;
}

/** Cleanup actions performed by the debugger recorder. */
export interface TracingAborted {
	readonly ended: boolean;
	readonly listenerRemoved: boolean;
	readonly detached: boolean;
}

/** Controls debugger recording in a self-contained page function. */
export function debuggerTracing(
	options: DebuggerTracingOptions,
): Promise<{ readonly method: "webContents.debugger" } | TracingStopped | TraceEvent[] | TracingAborted>;

/** Starts the page-side contentTracing fallback. */
export function tracingStart(options: TracingStartOptions): Promise<{ method: TraceMethod }>;
/** Stops page-side recording and returns the location or size of the collected trace. */
export function tracingStop(): Promise<TracingStopped>;
/** Reads a bounded chunk of debugger trace events collected in the page. */
export function tracingReadChunk(options: { readonly offset: number; readonly limit: number }): TraceEvent[];
/** Aborts page-side recording and removes recording listeners and owned debugger attachments. */
export function tracingAbort(): Promise<void>;

/** The synchronous CLI boundary that evaluates an asynchronous page function and returns its JSON result. */
export interface TraceCli {
	evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg, timeout?: number): Result;
}

/** Recording control plus cleanup steps for the caller's runAndUndo. */
export interface TraceRecorder {
	method(): TraceMethod | null;
	start(): void;
	stop(): TraceEvent[];
	readonly undoSteps: readonly (readonly [description: string, undo: () => unknown])[];
}

/** Controls page recording through an injected CLI, returning cleanup steps for the enclosing run. */
export function traceRecorder(
	cli: TraceCli,
	options: { readonly tmpDir: string; readonly log: (line: string) => void },
): TraceRecorder;
