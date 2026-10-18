/**
 * Measures how fast the timeline reacts in a real Obsidian, in the 4,000-task vault bench-vault.mjs generates, or with
 * `--scale 10` in the 40,000-task one:
 * - initial load: from loading the plugin and running "Open Tasks Timeline View" until the timeline has rendered;
 * - save with tasks: from saving a note with tasks until the timeline shows the new task text;
 * - save without tasks: saving a note without tasks, which should not reload the timeline at all;
 * - option change: turning the relative dates off through the plugin's writeOptions, as the settings tab does, until the
 *   timeline shows it, then on again; data.json has to be byte for byte as it was after that.
 * Besides the time until the timeline shows the change, it sums the long tasks (main-thread work over 50 ms, when
 * Obsidian does not respond to input) and records the longest one, which is what a user feels as a freeze. It also
 * counts the notes read (vault.cachedRead calls), and for option changes the timeline's reloads and how often Obsidian
 * called the plugin's onExternalSettingsChange after it saved. The arithmetic and the comparison are in
 * bench-results.mjs.
 *
 * `pnpm bench` builds the plugin, measures, and compares with fixtures/bench-vault.baseline.json; it fails when the
 * fastest run of a measurement got slower by more than 25 % and 50 ms, or a save without tasks reloads the timeline.
 * `pnpm bench --update` records the new numbers as the baseline. `pnpm bench --scale 10` does the same in bench-vault-x10,
 * with fixtures/bench-vault-x10.baseline.json and 3 runs of each measurement. Numbers depend on the machine and the Obsidian version, which the baseline
 * records; compare on the same setup. Other work on the machine moves the medians a lot and the fastest runs little, so
 * the fastest runs are compared, and the load average before and after the run is recorded and printed.
 *
 * Needs Obsidian running with the vault named bench-vault (bench-vault-x10) open: generate it with
 * `pnpm bench:vault <folder> [--scale 10]`, open the folder in Obsidian once, and keep its window open. The script only talks to that vault, after checking its notes are
 * exactly the generated ones. It installs the build into the vault, turns community plugins on, pins today to
 * 2026-01-15, stops throttling the window while it is hidden, sizes its page through the DevTools protocol, and puts all
 * of that and the edited notes back at the end.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { compare, counts, round, splitLoad, summary } from "./bench-results.mjs";
import { BENCH_TARGETS, benchVaultName, benchVaultNotes, scaleOf, withoutScale } from "./bench-notes.mjs";
import {
	buildInfo,
	fixtureCli,
	fixtureVaultPath,
	fixtureWindow,
	installPlugin,
	machineInfo,
	manifest,
	quietSettings,
	repoRoot,
	runAndUndo,
	runScript,
	ScriptError,
	TIMELINE_VIEW,
} from "./fixture-app.mjs";

const OPEN_COMMAND = `${manifest.id}:open-tasks-timeline-view`;
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false };
/** The measured runs at each scale; the large vault has fewer, so that a run takes minutes rather than an hour. */
const RUNS = { 1: { loads: 5, saves: 10, optionChanges: 5 }, 10: { loads: 3, saves: 3, optionChanges: 3 } };
const WARMUP_SAVES = 2;
const WARMUP_OPTION_CHANGES = 1;
/** A change is rendered once the timeline's DOM has not changed for this long. */
const QUIET_MS = 1_000;
/** Changes to the DOM less than this far apart belong to one render. */
const BURST_GAP_MS = 500;
/** How long after Obsidian reports a save without tasks the timeline is watched for a reload. */
const NO_RELOAD_WINDOW_MS = 3_000;
/**
 * The plugin pushes its options to open views 200 ms after it loads (#203), which renders the timeline again. A load is
 * watched until it shows task rows, at least this long, and then until the timeline is quiet, so that render is seen and
 * counted apart from the first one.
 */
const LOAD_WATCH_MS = 2_000;

/**
 * Runs in Obsidian: one measurement. Times are milliseconds from the start of the measured action. The waits allow
 * `slowness` times as long, the vault's scale.
 */
