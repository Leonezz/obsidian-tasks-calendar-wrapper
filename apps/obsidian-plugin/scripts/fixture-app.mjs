/**
 * What bench.mjs and screenshots.mjs share: talking to the running Obsidian through its CLI, only ever about one fixture
 * vault, installing the plugin build into that vault, and putting the app back the way it was afterwards.
 */
import { execFileSync, spawnSync } from "child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const packageDir = path.resolve(scriptDir, "..");
export const repoRoot = path.resolve(packageDir, "../..");
export const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
export const TIMELINE_VIEW = "tasks_timeline_view";
/** "Today" while the scripts run: Thursday 2026-01-15 at noon, the day the golden tests use. Dates are in English. */
export const PINNED_TODAY = { year: 2026, month: 0, day: 15 };

export class ScriptError extends Error {}

function cliPath() {
	if (process.env.OBSIDIAN_CLI) return process.env.OBSIDIAN_CLI;
	const macApp = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";
	if (process.platform === "darwin" && existsSync(macApp)) return macApp;
	return "obsidian-cli";
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The CLI for one vault: every command names that vault first, so the user's own vaults are never addressed.
 * The CLI waits forever when Obsidian is not running, and now and then never prints the answer of a command Obsidian
 * did run, so every call has a timeout, and calls that can safely run twice are tried again.
 */
export function fixtureCli(vaultName) {
	function run(args, { timeout = 20_000, retries = 2 } = {}) {
		for (let attempt = 0; ; attempt++) {
			const result = spawnSync(cliPath(), [`vault=${vaultName}`, ...args], {
				encoding: "utf8",
				timeout,
				killSignal: "SIGKILL",
				maxBuffer: 512 * 1024 * 1024,
			});
			if (result.error?.code === "ETIMEDOUT") {
				if (attempt < retries) continue;
				throw new ScriptError(
					`the Obsidian CLI did not answer "${args[0]}" within ${timeout / 1000} s. Is Obsidian running with the vault ${vaultName} open?`,
				);
			}
			if (result.error)
				throw new ScriptError(
					`could not run the Obsidian CLI (${cliPath()}): ${result.error.message}. Set OBSIDIAN_CLI to its path.`,
				);
			if (result.status !== 0)
				throw new ScriptError(
					`the Obsidian CLI failed for "${args[0]}": ${(result.stderr || result.stdout).trim()}`,
				);
			return result.stdout.trim();
		}
	}
	/** Runs code that returns a string and returns that string. */
	function evalString(code) {
		const out = run(["eval", `code=${code}`]);
		// The CLI prints what was logged meanwhile first, then "=> " and the result, or an error instead of a result.
		const result = out.split("\n").findLast((line) => line.startsWith("=> "));
		if (result === undefined) throw new ScriptError(`code run in Obsidian failed: ${out.slice(-2000)}`);
		return result.slice(3);
	}
	return {
		run: (...args) => run(args),
		/**
		 * Runs `fn(arg)` in the vault's window and returns its result, which must be JSON. `fn` is sent as source, so it
		 * cannot use anything from this file. The argument travels as base64, untouched by the CLI's own escapes.
		 * The call starts `fn` as a job kept in the window and then asks for the job's state, so that an answer the CLI
		 * loses costs a retry instead of the result. Both calls can be repeated without running `fn` twice.
		 */
		evaluate(fn, arg = null, timeout = 120_000) {
			const id = JSON.stringify(`job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
			const encoded = Buffer.from(JSON.stringify(arg), "utf8").toString("base64");
			const decode = `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${encoded}"), c => c.charCodeAt(0))))`;
			evalString(`(() => {
				const jobs = (window.__tcwJobs ??= {});
				if (!jobs[${id}]) {
					const job = (jobs[${id}] = { done: false });
					(async () => (${fn.toString()})(${decode}))()
						.then(result => { job.result = JSON.stringify(result ?? null); }, error => { job.error = String(error?.stack ?? error); })
						.finally(() => { job.done = true; });
				}
				return "started";
			})()`);
			const start = Date.now();
			for (let wait = 50; ; wait = Math.min(wait * 2, 400)) {
				pause(wait);
				const state = JSON.parse(evalString(`JSON.stringify(window.__tcwJobs?.[${id}] ?? { missing: true })`));
				if (state.missing) throw new ScriptError("the code run in Obsidian disappeared. Did Obsidian reload?");
				if (state.done) {
					evalString(`(() => { delete window.__tcwJobs[${id}]; return "deleted"; })()`);
					if (state.error !== undefined) throw new ScriptError(`code run in Obsidian failed: ${state.error}`);
					return JSON.parse(state.result);
				}
				if (Date.now() - start > timeout)
					throw new ScriptError(`code run in Obsidian did not finish within ${timeout / 1000} s.`);
			}
		},
		/** Calls a Chrome DevTools Protocol method on the vault's window. */
		cdp(method, params) {
			const out = run(["dev:cdp", `method=${method}`, ...(params ? [`params=${JSON.stringify(params)}`] : [])]);
			try {
				return JSON.parse(out);
			} catch {
				throw new ScriptError(`${method} did not return JSON: ${out.slice(0, 500)}`);
			}
		},
	};
}

/** Lists the notes (*.md) below a folder, skipping hidden folders such as .obsidian. */
export function markdownFiles(dir, prefix = "") {
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			if (name.startsWith(".")) return [];
			const full = path.join(dir, name);
			const relative = prefix ? `${prefix}/${name}` : name;
			if (statSync(full).isDirectory()) return markdownFiles(full, relative);
			return name.endsWith(".md") ? [relative] : [];
		});
}

