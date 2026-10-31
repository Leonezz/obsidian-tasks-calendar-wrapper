/**
 * Measures how fast the timeline reacts in a real Obsidian, in the 4,000-task vault bench-vault.mjs generates, or with
 * `--scale 10` in the 40,000-task one:
 * - initial load: from loading the plugin and running "Open Tasks Timeline View" until the timeline has rendered;
 * - save with tasks: from saving a note with tasks until the timeline shows the new task text;
 * - save without tasks: saving a note without tasks, which should not reload the timeline at all;
 * - option change: turning the relative dates off through the plugin's writeOptions, as the settings tab does, until the
 *   timeline shows it, then on again; data.json has to be byte for byte as it was after that;
 * - toggle (only with a writer, at both scales): idle checkbox clicks to the overlay and real result, five clicks
 *   200 ms apart counting reloads, then five ticks in one day column counting ignored clicks and retrying them.
 *   Generated notes have at most three tasks, so five same-day tasks are temporarily appended to a separate note.
 *   Only their five lines may change; the original note bytes and display options are restored even on failure.
 *   The idle overlay median's gate is 50 ms; the other timings are report-only. Missing baseline metrics are not judged.
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
 * `pnpm bench --ab <ref>` judges this checkout's build against the plugin built at a git ref instead, such as a PR's
 * base, measuring both in turn in the same Obsidian session; a baseline measured days before carries how busy the
 * machine was then. The ref is built in a temporary worktree. Each round measures each arm once, its build swapped in
 * between unloading and loading the plugin, with a warm-up load after each swap; which arm goes first changes from round
 * to round, in an order `--seed <n>` repeats. A round's value of a timing is the arm's fastest run, and bench-ab.mjs
 * judges the rounds as pairs, with the same 25 % and 50 ms floor and the same counts. It also measures the main
 * thread's CPU time of every step, which a busy machine moves far less than the clock. `--rounds <n>` (8 at scale 1, 6 at
 * scale 10), `--candidate <ref>` builds the candidate from a ref too, and `--report <file>` writes every number as JSON.
 * Both arms get this checkout's manifest.json, so a different version does not make one of them save its options while
 * it loads. scripts/bench-nightly.mjs runs this for labelled PRs at night.
 *
 * Needs Obsidian running with the vault named bench-vault (bench-vault-x10) open: generate it with
 * `pnpm bench:vault <folder> [--scale 10]`, open the folder in Obsidian once, and keep its window open. The script only talks to that vault, after checking its notes are
 * exactly the generated ones. It installs the build into the vault, turns community plugins on, pins today to
 * 2026-01-15, stops throttling the window while it is hidden, sizes its page through the DevTools protocol, and puts all
 * of that and the edited notes back at the end.
 */
import { execFileSync } from "child_process";
import { randomInt } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { AB_RUNS, abArgs, abOrder, compareAb } from "./bench-ab.mjs";
import { buildAt, localBuild } from "./bench-builds.mjs";
import { otherBenchProcesses } from "./bench-host.mjs";
import { measure } from "./bench-measure.mjs";
import {
	assertToggleChanges,
	assertToggleRestored,
	compare,
	countIgnoredClicks,
	counts,
	round,
	splitLoad,
	summary,
} from "./bench-results.mjs";
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
const TOGGLE_RUNS = { 1: 5, 10: 3 };
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

/** The note with tasks, with a token in the text of its first task, so the timeline has something new to show. */
function withToken(original, token) {
	const edited = original.replace(/^(- \[ \] Task \d{4} a)/m, `$1 ${token}`);
	if (edited === original) throw new ScriptError(`${BENCH_TARGETS.withTasks} has no "Task NNNN a" task to edit.`);
	return edited;
}

/**
 * The main thread's CPU time so far, in milliseconds: the renderer's task time counted in thread ticks, which needs
 * Performance.enable with timeDomain "threadTicks" first. Waiting for the CPU does not count, so a busy machine moves it
 * far less than the time on the clock.
 */
function mainThreadMs(cli) {
	const task = cli.cdp("Performance.getMetrics").metrics?.find((metric) => metric.name === "TaskDuration");
	if (!task) throw new ScriptError("Performance.getMetrics has no TaskDuration; is the Performance domain enabled?");
	return task.value * 1000;
}