async function measure({
	action,
	viewType,
	pluginId,
	command,
	path,
	content,
	token,
	quietMs,
	windowMs,
	settleMs,
	slowness = 1,
}) {
	const leafSelector = `.workspace-leaf-content[data-type="${viewType}"]`;
	// The timeline itself, without the view header, whose buttons Obsidian updates on its own.
	const contentSelector = `${leafSelector} > .view-content`;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	async function until(condition, timeoutMs, what) {
		const start = performance.now();
		const limit = timeoutMs * slowness;
		while (!condition()) {
			if (performance.now() - start > limit)
				throw new Error(`timed out after ${limit / 1000} s waiting for ${what}`);
			await sleep(20);
		}
	}
	const sum = (tasks) => ({
		blockedMs: tasks.reduce((total, task) => total + task.duration, 0),
		longestMs: Math.max(0, ...tasks.map((task) => task.duration)),
		longTasks: tasks.length,
	});
	/**
	 * Records the long tasks, and the changes to the timeline's DOM: their times, when task rows first show up, when the
	 * token does, and the frames that showed them. A change is on screen once the browser has laid out and painted the
	 * frame after it, which for thousands of new rows takes longer than the change itself.
	 */
	function record(root) {
		const longTasks = [];
		const performanceObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
		});
		performanceObserver.observe({ type: "longtask" });
		const seen = { first: null, last: null, token: null, times: [], rowsAt: null, frames: [] };
		const liveRows = document.getElementsByClassName("task");
		const inView = (node) =>
			(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(contentSelector);
		let framePending = false;
		// The frame's animation callbacks run before it is laid out and painted, a timer after; changes made before the
		// callbacks are in that frame.
		const watchFrame = () => {
			if (framePending) return;
			framePending = true;
			requestAnimationFrame(() => {
				framePending = false;
				const startedAt = performance.now();
				setTimeout(() => seen.frames.push({ startedAt, paintedAt: performance.now() }), 0);
			});
		};
		const text = (change) =>
			change.type === "characterData"
				? change.target.data
				: [...change.addedNodes].map((node) => node.textContent).join(" ");
		const mutationObserver = new MutationObserver((changes) => {
			const now = performance.now();
			const relevant = changes.filter((change) => inView(change.target));
			if (relevant.length === 0) return;
			seen.first ??= now;
			seen.last = now;
			seen.times.push(now);
			watchFrame();
			if (seen.rowsAt === null && [...liveRows].some((row) => row.closest(contentSelector))) seen.rowsAt = now;
			if (token && seen.token === null && relevant.some((change) => text(change).includes(token)))
				seen.token = now;
		});
		mutationObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
		let work = null;
		return {
			seen,
			/** Stops recording and sums the long tasks that started at `from` or later. Later calls return the same. */
			stop(from) {
				if (work) return work;
				for (const entry of performanceObserver.takeRecords())
					longTasks.push({ start: entry.startTime, duration: entry.duration });
				performanceObserver.disconnect();
				mutationObserver.disconnect();
				work = sum(longTasks.filter((task) => task.start >= from));
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
	/**
	 * Counts the calls of vault.cachedRead, which the plugin reads notes with. Obsidian's File recovery calls it too, for
	 * an edited note at most every few minutes. Returns a function that undoes the counting and returns the count.
	 */
	function countReads() {
		const vault = app.vault;
		const own = Object.prototype.hasOwnProperty.call(vault, "cachedRead");
		const original = vault.cachedRead;
		let reads = 0;
		vault.cachedRead = function (...args) {
			reads++;
			return original.apply(this, args);
		};
		return () => {
			if (own) vault.cachedRead = original;
			else delete vault.cachedRead;
			return reads;
		};
	}
	const quietFor = (seen, ms) => () => seen.last !== null && performance.now() - seen.last >= ms;
	/** When the frame that shows the changes made up to `time` was painted. */
	function paintedAfter(seen, time) {
		const frame = seen.frames.find((candidate) => candidate.startedAt >= time);
		if (!frame) throw new Error("no frame was painted after the timeline changed");
		return frame.paintedAt;
	}
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
			const reads = countReads();
			const start = performance.now();
			try {
				if (!(await app.plugins.enablePlugin(pluginId)))
					throw new Error(`Obsidian could not load the plugin ${pluginId}`);
				if (!app.commands.executeCommandById(command)) throw new Error(`the command ${command} did not run`);
				await until(
					() =>
						recorder.seen.rowsAt !== null &&
						performance.now() - start >= settleMs &&
						quietFor(recorder.seen, quietMs)(),
					60_000,
					"the timeline to render its task rows and stop changing",
				);
				const { seen } = recorder;
				const { tasks } = recorder.stop(start);
				// In milliseconds from enabling the plugin; bench-results.mjs splits them into renders.
				const since = (time) => time - start;
				return {
					rows: rows(),
					filesRead: reads(),
					rowsAt: seen.rowsAt === null ? null : since(seen.rowsAt),
					times: seen.times.map(since),
					frames: seen.frames.map((frame) => ({
						startedAt: since(frame.startedAt),
						paintedAt: since(frame.paintedAt),
					})),
					tasks: tasks
						.filter((task) => task.start >= start)
						.map((task) => ({ start: since(task.start), duration: task.duration })),
				};
			} finally {
				recorder.stop(start);
				reads();
			}
		}
		case "settle": {
			// Lets the reloads that follow loading the plugin pass, so they do not land in the next measurement.
			const recorder = record(document.body);
			try {
				await sleep(settleMs);
				await until(
					() => recorder.seen.last === null || quietFor(recorder.seen, quietMs)(),
					30_000,
					"the timeline to stop changing",
				);
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
			const reads = countReads();
			let changed = null;
			const ref = app.metadataCache.on("changed", (changedFile) => {
				if (changedFile.path === path) changed ??= performance.now();
			});
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
					renderedMs:
						recorder.seen.token === null ? null : paintedAfter(recorder.seen, recorder.seen.token) - start,
					reloadCalls: calls,
					reloaded: recorder.seen.first !== null || calls > 0,
					filesRead: reads(),
					...work,
				};
			} finally {
				recorder.stop(start);
				reloadCalls();
				reads();
				app.metadataCache.offref(ref);
			}
		}
		case "optionChange": {
			const plugin = app.plugins.plugins[pluginId];
			if (!plugin) throw new Error(`the plugin ${pluginId} is not loaded`);
			const leaf = document.querySelector(leafSelector);
			if (!leaf) throw new Error("the timeline view is not open");
			const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
			const saved = await app.vault.adapter.read(dataPath);
			const was = plugin.userOptions.useRelative;
			// The timeline shows the relative dates are off with a class on its root, see TimelineView.
			const shows = (useRelative) => () =>
				leaf.querySelector(".taskido")?.classList.contains("noRelative") === !useRelative;
			if (!shows(was)()) throw new Error("the timeline does not show the relative dates setting it has");
			// Obsidian passes changes of a plugin's data.json on only for plugins in the vault's list of enabled plugins,
			// which enablePlugin does not add it to. It is listed while the option changes, as for a user who turned it on,
			// so that onExternalSettingsChange can be called at all.
			const listed = app.plugins.enabledPlugins.has(pluginId);
			app.plugins.enabledPlugins.add(pluginId);
			let externalCalls = 0;
			const ownExternal = Object.prototype.hasOwnProperty.call(plugin, "onExternalSettingsChange");
			const external = plugin.onExternalSettingsChange;
			plugin.onExternalSettingsChange = function (...args) {
				externalCalls++;
				return external.apply(this, args);
			};
			const recorder = record(leaf);
			const reloadCalls = countReloads();
			const reads = countReads();
			// When the change that shows the setting was made: the frame after it is the one that shows it.
			let appliedAt = null;
			const classes = new MutationObserver(() => {
				if (appliedAt === null && shows(!was)()) appliedAt = performance.now();
			});
			classes.observe(leaf, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
			const start = performance.now();
			try {
				await plugin.writeOptions({ useRelative: !was });
				await until(() => appliedAt !== null, 10_000, "the timeline to show the changed setting");
				await until(quietFor(recorder.seen, quietMs), 30_000, "the timeline to stop changing");
				const { tasks, ...work } = recorder.stop(start);
				return {
					appliedMs: paintedAfter(recorder.seen, appliedAt) - start,
					reloadCalls: reloadCalls(),
					filesRead: reads(),
					externalSettingsCalls: externalCalls,
					...work,
				};
			} finally {
				classes.disconnect();
				recorder.stop(start);
				reloadCalls();
				reads();
				await plugin.writeOptions({ useRelative: was });
				await until(shows(was), 10_000, "the timeline to show the setting as it was");
				if (!listed) app.plugins.enabledPlugins.delete(pluginId);
				if (ownExternal) plugin.onExternalSettingsChange = external;
				else delete plugin.onExternalSettingsChange;
				// The "saveOptions" action saved the options before, so changing one and back saves the same file.
				if ((await app.vault.adapter.read(dataPath)) !== saved)
					throw new Error(`${dataPath} is not as it was before the option change and its undo`);
			}
		}
		case "saveOptions": {
			// The fixture installs a data.json with some options, written its own way; writeOptions saves all of them as
			// Obsidian writes JSON. Saving once first lets each option change check that it leaves data.json as it was.
			const plugin = app.plugins.plugins[pluginId];
			if (!plugin) throw new Error(`the plugin ${pluginId} is not loaded`);
			await plugin.writeOptions({});
			return true;
		}
		case "restore": {
			const file = app.vault.getAbstractFileByPath(path);
			if (file && (await app.vault.read(file)) !== content) await app.vault.modify(file, content);
			return true;
		}
		default:
			throw new Error(`unknown action ${action}`);
	}
}

