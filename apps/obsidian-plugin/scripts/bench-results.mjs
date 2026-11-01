/**
 * What scripts/bench.mjs makes of the times it measures in Obsidian, and how it judges them against the baseline. Plain
 * arithmetic, apart from the measuring, so tests/bench.test.ts can test it.
 */

/** A measurement counts as slower when its fastest run grew by more than both of these. */
export const SLOWER_RATIO = 1.25;
export const SLOWER_MS = 50;

/** Full scenario.metric names of counts reported without change warnings or verdicts. */
export const REPORT_ONLY_COUNTS = Object.freeze(new Set());

/** Summarises a view control's measured clicks, with CPU timings only when requested. */
export function clickResults(steps, cpu) {
	throw new Error("not implemented");
}

/** Summarises the on and off clicks separately under the flat Focus on today scenario names. */
export function focusTodayResults(pairs, cpu) {
	throw new Error("not implemented");
}

/** Computes nearest-rank p95 and counts from consecutive animation-frame timestamps. */
export function frameStats(timestamps) {
	throw new Error("not implemented");
}

/** Summarises scroll frame timings and counts, retaining the observed visibility states. */
export function scrollResults(runs) {
	throw new Error("not implemented");
}

/** Summarises used heap bytes collected after garbage collection. */
export function heapResults(usedSizes) {
	throw new Error("not implemented");
}

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const round = (value) => Math.round(value * 10) / 10;

/** The median, the fastest and the slowest run of a timing, in milliseconds. */
export function summary(samples) {
	return {
		medianMs: round(median(samples)),
		minMs: round(Math.min(...samples)),
		maxMs: round(Math.max(...samples)),
		samplesMs: samples.map(round),
	};
}

/** The same for counts, such as the notes read. */
export function counts(samples) {
	return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples), samples };
}

/** Checks zero-based task lines; splitting only at LF also preserves trailing spaces, CR and the final newline. */
export function assertToggleChanges(original, actual, lines) {
	const before = original.split("\n");
	const after = actual.split("\n");
	const ticked = new Set(lines);
	for (const line of ticked) {
		if (!Number.isInteger(line) || line < 0 || line >= before.length)
			throw new Error(`toggle: invalid task line ${line + 1}`);
	}
	for (let line = 0; line < Math.max(before.length, after.length); line++) {
		if (ticked.has(line)) {
			if (!/^\s*[-*+] \[ \] /.test(before[line]) || !/^\s*[-*+] \[x\] /.test(after[line] ?? ""))
				throw new Error(`toggle: line ${line + 1} was not ticked from [ ] to [x]`);
		} else if (before[line] !== after[line]) {
			throw new Error(`toggle: line ${line + 1} changed although it was not ticked`);
		}
	}
}

/** Restoration must read back the original bytes, including the final newline; a missing note fails too. */
export function assertToggleRestored(path, original, actual) {
	if (actual !== original) throw new Error(`toggle: could not restore ${path} to its original bytes`);
}

/** A null overlay time records a click with no overlay within the 200 ms guard check. */
export function countIgnoredClicks(log) {
	return log.filter((click) => click.overlayMs === null).length;
}

/** The long tasks summed up: the time Obsidian did not respond, and the longest freeze. */
export function sumTasks(tasks) {
	return {
		blockedMs: tasks.reduce((total, task) => total + task.duration, 0),
		longestMs: Math.max(0, ...tasks.map((task) => task.duration)),
		longTasks: tasks.length,
	};
}

/** When the frame that shows the changes made up to `time` was painted: the first frame that started after them. */
export function paintedAfter(frames, time) {
	const frame = frames.find((candidate) => candidate.startedAt >= time);
	if (!frame) throw new Error("no frame was painted after the timeline changed");
	return frame.paintedAt;
}

/**
 * A load, from the times measured in Obsidian, all in milliseconds from enabling the plugin: the first render with
 * task rows ends at the first pause of `burstGapMs` after the rows appear, and is on screen when the next frame is
 * painted; what changes the timeline after that are later renders, such as the reload after the options push. The
 * long tasks are summed for the first render, for what comes after it, and for the whole load.
 */
export function splitLoad(raw, burstGapMs) {
	if (raw.rowsAt === null) throw new Error("the timeline rendered no task rows (.task)");
	let end = raw.rowsAt;
	for (const time of raw.times) {
		if (time <= end) continue;
		if (time - end >= burstGapMs) break;
		end = time;
	}
	const painted = paintedAfter(raw.frames, end);
	const later = raw.times.filter((time) => time > painted);
	return {
		renderedMs: painted,
		rows: raw.rows,
		filesRead: raw.filesRead,
		...sumTasks(raw.tasks.filter((task) => task.start >= 0 && task.start < painted)),
		laterRenders: later.filter((time, i) => i === 0 || time - later[i - 1] >= burstGapMs).length,
		laterBlockedMs: sumTasks(raw.tasks.filter((task) => task.start >= painted)).blockedMs,
		totalBlockedMs: sumTasks(raw.tasks.filter((task) => task.start >= 0)).blockedMs,
	};
}

