/**
 * Measures how fast the timeline reacts in a real Obsidian, in the 4,000-task vault bench-vault.mjs generates:
 * - initial load: from loading the plugin and running "Open Tasks Timeline View" until the timeline has rendered;
 * - save with tasks: from saving a note with tasks until the timeline shows the new task text;
 * - save without tasks: saving a note without tasks, which should not reload the timeline at all.
 * Besides the time until the timeline shows the change, it sums the long tasks (main-thread work over 50 ms, when
 * Obsidian does not respond to input) and records the longest one, which is what a user feels as a freeze.
 *
 * `pnpm bench` builds the plugin, measures, and compares with fixtures/bench-vault.baseline.json; it fails when the
 * fastest run of a measurement got slower by more than 25 % and 50 ms, or a save without tasks reloads the timeline. `pnpm bench --update`
 * records the new numbers as the baseline. Numbers depend on the machine and the Obsidian version, which the baseline
 * records; compare on the same setup. Other work on the machine moves the medians a lot and the fastest runs little, so
 * the fastest runs are compared, and the load average before and after the run is recorded and printed.
 *
 * Needs Obsidian running with the vault named bench-vault open: generate it with `pnpm bench:vault <folder>`, open the
 * folder in Obsidian once, and keep its window open. The script only talks to that vault, after checking its notes are
 * exactly the generated ones. It installs the build into the vault, turns community plugins on, pins today to
 * 2026-01-15, stops throttling the window while it is hidden, sizes its page through the DevTools protocol, and puts all
 * of that and the edited notes back at the end.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { BENCH_TARGETS, BENCH_VAULT_NAME, benchVaultNotes } from "./bench-vault.mjs";
import {
	buildInfo, fixtureCli, fixtureVaultPath, installPlugin, machineInfo, manifest, PINNED_TODAY, prepareApp, quietSettings,
	repoRoot, restoreApp, runAndUndo, runScript, ScriptError, TIMELINE_VIEW, unloadApp,
} from "./fixture-app.mjs";

const baselineFile = path.join(repoRoot, "fixtures", `${BENCH_VAULT_NAME}.baseline.json`);
const OPEN_COMMAND = `${manifest.id}:open-tasks-timeline-view`;
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false };
const LOADS = 5;
const WARMUP_SAVES = 2;
const SAVES = 10;
/** A change is rendered once the timeline's DOM has not changed for this long. */
const QUIET_MS = 1_000;
/** Changes to the DOM less than this far apart belong to one render. */
const BURST_GAP_MS = 500;
/** How long after Obsidian reports a save without tasks the timeline is watched for a reload. */
const NO_RELOAD_WINDOW_MS = 3_000;
/**
 * The plugin applies its settings to open views 5 s after it loads, which renders the timeline again. A load is watched
 * this long, so that render is seen and kept apart from the first one.
 */
const SETTLE_AFTER_LOAD_MS = 6_000;
/** A measurement counts as slower when its fastest run grew by more than both of these. */
const SLOWER_RATIO = 1.25;
const SLOWER_MS = 50;