/** The writer-only scenario, after the shared measurements, with setup and restoration outside the timed clicks. */
function measureToggle(evaluate, timed, notes, scale, label, cpuSummary, cpuText) {
	if (!evaluate({ action: "toggleSupport" })) {
		console.log(`bench: ${label}toggle: skipped (the loaded plugin has no in-place checkbox support); not judged.`);
		return { skipped: "the loaded plugin has no in-place checkbox support" };
	}
	const path = BENCH_TARGETS.toggle;
	const original = notes.get(path);
	const toggleTasks = Array.from({ length: 5 }, (_, i) => `Bench toggle task ${i + 1}`);
	const lines = toggleTasks.map((_, i) => original.split("\n").length + i);
	const prepared = `${original}\n${toggleTasks.map((text) => `- [ ] ${text} 📅 2026-01-15`).join("\n")}\n`;
	const settings = evaluate({ action: "toggleOptions" });
	const check = (fn) => {
		try {
			return fn();
		} catch (error) {
			throw new ScriptError(error.message);
		}
	};
	const restore = (content) =>
		check(() =>
			assertToggleRestored(path, content, evaluate({ action: "restore", path, content, verifyRestore: true })),
		);
	const settle = () => evaluate({ action: "settle", settleMs: LOAD_WATCH_MS, toggleTasks });
	const reset = () => {
		restore(prepared);
		evaluate({ action: "settle", settleMs: LOAD_WATCH_MS, path, toggleTasks, toggleReady: true });
	};
	return runAndUndo(() => {
		evaluate({
			action: "toggleOptions",
			options: { hideStatusTasks: [], useBuiltinStyle: true, openNoteInsteadOfInPlace: false },
		});
		const idle = [];
		for (let run = 0; run < TOGGLE_RUNS[scale]; run++) {
			reset();
			const step = timed({ action: "toggle", path, toggleTasks, toggleMode: "idle" });
			check(() => assertToggleChanges(prepared, step.content, lines.slice(0, 1)));
			idle.push(step);
			console.log(
				`bench: ${label}toggle idle ${run + 1}: overlay ${round(step.overlayMs)} ms, real result ${round(step.renderedMs)} ms, blocked ${round(step.blockedMs)} ms, longest task ${round(step.longestMs)} ms${cpuText(step)}`,
			);
		}
		reset();
		const burst = evaluate({ action: "toggle", path, toggleTasks, toggleMode: "burst" });
		if (burst.reloadCalls === null)
			throw new ScriptError("toggle: the timeline view has no onReloadTasks to count reloads with");
		const burstIgnored = countIgnoredClicks(burst.clicks);
		check(() =>
			assertToggleChanges(
				prepared,
				burst.content,
				burst.clicks.flatMap((click, i) => (click.overlayMs === null ? [] : [lines[i]])),
			),
		);
		console.log(
			`bench: ${label}toggle five clicks 200 ms apart: ${burst.reloadCalls} reload call(s) (gate: ${scale === 1 ? "exactly 1" : "at most 2"}), ${burstIgnored} ignored click(s).`,
		);
		reset();
		const sequence = evaluate({ action: "toggle", path, toggleTasks, toggleMode: "sequence" });
		check(() => assertToggleChanges(prepared, sequence.content, lines));
		const ignored = countIgnoredClicks(sequence.clicks);
		console.log(
			`bench: ${label}toggle five ticks in one column: exactly those five lines changed, ${ignored} ignored click(s).`,
		);
		const overlayMs = summary(idle.map((step) => step.overlayMs));
		console.log(
			`bench: ${label}toggle idle overlay median ${overlayMs.medianMs} ms; gate <= 50 ms: ${overlayMs.medianMs <= 50 ? "PASS" : "OVER LIMIT"} (checked from the report).`,
		);
		return {
			runs: idle.length,
			overlayMs,
			renderedMs: summary(idle.map((step) => step.renderedMs)),
			blockedMs: summary(idle.map((step) => step.blockedMs)),
			longestTaskMs: summary(idle.map((step) => step.longestMs)),
			...cpuSummary(idle),
			reloadCalls: counts([burst.reloadCalls]),
			ignoredClicks: counts([ignored]),
			burstIgnoredClicks: counts([burstIgnored]),
			clickLog: { idle: idle.map((step) => step.clicks), burst: burst.clicks, sequence: sequence.clicks },
		};
	}, [
		["wait for toggle writes", settle],
		[`restore ${path} after toggle`, () => restore(original)],
		["restore toggle display options", () => evaluate({ action: "toggleOptions", ...settings })],
		["settle after toggle", settle],
		[
			"verify restored toggle bytes",
			() => check(() => assertToggleRestored(path, original, evaluate({ action: "readNote", path }))),
		],
	]);
}

