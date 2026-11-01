/** The shared build preparation and the separate, unjudged profile pass of bench.mjs. */
import { execFileSync } from "child_process";
import { randomInt } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { abMergeBase, abOrder, checkAbBase } from "./bench-ab.mjs";
import { buildAt, localBuild } from "./bench-builds.mjs";
import { otherBenchProcesses } from "./bench-host.mjs";
import { measure } from "./bench-measure.mjs";
import { BENCH_TARGETS, SAVE_MARKER, benchVaultName, benchVaultNotes, withSaveToken } from "./bench-notes.mjs";
import { PROFILE_SCENARIOS, bucketTrace, profileMarker, profileTable, traceRecorder } from "./bench-profile.mjs";
import { assertToggleChanges } from "./bench-results.mjs";
import { SCROLL } from "./bench-scenarios.mjs";
import {
	fixtureCli,
	fixtureVaultPath,
	fixtureWindow,
	installPlugin,
	manifest,
	quietSettings,
	repoRoot,
	runAndUndo,
	ScriptError,
} from "./fixture-app.mjs";

/** Checks the base and host, validates the fixture, and keeps both builds before either mode measures them. */
export function prepareBenchBuilds(ab, scale, { profile = false } = {}) {
	let mergeBase = null;
	if (ab.base)
		try {
			// Only the optional upstream lookup is quiet; resolution failures keep git's existing stderr output.
			const git = (args) =>
				execFileSync("git", args, {
					cwd: repoRoot,
					encoding: "utf8",
					...(args[0] === "rev-parse" && args[1] === "--abbrev-ref"
						? { stdio: ["ignore", "pipe", "ignore"] }
						: {}),
				}).trim();
			const resolved = abMergeBase({ base: ab.base, candidate: ab.candidate, git });
			const { baseCommit } = resolved;
			mergeBase = resolved.mergeBase;
			const warning = checkAbBase({ ref: ab.base, baseCommit, mergeBase, allowOtherBase: ab.allowOtherBase });
			if (warning) console.warn(warning);
		} catch (error) {
			throw new ScriptError(error.message);
		}
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
	const seed = profile ? null : (ab.seed ?? randomInt(2 ** 32));
	const order = profile ? null : abOrder(ab.rounds, seed);
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
	const workDir = mkdtempSync(path.join(os.tmpdir(), profile ? "tcw-bench-profile-" : "tcw-bench-ab-"));
	try {
		const builds = {
			...(ab.base ? { base: buildAt(ab.base, path.join(workDir, "base")) } : {}),
			candidate: ab.candidate
				? buildAt(ab.candidate, path.join(workDir, "candidate"))
				: localBuild(path.join(workDir, "candidate")),
		};
		const identicalBuilds = builds.base
			? builds.base.mainJsSha256 === builds.candidate.mainJsSha256 &&
				builds.base.stylesCssSha256 === builds.candidate.stylesCssSha256
			: null;
		return { mergeBase, seed, order, vaultName, cli, notes, vaultPath, workDir, builds, identicalBuilds };
	} catch (error) {
		rmSync(workDir, { recursive: true, force: true });
		throw error;
	}
}

/** Profiles one arm, keeping setup, warm-ups and restoration outside each scenario's recording. */
function profileArm({ evaluate, recorder, build, notes, arm, toggleSetup, loadWatchMs }) {
	const mainJs = readFileSync(build.mainJs, "utf8");
	const profiles = {};
	const traced = (scenario, action) => {
		recorder.start();
		evaluate({ action: "timeStamp", marker: profileMarker(scenario, "start") });
		const result = evaluate(action);
		evaluate({ action: "timeStamp", marker: profileMarker(scenario, "end") });
		profiles[scenario] = bucketTrace(recorder.stop(), {
			scenario,
			mainJs,
			pluginId: manifest.id,
			requireMarkdown: scenario === "initialLoad",
			requireReactDom: scenario === "initialLoad",
		});
		const summary = profiles[scenario];
		console.log(`bench: profile ${arm} ${scenario}: ${summary.longTasks} long tasks, ${summary.totalMs} ms`);
		return result;
	};
	const skip = (scenario, reason) => {
		profiles[scenario] = { skipped: reason };
		console.log(`bench: profile ${arm} ${scenario}: skipped (${reason}); not judged.`);
	};
	const reveal = () => evaluate({ action: "reveal", taskPath: SAVE_MARKER.path, taskLine: SAVE_MARKER.line });
	const restore = () => evaluate({ action: "viewRestore" });
	evaluate({ action: "load", settleMs: loadWatchMs });
	evaluate({ action: "settle", settleMs: loadWatchMs });
	evaluate({ action: "unload" });
	traced("initialLoad", { action: "load", settleMs: loadWatchMs });
	evaluate({ action: "settle", settleMs: loadWatchMs });
	runAndUndo(() => {
		reveal();
		const token = `benchprofile${Date.now().toString(36)}`;
		traced("saveWithTasks", {
			action: "save",
			path: BENCH_TARGETS.withTasks,
			content: withSaveToken(notes.get(BENCH_TARGETS.withTasks), token),
			token,
			todayCheck: true,
		});
	}, [["restore the timeline view state", restore]]);
	if (!evaluate({ action: "toggleSupport" })) {
		if (arm === "candidate") throw new Error("toggle: the candidate's plugin has no in-place checkbox support.");
		skip("toggle", "the loaded plugin has no in-place checkbox support");
	} else {
		const setup = toggleSetup(evaluate, notes);
		runAndUndo(() => {
			setup.prepare();
			setup.reset();
			evaluate({ action: "reveal", taskPath: setup.path, taskLine: setup.lines[0] });
			const step = traced("toggle", {
				action: "toggle",
				path: setup.path,
				toggleTasks: setup.toggleTasks,
				toggleMode: "idle",
			});
			assertToggleChanges(setup.prepared, step.content, setup.lines.slice(0, 1));
		}, setup.undoSteps);
	}
	const controls = evaluate({ action: "controls" });
	const missing = (scenario, control, selector, scenarios) => {
		if (arm === "candidate")
			throw new Error(
				`${scenario}: the candidate's timeline has no ${control} (${selector}); a moved control must not drop the scenario, so update the selector in bench-measure.mjs.`,
			);
		for (const name of scenarios) skip(name, `the loaded build has no ${control}`);
	};
	if (!controls.todayHeader)
		missing("focusToday", "Focus on today control", ".todayHeader in the entry day", [
			"focusToday.on",
			"focusToday.off",
		]);
	else
		runAndUndo(() => {
			reveal();
			traced("focusToday.on", { action: "focusToday", direction: "on" });
			traced("focusToday.off", { action: "focusToday", direction: "off" });
		}, [["turn Focus on today off", restore]]);
	if (!controls.todoCounter) missing("counterFilter", "Todo counter", ".counter#todo", ["counterFilter"]);
	else
		runAndUndo(() => {
			reveal();
			traced("counterFilter", { action: "counterFilter", direction: "on" });
			evaluate({ action: "counterFilter", direction: "off" });
		}, [["turn the Todo filter off", restore]]);
	if (!controls.viewContent) throw new Error("scroll: the timeline leaf has no .view-content to scroll.");
	runAndUndo(
		() => traced("scroll", { action: "scroll", ...SCROLL }),
		[["scroll the timeline back to the top", restore]],
	);
	return Object.fromEntries(PROFILE_SCENARIOS.map((scenario) => [scenario, profiles[scenario]]));
}

