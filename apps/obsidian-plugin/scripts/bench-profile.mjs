/**
 * Records benchmark traces and attributes renderer long-task time to bundle modules, MarkdownRenderer and browser
 * work. The trace arithmetic and report formatting are independent of Obsidian; page recording functions are sent
 * as source and use no imports.
 */

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

/** The console.timeStamp message delimiting a scenario's trace window. */
export function profileMarker(scenario, edge) {
	throw new Error("not implemented");
}

/** Maps zero-based bundle lines to esbuild module path comments, excluding ordinary comments. */
export function moduleMap(mainJs) {
	throw new Error("not implemented");
}

/** Categorises a bundle module, including React and scheduler in the react-dom bucket. */
export function moduleCategory(path) {
	throw new Error("not implemented");
}

/** Recognises the plugin's evaluated bundle URL in a sampled frame. */
export function isPluginScript(url, pluginId) {
	throw new Error("not implemented");
}

/** Finds the unique wrapper-line offset that aligns sampled function names with the bundle source. */
export function pluginLineOffset(frames, mainJs) {
	throw new Error("not implemented");
}

/** Attributes renderer long-task self time and sampled script stacks inside one marked scenario window. */
export function bucketTrace(trace, options) {
	throw new Error("not implemented");
}

/** Prints per-scenario long-task categories with base and candidate values side by side. */
export function profileTable(columns) {
	throw new Error("not implemented");
}

/** Starts page-side recording through webContents.debugger or the contentTracing fallback. */
export function tracingStart(options) {
	throw new Error("not implemented");
}

/** Stops page-side recording and returns the location or size of the collected trace. */
export function tracingStop() {
	throw new Error("not implemented");
}

/** Reads a bounded chunk of debugger trace events collected in the page. */
export function tracingReadChunk(options) {
	throw new Error("not implemented");
}

/** Aborts page-side recording and removes recording listeners and owned debugger attachments. */
export function tracingAbort() {
	throw new Error("not implemented");
}

/** Controls page recording through an injected CLI, returning cleanup steps for the enclosing run. */
export function traceRecorder(cli, options) {
	throw new Error("not implemented");
}