/**
 * Measures the loads, the saves and the option changes, `runs` of each after their warm-ups, and sums them up. For the
 * A/B mode, `install` puts an arm's build in place once the plugin is first unloaded, `warmupLoads` loads come first and
 * are not kept, `cpu` adds each step's main-thread CPU time (cpuMs), and `label` names the round and the arm in the log.
 */
function measureAll(
	cli,
	notes,
	scale,
	{ runs = RUNS[scale], warmupLoads = 0, install = () => {}, cpu = false, label = "" } = {},
) {
	const args = {
		viewType: TIMELINE_VIEW,
		pluginId: manifest.id,
		command: OPEN_COMMAND,
		quietMs: QUIET_MS,
		slowness: scale,
	};
	// The CLI gives up on code run in Obsidian after 2 minutes, which the large vault's loads can come close to.
	const evaluate = (arg) => cli.evaluate(measure, { ...args, ...arg }, 120_000 * scale);
	// The CPU time spans the whole call, and for an option change its undo too, the same for both arms.
	const timed = (arg) => {
		if (!cpu) return evaluate(arg);
		const before = mainThreadMs(cli);
		const result = evaluate(arg);
		return { ...result, cpuMs: mainThreadMs(cli) - before };
	};
	const cpuText = (step) => (cpu ? `, main thread ${round(step.cpuMs)} ms` : "");
	const cpuSummary = (steps) => (cpu ? { cpuMs: summary(steps.map((step) => step.cpuMs)) } : {});
	const loads = [];
	for (let run = 0; run < warmupLoads + runs.loads; run++) {
		evaluate({ action: "unload" });
		if (run === 0) install();
		const { cpuMs, ...raw } = timed({ action: "load", settleMs: LOAD_WATCH_MS });
		const load = { ...splitLoad(raw, BURST_GAP_MS), ...(cpu ? { cpuMs } : {}) };
		console.log(
			`bench: ${label}initial load ${run < warmupLoads ? "(warm-up)" : run - warmupLoads + 1}: rendered ${round(load.renderedMs)} ms, ${load.rows} rows, ${load.filesRead} notes read, longest task ${round(load.longestMs)} ms; ${load.laterRenders} later render(s) blocking ${round(load.laterBlockedMs)} ms${cpuText(load)}`,
		);
		if (run >= warmupLoads) loads.push(load);
	}
	evaluate({ action: "settle", settleMs: LOAD_WATCH_MS });

	const withTasks = [];
	const original = notes.get(BENCH_TARGETS.withTasks);
	for (let run = 0; run < WARMUP_SAVES + runs.saves; run++) {
		const token = `bench${run}x${Date.now().toString(36)}`;
		const save = timed({
			action: "save",
			path: BENCH_TARGETS.withTasks,
			content: withToken(original, token),
			token,
		});
		if (run >= WARMUP_SAVES) withTasks.push(save);
		console.log(
			`bench: ${label}save with tasks ${run < WARMUP_SAVES ? "(warm-up)" : run - WARMUP_SAVES + 1}: rendered ${round(save.renderedMs)} ms, ${save.filesRead} notes read, longest task ${round(save.longestMs)} ms${cpuText(save)}`,
		);
	}

	const withoutTasks = [];
	const plain = notes.get(BENCH_TARGETS.withoutTasks);
	for (let run = 0; run < WARMUP_SAVES + runs.saves; run++) {
		const content = `${plain}\nEdited by the benchmark, run ${run}.\n`;
		const save = timed({
			action: "save",
			path: BENCH_TARGETS.withoutTasks,
			content,
			token: null,
			windowMs: NO_RELOAD_WINDOW_MS,
		});
		if (run >= WARMUP_SAVES) withoutTasks.push(save);
		console.log(
			`bench: ${label}save without tasks ${run < WARMUP_SAVES ? "(warm-up)" : run - WARMUP_SAVES + 1}: ${save.reloaded ? `reloaded (${save.reloadCalls ?? "?"} reload calls)` : "no reload"}, ${save.filesRead} notes read, longest task ${round(save.longestMs)} ms${cpuText(save)}`,
		);
	}

	evaluate({ action: "saveOptions" });
	evaluate({ action: "settle", settleMs: LOAD_WATCH_MS });
	const optionChanges = [];
	for (let run = 0; run < WARMUP_OPTION_CHANGES + runs.optionChanges; run++) {
		const change = timed({ action: "optionChange" });
		if (change.reloadCalls === null)
			throw new ScriptError(
				"the timeline view has no onReloadTasks, which the benchmark counts an option change's reloads with; count them where the view reloads now.",
			);
		if (run >= WARMUP_OPTION_CHANGES) optionChanges.push(change);
		console.log(
			`bench: ${label}option change ${run < WARMUP_OPTION_CHANGES ? "(warm-up)" : run - WARMUP_OPTION_CHANGES + 1}: shown after ${round(change.appliedMs)} ms, ${change.reloadCalls} reload call(s), ${change.filesRead} notes read, onExternalSettingsChange called ${change.externalSettingsCalls} time(s), longest task ${round(change.longestMs)} ms${cpuText(change)}`,
		);
	}
	const toggle = measureToggle(evaluate, timed, notes, scale, label, cpuSummary, cpuText);

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
			// All of the load's work: the first render, and what the options push adds before or after it.
			totalBlockedMs: summary(loads.map((load) => load.totalBlockedMs)),
			filesRead: counts(loads.map((load) => load.filesRead)),
			...cpuSummary(loads),
		},
		saveWithTasks: {
			runs: withTasks.length,
			indexedMs: summary(withTasks.map((save) => save.indexedMs)),
			renderedMs: summary(withTasks.map((save) => save.renderedMs)),
			blockedMs: summary(withTasks.map((save) => save.blockedMs)),
			longestTaskMs: summary(withTasks.map((save) => save.longestMs)),
			filesRead: counts(withTasks.map((save) => save.filesRead)),
			...cpuSummary(withTasks),
		},
		saveWithoutTasks: {
			runs: withoutTasks.length,
			reloads: withoutTasks.filter((save) => save.reloaded).length,
			indexedMs: summary(withoutTasks.map((save) => save.indexedMs)),
			blockedMs: summary(withoutTasks.map((save) => save.blockedMs)),
			longestTaskMs: summary(withoutTasks.map((save) => save.longestMs)),
			filesRead: counts(withoutTasks.map((save) => save.filesRead)),
			...cpuSummary(withoutTasks),
		},
		optionChange: {
			runs: optionChanges.length,
			appliedMs: summary(optionChanges.map((change) => change.appliedMs)),
			blockedMs: summary(optionChanges.map((change) => change.blockedMs)),
			longestTaskMs: summary(optionChanges.map((change) => change.longestMs)),
			reloadCalls: counts(optionChanges.map((change) => change.reloadCalls)),
			filesRead: counts(optionChanges.map((change) => change.filesRead)),
			externalSettingsCalls: counts(optionChanges.map((change) => change.externalSettingsCalls)),
			...cpuSummary(optionChanges),
		},
		toggle,
	};
}