/**
 * Finds the folder of the vault Obsidian knows by this name and checks that its notes are exactly `expected`
 * (path → content, a string or a Buffer), so nothing is ever done to a vault that is not the fixture.
 */
export function fixtureVaultPath(cli, vaultName, expected, howToOpen) {
	let vaultPath;
	try {
		vaultPath = cli.run("vault", "info=path");
	} catch (error) {
		throw new ScriptError(`${error.message}\n${howToOpen}`);
	}
	if (!vaultPath || !existsSync(vaultPath))
		throw new ScriptError(`Obsidian has no vault "${vaultName}". ${howToOpen}`);
	const onDisk = new Set(markdownFiles(vaultPath));
	const differing = [...new Set([...expected.keys(), ...onDisk])].filter(
		(file) =>
			!expected.has(file) ||
			!onDisk.has(file) ||
			!readFileSync(path.join(vaultPath, file)).equals(Buffer.from(expected.get(file))),
	);
	if (differing.length) {
		throw new ScriptError(
			`the vault "${vaultName}" at ${vaultPath} is not the fixture; these notes differ: ${JSON.stringify(differing.slice(0, 20))}${differing.length > 20 ? ` and ${differing.length - 20} more` : ""}.`,
		);
	}
	const base = cli.evaluate(() => app.vault.adapter.getBasePath?.() ?? null);
	if (base !== vaultPath)
		throw new ScriptError(
			`the window for "${vaultName}" shows the vault at ${base}, not ${vaultPath}. Is more than one vault named ${vaultName}?`,
		);
	return vaultPath;
}

/** Reads the notes of a folder as `markdownFiles` lists them, as a map from path to content. */
export function notesOf(dir) {
	return new Map(markdownFiles(dir).map((file) => [file, readFileSync(path.join(dir, file))]));
}

/** This checkout's release build: dist/main.js, made by `pnpm build`, and styles.css. */
export const releaseBuild = () => ({
	mainJs: path.join(packageDir, "dist", "main.js"),
	stylesCss: path.join(packageDir, "styles.css"),
});

/**
 * Copies a build, this checkout's release build unless `build` names another main.js and styles.css, and manifest.json
 * into the vault's plugin folder, with `settings` as data.json. Returns `copyBuild`, which puts another build's main.js
 * and styles.css in place while keeping the manifest, and `restore`, which puts the folder back as it was.
 * What the folder held is kept on disk until then, in .obsidian/.tcw-fixture-backup (Obsidian ignores folders it does
 * not know there), so after a run that was killed the next one restores it instead of taking the leftovers for it.
 */
export function installPlugin(vaultPath, settings, build = releaseBuild()) {
	if (!existsSync(build.mainJs))
		throw new ScriptError(`${path.relative(repoRoot, build.mainJs)} does not exist. Run \`pnpm build\` first.`);
	const obsidianDir = path.join(vaultPath, ".obsidian");
	const pluginsDir = path.join(obsidianDir, "plugins");
	const pluginDir = path.join(pluginsDir, manifest.id);
	const backupDir = path.join(obsidianDir, ".tcw-fixture-backup");
	const stateFile = path.join(backupDir, "state.json");
	function restore() {
		// Without the state file the backup was not finished, and the plugin folder was not touched yet.
		if (existsSync(stateFile)) {
			const state = JSON.parse(readFileSync(stateFile, "utf8"));
			rmSync(state.pluginsDirExisted ? pluginDir : pluginsDir, { recursive: true, force: true });
			if (state.pluginDirExisted) cpSync(path.join(backupDir, "files"), pluginDir, { recursive: true });
		}
		rmSync(backupDir, { recursive: true, force: true });
	}
	if (existsSync(backupDir)) {
		console.warn(
			`${path.relative(vaultPath, backupDir)} is left from a run that did not finish; putting the plugin folder back first.`,
		);
		restore();
	}
	const state = { pluginsDirExisted: existsSync(pluginsDir), pluginDirExisted: existsSync(pluginDir) };
	mkdirSync(backupDir, { recursive: true });
	if (state.pluginDirExisted) cpSync(pluginDir, path.join(backupDir, "files"), { recursive: true });
	writeFileSync(stateFile, JSON.stringify(state));
	const writeSettings = (values) =>
		writeFileSync(path.join(pluginDir, "data.json"), JSON.stringify(values, null, "\t"));
	const copyBuild = (files) => {
		copyFileSync(files.mainJs, path.join(pluginDir, "main.js"));
		copyFileSync(files.stylesCss, path.join(pluginDir, "styles.css"));
	};
	try {
		mkdirSync(pluginDir, { recursive: true });
		copyBuild(build);
		copyFileSync(path.join(repoRoot, "manifest.json"), path.join(pluginDir, "manifest.json"));
		writeSettings(settings);
	} catch (error) {
		restore();
		throw error;
	}
	return { writeSettings, copyBuild, restore };
}

