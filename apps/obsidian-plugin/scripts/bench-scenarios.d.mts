/** Types for the benchmark's injected view-scenario orchestration. */

import type { Arm } from "./bench-ab.mjs";
import type { ClickResults, ClickStep, Counts, ScrollResults, ScrollRun } from "./bench-results.mjs";

/** Measured click pairs and scrolls at each vault scale, after one warm-up pair or scroll. */
export const VIEW_RUNS: {
	readonly 1: { readonly pairs: 3; readonly scrolls: 2 };
	readonly 10: { readonly pairs: 2; readonly scrolls: 1 };
};

/** A two-second scroll from the top, covering six thousand pixels at three pixels per millisecond. */
export const SCROLL: { readonly durationMs: 2000; readonly pxPerMs: 3; readonly minScrollPx: 6000 };

/** Availability of the controls and scroll container in the loaded timeline. */
export interface ViewControls {
	readonly todayHeader: boolean;
	readonly todoCounter: boolean;
	readonly viewContent: boolean;
}

/** One click of a timeline control, measured when switching it on or off. */
export interface ClickAction {
	readonly action: "focusToday" | "counterFilter";
	readonly direction: "on" | "off";
}

/** Arguments sent to the page by the new view scenarios. */
export type ViewAction =
	| { readonly action: "controls" }
	| { readonly action: "reveal"; readonly taskPath: string; readonly taskLine: number }
	| { readonly action: "viewRestore" }
	| ClickAction
	| {
			readonly action: "scroll";
			readonly durationMs: number;
			readonly pxPerMs: number;
			readonly minScrollPx: number;
	  };

/** A named restoration step, executed even when the scenario throws. */
export type ViewUndoStep = readonly [description: string, undo: () => unknown];

/** Synchronous CLI calls and cleanup, injected instead of importing the fixture application. */
export interface ViewScenarioDeps {
	readonly evaluate: (
		arg: ViewAction,
	) => ViewControls | { revealed: boolean } | { restored: readonly string[] } | ClickStep | ScrollRun;
	readonly timed: (arg: ClickAction) => ClickStep;
	readonly scale: 1 | 10;
	readonly arm: Arm;
	readonly cpu: boolean;
	readonly label: string;
	readonly log: (line: string) => void;
	readonly runAndUndo: <T>(work: () => T, undoSteps: readonly ViewUndoStep[]) => T;
}

/** An unavailable base control, reported without a timing or verdict. */
export type SkippedScenario = {
	readonly skipped: string;
};

/** The flat scenario keys appended to the existing benchmark results. */
export interface ViewScenarioResults {
	readonly "focusToday.on": ClickResults | SkippedScenario;
	readonly "focusToday.off": ClickResults | SkippedScenario;
	readonly counterFilter: ClickResults | SkippedScenario;
	readonly scroll: ScrollResults;
}

/** Collects garbage before reading the used heap, requiring a positive finite usedSize. */
export function heapAfterLoad(cdp: (method: string, params?: object) => unknown): { usedBytes: Counts };

/** Measures the view scenarios, skipping unavailable base controls and always undoing page changes. */
export function measureViewScenarios(deps: ViewScenarioDeps): ViewScenarioResults;