/**
 * The timings shown but not judged in the vault at a scale:
 * - indexedMs: how long Obsidian takes to read a saved note, which is not up to the plugin;
 * - overlayPaintedMs: the toggle overlay's first painted frame, recorded only for reporting;
 * - laterBlockedMs in the 40,000-task vault: the work after a load's first render. The plugin pushes its options to
 *   the view 200 ms after it loads; whether that lands before the first render is painted or after it is a race, and
 *   after it the timeline reloads and renders again. With the noise of a busy machine on top, this moved between
 *   1.7 s and 7.1 s across loads of the same build. The whole load's work, totalBlockedMs, moved 1.6 %, and is judged
 *   instead; the push's own reload and render are also judged in optionChange, which runs the same code. In the
 *   4,000-task vault laterBlockedMs stayed within 230-245 ms over 20 loads, and is judged.
 */
export function notJudgedAt(scale) {
	return new Set(
		scale === 1 ? ["indexedMs", "overlayPaintedMs"] : ["indexedMs", "overlayPaintedMs", "laterBlockedMs"],
	);
}

const isTiming = (value) => typeof value === "object" && value !== null && "minMs" in value;
const isCount = (value) => typeof value === "object" && value !== null && "min" in value && "samples" in value;

/**
 * The fastest and the median run next to the baseline's, and how many got slower, for the vault at `scale`. Judged by
 * the fastest run: other work on the machine only adds time, and moved the medians of the same build by up to 25 %
 * between runs, the fastest runs by under 5 %. Counts are shown and not judged; so are timings the baseline does not
 * have, which a warning names.
 */
export function compare(baseline, results, scale = 1) {
	const notJudged = notJudgedAt(scale);
	const missing = [];
	const lines = [];
	const warnings = [];
	let slower = 0;
	const cell = (value) => String(value ?? "-").padStart(8);
	const row = (name, was, now, change, wasMedian, nowMedian) =>
		`bench: ${name.padEnd(44)} ${cell(was).padStart(17)} ${cell(now)} ${change.padStart(7)}   ${cell(wasMedian).padStart(16)} ${cell(nowMedian)}`;
	lines.push(row("(ms)", "fastest: baseline", "now", "change", "median: baseline", "now"));
	for (const [scenario, metrics] of Object.entries(results)) {
		for (const [metric, value] of Object.entries(metrics)) {
			const before = baseline.results[scenario]?.[metric];
			const name = `${scenario}.${metric}`;
			if (isCount(value)) {
				const was = isCount(before) ? before : undefined;
				lines.push(row(`${name} (count)`, was?.min, value.min, "", was?.median, value.median));
				continue;
			}
			if (!isTiming(value)) continue;
			if (!isTiming(before)) {
				lines.push(row(name, null, value.minMs, "", null, value.medianMs) + "  no baseline");
				missing.push(name);
				continue;
			}
			const judged = !notJudged.has(metric);
			const isSlower =
				judged && value.minMs > before.minMs * SLOWER_RATIO && value.minMs - before.minMs > SLOWER_MS;
			if (isSlower) slower++;
			const change =
				before.minMs === 0
					? ""
					: `${value.minMs >= before.minMs ? "+" : ""}${Math.round((100 * (value.minMs - before.minMs)) / before.minMs)} %`;
			lines.push(
				row(name, before.minMs, value.minMs, change, before.medianMs, value.medianMs) +
					(isSlower ? "  SLOWER" : judged ? "" : "  not judged"),
			);
		}
	}
	if (missing.length) {
		warnings.push(
			`bench: warning: the baseline has no ${missing.join(", ")}; they are not judged until it is recorded again with \`pnpm bench --update${scale === 1 ? "" : ` --scale ${scale}`}\`.`,
		);
	}
	if (results.initialLoad.rows !== baseline.results.initialLoad?.rows) {
		warnings.push(
			`bench: warning: the timeline shows ${results.initialLoad.rows} task rows, the baseline ${baseline.results.initialLoad?.rows}; it renders something else now.`,
		);
	}
	const reloads = results.saveWithoutTasks.reloads;
	if (reloads > (baseline.results.saveWithoutTasks?.reloads ?? 0)) {
		lines.push(
			`bench: saving a note without tasks reloaded the timeline ${reloads} of ${results.saveWithoutTasks.runs} times.  SLOWER`,
		);
		slower++;
	}
	return { lines, warnings, slower };
}