/**
 * Settings that keep the "what's new" dialog away, which would cover the timeline, and open the timeline without an
 * active counter or "Focus on today", whatever the defaults are.
 */
export function quietSettings(extra = {}) {
	return {
		showWhatsNewOnUpdate: false,
		lastSeenVersion: manifest.version,
		defaultFilters: "",
		defaultTodayFocus: false,
		...extra,
	};
}

/**
 * Runs in Obsidian. Remembers what the scripts change, then: stops throttling the window when it is hidden behind
 * other windows (timers and frames would otherwise slow to a crawl), pins "today" and writes dates in English whatever
 * language Obsidian uses, turns community plugins on and loads the copied plugin. What it remembers is kept in the
 * window, so after a run that crashed, the next run still restores the state from before the first.
 */
export async function prepareApp({ pluginId, today }) {
	const webContents = require("@electron/remote").getCurrentWebContents();
	const saved = window.__tcwFixtureSaved ?? {
		throttling: webContents.getBackgroundThrottling(),
		momentNow: window.moment.now,
		locale: window.moment.locale(),
		restricted: !app.plugins.isEnabled(),
		pluginEnabled: app.plugins.enabledPlugins.has(pluginId),
		// Undefined when the vault never set it, which restoring keeps.
		theme: app.vault.config.theme,
		layout: app.workspace.getLayout(),
	};
	window.__tcwFixtureSaved = saved;
	webContents.setBackgroundThrottling(false);
	const now = new Date(today.year, today.month, today.day, 12, 0, 0).getTime();
	window.moment.now = () => now;
	window.moment.locale("en");
	if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
	if (app.plugins.enabledPlugins.has(pluginId)) await app.plugins.disablePlugin(pluginId);
	await app.plugins.loadManifests();
	if (!app.plugins.manifests[pluginId]) throw new Error(`Obsidian did not find the plugin ${pluginId} in the vault`);
	return {
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		today: window.moment().format("YYYY-MM-DD dddd"),
		visibility: document.visibilityState,
	};
}

/**
 * Runs in Obsidian, the first half of undoing prepareApp: the clock, the language and the throttling first, as they
 * matter most, then the plugin is unloaded, after waiting for code from a call that timed out to finish. Every step
 * runs even when one fails; the failures are thrown together at the end.
 */