/** Runs in Obsidian: one measurement. Times are milliseconds from the start of the measured action. */
async function measure({ action, viewType, pluginId, command, path, content, token, quietMs, windowMs, settleMs, burstGapMs }) {
	const leafSelector = `.workspace-leaf-content[data-type="${viewType}"]`;
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
	async function until(condition, timeoutMs, what) {
		const start = performance.now();
		while (!condition()) {
			if (performance.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
			await sleep(20);
		}
	}
	const sum = tasks => ({
		blockedMs: tasks.reduce((total, task) => total + task.duration, 0),
		longestMs: Math.max(0, ...tasks.map(task => task.duration)),
		longTasks: tasks.length,
	});
	/**
	 * Records the long tasks, and the changes to the timeline's DOM: their times, when task rows first show up, and when
	 * the token does.
	 */
	function record(root) {
		const longTasks = [];
		const performanceObserver = new PerformanceObserver(list => {
			for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
		});
		performanceObserver.observe({ type: "longtask" });
		const seen = { first: null, last: null, token: null, times: [], rowsAt: null };
		const liveRows = document.getElementsByClassName("task");
		const inView = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(leafSelector);
		const text = change => change.type === "characterData" ? change.target.data : [...change.addedNodes].map(node => node.textContent).join(" ");
		const mutationObserver = new MutationObserver(changes => {
			const now = performance.now();
			const relevant = changes.filter(change => inView(change.target));
			if (relevant.length === 0) return;
			seen.first ??= now;
			seen.last = now;
			seen.times.push(now);
			if (seen.rowsAt === null && [...liveRows].some(row => row.closest(leafSelector))) seen.rowsAt = now;
			if (token && seen.token === null && relevant.some(change => text(change).includes(token))) seen.token = now;
		});
		mutationObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
		let work = null;
		return {
			seen,
			/** Stops recording and sums the long tasks that started at `from` or later. Later calls return the same. */
			stop(from) {
				if (work) return work;
				for (const entry of performanceObserver.takeRecords()) longTasks.push({ start: entry.startTime, duration: entry.duration });
				performanceObserver.disconnect();
				mutationObserver.disconnect();
				work = sum(longTasks.filter(task => task.start >= from));
				work.tasks = longTasks;
				return work;
			},
		};
	}
	/**
	 * Counts the calls of the open view's onReloadTasks, if it has one, as an unchanged list reloads without changing
	 * the DOM. Returns a function that undoes the counting and returns the count, or null without that method.
	 */
	function countReloads() {
		const view = app.workspace.getLeavesOfType(viewType)[0]?.view;
		if (typeof view?.onReloadTasks !== "function") return () => null;
		const own = Object.prototype.hasOwnProperty.call(view, "onReloadTasks");
		const original = view.onReloadTasks;
		let calls = 0;
		view.onReloadTasks = function (...args) {
			calls++;
			return original.apply(this, args);
		};
		return () => {
			if (own) view.onReloadTasks = original;
			else delete view.onReloadTasks;
			return calls;
		};
	}
	const quietFor = (seen, ms) => () => seen.last !== null && performance.now() - seen.last >= ms;
	const rows = () => document.querySelectorAll(`${leafSelector} .task`).length;

	switch (action) {
		case "unload": {
			app.workspace.detachLeavesOfType(viewType);
			if (app.plugins.plugins[pluginId]) await app.plugins.disablePlugin(pluginId);
			await sleep(1_000);
			return true;
		}
		case "load": {
			// The command opens the timeline in the right sidebar, where a collapsed sidebar would keep it from loading.
			app.workspace.rightSplit.expand();
			const recorder = record(document.body);
			const start = performance.now();
			try {
				if (!await app.plugins.enablePlugin(pluginId)) throw new Error(`Obsidian could not load the plugin ${pluginId}`);
				if (!app.commands.executeCommandById(command)) throw new Error(`the command ${command} did not run`);
				await until(() => performance.now() - start >= settleMs && quietFor(recorder.seen, quietMs)(), 60_000, "the timeline to stop changing");
				const { seen } = recorder;
				if (seen.rowsAt === null) throw new Error("the timeline rendered no task rows (.task)");
				// The first render with rows ends at the first pause of burstGapMs; what comes later is another render.
				let end = seen.rowsAt;
				for (const time of seen.times) {
					if (time <= end) continue;
					if (time - end >= burstGapMs) break;
					end = time;
				}
				const later = seen.times.filter(time => time > end);
				const { tasks } = recorder.stop(start);
				const first = sum(tasks.filter(task => task.start >= start && task.start <= end));
				return {
					renderedMs: end - start,
					rows: rows(),
					// The plugin's reload 5 s after loading starts while the first render is still going on.
					reachedSettingsTimer: end - start >= settleMs - 1_500,
					...first,
					laterRenders: later.filter((time, i) => i === 0 || time - later[i - 1] >= burstGapMs).length,
					laterBlockedMs: sum(tasks.filter(task => task.start > end)).blockedMs,
				};
			} finally {
				recorder.stop(start);
			}
		}
		case "settle": {
			// Lets the reloads that follow loading the plugin pass, so they do not land in the next measurement.
			const recorder = record(document.body);
			try {
				await sleep(settleMs);
				await until(() => recorder.seen.last === null || quietFor(recorder.seen, quietMs)(), 30_000, "the timeline to stop changing");
				return { rows: rows() };
			} finally {
				recorder.stop(0);
			}
		}
		case "save": {
			const file = app.vault.getAbstractFileByPath(path);
			if (!file) throw new Error(`the vault has no note ${path}`);
			const root = document.querySelector(leafSelector);
			if (!root) throw new Error("the timeline view is not open");
			const recorder = record(root);
			const reloadCalls = countReloads();
			let changed = null;
			const ref = app.metadataCache.on("changed", changedFile => { if (changedFile.path === path) changed ??= performance.now(); });
			const start = performance.now();
			try {
				await app.vault.modify(file, content);
				const saved = performance.now();
				await until(() => changed !== null, 30_000, "Obsidian to read the saved note");
				if (token) {
					await until(() => recorder.seen.token !== null, 30_000, `the timeline to show "${token}"`);
					await until(quietFor(recorder.seen, quietMs), 30_000, "the timeline to stop changing");
				} else {
					await sleep(windowMs);
				}
				const { tasks, ...work } = recorder.stop(start);
				const calls = reloadCalls();
				return {
					savedMs: saved - start,
					indexedMs: changed - start,
					renderedMs: recorder.seen.token === null ? null : recorder.seen.token - start,
					reloadCalls: calls,
					reloaded: recorder.seen.first !== null || calls > 0,
					...work,
				};
			} finally {
				recorder.stop(start);
				reloadCalls();
				app.metadataCache.offref(ref);
			}
		}
		case "restore": {
			const file = app.vault.getAbstractFileByPath(path);
			if (file && await app.vault.read(file) !== content) await app.vault.modify(file, content);
			return true;
		}
		default:
			throw new Error(`unknown action ${action}`);
	}
}

const median = values => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = value => Math.round(value * 10) / 10;
function summary(samples) {
	return { medianMs: round(median(samples)), minMs: round(Math.min(...samples)), maxMs: round(Math.max(...samples)), samplesMs: samples.map(round) };
}

/** The note with tasks, with a token in the text of its first task, so the timeline has something new to show. */
function withToken(original, token) {
	const edited = original.replace(/^(- \[ \] Task \d{4} a)/m, `$1 ${token}`);
	if (edited === original) throw new ScriptError(`${BENCH_TARGETS.withTasks} has no "Task NNNN a" task to edit.`);
	return edited;
}

function measureAll(cli, notes) {
	const args = { viewType: TIMELINE_VIEW, pluginId: manifest.id, command: OPEN_COMMAND, quietMs: QUIET_MS };
	const loads = [];
	for (let run = 0; run < LOADS; run++) {
		cli.evaluate(measure, { ...args, action: "unload" });
		const load = cli.evaluate(measure, { ...args, action: "load", settleMs: SETTLE_AFTER_LOAD_MS, burstGapMs: BURST_GAP_MS });
		console.log(`bench: initial load ${run + 1}: rendered ${round(load.renderedMs)} ms, ${load.rows} rows, longest task ${round(load.longestMs)} ms; ${load.laterRenders} later render(s) blocking ${round(load.laterBlockedMs)} ms`);
		if (load.reachedSettingsTimer) console.warn("bench: warning: this load took so long that the reload the plugin does 5 s after loading may be part of it.");
		loads.push(load);
	}
	cli.evaluate(measure, { ...args, action: "settle", settleMs: SETTLE_AFTER_LOAD_MS });

	const withTasks = [];
	const original = notes.get(BENCH_TARGETS.withTasks);
	for (let run = 0; run < WARMUP_SAVES + SAVES; run++) {
		const token = `bench${run}x${Date.now().toString(36)}`;
		const save = cli.evaluate(measure, { ...args, action: "save", path: BENCH_TARGETS.withTasks, content: withToken(original, token), token });
		if (run >= WARMUP_SAVES) withTasks.push(save);
		console.log(`bench: save with tasks ${run < WARMUP_SAVES ? "(warm-up)" : run - WARMUP_SAVES + 1}: rendered ${round(save.renderedMs)} ms, longest task ${round(save.longestMs)} ms`);
	}

	const withoutTasks = [];
	const plain = notes.get(BENCH_TARGETS.withoutTasks);
	for (let run = 0; run < WARMUP_SAVES + SAVES; run++) {
		const content = `${plain}\nEdited by the benchmark, run ${run}.\n`;
		const save = cli.evaluate(measure, { ...args, action: "save", path: BENCH_TARGETS.withoutTasks, content, token: null, windowMs: NO_RELOAD_WINDOW_MS });
		if (run >= WARMUP_SAVES) withoutTasks.push(save);
		console.log(`bench: save without tasks ${run < WARMUP_SAVES ? "(warm-up)" : run - WARMUP_SAVES + 1}: ${save.reloaded ? `reloaded (${save.reloadCalls ?? "?"} reload calls)` : "no reload"}, longest task ${round(save.longestMs)} ms`);
	}

	return {
		initialLoad: {
			runs: loads.length,
			rows: loads[0].rows,
			reachedSettingsTimer: loads.filter(load => load.reachedSettingsTimer).length,
			renderedMs: summary(loads.map(load => load.renderedMs)),
			blockedMs: summary(loads.map(load => load.blockedMs)),
			longestTaskMs: summary(loads.map(load => load.longestMs)),
			// Renders within 6 s after the first one, such as the plugin's reload 5 s after loading.
			laterRenders: loads.map(load => load.laterRenders),
			laterBlockedMs: summary(loads.map(load => load.laterBlockedMs)),
		},
		saveWithTasks: {
			runs: withTasks.length,
			indexedMs: summary(withTasks.map(save => save.indexedMs)),
			renderedMs: summary(withTasks.map(save => save.renderedMs)),
			blockedMs: summary(withTasks.map(save => save.blockedMs)),
			longestTaskMs: summary(withTasks.map(save => save.longestMs)),
		},
		saveWithoutTasks: {
			runs: withoutTasks.length,
			reloads: withoutTasks.filter(save => save.reloaded).length,
			indexedMs: summary(withoutTasks.map(save => save.indexedMs)),
			blockedMs: summary(withoutTasks.map(save => save.blockedMs)),
			longestTaskMs: summary(withoutTasks.map(save => save.longestMs)),
		},
	};
}

/**
 * Prints the fastest and the median run next to the baseline's and returns how many got slower. Judged by the fastest
 * run: other work on the machine only adds time, and moved the medians of the same build by up to 25 % between runs,
 * the fastest runs by under 5 %.
 */
function compare(baseline, results) {
	let slower = 0;
	const cell = value => String(value ?? "-").padStart(8);
	console.log(`bench: ${"(ms)".padEnd(32)} ${"fastest: baseline".padStart(17)} ${"now".padStart(8)} ${"change".padStart(7)}   median: baseline      now`);
	for (const [scenario, metrics] of Object.entries(results)) {
		for (const [metric, value] of Object.entries(metrics)) {
			if (typeof value !== "object" || Array.isArray(value)) continue;
			const before = baseline.results[scenario]?.[metric];
			const name = `${scenario}.${metric}`.padEnd(32);
			if (before === undefined) {
				console.log(`bench: ${name} ${cell(null).padStart(17)} ${cell(value.minMs)}                ${cell(null)} ${cell(value.medianMs)}`);
				continue;
			}
			// How long Obsidian takes to read a note is not up to the plugin, so it is shown but not judged.
			const isSlower = metric !== "indexedMs" && value.minMs > before.minMs * SLOWER_RATIO && value.minMs - before.minMs > SLOWER_MS;
			if (isSlower) slower++;
			const change = before.minMs === 0 ? "" : `${value.minMs >= before.minMs ? "+" : ""}${Math.round(100 * (value.minMs - before.minMs) / before.minMs)} %`;
			console.log(`bench: ${name} ${cell(before.minMs).padStart(17)} ${cell(value.minMs)} ${change.padStart(7)}   ${cell(before.medianMs).padStart(16)} ${cell(value.medianMs)}${isSlower ? "  SLOWER" : ""}`);
		}
	}
	if (results.initialLoad.rows !== baseline.results.initialLoad?.rows) {
		console.warn(`bench: warning: the timeline shows ${results.initialLoad.rows} task rows, the baseline ${baseline.results.initialLoad?.rows}; it renders something else now.`);
	}
	const reloads = results.saveWithoutTasks.reloads;
	if (reloads > (baseline.results.saveWithoutTasks?.reloads ?? 0)) {
		console.log(`bench: saving a note without tasks reloaded the timeline ${reloads} of ${results.saveWithoutTasks.runs} times.  SLOWER`);
		slower++;
	}
	return slower;
}

await runScript("bench", async () => {
	const unknown = process.argv.slice(2).filter(arg => arg !== "--update");
	if (unknown.length) throw new ScriptError(`unknown arguments ${JSON.stringify(unknown)}; the only one is --update.`);
	const update = process.argv.includes("--update");
	// Checked before the run, which takes minutes, rather than after it.
	if (!update && !existsSync(baselineFile)) throw new ScriptError(`there is no baseline ${path.relative(repoRoot, baselineFile)}. Record one with \`pnpm bench --update\`.`);
	const build = buildInfo();
	const cli = fixtureCli(BENCH_VAULT_NAME);
	const notes = benchVaultNotes();
	const vaultPath = fixtureVaultPath(cli, BENCH_VAULT_NAME, notes,
		`Generate it with \`pnpm bench:vault <folder named ${BENCH_VAULT_NAME}>\`, open the folder with "Open folder as vault", then run this again.`);

	const plugin = installPlugin(vaultPath, quietSettings());
	const { env, results } = runAndUndo(() => {
		const prepared = cli.evaluate(prepareApp, { pluginId: manifest.id, today: PINNED_TODAY });
		if (prepared.today !== "2026-01-15 Thursday") throw new ScriptError(`pinning today failed: Obsidian says it is ${prepared.today}.`);
		cli.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
		const env = {
			obsidianVersion: cli.run("version"),
			electron: prepared.electron,
			chrome: prepared.chrome,
			machine: machineInfo(),
			viewport: VIEWPORT,
			today: prepared.today,
			windowVisibility: prepared.visibility,
		};
		// Other work on the machine slows the timeline down as much as a change could; the load average shows it.
		const loadBefore = os.loadavg()[0];
		const results = measureAll(cli, notes);
		env.loadAverage = { before: Math.round(loadBefore * 10) / 10, after: Math.round(os.loadavg()[0] * 10) / 10, cores: os.cpus().length };
		return { env, results };
	}, [
		...Object.values(BENCH_TARGETS).map(target =>
			[`restore ${target}`, () => cli.evaluate(measure, { action: "restore", path: target, content: notes.get(target) })]),
		["clear the page size", () => cli.cdp("Emulation.clearDeviceMetricsOverride")],
		["unload the plugin", () => cli.evaluate(unloadApp, { pluginId: manifest.id, viewType: TIMELINE_VIEW })],
		["restore the plugin folder", () => plugin.restore()],
		["restore the app", () => cli.evaluate(restoreApp, { pluginId: manifest.id })],
	]);

	const record = {
		note: "Measured by apps/obsidian-plugin/scripts/bench.mjs (`pnpm bench --update`). Do not edit by hand.",
		measuredAt: new Date().toISOString().slice(0, 10),
		...env,
		plugin: build,
		vault: { notes: notes.size, tasks: 4000, withTasks: BENCH_TARGETS.withTasks, withoutTasks: BENCH_TARGETS.withoutTasks },
		settings: { quietMs: QUIET_MS, noReloadWindowMs: NO_RELOAD_WINDOW_MS, warmupSaves: WARMUP_SAVES },
		results,
	};
	if (update) {
		// A baseline that reloads on saves without tasks would make that the expected behaviour.
		if (results.saveWithoutTasks.reloads > 0) {
			throw new ScriptError(`saving a note without tasks reloaded the timeline ${results.saveWithoutTasks.reloads} times; not recording that as the baseline.`);
		}
		writeFileSync(baselineFile, JSON.stringify(record, null, "\t") + "\n");
		console.log(`bench: wrote the baseline to ${path.relative(repoRoot, baselineFile)}`);
		return 0;
	}
	const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
	console.log(`bench: 1-minute load average ${env.loadAverage.before} before and ${env.loadAverage.after} after the run (${env.loadAverage.cores} cores); the baseline had ${baseline.loadAverage?.before} and ${baseline.loadAverage?.after}.`);
	for (const key of ["obsidianVersion", "machine", "viewport", "today"]) {
		if (JSON.stringify(baseline[key]) !== JSON.stringify(env[key])) {
			console.warn(`bench: warning: the baseline was measured with ${key} ${JSON.stringify(baseline[key])}, this run has ${JSON.stringify(env[key])}; the numbers are not comparable.`);
		}
	}
	const slower = compare(baseline, results);
	console.log(slower ? `bench: ${slower} measurement(s) got slower than the baseline.` : "bench: nothing got slower than the baseline.");
	return slower ? 1 : 0;
});