/** The note with tasks, with a token in the text of its first task, so the timeline has something new to show. */
function withToken(original, token) {
	const edited = original.replace(/^(- \[ \] Task \d{4} a)/m, `$1 ${token}`);
	if (edited === original) throw new ScriptError(`${BENCH_TARGETS.withTasks} has no "Task NNNN a" task to edit.`);
	return edited;
}

function measureAll(cli, notes, scale) {
	const runs = RUNS[scale];
	const args = {
		viewType: TIMELINE_VIEW,
		pluginId: manifest.id,
		command: OPEN_COMMAND,
		quietMs: QUIET_MS,
		slowness: scale,
	};
	// The CLI gives up on code run in Obsidian after 2 minutes, which the large vault's loads can come close to.
	const evaluate = (arg) => cli.evaluate(measure, { ...args, ...arg }, 120_000 * scale);
	const loads = [];
	for (let run = 0; run < runs.loads; run++) {
		evaluate({ action: "unload" });
		const raw = evaluate({ action: "load", settleMs: LOAD_WATCH_MS });
		const load = splitLoad(raw, BURST_GAP_MS);
		console.log(
			`bench: initial load ${run + 1}: rendered ${round(load.renderedMs)} ms, ${load.rows} rows, ${load.filesRead} notes read, longest task ${round(load.longestMs)} ms; ${load.laterRenders} later render(s) blocking ${round(load.laterBlockedMs)} ms`,
		);
		loads.push(load);
	}
	evaluate({ action: "settle", settleMs: LOAD_WATCH_MS });

	const withTasks = [];
	const original = notes.get(BENCH_TARGETS.withTasks);
	for (let run = 0; run < WARMUP_SAVES + runs.saves; run++) {
		const token = `bench${run}x${Date.now().toString(36)}`;
		const save = evaluate({
			action: "save",
			path: BENCH_TARGETS.withTasks,
			content: withToken(original, token),
			token,
		});
		if (run >= WARMUP_SAVES) withTasks.push(save);
		console.log(
			`bench: save with tasks ${run < WARMUP_SAVES ? "(warm-up)" : run - WARMUP_SAVES + 1}: rendered ${round(save.renderedMs)} ms, ${save.filesRead} notes read, longest task ${round(save.longestMs)} ms`,
		);
	}

	const withoutTasks = [];
	const plain = notes.get(BENCH_TARGETS.withoutTasks);
	for (let run = 0; run < WARMUP_SAVES + runs.saves; run++) {
		const content = `${plain}\nEdited by the benchmark, run ${run}.\n`;
		const save = evaluate({
			action: "save",
			path: BENCH_TARGETS.withoutTasks,
			content,
			token: null,
			windowMs: NO_RELOAD_WINDOW_MS,
		});
		if (run >= WARMUP_SAVES) withoutTasks.push(save);
		console.log(
			`bench: save without tasks ${run < WARMUP_SAVES ? "(warm-up)" : run - WARMUP_SAVES + 1}: ${save.reloaded ? `reloaded (${save.reloadCalls ?? "?"} reload calls)` : "no reload"}, ${save.filesRead} notes read, longest task ${round(save.longestMs)} ms`,
		);
	}

	evaluate({ action: "saveOptions" });
	evaluate({ action: "settle", settleMs: LOAD_WATCH_MS });
	const optionChanges = [];
	for (let run = 0; run < WARMUP_OPTION_CHANGES + runs.optionChanges; run++) {
		const change = evaluate({ action: "optionChange" });
		if (change.reloadCalls === null)
			throw new ScriptError(
				"the timeline view has no onReloadTasks, which the benchmark counts an option change's reloads with; count them where the view reloads now.",
			);
		if (run >= WARMUP_OPTION_CHANGES) optionChanges.push(change);
		console.log(
			`bench: option change ${run < WARMUP_OPTION_CHANGES ? "(warm-up)" : run - WARMUP_OPTION_CHANGES + 1}: shown after ${round(change.appliedMs)} ms, ${change.reloadCalls} reload call(s), ${change.filesRead} notes read, onExternalSettingsChange called ${change.externalSettingsCalls} time(s), longest task ${round(change.longestMs)} ms`,
		);
	}

	return {
		initialLoad: {
			runs: loads.length,
			rows: loads[0].rows,
			renderedMs: summary(loads.map((load) => load.renderedMs)),
			blockedMs: summary(loads.map((load) => load.blockedMs)),
			longestTaskMs: summary(loads.map((load) => load.longestMs)),
			// Renders after the first one, such as the reload after the options push 200 ms after loading.
			laterRenders: counts(loads.map((load) => load.laterRenders)),
			laterBlockedMs: summary(loads.map((load) => load.laterBlockedMs)),
			filesRead: counts(loads.map((load) => load.filesRead)),
		},
		saveWithTasks: {
			runs: withTasks.length,
			indexedMs: summary(withTasks.map((save) => save.indexedMs)),
			renderedMs: summary(withTasks.map((save) => save.renderedMs)),
			blockedMs: summary(withTasks.map((save) => save.blockedMs)),
			longestTaskMs: summary(withTasks.map((save) => save.longestMs)),
			filesRead: counts(withTasks.map((save) => save.filesRead)),
		},
		saveWithoutTasks: {
			runs: withoutTasks.length,
			reloads: withoutTasks.filter((save) => save.reloaded).length,
			indexedMs: summary(withoutTasks.map((save) => save.indexedMs)),
			blockedMs: summary(withoutTasks.map((save) => save.blockedMs)),
			longestTaskMs: summary(withoutTasks.map((save) => save.longestMs)),
			filesRead: counts(withoutTasks.map((save) => save.filesRead)),
		},
		optionChange: {
			runs: optionChanges.length,
			appliedMs: summary(optionChanges.map((change) => change.appliedMs)),
			blockedMs: summary(optionChanges.map((change) => change.blockedMs)),
			longestTaskMs: summary(optionChanges.map((change) => change.longestMs)),
			reloadCalls: counts(optionChanges.map((change) => change.reloadCalls)),
			filesRead: counts(optionChanges.map((change) => change.filesRead)),
			externalSettingsCalls: counts(optionChanges.map((change) => change.externalSettingsCalls)),
		},
	};
}

