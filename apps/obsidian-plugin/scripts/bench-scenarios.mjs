/**
 * Node-side orchestration of the benchmark's view controls, scrolling and heap measurements. Page calls, cleanup
 * and logging are injected so the scenario policy can be tested without starting Obsidian.
 */
import { SAVE_MARKER } from "./bench-notes.mjs";
import { clickResults, focusTodayResults, frameStats, heapResults, round, scrollResults } from "./bench-results.mjs";

/** Measured click pairs and scrolls at each vault scale, after one warm-up pair or scroll. */
export const VIEW_RUNS = { 1: { pairs: 3, scrolls: 2 }, 10: { pairs: 2, scrolls: 1 } };

/** A two-second scroll from the top, covering six thousand pixels at three pixels per millisecond. */
export const SCROLL = { durationMs: 2000, pxPerMs: 3, minScrollPx: 6000 };

/** Collects garbage before reading the used heap, naming a failed CDP method in its error. */
export function heapAfterLoad(cdp) {
	const call = (method) => {
		try {
			return cdp(method);
		} catch (error) {
			throw new Error(`heapAfterLoad: ${method} failed: ${error?.message ?? String(error)}`);
		}
	};
	call("HeapProfiler.collectGarbage");
	const answer = call("Runtime.getHeapUsage");
	if (typeof answer?.usedSize !== "number" || !Number.isFinite(answer.usedSize) || answer.usedSize <= 0)
		throw new Error(
			`heapAfterLoad: Runtime.getHeapUsage returned no positive usedSize (got ${JSON.stringify(answer)}).`,
		);
	return heapResults([answer.usedSize]);
}

/** Measures the view scenarios, skipping unavailable base controls and always undoing page changes. */
export function measureViewScenarios({ evaluate, timed, scale, arm, cpu, label, log, runAndUndo }) {
	const controls = evaluate({ action: "controls" });
	const runs = VIEW_RUNS[scale];
	const reveal = () => evaluate({ action: "reveal", taskPath: SAVE_MARKER.path, taskLine: SAVE_MARKER.line });
	const restore = () => evaluate({ action: "viewRestore" });
	const runName = (run) => (run === 0 ? "(warm-up)" : run);
	const click = (action, direction, run) => {
		const step = timed({ action, direction });
		log(
			`bench: ${label}${action} ${direction} ${runName(run)}: painted ${round(step.paintedMs)} ms, blocked ${round(step.blockedMs)} ms, longest task ${round(step.longestMs)} ms${cpu ? `, main thread ${round(step.cpuMs)} ms` : ""}`,
		);
		return step;
	};
	const skipped = (scenario, control, selector) => {
		if (arm === "candidate")
			throw new Error(
				`${scenario}: the candidate's timeline has no ${control} (${selector}); a moved control must not drop the scenario, so update the selector in bench-measure.mjs.`,
			);
		const reason = `the loaded build has no ${control}`;
		log(`bench: ${label}${scenario}: skipped (${reason}); not judged.`);
		return { skipped: reason };
	};
	let focus;
	if (!controls.todayHeader) {
		const result = skipped("focusToday", "Focus on today control", ".todayHeader in the entry day");
		focus = { "focusToday.on": result, "focusToday.off": result };
	} else {
		focus = runAndUndo(() => {
			reveal();
			const pairs = [];
			for (let run = 0; run <= runs.pairs; run++) {
				const on = click("focusToday", "on", run);
				const off = click("focusToday", "off", run);
				if (run > 0) pairs.push({ on, off });
			}
			return focusTodayResults(pairs, cpu);
		}, [["turn Focus on today off", restore]]);
	}
	const counterFilter = !controls.todoCounter
		? skipped("counterFilter", "Todo counter", ".counter#todo")
		: runAndUndo(() => {
				reveal();
				const steps = [];
				for (let run = 0; run <= runs.pairs; run++) {
					const step = click("counterFilter", "on", run);
					evaluate({ action: "counterFilter", direction: "off" });
					if (run > 0) steps.push(step);
				}
				return clickResults(steps, cpu);
			}, [["turn the Todo filter off", restore]]);
	if (!controls.viewContent) throw new Error("scroll: the timeline leaf has no .view-content to scroll.");
	const scroll = runAndUndo(() => {
		const steps = [];
		for (let run = 0; run <= runs.scrolls; run++) {
			const step = evaluate({ action: "scroll", ...SCROLL });
			const stats = frameStats(step.timestamps);
			log(
				`bench: ${label}scroll ${runName(run)}: p95 frame ${stats.p95FrameMs} ms, ${stats.framesOver50Ms} frames over 50 ms, ${stats.frames} frames, visibility ${step.visibilityState}`,
			);
			if (run > 0) steps.push(step);
		}
		return scrollResults(steps);
	}, [["scroll the timeline back to the top", restore]]);
	return { ...focus, counterFilter, scroll };
}