export async function unloadApp({ pluginId, viewType }) {
	const saved = window.__tcwFixtureSaved;
	if (!saved) return false;
	const failures = [];
	const step = async (what, run) => {
		try {
			await run();
		} catch (error) {
			failures.push(`${what}: ${error?.message ?? error}`);
		}
	};
	await step("unpin today", () => {
		window.moment.now = saved.momentNow;
	});
	await step("restore the language of dates", () => {
		window.moment.locale(saved.locale);
	});
	await step("restore throttling", () =>
		require("@electron/remote").getCurrentWebContents().setBackgroundThrottling(saved.throttling),
	);
	await step("wait for unfinished calls", async () => {
		// This call is one of the jobs that are not done.
		const start = performance.now();
		while (Object.values(window.__tcwJobs ?? {}).filter((job) => !job.done).length > 1) {
			if (performance.now() - start > 30_000)
				throw new Error("code from an earlier call is still running after 30 s");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});
	await step("close the timeline", () => app.workspace.detachLeavesOfType(viewType));
	await step("unload the plugin", async () => {
		if (app.plugins.plugins[pluginId]) await app.plugins.disablePlugin(pluginId);
	});
	if (failures.length) throw new Error(failures.join("; "));
	return true;
}

/**
 * Runs in Obsidian once the plugin folder is back as it was, the second half of undoing prepareApp: the plugin list,
 * restricted mode, the theme setting and the layout.
 */
export async function restoreApp({ pluginId }) {
	const saved = window.__tcwFixtureSaved;
	if (!saved) return false;
	const failures = [];
	const step = async (what, run) => {
		try {
			await run();
		} catch (error) {
			failures.push(`${what}: ${error?.message ?? error}`);
		}
	};
	await step("reload the plugin list", () => app.plugins.loadManifests());
	await step("enable the plugin again", async () => {
		if (saved.pluginEnabled && app.plugins.manifests[pluginId]) await app.plugins.enablePlugin(pluginId);
	});
	await step("turn restricted mode back on", async () => {
		if (saved.restricted) await app.plugins.setEnable(false);
	});
	await step("restore the theme setting", () => {
		app.vault.setConfig("theme", saved.theme);
		app.updateTheme();
	});
	await step("restore the layout", () => app.workspace.changeLayout(saved.layout));
	delete window.__tcwFixtureSaved;
	if (failures.length) throw new Error(failures.join("; "));
	return true;
}

/**
 * Prepares the vault's window for a run (prepareApp) and gives the undo steps that put the window and the plugin folder
 * back, for runAndUndo. Once prepareApp was asked to run, a window that lost what it saved, because it was reloaded or
 * closed and reopened during the run, makes the undo steps fail and name what was not put back, rather than do nothing.
 */
export function fixtureWindow(cli, vaultName, plugin) {
	let prepared = false;
	const undo = (fn, what) => () => {
		if (!prepared) return;
		if (cli.evaluate(fn, { pluginId: manifest.id, viewType: TIMELINE_VIEW }) === false) {
			throw new ScriptError(
				`the window of ${vaultName} no longer has what it saved before the run (was it reloaded, or closed and reopened?), so ${what} were not put back; check them in Obsidian`,
			);
		}
	};
	return {
		prepare() {
			prepared = true;
			const result = cli.evaluate(prepareApp, { pluginId: manifest.id, today: PINNED_TODAY });
			if (result.today !== "2026-01-15 Thursday")
				throw new ScriptError(`pinning today failed: Obsidian says it is ${result.today}.`);
			return result;
		},
		undoSteps: [
			[
				"unload the plugin",
				undo(unloadApp, "the clock, the language of dates, the throttling and the loaded plugin"),
			],
			["restore the plugin folder", () => plugin.restore()],
			["restore the app", undo(restoreApp, `restricted mode, the theme setting and the layout of ${vaultName}`)],
		],
	};
}

/**
 * Runs `work`, then every undo step, each one even when an earlier one failed. Throws the error of `work` together with
 * any failed undo step, so a failure to put things back is never lost and never hides the original error.
 * @param undoSteps [description, function] pairs, in the order they run.
 */
export function runAndUndo(work, undoSteps) {
	let failure = null;
	let result;
	try {
		result = work();
	} catch (error) {
		failure = error;
	}
	const problems = [];
	for (const [what, undo] of undoSteps) {
		try {
			undo();
		} catch (error) {
			problems.push(`${what}: ${error.message}`);
		}
	}
	if (problems.length) {
		const message = `could not put everything back, see what is left: ${problems.join("; ")}`;
		if (failure)
			throw new ScriptError(
				`${failure instanceof ScriptError ? failure.message : failure.stack}\nAlso ${message}`,
			);
		throw new ScriptError(message);
	}
	if (failure) throw failure;
	return result;
}

/** The machine, for the records: numbers and pixels from another machine are not comparable. */
export function machineInfo() {
	const cpus = os.cpus();
	let osName = `${os.type()} ${os.release()}`;
	if (process.platform === "darwin") {
		try {
			osName = `macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()} (${osName})`;
		} catch {
			// sw_vers is only for a nicer name; the kernel version above identifies the system too.
		}
	}
	return {
		cpu: cpus[0]?.model ?? "unknown",
		cores: cpus.length,
		memoryGB: Math.round(os.totalmem() / 2 ** 30),
		os: osName,
		arch: os.arch(),
	};
}

/** What `pnpm build` reads, as git pathspecs. */
const BUILD_INPUTS = [
	"apps/obsidian-plugin",
	":(exclude)apps/obsidian-plugin/scripts",
	":(exclude)apps/obsidian-plugin/tests",
	"packages",
	"manifest.json",
	"pnpm-lock.yaml",
];

/** The last commit that changed what the build is made from, and whether the checkout changes it further. */
export function buildInfo() {
	const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
	return {
		version: manifest.version,
		commit: git("log", "-1", "--format=%h", "--", ...BUILD_INPUTS),
		uncommittedChanges: git("status", "--porcelain", "--", ...BUILD_INPUTS).length > 0,
	};
}

/** Runs `main`, reporting a ScriptError as one line and anything else with its stack, and sets the exit code. */
export async function runScript(name, main) {
	try {
		process.exitCode = (await main()) ?? 0;
	} catch (error) {
		console.error(`${name}: ${error instanceof ScriptError ? error.message : error.stack}`);
		process.exitCode = 1;
	}
}
