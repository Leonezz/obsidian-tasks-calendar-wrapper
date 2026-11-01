/**
 * Records Tasks 8.6.0's API and editor toggles, so packages/core/tests can compare toggleTaskLine and tasksreader
 * with Tasks itself. `pnpm capture:tasks-toggle [--zones]` writes the eight settings groups to fixtures/tasks-toggle;
 * --zones also records recurring tasks in Los Angeles and Shanghai as Tasks regression probes.
 *
 * Needs Obsidian running with the vault named tasks-parity open, made by `pnpm tasks-parity:vault <folder>`, community
 * plugins on, Tasks 8.6.0 enabled, and Obsidian's language English. Every note and the installed Tasks release are
 * checked before touching the vault. The script temporarily changes Tasks' data.json, the window's time zone and
 * layout, and one note at a time. It restores the note's original bytes after every command, and the settings,
 * time zone and layout at the end. A settings backup on disk survives an interrupted run.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fixtureCli, fixtureVaultPath, repoRoot, runAndUndo, runScript, ScriptError } from "./fixture-app.mjs";
import {
	captureCases,
	diffNote,
	PROBE_LINES,
	probeSignature,
	SETTINGS_GROUPS,
	stableStringify,
	TASKS_PARITY_VAULT,
} from "./capture-tasks-toggle-lib.mjs";
import { tasksParityNotes } from "./tasks-parity-notes.mjs";
import { TASKS_FILES, TASKS_PARITY_MARKER, TASKS_PLUGIN_ID, TASKS_VERSION } from "./tasks-parity-vault.mjs";

const howToOpen =
	"Run `pnpm tasks-parity:vault <folder named tasks-parity>`, open that folder as a vault in Obsidian, then run this again.";
const enableTasks =
	"Turn on community plugins in tasks-parity and enable Tasks 8.6.0 (Settings → Community plugins), then run this again.";
const english = "Set Obsidian's language to English for the parity capture…";
const utcFailure =
	"Obsidian's time zone could not be switched to UTC from the script; quit Obsidian and start it with TZ=UTC (on macOS: `TZ=UTC /Applications/Obsidian.app/Contents/MacOS/Obsidian`), then run this again.";
const midnight = "the capture crossed midnight (UTC); run it again";
const groupTimeout = 45 * 60 * 1000;

function checkInstallation(vaultPath) {
	if (!existsSync(path.join(vaultPath, TASKS_PARITY_MARKER)))
		throw new ScriptError(`${TASKS_PARITY_VAULT} has no ${TASKS_PARITY_MARKER}; ${howToOpen}`);
	for (const name of ["main.js", "manifest.json", "styles.css"]) {
		const file = path.join(vaultPath, ".obsidian", "plugins", TASKS_PLUGIN_ID, name);
		if (
			!existsSync(file) ||
			createHash("sha256").update(readFileSync(file)).digest("hex") !== TASKS_FILES[name].sha256
		)
			throw new ScriptError(`Tasks ${name} does not match 8.6.0; run \`pnpm tasks-parity:vault <folder>\` again`);
	}
}

function preflight({ id, version, enableTasks, english }) {
	const plugin = app.plugins.plugins[id];
	if (
		!app.plugins.enabledPlugins.has(id) ||
		plugin?.manifest.version !== version ||
		typeof plugin.apiV1?.executeToggleTaskDoneCommand !== "function"
	)
		return { error: enableTasks };
	if (
		window.moment("2026-10-23", "YYYY-MM-DD").format("YYYY-MM-DD") !== "2026-10-23" ||
		window.moment.invalid().format() !== "Invalid date"
	)
		return { error: english };
	return { tasksVersion: plugin.manifest.version };
}

async function reloadPlugin({ id }) {
	await app.plugins.disablePlugin(id);
	if ((await app.plugins.enablePlugin(id)) === false) throw new Error(`could not re-enable ${id}`);
}

async function waitForJobs() {
	const start = performance.now();
	if (window.__tcwTasksToggleSaved) window.__tcwTasksToggleSaved.cancelled = true;
	while (Object.values(window.__tcwJobs ?? {}).filter((job) => !job.done).length > 1) {
		if (performance.now() - start > 30_000) throw new Error("an unfinished capture job did not stop within 30 s");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

function settingsBackup(vaultPath, cli) {
	const file = path.join(vaultPath, ".obsidian", "plugins", TASKS_PLUGIN_ID, "data.json");
	const folder = path.join(vaultPath, ".obsidian", ".tcw-tasks-parity-backup");
	const stateFile = path.join(folder, "state.json");
	function restore() {
		// No state file means the backup never completed, so no settings were written.
		if (existsSync(stateFile)) {
			// A reload can outlive its CLI timeout even when Obsidian lost the saved layout after a restart.
			cli.evaluate(waitForJobs);
			const { existed } = JSON.parse(readFileSync(stateFile, "utf8"));
			if (existed) writeFileSync(file, readFileSync(path.join(folder, "data.json")));
			else rmSync(file, { force: true });
			cli.evaluate(reloadPlugin, { id: TASKS_PLUGIN_ID });
		}
		// Keep the backup when restoring or reloading failed, for the next run.
		rmSync(folder, { recursive: true, force: true });
	}
	return {
		recover() {
			if (existsSync(folder)) restore();
		},
		prepare() {
			mkdirSync(folder, { recursive: true });
			const existed = existsSync(file);
			if (existed) writeFileSync(path.join(folder, "data.json"), readFileSync(file));
			writeFileSync(stateFile, JSON.stringify({ existed }));
		},
		write(settings) {
			writeFileSync(file, stableStringify(settings));
		},
		restore,
	};
}

function rememberWindow() {
	if (window.__tcwTasksToggleSaved) throw new Error("an earlier Tasks capture still has window state to restore");
	window.__tcwTasksToggleSaved = {
		timeZone: process.env.TZ,
		hadTimeZone: Object.hasOwn(process.env, "TZ"),
		layout: app.workspace.getLayout(),
		leaves: new Set(),
		originals: new Map(),
		cancelled: false,
		running: false,
	};
}

function switchZone({ zone, failure }) {
	process.env.TZ = zone;
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const expected = zone === "UTC" ? [0, 0] : zone === "America/Los_Angeles" ? [420, 480] : [-480, -480];
	const dates =
		zone === "UTC"
			? [new Date(2026, 0, 15, 12), new Date(2026, 6, 15, 12)]
			: [new Date(2026, 9, 31, 12), new Date(2026, 10, 2, 12)];
	if (
		!dates.every((date, i) => date.getTimezoneOffset() === expected[i]) ||
		!(timeZone === zone || (zone === "UTC" && timeZone === "Etc/UTC"))
	)
		return { error: failure };
	return { timeZone: zone, momentLocale: window.moment.locale(), day: window.moment().format("YYYY-MM-DD") };
}

async function waitForSettings({ id, group, probes, probePath }, signatureOf) {
	await app.plugins.disablePlugin(id);
	await app.plugins.enablePlugin(id);
	const start = performance.now();
	let seen = "API unavailable";
	while (performance.now() - start < 10_000) {
		try {
			const api = app.plugins.plugins[id]?.apiV1;
			if (typeof api?.executeToggleTaskDoneCommand === "function") {
				seen = signatureOf(probes.map((line) => api.executeToggleTaskDoneCommand(line, probePath)));
				if (JSON.stringify(seen) === JSON.stringify(group.signature)) return;
			}
		} catch (error) {
			seen = String(error?.message ?? error);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`settings group ${group.name} did not become ready; signature seen: ${JSON.stringify(seen)}`);
}

async function captureGroup({ id, cases, hashes }, noteDiff) {
	const saved = window.__tcwTasksToggleSaved;
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const sha256 = (bytes) => require("crypto").createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
	const notes = {};
	const captured = [];
	saved.running = true;
	try {
		for (const entry of cases) {
			if (saved.cancelled) throw new Error("the capture was cancelled before undoing the window");
			const original = await app.vault.adapter.readBinary(entry.path);
			if (sha256(original) !== hashes[entry.path]) throw new Error(`note changed before capture: ${entry.path}`);
			const before = decoder.decode(original);
			notes[entry.path] = before;
			// The verified note supplies the source line, keeping the CLI argument below the operating system's limit.
			let sourceLine = before.split("\n")[entry.line].replace(/\r$/, "");
			if (entry.line === 0) sourceLine = sourceLine.replace(/^\uFEFF/, "");
			const api = app.plugins.plugins[id].apiV1.executeToggleTaskDoneCommand(sourceLine, entry.path);
			if (typeof api !== "string")
				throw new Error(`Tasks API did not return a string: ${entry.path}:${entry.line}`);
			saved.originals.set(entry.path, original);
			const leaf = app.workspace.getLeaf("tab");
			saved.leaves.add(leaf);
			let after;
			try {
				await leaf.setViewState({
					type: "markdown",
					state: { file: entry.path, mode: "source" },
					active: true,
				});
				app.workspace.setActiveLeaf(leaf, { focus: true });
				const view = leaf.view;
				if (view.getMode?.() !== "source" || !view.editor)
					throw new Error(`no source editor for ${entry.path}`);
				const line = view.editor.getLine(entry.line);
				if ((entry.line === 0 ? line.replace(/^\uFEFF/, "") : line) !== sourceLine)
					throw new Error(`editor has stale text: ${entry.path}:${entry.line}`);
				view.editor.setCursor({ line: entry.line, ch: 0 });
				if (app.commands.executeCommandById("obsidian-tasks-plugin:toggle-done") !== true)
					throw new Error(`Tasks toggle command did not run: ${entry.path}:${entry.line}`);
				await view.save();
				after = decoder.decode(await app.vault.adapter.readBinary(entry.path));
			} finally {
				// Closing first prevents a pending editor save from overwriting the restored bytes.
				leaf.detach();
				saved.leaves.delete(leaf);
				await app.vault.adapter.writeBinary(entry.path, original);
				if (sha256(await app.vault.adapter.readBinary(entry.path)) !== hashes[entry.path])
					throw new Error(`note was not restored byte for byte: ${entry.path}`);
				saved.originals.delete(entry.path);
				// As in capture-golden, the cache hash identifies the bytes Obsidian has indexed before reopening the note.
				await new Promise((resolve) => setTimeout(resolve, 50));
				const start = performance.now();
				while (app.metadataCache.fileCache?.[entry.path]?.hash !== hashes[entry.path]) {
					if (performance.now() - start > 10_000) throw new Error(`metadata did not settle: ${entry.path}`);
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}
			captured.push({ ...entry, sourceLine, api, after: noteDiff(before, after) });
		}
		return { notes, cases: captured };
	} finally {
		saved.running = false;
	}
}

async function closeCapture() {
	const saved = window.__tcwTasksToggleSaved;
	if (!saved) return false;
	saved.cancelled = true;
	const start = performance.now();
	// Settings reloads also run as jobs. Undo must not race a job whose CLI call timed out.
	while (saved.running || Object.values(window.__tcwJobs ?? {}).filter((job) => !job.done).length > 1) {
		if (performance.now() - start > 30_000) throw new Error("an unfinished capture did not stop within 30 s");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	const problems = [];
	for (const leaf of saved.leaves) {
		try {
			leaf.detach();
			saved.leaves.delete(leaf);
		} catch (error) {
			problems.push(`close capture leaf: ${error.message}`);
		}
	}
	for (const [file, original] of saved.originals) {
		try {
			await app.vault.adapter.writeBinary(file, original);
			const actual = new Uint8Array(await app.vault.adapter.readBinary(file));
			if (
				actual.length !== original.byteLength ||
				!actual.every((value, i) => value === new Uint8Array(original)[i])
			)
				throw new Error("bytes differ after restoring");
			saved.originals.delete(file);
		} catch (error) {
			problems.push(`restore ${file}: ${error.message}`);
		}
	}
	if (problems.length) throw new Error(problems.join("; "));
	return true;
}

function restoreZone() {
	const saved = window.__tcwTasksToggleSaved;
	if (!saved) return false;
	if (Object.values(window.__tcwJobs ?? {}).filter((job) => !job.done).length > 1)
		throw new Error("unfinished capture jobs still need the time zone; saved state was kept");
	if (saved.hadTimeZone) process.env.TZ = saved.timeZone;
	else delete process.env.TZ;
	saved.zoneRestored = true;
	return true;
}

async function restoreLayout() {
	const saved = window.__tcwTasksToggleSaved;
	if (!saved) return false;
	if (
		!saved.zoneRestored ||
		saved.leaves.size ||
		saved.originals.size ||
		saved.running ||
		Object.values(window.__tcwJobs ?? {}).filter((job) => !job.done).length > 1
	)
		throw new Error("capture cleanup is still incomplete");
	await app.workspace.changeLayout(saved.layout);
	delete window.__tcwTasksToggleSaved;
	return true;
}

// evaluate sends source into the window. Transferring the tested pure helpers keeps both sides on the same algorithm.
const settingsJob = new Function(
	"input",
	`return (${waitForSettings.toString()})(input, ${probeSignature.toString()});`,
);
const captureJob = new Function("input", `return (${captureGroup.toString()})(input, ${diffNote.toString()});`);

function capture(cli, backup, group, cases, expected, environment) {
	backup.write(group.settings);
	cli.evaluate(settingsJob, { id: TASKS_PLUGIN_ID, group, probes: PROBE_LINES, probePath: cases[0].path });
	const hashes = Object.fromEntries(
		[...new Set(cases.map((entry) => entry.path))].map((file) => [
			file,
			createHash("sha256").update(expected.get(file)).digest("hex"),
		]),
	);
	const locations = cases.map(({ path, line, kind, recurring, lineEnding }) => ({
		path,
		line,
		kind,
		recurring,
		lineEnding,
	}));
	const result = cli.evaluate(captureJob, { id: TASKS_PLUGIN_ID, cases: locations, hashes }, groupTimeout);
	return { format: 1, group: group.name, settings: group.settings, ...environment, ...result };
}

function zone(cli, name) {
	const result = cli.evaluate(switchZone, {
		zone: name,
		failure:
			name === "UTC"
				? utcFailure
				: `Obsidian's time zone could not be switched to ${name}; no fixtures were written.`,
	});
	if (result.error) throw new ScriptError(result.error);
	return result;
}

function writeCaptures(captures) {
	const output = path.join(repoRoot, "fixtures", "tasks-toggle");
	const stage = mkdtempSync(path.join(repoRoot, "fixtures", ".tasks-toggle-"));
	const next = path.join(stage, "next");
	const previous = path.join(stage, "previous");
	let keepPrevious = false;
	try {
		// Preserve optional zone captures (and their bytes) when this run did not request them.
		if (existsSync(output)) cpSync(output, next, { recursive: true });
		else mkdirSync(next);
		for (const [file, fixture] of captures) {
			mkdirSync(path.dirname(path.join(next, file)), { recursive: true });
			writeFileSync(path.join(next, file), stableStringify(fixture));
		}
		if (existsSync(output)) renameSync(output, previous);
		try {
			renameSync(next, output);
		} catch (error) {
			if (existsSync(previous)) {
				try {
					renameSync(previous, output);
				} catch (restoreError) {
					keepPrevious = true;
					throw new ScriptError(
						`could not publish captures (${error.message}) or restore fixtures (${restoreError.message}); previous fixtures remain at ${previous}`,
					);
				}
			}
			throw error;
		}
	} finally {
		if (!keepPrevious) rmSync(stage, { recursive: true, force: true });
	}
	for (const [file, fixture] of captures)
		console.log(
			`capture-tasks-toggle: ${fixture.group} (${fixture.timeZone}): ${fixture.cases.length} cases, ${fixture.cases.filter((entry) => entry.recurring).length} recurring; wrote fixtures/tasks-toggle/${file}`,
		);
}

await runScript("capture-tasks-toggle", () => {
	const args = process.argv.slice(2);
	if (args.length > 1 || args.some((arg) => arg !== "--zones"))
		throw new ScriptError("usage: pnpm capture:tasks-toggle [--zones]");
	const cli = fixtureCli(TASKS_PARITY_VAULT);
	const expected = tasksParityNotes();
	const vaultPath = fixtureVaultPath(cli, TASKS_PARITY_VAULT, expected, howToOpen);
	checkInstallation(vaultPath);
	const version = cli.run("version");
	if (!/^\d+\.\d+/.test(version)) throw new ScriptError(`unexpected output of "obsidian-cli version": ${version}`);
	const backup = settingsBackup(vaultPath, cli);
	let remembered = false;
	const undo = (fn) => () => {
		if (remembered && cli.evaluate(fn) === false)
			throw new ScriptError(
				"the tasks-parity window lost its saved state; check its time zone, notes and layout in Obsidian",
			);
	};
	const captures = runAndUndo(() => {
		// A killed CLI may leave its job and original state in the window; recover that before saving a fresh layout.
		if (cli.evaluate(() => Boolean(window.__tcwTasksToggleSaved))) {
			remembered = true;
			cli.evaluate(closeCapture);
			cli.evaluate(restoreZone);
			backup.recover();
			cli.evaluate(restoreLayout);
			remembered = false;
		}
		// A killed reload may have left Tasks disabled; recover its settings before checking that it is enabled.
		backup.recover();
		const preflightResult = cli.evaluate(preflight, {
			id: TASKS_PLUGIN_ID,
			version: TASKS_VERSION,
			enableTasks,
			english,
		});
		if (preflightResult.error) throw new ScriptError(preflightResult.error);
		remembered = true;
		cli.evaluate(rememberWindow);
		backup.prepare();
		const started = zone(cli, "UTC");
		const environment = {
			tasksVersion: preflightResult.tasksVersion,
			obsidianVersion: version.split(/\s/)[0],
			...started,
		};
		const cases = captureCases();
		const captures = SETTINGS_GROUPS.map((group) => [
			`${group.name}.json`,
			capture(cli, backup, group, cases, expected, environment),
		]);
		if (args.includes("--zones")) {
			for (const name of ["America/Los_Angeles", "Asia/Shanghai"]) {
				const local = zone(cli, name);
				const fixture = capture(
					cli,
					backup,
					SETTINGS_GROUPS[0],
					cases.filter((entry) => entry.recurring),
					expected,
					{ ...environment, ...local },
				);
				if (cli.evaluate(() => window.moment().format("YYYY-MM-DD")) !== local.day)
					throw new ScriptError(`the capture crossed midnight (${name}); run it again`);
				captures.push([`zones/${name.replaceAll("/", "-")}.json`, fixture]);
			}
		}
		if (zone(cli, "UTC").day !== started.day) throw new ScriptError(midnight);
		return captures;
	}, [
		["close capture leaves and restore unfinished notes", undo(closeCapture)],
		["restore the time zone", undo(restoreZone)],
		["restore Tasks settings and reload Tasks", () => backup.restore()],
		["restore the layout", undo(restoreLayout)],
		["verify every original note", () => fixtureVaultPath(cli, TASKS_PARITY_VAULT, expected, howToOpen)],
	]);
	writeCaptures(captures);
});