/** What the run was measured with, for the record next to the results: the app, the machine and the page. */
function environment(cli, prepared) {
	return {
		obsidianVersion: cli.run("version"),
		electron: prepared.electron,
		chrome: prepared.chrome,
		machine: machineInfo(),
		viewport: VIEWPORT,
		today: prepared.today,
		windowVisibility: prepared.visibility,
	};
}

const loadAverageSince = (before) => ({
	before: Math.round(before * 10) / 10,
	after: Math.round(os.loadavg()[0] * 10) / 10,
	cores: os.cpus().length,
});

/** The steps that put each benchmark note back as it was generated. */
const restoreSteps = (cli, notes) =>
	Object.values(BENCH_TARGETS).map((target) => [
		`restore ${target}`,
		() => {
			const restored = cli.evaluate(measure, {
				action: "restore",
				path: target,
				content: notes.get(target),
				verifyRestore: target === BENCH_TARGETS.toggle,
			});
			if (target === BENCH_TARGETS.toggle) {
				try {
					assertToggleRestored(target, notes.get(target), restored);
				} catch (error) {
					throw new ScriptError(error.message);
				}
			}
		},
	]);

/**
 * `pnpm bench --ab <ref>`: builds the base at the ref and the candidate at `--candidate <ref>` or from this checkout,
 * then measures them in turn, round by round, and judges the candidate against the base (bench-ab.mjs). Returns the
 * exit code: 1 when something got slower.
 */
