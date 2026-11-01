/**
 * Node-side orchestration of the benchmark's view controls, scrolling and heap measurements. Page calls, cleanup
 * and logging are injected so the scenario policy can be tested without starting Obsidian.
 */

/** Measured click pairs and scrolls at each vault scale, after one warm-up pair or scroll. */
export const VIEW_RUNS = { 1: { pairs: 3, scrolls: 2 }, 10: { pairs: 2, scrolls: 1 } };

/** A two-second scroll from the top, covering six thousand pixels at three pixels per millisecond. */
export const SCROLL = { durationMs: 2000, pxPerMs: 3, minScrollPx: 6000 };

/** Collects garbage before reading the used heap, naming a failed CDP method in its error. */
export function heapAfterLoad(cdp) {
	throw new Error("not implemented");
}

/** Measures the view scenarios, skipping unavailable base controls and always undoing page changes. */
export function measureViewScenarios(deps) {
	throw new Error("not implemented");
}