await runScript("bench", async () => {
	const args = process.argv.slice(2);
	let scale;
	try {
		scale = scaleOf(args);
	} catch (error) {
		throw new ScriptError(error.message);
	}
	const unknown = withoutScale(args).filter((arg) => arg !== "--update");
	if (unknown.length)
		throw new ScriptError(
			`unknown arguments ${JSON.stringify(unknown)}; the only ones are --update and --scale 10.`,
		);
	const update = args.includes("--update");
	const vaultName = benchVaultName(scale);
	const scaleArg = scale === 1 ? "" : ` --scale ${scale}`;
	const baselineFile = path.join(repoRoot, "fixtures", `${vaultName}.baseline.json`);
	// Checked before the run, which takes minutes, rather than after it.
	if (!update && !existsSync(baselineFile))
		throw new ScriptError(
			`there is no baseline ${path.relative(repoRoot, baselineFile)}. Record one with \`pnpm bench --update${scaleArg}\`.`,
		);
	const build = buildInfo();
	const cli = fixtureCli(vaultName);
	const notes = benchVaultNotes(scale);
	const vaultPath = fixtureVaultPath(
		cli,
		vaultName,
		notes,
		`Generate it with \`pnpm bench:vault <folder named ${vaultName}>${scaleArg}\`, open the folder with "Open folder as vault", then run this again.`,
	);

	const plugin = installPlugin(vaultPath, quietSettings());
	const fixture = fixtureWindow(cli, vaultName, plugin);
	const { env, results } = runAndUndo(() => {
		const prepared = fixture.prepare();
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
		const results = measureAll(cli, notes, scale);
		env.loadAverage = {
			before: Math.round(loadBefore * 10) / 10,
			after: Math.round(os.loadavg()[0] * 10) / 10,
			cores: os.cpus().length,
		};
		return { env, results };
	}, [
		...Object.values(BENCH_TARGETS).map((target) => [
			`restore ${target}`,
			() => cli.evaluate(measure, { action: "restore", path: target, content: notes.get(target) }),
		]),
		["clear the page size", () => cli.cdp("Emulation.clearDeviceMetricsOverride")],
		...fixture.undoSteps,
	]);

	const record = {
		note: `Measured by apps/obsidian-plugin/scripts/bench.mjs (\`pnpm bench --update${scaleArg}\`). Do not edit by hand.`,
		measuredAt: new Date().toISOString().slice(0, 10),
		...env,
		plugin: build,
		vault: {
			name: vaultName,
			notes: notes.size,
			tasks: 4000 * scale,
			withTasks: BENCH_TARGETS.withTasks,
			withoutTasks: BENCH_TARGETS.withoutTasks,
		},
		settings: {
			quietMs: QUIET_MS,
			noReloadWindowMs: NO_RELOAD_WINDOW_MS,
			loadWatchMs: LOAD_WATCH_MS,
			warmupSaves: WARMUP_SAVES,
			warmupOptionChanges: WARMUP_OPTION_CHANGES,
			runs: RUNS[scale],
		},
		results,
	};
	if (update) {
		// A baseline that reloads on saves without tasks would make that the expected behaviour.
		if (results.saveWithoutTasks.reloads > 0) {
			throw new ScriptError(
				`saving a note without tasks reloaded the timeline ${results.saveWithoutTasks.reloads} times; not recording that as the baseline.`,
			);
		}
		writeFileSync(baselineFile, JSON.stringify(record, null, "\t") + "\n");
		console.log(`bench: wrote the baseline to ${path.relative(repoRoot, baselineFile)}`);
		return 0;
	}
	const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
	console.log(
		`bench: 1-minute load average ${env.loadAverage.before} before and ${env.loadAverage.after} after the run (${env.loadAverage.cores} cores); the baseline had ${baseline.loadAverage?.before} and ${baseline.loadAverage?.after}.`,
	);
	const baselineLoad = Math.max(baseline.loadAverage?.before ?? 0, baseline.loadAverage?.after ?? 0, 1);
	if (Math.max(env.loadAverage.before, env.loadAverage.after) > 2 * baselineLoad) {
		console.warn(
			"bench: warning: the machine was more than twice as busy as when the baseline was measured, which alone makes the numbers slower. Run again when it is idle.",
		);
	}
	for (const key of ["obsidianVersion", "machine", "viewport", "today"]) {
		if (JSON.stringify(baseline[key]) !== JSON.stringify(env[key])) {
			console.warn(
				`bench: warning: the baseline was measured with ${key} ${JSON.stringify(baseline[key])}, this run has ${JSON.stringify(env[key])}; the numbers are not comparable.`,
			);
		}
	}
	const { lines, warnings, slower } = compare(baseline, results);
	lines.forEach((line) => console.log(line));
	warnings.forEach((warning) => console.warn(warning));
	console.log(
		slower
			? `bench: ${slower} measurement(s) got slower than the baseline.`
			: "bench: nothing got slower than the baseline.",
	);
	return slower ? 1 : 0;
});