/** Runs one unjudged trace per scenario and arm, writing only the bucketed summaries to an optional report. */
export function runProfile(
	profile,
	scale,
	{ toggleSetup, environment, restoreSteps, loadAverageSince, viewport, loadWatchMs, args },
) {
	const { mergeBase, vaultName, cli, notes, vaultPath, workDir, builds, identicalBuilds } = prepareBenchBuilds(
		profile,
		scale,
		{ profile: true },
	);
	try {
		const describe = (build) =>
			`${build.ref} (${build.commit}${build.uncommittedChanges ? " with uncommitted changes" : ""})`;
		console.log(
			`bench: profile in ${vaultName}: ${builds.base ? `the base is ${describe(builds.base)}, ` : ""}the candidate ${describe(builds.candidate)}${identicalBuilds ? "; the two builds are identical, so this shows the noise" : ""}.`,
		);
		const recorder = traceRecorder(cli, { tmpDir: path.join(workDir, "traces"), log: console.log });
		const plugin = installPlugin(vaultPath, quietSettings(), builds.candidate);
		const fixture = fixtureWindow(cli, vaultName, plugin);
		const restoreNotes = restoreSteps(cli, notes);
		const evaluate = (arg) => cli.evaluate(measure, { ...args, ...arg }, 120_000 * scale);
		const { env, loadAverage, profiles } = runAndUndo(() => {
			const prepared = fixture.prepare();
			cli.cdp("Emulation.setDeviceMetricsOverride", viewport);
			const env = environment(cli, prepared);
			const loadBefore = os.loadavg()[0];
			const profiles = {};
			for (const [arm, build] of Object.entries(builds)) {
				evaluate({ action: "unload" });
				restoreNotes.forEach(([, restore]) => restore());
				plugin.copyBuild(build);
				plugin.writeSettings(quietSettings());
				profiles[arm] = profileArm({ evaluate, recorder, build, notes, arm, toggleSetup, loadWatchMs });
			}
			return { env, loadAverage: loadAverageSince(loadBefore), profiles };
		}, [
			...restoreNotes,
			...recorder.undoSteps,
			["clear the page size", () => cli.cdp("Emulation.clearDeviceMetricsOverride")],
			...fixture.undoSteps,
		]);
		profileTable(profiles).forEach((line) => console.log(line));
		console.log(
			`bench: 1-minute load average ${loadAverage.before} before and ${loadAverage.after} after the run (${loadAverage.cores} cores).`,
		);
		if (profile.report) {
			const record = ({ mainJs, stylesCss, ...build }) => build;
			const report = {
				note: "Written by apps/obsidian-plugin/scripts/bench.mjs --profile.",
				measuredAt: new Date().toISOString(),
				scale,
				vault: vaultName,
				recording: recorder.method(),
				base: builds.base ? { ...record(builds.base), mergeBase: mergeBase.slice(0, 7) } : null,
				candidate: record(builds.candidate),
				identicalBuilds,
				env,
				loadAverage,
				profiles,
			};
			writeFileSync(profile.report, JSON.stringify(report, null, "\t") + "\n");
			console.log(`bench: wrote the report to ${profile.report}`);
		}
		return 0;
	} catch (error) {
		throw new ScriptError(error.message);
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}