function runAb(ab, scale) {
	const others = otherBenchProcesses(
		execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
		process.pid,
	);
	if (others.length)
		throw new ScriptError(
			`another script is driving Obsidian, whose work would land in the measurements; wait for it to finish: ${others.map((other) => `${other.pid} ${other.command}`).join("; ")}`,
		);
	// Checked before the run, which takes a quarter of an hour or more, rather than after it.
	if (ab.report && !existsSync(path.dirname(path.resolve(ab.report))))
		throw new ScriptError(`the folder of the report ${ab.report} does not exist.`);
	const seed = ab.seed ?? randomInt(2 ** 32);
	const order = abOrder(ab.rounds, seed);
	const vaultName = benchVaultName(scale);
	const scaleArg = scale === 1 ? "" : ` --scale ${scale}`;
	const cli = fixtureCli(vaultName);
	const notes = benchVaultNotes(scale);
	const vaultPath = fixtureVaultPath(
		cli,
		vaultName,
		notes,
		`Generate it with \`pnpm bench:vault <folder named ${vaultName}>${scaleArg}\`, open the folder with "Open folder as vault", then run this again.`,
	);
	const workDir = mkdtempSync(path.join(os.tmpdir(), "tcw-bench-ab-"));
	try {
		const builds = {
			base: buildAt(ab.base, path.join(workDir, "base")),
			candidate: ab.candidate
				? buildAt(ab.candidate, path.join(workDir, "candidate"))
				: localBuild(path.join(workDir, "candidate")),
		};
		const identicalBuilds =
			builds.base.mainJsSha256 === builds.candidate.mainJsSha256 &&
			builds.base.stylesCssSha256 === builds.candidate.stylesCssSha256;
		const describe = (build) =>
			`${build.ref} (${build.commit}${build.uncommittedChanges ? " with uncommitted changes" : ""})`;
		console.log(
			`bench: A/B in ${vaultName}: the base is ${describe(builds.base)}, the candidate ${describe(builds.candidate)}${identicalBuilds ? "; the two builds are identical, so this shows the noise" : ""}. ${ab.rounds} rounds in the order of seed ${seed}.`,
		);
		const plugin = installPlugin(vaultPath, quietSettings(), builds.candidate);
		const fixture = fixtureWindow(cli, vaultName, plugin);
		const restoreNotes = restoreSteps(cli, notes);
		const { env, loadAverage, slots } = runAndUndo(() => {
			const prepared = fixture.prepare();
			cli.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
			cli.cdp("Performance.enable", { timeDomain: "threadTicks" });
			const env = environment(cli, prepared);
			const loadBefore = os.loadavg()[0];
			const slots = [];
			order.forEach((arms, i) => {
				for (const arm of arms) {
					const results = measureAll(cli, notes, scale, {
						runs: AB_RUNS[scale],
						warmupLoads: 1,
						cpu: true,
						label: `round ${i + 1} of ${order.length}, ${arm}: `,
						install: () => {
							// Every slot starts from the generated notes and the same data.json, as `pnpm bench` does.
							restoreNotes.forEach(([, restore]) => restore());
							plugin.copyBuild(builds[arm]);
							plugin.writeSettings(quietSettings());
						},
					});
					slots.push({ round: i + 1, arm, results });
				}
			});
			return { env, loadAverage: loadAverageSince(loadBefore), slots };
		}, [
			...restoreNotes,
			["stop measuring the main thread", () => cli.cdp("Performance.disable")],
			["clear the page size", () => cli.cdp("Emulation.clearDeviceMetricsOverride")],
			...fixture.undoSteps,
		]);

		const verdict = compareAb(slots, scale);
		console.log(
			`bench: the candidate against the base over ${ab.rounds} rounds, from each arm's fastest run in each round:`,
		);
		verdict.lines.forEach((line) => console.log(line));
		// These are different actions, so print them side by side without a ratio or a verdict.
		for (let roundIndex = 1; roundIndex <= ab.rounds; roundIndex++) {
			const base = slots.find((slot) => slot.round === roundIndex && slot.arm === "base").results.saveWithTasks;
			const toggle = slots.find((slot) => slot.round === roundIndex && slot.arm === "candidate").results.toggle;
			if (toggle.skipped) continue;
			for (const metric of ["renderedMs", "blockedMs", "cpuMs", "longestTaskMs"]) {
				if (toggle[metric] && base[metric])
					console.log(
						`bench: round ${roundIndex} report only, ${metric} median: base saveWithTasks ${base[metric].medianMs} ms | candidate toggle ${toggle[metric].medianMs} ms`,
					);
			}
		}
		verdict.warnings.forEach((warning) => console.warn(warning));
		console.log(
			`bench: 1-minute load average ${loadAverage.before} before and ${loadAverage.after} after the run (${loadAverage.cores} cores).`,
		);
		if (ab.report) {
			const record = ({ mainJs, stylesCss, ...build }) => build;
			const report = {
				note: "Written by apps/obsidian-plugin/scripts/bench.mjs --ab.",
				measuredAt: new Date().toISOString(),
				scale,
				vault: vaultName,
				rounds: ab.rounds,
				seed,
				order,
				base: record(builds.base),
				candidate: record(builds.candidate),
				identicalBuilds,
				env,
				loadAverage,
				settings: {
					quietMs: QUIET_MS,
					noReloadWindowMs: NO_RELOAD_WINDOW_MS,
					loadWatchMs: LOAD_WATCH_MS,
					warmupLoads: 1,
					warmupSaves: WARMUP_SAVES,
					warmupOptionChanges: WARMUP_OPTION_CHANGES,
					toggleRuns: TOGGLE_RUNS[scale],
					runs: AB_RUNS[scale],
				},
				slots,
				verdict,
			};
			writeFileSync(ab.report, JSON.stringify(report, null, "\t") + "\n");
			console.log(`bench: wrote the report to ${ab.report}`);
		}
		console.log(
			verdict.slower
				? `bench: ${verdict.slower} measurement(s) got slower than the base.`
				: "bench: nothing got slower than the base.",
		);
		return verdict.slower ? 1 : 0;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

await runScript("bench", async () => {
	const args = process.argv.slice(2);
	let scale;
	let ab;
	let rest;
	try {
		scale = scaleOf(args);
		({ ab, rest } = abArgs(withoutScale(args), scale));
	} catch (error) {
		throw new ScriptError(error.message);
	}
	const unknown = rest.filter((arg) => arg !== "--update");
	if (unknown.length)
		throw new ScriptError(
			`unknown arguments ${JSON.stringify(unknown)}; the only ones are --update, --scale 10, and --ab <ref> with --candidate <ref>, --rounds <n>, --seed <n> and --report <file>.`,
		);
	const update = args.includes("--update");
	if (ab && update) throw new ScriptError("--ab compares two builds and records no baseline; leave out --update.");
	if (ab) return runAb(ab, scale);
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
		const env = environment(cli, prepared);
		// Other work on the machine slows the timeline down as much as a change could; the load average shows it.
		const loadBefore = os.loadavg()[0];
		const results = measureAll(cli, notes, scale);
		env.loadAverage = loadAverageSince(loadBefore);
		return { env, results };
	}, [
		...restoreSteps(cli, notes),
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
			toggleRuns: TOGGLE_RUNS[scale],
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
	const { lines, warnings, slower } = compare(baseline, results, scale);
	lines.forEach((line) => console.log(line));
	warnings.forEach((warning) => console.warn(warning));
	console.log(
		slower
			? `bench: ${slower} measurement(s) got slower than the baseline.`
			: "bench: nothing got slower than the baseline.",
	);
	return slower ? 1 : 0;
});
