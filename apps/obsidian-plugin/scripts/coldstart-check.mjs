/** Step 21's cold-start identity check. Only an explicit CLI invocation may quit or start Obsidian. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COLDSTART_FIXTURES = ["golden-vault", "bench-vault", "bench-vault-x10", "tasks-parity"];
const TARGETS = ["golden-vault", "bench-vault-x10"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, "\t") + "\n";
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function parseColdstartArgs(argv) {
	let report;
	let timeoutMs = 180_000;
	const seen = new Set();
	for (const arg of argv) {
		const match = /^--(report|timeout-ms)=(.+)$/.exec(arg);
		if (!match || seen.has(match[1])) throw new Error(`Unknown or repeated coldstart-check argument: ${arg}`);
		seen.add(match[1]);
		if (match[1] === "report") report = match[2];
		else {
			timeoutMs = Number(match[2]);
			if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000)
				throw new Error("--timeout-ms must be an integer from 5000 through 300000.");
		}
	}
	if (!report)
		throw new Error("Use --report=<new artifact directory or .json file>; existing reports are never overwritten.");
	return { report, timeoutMs };
}

/** Canonicalise the existing ancestor, including aliases such as macOS /var, before creating anything. */
export function coldstartReportPaths(input) {
	let ancestor = path.resolve(input);
	const missing = [];
	while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
		missing.unshift(path.basename(ancestor));
		ancestor = path.dirname(ancestor);
	}
	const canonical = path.join(realpathSync(ancestor), ...missing);
	const file = canonical.endsWith(".json") ? canonical : path.join(canonical, "report.json");
	const directory = canonical.endsWith(".json") ? canonical + ".files" : canonical;
	for (const target of [canonical, file, directory])
		if (lstatSync(target, { throwIfNoEntry: false }))
			throw new Error(`Cold-start output already exists: ${target}`);
	for (let current = path.dirname(canonical); ; current = path.dirname(current)) {
		if (existsSync(path.join(current, ".obsidian")))
			throw new Error("Cold-start reports and backups must stay outside vaults.");
		if (path.dirname(current) === current) break;
	}
	return { file, directory };
}

/** Keep esbuild's non-configurable default getter and every other export descriptor, replacing only its value. */
export function wrapColdstartBundle(source, skipOpenReread, today) {
	if (typeof skipOpenReread !== "boolean") throw new Error("The cold-start arm must be a boolean.");
	if (!today || ![today.year, today.month, today.day].every(Number.isInteger))
		throw new Error("A pinned day is required.");
	const pin = { ...today, sourceSha256: sha256(source), skipOpenReread };
	return (
		source +
		`\n;(() => {
	const pin = ${JSON.stringify(pin)};
	const original = module.exports;
	const descriptors = Object.getOwnPropertyDescriptors(original);
	const descriptor = descriptors.default;
	const Base = original.default;
	if (!descriptor || typeof Base !== "function") throw new Error("The cold-start build has no default plugin class.");
	class ColdstartPlugin extends Base {
		constructor(...args) {
			if (!window.moment || typeof window.moment.locale !== "function") throw new Error("Obsidian moment is unavailable before onload.");
			window.moment.now = () => new Date(pin.year, pin.month, pin.day, 12, 0, 0).getTime();
			window.moment.locale("en");
			super(...args);
			if (!this.debug || typeof this.debug !== "object") throw new Error("This build has no fixture debug flags.");
			this.debug.skipOpenReread = pin.skipOpenReread;
			window.__tcwColdstartBuild = { ...pin, bootNonce };
		}
	}
	const bootNonce = require("crypto").randomUUID();
	descriptors.default = "get" in descriptor
		? { ...descriptor, get: () => ColdstartPlugin }
		: { ...descriptor, value: ColdstartPlugin };
	module.exports = Object.defineProperties(Object.create(Object.getPrototypeOf(original)), descriptors);
})();\n`
	);
}

/** Runs in the actual vault. Reads the controller's committed full arrangement, including off-window instances. */
export function collectColdstartSample({ pluginId, viewType, vaultPath, skipOpenReread, sourceSha256 }) {
	let remote;
	try {
		remote = require("@electron/remote");
	} catch {
		throw new Error("Cold-start samples require the actual Obsidian Electron host.");
	}
	const actualPath = app.vault.adapter.getBasePath?.();
	if (actualPath !== vaultPath) throw new Error(`Cold-start vault identity changed: ${actualPath}`);
	const plugin = app.plugins.plugins[pluginId];
	const pin = window.__tcwColdstartBuild;
	if (
		!plugin ||
		plugin.debug?.skipOpenReread !== skipOpenReread ||
		pin?.skipOpenReread !== skipOpenReread ||
		pin?.sourceSha256 !== sourceSha256 ||
		typeof pin.bootNonce !== "string"
	)
		throw new Error("Cold-start build/arm identity does not match the installed wrapper.");
	if (window.moment.locale() !== "en" || window.moment().format("YYYY-MM-DD") !== "2026-01-15")
		throw new Error("Cold-start date/locale pin is missing.");
	const metadata = {
		initialized: app.metadataCache?.initialized,
		inProgressTaskCount: app.metadataCache?.inProgressTaskCount,
	};
	if (
		typeof metadata.initialized !== "boolean" ||
		!Number.isInteger(metadata.inProgressTaskCount) ||
		metadata.inProgressTaskCount < 0
	)
		throw new Error("Cold-start metadata readiness fields are missing or unsupported.");
	if (!metadata.initialized || metadata.inProgressTaskCount !== 0)
		throw new Error("NOT_READY: metadata initialization/indexing is unfinished.");
	const leaves = app.workspace.getLeavesOfType(viewType);
	if (leaves.length !== 1) throw new Error(`NOT_READY: expected one timeline, found ${leaves.length}`);
	const view = leaves[0].view;
	const result = view.timelineHandle?.result;
	const store = view.store?.getSnapshot();
	const controls = view.viewState?.store.getSnapshot();
	if (!app.workspace.layoutReady || !result || !store || !controls)
		throw new Error("NOT_READY: timeline controller/store has not committed.");
	if (controls.counter !== "" || controls.todayFocus !== false || controls.quickFilter !== undefined)
		throw new Error("Cold-start controls must have no counter, today focus or quick filter.");
	if (
		view.isReloading !== false ||
		view.reloadAgain !== false ||
		!Number.isInteger(view.committedReloadId) ||
		!Number.isInteger(view.lastListReloadId) ||
		view.committedReloadId < view.lastListReloadId ||
		view.committedReloadId < 1
	)
		throw new Error("NOT_READY: timeline has an unfinished or uncommitted reload.");
	const rows = result.years.flatMap((year) =>
		year.days.flatMap((day) =>
			day.tasks.map(({ task }) => ({
				day: day.key,
				id: task.id,
				path: task.path,
				line: task.line,
			})),
		),
	);
	for (const row of rows)
		if (
			typeof row.day !== "string" ||
			typeof row.id !== "string" ||
			typeof row.path !== "string" ||
			!Number.isInteger(row.line) ||
			row.line < 0
		)
			throw new Error("Cold-start arrangement has an invalid row identity.");
	const info = view.getWindowingInfo();
	if (!info || info.rowCount !== rows.length)
		throw new Error("Cold-start logical row count differs from the committed arrangement.");
	const ids = (tasks) =>
		tasks.map((task) => {
			if (typeof task.id !== "string") throw new Error("Cold-start store has an invalid task ID.");
			return task.id;
		});
	if (
		rows.length === 0 ||
		!Array.isArray(store.tasks) ||
		store.tasks.length === 0 ||
		!Array.isArray(store.shown) ||
		store.shown.length === 0
	)
		throw new Error("Cold-start fixed fixtures must have nonempty arranged, source and shown identities.");
	return {
		vaultPath,
		skipOpenReread,
		mainPid: remote.process.pid,
		parentPid: process.ppid,
		rendererPid: process.pid,
		at: Date.now(),
		locale: window.moment.locale(),
		today: window.moment().format("YYYY-MM-DD"),
		bootNonce: pin.bootNonce,
		sourceSha256: pin.sourceSha256,
		actualFlag: plugin.debug.skipOpenReread,
		metadata,
		controls: { counter: controls.counter, todayFocus: controls.todayFocus, quickFilter: null },
		rows,
		taskIds: ids(store.tasks),
		shownIds: ids(store.shown),
		windowing: info,
		committedReloadId: view.committedReloadId,
		lastListReloadId: view.lastListReloadId,
	};
}

export function compareColdstartSamples(before, after) {
	for (const key of ["vaultPath", "locale", "today", "controls", "rows", "taskIds", "shownIds"])
		assert.deepEqual(after[key], before[key], `Cold-start ${key} differ`);
	assert.equal(after.windowing.rowCount, before.windowing.rowCount, "Cold-start logical row counts differ");
}

/** Window IDs/PIDs may change; paths and their unique fixture names may not. */
export function assertColdstartInventory(inventory, expectedPaths) {
	assert.equal(Number.isInteger(inventory.mainPid) && inventory.mainPid > 0, true, "Missing main PID");
	assert.equal(inventory.windows.length, Object.keys(expectedPaths).length, "Unexpected number of app windows");
	const found = new Set();
	for (const win of inventory.windows) {
		assert.equal(COLDSTART_FIXTURES.includes(win.name), true, `Unexpected vault/window: ${win.name}`);
		assert.equal(found.has(win.name), false, `Duplicate fixture window: ${win.name}`);
		found.add(win.name);
		assert.equal(win.vaultPath, expectedPaths[win.name], `Fixture path changed for ${win.name}`);
		assert.equal(win.crashed, false, `Renderer crashed: ${win.name}`);
		assert.equal(win.mainPid, inventory.mainPid, "Fixture windows belong to different app processes");
		assert.equal(win.parentPid, inventory.mainPid, "Renderer parent is not the app main process");
		assert.equal(win.layoutReady, true, `Layout is not ready: ${win.name}`);
		assert.equal(win.saved, false, `An earlier fixture setup remains in ${win.name}`);
		assert.equal(
			win.jobs,
			win.webContentsId === inventory.callerWebContentsId ? 1 : 0,
			`Another CLI job is running in ${win.name}`,
		);
	}
	for (const target of TARGETS) assert.equal(found.has(target), true, `Missing target fixture ${target}`);
}

/** A cold-only restore cannot reproduce manually hot-loaded plugins or a disabled plugin's surviving controller. */
export function assertColdstartRestorable(inventory, communities, pluginId) {
	for (const win of inventory.windows) {
		const disk = communities[win.name];
		assert.equal(
			Array.isArray(disk) && disk.every((id) => typeof id === "string") && new Set(disk).size === disk.length,
			true,
			`Invalid persisted community plugin list: ${win.name}`,
		);
		assert.deepEqual([...disk].sort(), win.enabled, `Persisted plugin list and enabled Set disagree: ${win.name}`);
		assert.deepEqual(
			win.loaded,
			win.restricted ? [] : win.enabled,
			`Loaded plugins cannot be restored by cold startup: ${win.name}`,
		);
		if (!win.loaded.includes(pluginId))
			assert.equal(
				win.views.some((view) => view.hasController || view.controls !== null),
				false,
				`A disabled plugin still has live timeline controls/controller: ${win.name}`,
			);
	}
}

export function assertNoColdstartLeftovers(vaultPath) {
	for (const name of [".tcw-fixture-backup", ".tcw-fixture-appearance.json", ".tcw-fixture-appearance.json.tmp"])
		if (lstatSync(path.join(vaultPath, ".obsidian", name), { throwIfNoEntry: false }))
			throw new Error(`An earlier fixture backup remains: ${path.join(vaultPath, ".obsidian", name)}`);
}

export function coldstartDriverProcesses(ps, selfPid) {
	const processes = ps
		.split("\n")
		.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
		.filter(Boolean);
	const parents = new Map(processes.map(([, pid, ppid]) => [Number(pid), Number(ppid)]));
	const own = new Set();
	for (let pid = selfPid; pid && !own.has(pid); pid = parents.get(pid)) own.add(pid);
	return processes
		.filter(
			([, pid, , command]) =>
				!own.has(Number(pid)) &&
				/\bnode\b.*(?:scripts\/(?:bench|screenshots|capture|markup|coldstart-check)[\w-]*\.mjs|\/tmp\/tcw-[^\s]*\.mjs)\b/.test(
					command,
				),
		)
		.map(([, pid, , command]) => ({ pid: Number(pid), command }));
}

/** Bounded readiness polling is allowed; it never launches/reloads the app or repeats a restart. */
export function waitForColdstart(
	read,
	timeoutMs,
	description,
	{ now = Date.now, sleep = pause, accept = Boolean, retry = () => false } = {},
) {
	const start = now();
	let error;
	for (;;) {
		try {
			const result = read();
			if (accept(result)) return result;
		} catch (caught) {
			if (!retry(caught)) throw caught;
			error = caught;
		}
		if (now() - start >= timeoutMs)
			throw new Error(`Timed out waiting for ${description}${error ? `: ${error.message}` : ""}`);
		sleep(250);
	}
}

/** One read-only inventory job, plus an explicit delayed normal quit. No app restart is hidden in this function. */
export async function coldstartHost({ action, pluginId, viewType, expectedPaths, restore }) {
	let remote;
	try {
		remote = require("@electron/remote");
	} catch {
		throw new Error("Cold-start inventory requires the actual Obsidian Electron host.");
	}
	if (
		!expectedPaths ||
		Object.keys(expectedPaths).some(
			(name) => !["golden-vault", "bench-vault", "bench-vault-x10", "tasks-parity"].includes(name),
		)
	)
		throw new Error("The exact fixture path allowlist is required.");
	const identities = (verified) =>
		verified
			.map(({ win, wc, vaultPath, title }) => ({
				windowId: win.id,
				webContentsId: wc.id,
				vaultPath,
				title,
			}))
			.sort((a, b) => a.windowId - b.windowId);
	async function page(wc, fn, argument = null) {
		// Electron can replace rejected executeJavaScript errors with "Script failed to execute". Return errors as JSON.
		let encoded;
		try {
			encoded = await wc.executeJavaScript(`(async () => {
			try { return JSON.stringify({ ok: true, value: await (${fn.toString()})(${JSON.stringify(argument)}) }); }
			catch (error) { return JSON.stringify({ ok: false, error: String(error?.stack ?? error) }); }
		})()`);
		} catch (error) {
			if (!wc.isDestroyed() && !wc.isCrashed() && wc.isLoading())
				throw new Error("NOT_READY: fixture page began loading during identity access.");
			throw error;
		}
		const response = JSON.parse(encoded);
		if (response?.ok !== true) throw new Error(response?.error ?? "Invalid cold-start page response.");
		return response.value;
	}
	function vaultIdentity() {
		if (typeof app === "undefined" || !app.vault?.adapter)
			throw new Error("NOT_READY: vault identity is not available.");
		return app.vault.adapter.getBasePath?.() ?? null;
	}
	async function verifyWindows() {
		const verified = [];
		const found = new Set();
		for (const win of remote.BrowserWindow.getAllWindows()) {
			const wc = win.webContents;
			const title = win.getTitle();
			if (wc.isDestroyed() || wc.isCrashed()) throw new Error(`An app renderer is unavailable: ${win.id}`);
			if (wc.isLoading()) throw new Error("NOT_READY: a fixture renderer is loading.");
			if (!Object.keys(expectedPaths).some((name) => title.includes(`${name} - Obsidian`)))
				throw new Error(`Unexpected app window title; refusing full snapshot or mutation: ${title}`);
			// This first pass reads only vault identity. No private layout, controls, clock or restoration yet.
			const vaultPath = await page(wc, vaultIdentity);
			const name = vaultPath?.split(/[\\/]/).pop();
			if (
				!Object.prototype.hasOwnProperty.call(expectedPaths, name) ||
				expectedPaths[name] !== vaultPath ||
				found.has(name)
			)
				throw new Error(
					`Unexpected or duplicate fixture path; refusing full snapshot or mutation: ${vaultPath}`,
				);
			if (!title.includes(`${name} - Obsidian`))
				throw new Error("Window title and actual fixture path disagree.");
			found.add(name);
			verified.push({ win, wc, name, vaultPath, title });
		}
		if (verified.length < Object.keys(expectedPaths).length)
			throw new Error("NOT_READY: not all expected fixture windows are open.");
		if (verified.length !== Object.keys(expectedPaths).length) throw new Error("Unexpected number of app windows.");
		// executeJavaScript awaited above: reject windows added/replaced/retitled while that pass was in progress.
		const current = remote.BrowserWindow.getAllWindows();
		if (
			current.length !== verified.length ||
			current.some((win) => {
				const saved = verified.find((entry) => entry.win.id === win.id);
				return (
					!saved ||
					win.webContents.id !== saved.wc.id ||
					win.getTitle() !== saved.title ||
					win.webContents.isDestroyed() ||
					win.webContents.isCrashed() ||
					win.webContents.isLoading()
				);
			})
		)
			throw new Error("App window identities changed during fixture verification.");
		return verified;
	}
	const verified = await verifyWindows();
	if (action === "quit") {
		if (window.__tcwColdstartQuit) throw new Error("An earlier cold-start quit request remains.");
		const state = { status: "scheduled", mainPid: remote.process.pid, identities: identities(verified) };
		window.__tcwColdstartQuit = state;
		setTimeout(async () => {
			try {
				const current = await verifyWindows();
				if (JSON.stringify(identities(current)) !== JSON.stringify(state.identities))
					throw new Error("App window identities changed after scheduling quit.");
				state.status = "quitting";
				remote.app.quit();
			} catch (error) {
				state.status = "blocked";
				state.error = error.stack ?? String(error);
			}
		}, 1_500);
		return { mainPid: remote.process.pid, scheduled: true };
	}
	function local({ pluginId, viewType, restore }) {
		if (typeof app === "undefined" || !app.vault || !app.workspace || !app.plugins)
			throw new Error("NOT_READY: vault globals are not available.");
		if (!app.workspace.layoutReady || typeof window.moment?.locale !== "function")
			throw new Error("NOT_READY: fixture runtime/layout is not ready.");
		let remote;
		try {
			remote = require("@electron/remote");
		} catch {
			throw new Error("Cold-start restoration requires the actual Obsidian Electron host.");
		}
		const wc = remote.getCurrentWebContents();
		if (restore) {
			if (
				typeof app.workspace.requestSaveLayout?.cancel !== "function" ||
				typeof app.plugins.requestSaveConfig?.cancel !== "function"
			)
				throw new Error("The known workspace/plugin autosave cancellation hooks are unavailable.");
			app.workspace.requestSaveLayout.cancel();
			app.plugins.requestSaveConfig.cancel();
			window.moment.locale(restore.locale);
			wc.setBackgroundThrottling(restore.throttling);
			for (const saved of restore.views) {
				const leaf = app.workspace.getLeavesOfType(viewType).find((leaf) => leaf.id === saved.id);
				if (saved.controls) {
					if (!leaf?.view.viewState?.actions)
						throw new Error("An original timeline could not restore its controls.");
					leaf.view.viewState.actions.restore(saved.controls);
					leaf.view.viewState.actions.setQuickFilter(saved.controls.quickFilter ?? undefined);
				}
			}
		}
		return {
			vaultPath: app.vault.adapter.getBasePath?.(),
			mainPid: remote.process.pid,
			parentPid: process.ppid,
			rendererPid: process.pid,
			webContentsId: wc.id,
			layoutReady: app.workspace.layoutReady,
			layout: app.workspace.getLayout(),
			locale: window.moment.locale(),
			clock: window.moment.now(),
			realClock: Date.now(),
			throttling: wc.getBackgroundThrottling(),
			visibility: document.visibilityState,
			restricted: !app.plugins.isEnabled(),
			enabled: [...app.plugins.enabledPlugins].sort(),
			loaded: Object.keys(app.plugins.plugins).sort(),
			theme: app.vault.config.theme ?? null,
			cssTheme: app.customCss?.theme ?? null,
			saved: !!window.__tcwFixtureSaved,
			jobs: Object.values(window.__tcwJobs ?? {}).filter((job) => !job.done).length,
			views: app.workspace.getLeavesOfType(viewType).map((leaf) => ({
				id: leaf.id,
				hasController: !!leaf.view.timelineHandle,
				controls: leaf.view.viewState?.store.getSnapshot() ?? null,
			})),
		};
	}
	const windows = [];
	for (const { win, wc, title, vaultPath, name } of verified) {
		const before = await page(wc, local, { pluginId, viewType });
		if (before.vaultPath !== vaultPath) throw new Error("Fixture path changed during the snapshot.");
		const state = restore?.[vaultPath];
		const host = state ? await page(wc, local, { pluginId, viewType, restore: state }) : before;
		if (host.vaultPath !== vaultPath) throw new Error("Fixture path changed during restoration.");
		windows.push({ ...host, name, title, windowId: win.id, crashed: false });
	}
	return {
		mainPid: remote.process.pid,
		callerWebContentsId: remote.getCurrentWebContents().id,
		executable: remote.app.getPath("exe"),
		version: remote.app.getVersion(),
		versions: process.versions,
		windows,
	};
}

/** Keep the other panes, but save one unfiltered timeline in the main tab group for the next real app startup. */
export function coldstartLayout(original, viewType) {
	const layout = JSON.parse(JSON.stringify(original));
	if (layout.main?.type !== "split") throw new Error("The fixture has no normal main workspace split.");
	const mainLeaves = [];
	const timelines = [];
	function visit(node, parents, main) {
		if (!node || typeof node.id !== "string") throw new Error("Workspace nodes must have known IDs.");
		if (node.type === "leaf") {
			if (typeof node.state?.type !== "string") throw new Error("A workspace leaf has no known view state.");
			const leaf = { node, parents };
			if (main) mainLeaves.push(leaf);
			if (node.state.type === viewType) timelines.push(leaf);
		} else {
			if (!["split", "tabs"].includes(node.type) || !Array.isArray(node.children))
				throw new Error("Unknown workspace split/tabs/leaf shape.");
			node.children.forEach((child, index) => visit(child, [...parents, { node, index }], main));
		}
	}
	for (const [key, node] of Object.entries(layout))
		if (node && typeof node === "object" && node.type) visit(node, [], key === "main");
	if (timelines.length > 1)
		throw new Error("The fixture already has multiple timelines; prepare one known leaf first.");
	const selected = timelines[0] ?? mainLeaves.find(({ node }) => node.id === layout.active) ?? mainLeaves[0];
	if (!selected) throw new Error("The fixture has no existing main leaf for its cold-start timeline.");
	selected.node.state = { type: viewType, state: {} };
	for (const { node, index } of selected.parents) if (node.type === "tabs") node.currentTab = index;
	layout.active = selected.node.id;
	return layout;
}

function filesOf(directory, prefix = "") {
	if (!existsSync(directory)) return new Map();
	if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
		throw new Error(`Not an unaliased plugin directory: ${directory}`);
	const result = new Map();
	for (const name of readdirSync(directory).sort()) {
		const file = path.join(directory, name);
		const relative = path.join(prefix, name);
		const stat = lstatSync(file);
		if (stat.isSymbolicLink()) throw new Error(`Refusing a symbolic link in plugin backup: ${file}`);
		if (stat.isDirectory()) for (const entry of filesOf(file, relative)) result.set(...entry);
		else if (stat.isFile()) result.set(relative, readFileSync(file));
		else throw new Error(`Not a regular plugin file: ${file}`);
	}
	return result;
}

const hashFiles = (files) =>
	Object.fromEntries([...files].map(([file, bytes]) => [file, { bytes: bytes.length, sha256: sha256(bytes) }]));

/** Durable backups precede app/disk mutation. These helpers do no app access. */
export function backupColdstartFiles(vaults, directory, pluginId) {
	const backups = {};
	for (const [name, vaultPath] of Object.entries(vaults)) {
		const config = path.join(vaultPath, ".obsidian");
		const plugin = path.join(config, "plugins", pluginId);
		const files = filesOf(plugin);
		const record = {
			pluginExisted: existsSync(plugin),
			pluginsDirExisted: existsSync(path.dirname(plugin)),
			plugin: hashFiles(files),
			config: {},
		};
		for (const [relative, bytes] of files) {
			const file = path.join(directory, name, "plugin", relative);
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, bytes, { flag: "wx" });
		}
		for (const relative of ["community-plugins.json", "workspace.json", "appearance.json"]) {
			const file = path.join(config, relative);
			if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink())
				throw new Error(`Refusing aliased fixture settings: ${file}`);
			const bytes = existsSync(file) ? readFileSync(file) : null;
			record.config[relative] = bytes ? { bytes: bytes.length, sha256: sha256(bytes) } : null;
			if (bytes) {
				mkdirSync(path.join(directory, name), { recursive: true });
				writeFileSync(path.join(directory, name, relative), bytes, { flag: "wx" });
			}
		}
		backups[name] = record;
	}
	writeFileSync(path.join(directory, "index.json"), json(backups), { flag: "wx" });
	return backups;
}

export function restoreColdstartFiles(vaults, directory, backups, pluginId) {
	// Verify every backup before touching any original, including an absent-file record.
	for (const [name, record] of Object.entries(backups)) {
		assert.deepEqual(
			hashFiles(filesOf(path.join(directory, name, "plugin"))),
			record.plugin,
			`Plugin backup changed: ${name}`,
		);
		for (const [file, expected] of Object.entries(record.config))
			if (expected)
				assert.deepEqual(
					hashFiles(new Map([[file, readFileSync(path.join(directory, name, file))]]))[file],
					expected,
					`Settings backup changed: ${name}/${file}`,
				);
	}
	for (const [name, vaultPath] of Object.entries(vaults)) {
		const record = backups[name];
		const config = path.join(vaultPath, ".obsidian");
		const plugin = path.join(config, "plugins", pluginId);
		rmSync(plugin, { recursive: true, force: true });
		if (record.pluginExisted) mkdirSync(plugin, { recursive: true });
		for (const [relative, bytes] of filesOf(path.join(directory, name, "plugin"))) {
			mkdirSync(path.dirname(path.join(plugin, relative)), { recursive: true });
			writeFileSync(path.join(plugin, relative), bytes);
		}
		for (const [file, expected] of Object.entries(record.config)) {
			if (expected) writeFileSync(path.join(config, file), readFileSync(path.join(directory, name, file)));
			else rmSync(path.join(config, file), { force: true });
		}
		if (
			!record.pluginsDirExisted &&
			existsSync(path.dirname(plugin)) &&
			readdirSync(path.dirname(plugin)).length === 0
		)
			rmdirSync(path.dirname(plugin));
	}
}

function verifyFiles(vaults, backups, pluginId) {
	for (const [name, vaultPath] of Object.entries(vaults)) {
		const config = path.join(vaultPath, ".obsidian");
		assert.deepEqual(
			hashFiles(filesOf(path.join(config, "plugins", pluginId))),
			backups[name].plugin,
			`Plugin bytes not restored: ${name}`,
		);
		for (const [file, expected] of Object.entries(backups[name].config)) {
			const actual = existsSync(path.join(config, file)) ? readFileSync(path.join(config, file)) : null;
			assert.deepEqual(
				actual ? { bytes: actual.length, sha256: sha256(actual) } : null,
				expected,
				`Settings bytes not restored: ${name}/${file}`,
			);
		}
	}
}

export function coldstartLayoutIdentity(layout, viewType) {
	const value = JSON.parse(JSON.stringify(layout));
	const sessions = [];
	function visit(node) {
		if (
			node?.type === "leaf" &&
			node.state?.type === viewType &&
			node.state.state?.v === 1 &&
			"session" in node.state.state
		) {
			sessions.push({ leafId: node.id, session: node.state.state.session });
			delete node.state.state.session;
		}
		for (const child of node?.children ?? []) visit(child);
	}
	for (const node of Object.values(value)) if (node && typeof node === "object") visit(node);
	return { layout: value, sessions };
}

async function performColdstartCheck(args, output, report, save) {
	if (process.platform !== "darwin")
		throw new Error("This cold-start driver currently requires the macOS Obsidian app.");
	const load = (specifier) => import(specifier);
	const fixture = await load("./fixture-app.mjs");
	const { benchVaultNotes } = await load("./bench-notes.mjs");
	const { tasksParityNotes } = await load("./tasks-parity-notes.mjs");
	const {
		fixtureCli,
		fixtureVaultPath,
		notesOf,
		repoRoot,
		releaseBuild,
		quietSettings,
		manifest,
		TIMELINE_VIEW,
		PINNED_TODAY,
		buildInfo,
	} = fixture;
	const cli = fixtureCli("bench-vault");
	const drivers = () => {
		const found = coldstartDriverProcesses(
			execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" }),
			process.pid,
		);
		assert.deepEqual(found, [], "Another native driver is running; refusing to restart the app");
	};
	drivers();
	const expected = {
		"golden-vault": notesOf(path.join(repoRoot, "fixtures", "golden-vault")),
		"bench-vault": benchVaultNotes(1),
		"bench-vault-x10": benchVaultNotes(10),
		"tasks-parity": tasksParityNotes(),
	};
	const vaults = {};
	for (const name of COLDSTART_FIXTURES) {
		const actual = fixtureVaultPath(
			fixtureCli(name),
			name,
			expected[name],
			`Open the generated ${name} fixture first.`,
		);
		assert.equal(path.basename(actual), name, "Fixture folder name differs from its CLI identity");
		vaults[name] = realpathSync(actual);
		assert.equal(actual, vaults[name], "CLI and canonical fixture paths differ");
		assertNoColdstartLeftovers(actual);
	}
	const host = (restore) =>
		cli.evaluate(
			coldstartHost,
			{ action: "inventory", pluginId: manifest.id, viewType: TIMELINE_VIEW, expectedPaths: vaults, restore },
			10_000,
		);
	const before = host();
	report.preflight = before;
	report.vaults = vaults;
	save();
	assertColdstartInventory(before, vaults);
	const communities = Object.fromEntries(
		COLDSTART_FIXTURES.map((name) => {
			const file = path.join(vaults[name], ".obsidian", "community-plugins.json");
			return [name, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []];
		}),
	);
	assertColdstartRestorable(before, communities, manifest.id);
	const controlledLayouts = Object.fromEntries(
		TARGETS.map((name) => [
			name,
			coldstartLayout(before.windows.find((win) => win.name === name).layout, TIMELINE_VIEW),
		]),
	);
	report.controlledLayouts = controlledLayouts;
	save();
	for (const win of before.windows) {
		assert.equal(Math.abs(win.clock - win.realClock) < 2_000, true, `Original clock is not current: ${win.name}`);
		if (TARGETS.includes(win.name))
			assert.equal(win.restricted, false, `Community plugins are disabled in ${win.name}`);
	}
	const appBundle = path.resolve(path.dirname(before.executable), "../..");
	assert.equal(appBundle.endsWith("/Obsidian.app"), true, "Unexpected Obsidian executable location");
	assert.equal(realpathSync(before.executable).startsWith(realpathSync(appBundle) + path.sep), true);
	const build = releaseBuild();
	const source = readFileSync(build.mainJs, "utf8");
	const styles = readFileSync(build.stylesCss);
	const wrappers = [false, true].map((skip) => ({
		skip,
		bytes: Buffer.from(wrapColdstartBundle(source, skip, PINNED_TODAY)),
	}));
	assert.equal(
		source.includes("skipOpenReread"),
		true,
		"Release build has no Step 21 debug policy; build the current source first",
	);
	Object.assign(report, {
		build: {
			...buildInfo(),
			head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
			sourceMainSha256: sha256(source),
			stylesSha256: sha256(styles),
			wrappers: wrappers.map(({ skip, bytes }) => ({ skipOpenReread: skip, mainSha256: sha256(bytes) })),
		},
		preflight: before,
		vaults,
	});
	for (const wrapper of wrappers)
		writeFileSync(path.join(output.directory, `skip-${wrapper.skip}.main.js`), wrapper.bytes, { flag: "wx" });
	const backupDir = path.join(output.directory, "backups");
	mkdirSync(backupDir);
	const backups = backupColdstartFiles(vaults, backupDir, manifest.id);
	assertColdstartRestorable(
		before,
		Object.fromEntries(
			COLDSTART_FIXTURES.map((name) => [
				name,
				backups[name].config["community-plugins.json"]
					? JSON.parse(readFileSync(path.join(backupDir, name, "community-plugins.json"), "utf8"))
					: [],
			]),
		),
		manifest.id,
	);
	report.backups = backups;
	save();
	const alive = (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			if (error.code === "ESRCH") return false;
			throw error;
		}
	};
	let current = before;
	let appDown = false;
	let changed = false;
	let quitFailed = false;
	let pendingStartup;
	const notesExact = () => {
		for (const name of COLDSTART_FIXTURES)
			assert.deepEqual(
				notesOf(vaults[name]),
				new Map([...expected[name]].map(([file, value]) => [file, Buffer.from(value)])),
				`Fixture notes changed: ${name}`,
			);
	};
	const quit = (label) => {
		drivers();
		const inventory = pendingStartup
			? awaitColdstartHost(host, vaults, pendingStartup.previousPid, args.timeoutMs)
			: host();
		assertColdstartInventory(inventory, vaults);
		if (pendingStartup) {
			current = inventory;
			pendingStartup = undefined;
			report.restoration.startupReadyBeforeQuit = inventory;
			save();
		}
		const request = { label, mainPid: inventory.mainPid, status: "requested" };
		report.quitRequests.push(request);
		save();
		try {
			const result = cli.evaluate(
				coldstartHost,
				{ action: "quit", pluginId: manifest.id, viewType: TIMELINE_VIEW, expectedPaths: vaults },
				5_000,
			);
			assert.equal(result.mainPid, inventory.mainPid);
			waitForColdstart(() => !alive(inventory.mainPid), args.timeoutMs, `normal app quit (${label})`);
		} catch (error) {
			quitFailed = true;
			appDown = !alive(inventory.mainPid);
			request.status = "failed";
			request.error = error.stack ?? String(error);
			if (!appDown) {
				try {
					request.pageState = cli.evaluate(
						({ vaultPath }) => {
							if (app.vault.adapter.getBasePath?.() !== vaultPath)
								throw new Error("Quit-status fixture path changed.");
							const state = window.__tcwColdstartQuit ?? null;
							if (state?.status === "blocked") delete window.__tcwColdstartQuit;
							return state;
						},
						{ vaultPath: vaults["bench-vault"] },
						5_000,
					);
				} catch (statusError) {
					request.statusError = statusError.stack ?? String(statusError);
				}
			}
			save();
			throw error;
		}
		appDown = true;
		request.status = "exited";
		save();
		return inventory.mainPid;
	};
	const start = (previousPid, label) => {
		const launched = spawnSync("/usr/bin/open", ["-g", "-a", appBundle], { encoding: "utf8", timeout: 20_000 });
		if (launched.error || launched.status !== 0)
			throw new Error(`Could not start Obsidian once: ${launched.error?.message ?? launched.stderr}`);
		appDown = false;
		pendingStartup = { previousPid, label };
		const inventory = awaitColdstartHost(host, vaults, previousPid, args.timeoutMs);
		pendingStartup = undefined;
		report.restarts.push({
			label,
			previousPid,
			mainPid: inventory.mainPid,
			windows: inventory.windows.map(({ name, windowId, webContentsId, rendererPid }) => ({
				name,
				windowId,
				webContentsId,
				rendererPid,
			})),
		});
		save();
		return inventory;
	};
	try {
		for (const { skip, bytes } of wrappers)
			for (let run = 1; run <= 5; run++) {
				const label = `skip=${skip} run=${run}/5`;
				console.log(`coldstart-check: ${label}: normal quit`);
				const previousPid = quit(label);
				notesExact();
				for (const name of TARGETS) {
					const config = path.join(vaults[name], ".obsidian");
					const plugin = path.join(config, "plugins", manifest.id);
					changed = true;
					mkdirSync(plugin, { recursive: true });
					writeFileSync(path.join(plugin, "main.js"), bytes);
					writeFileSync(path.join(plugin, "styles.css"), styles);
					writeFileSync(path.join(plugin, "manifest.json"), json(manifest));
					writeFileSync(path.join(plugin, "data.json"), json(quietSettings({ openViewOnStartup: false })));
					const originalCommunity = backups[name].config["community-plugins.json"]
						? JSON.parse(readFileSync(path.join(backupDir, name, "community-plugins.json"), "utf8"))
						: [];
					assert.equal(Array.isArray(originalCommunity), true, "Community plugin list is not an array");
					writeFileSync(
						path.join(config, "community-plugins.json"),
						json([...new Set([...originalCommunity, manifest.id])]),
					);
					writeFileSync(path.join(config, "workspace.json"), json(controlledLayouts[name]));
				}
				console.log(`coldstart-check: ${label}: one app start`);
				current = start(previousPid, label);
				for (const name of TARGETS) {
					const target = fixtureCli(name);
					const argument = {
						pluginId: manifest.id,
						viewType: TIMELINE_VIEW,
						vaultPath: vaults[name],
						skipOpenReread: skip,
						sourceSha256: sha256(source),
					};
					const first = waitForColdstart(
						() => target.evaluate(collectColdstartSample, argument, 10_000),
						args.timeoutMs,
						`${name} committed identity`,
						{ retry: (error) => error.message.includes("NOT_READY:") },
					);
					assert.equal(first.mainPid, current.mainPid);
					assert.equal(first.parentPid, current.mainPid);
					assert.equal(
						report.samples.some(
							(entry) => entry.name === name && entry.first.bootNonce === first.bootNonce,
						),
						false,
						"A previous boot sample was reused",
					);
					const sample = { name, skipOpenReread: skip, run, first };
					report.samples.push(sample);
					save();
					pause(1_000);
					const second = target.evaluate(collectColdstartSample, argument, 10_000);
					sample.second = second;
					writeFileSync(
						path.join(output.directory, `${skip ? "skip" : "reread"}-${run}-${name}.json`),
						json(sample),
						{ flag: "wx" },
					);
					save();
					compareColdstartSamples(first, second);
					assert.equal(second.mainPid, first.mainPid);
					assert.equal(second.bootNonce, first.bootNonce);
					const reference = report.samples.find((entry) => entry.name === name);
					compareColdstartSamples(reference.first, first);
					assert.equal(
						readFileSync(path.join(vaults[name], ".obsidian", "plugins", manifest.id, "main.js")).equals(
							bytes,
						),
						true,
						"Installed wrapper changed",
					);
					assert.equal(
						/skipOpenReread/.test(
							readFileSync(
								path.join(vaults[name], ".obsidian", "plugins", manifest.id, "data.json"),
								"utf8",
							),
						),
						false,
						"Debug flag was persisted to data.json",
					);
					console.log(
						`coldstart-check: ${label}: ${name}: ${first.rows.length} row instances stable and equal`,
					);
				}
				notesExact();
			}
	} catch (error) {
		report.errors.push(error.stack ?? String(error));
		save();
	} finally {
		if (changed || appDown || quitFailed) {
			const check = (name, action) => {
				try {
					action();
					report.restoration.checks.push({ name, ok: true });
				} catch (error) {
					report.restoration.checks.push({ name, ok: false, error: error.stack ?? String(error) });
					throw error;
				} finally {
					save();
				}
			};
			try {
				if (quitFailed && !appDown)
					throw new Error(
						"Normal quit timed out; no automatic quit/restart retry or disk restoration was attempted. Durable backups remain for manual recovery.",
					);
				let previousPid = current.mainPid;
				if (!appDown) previousPid = quit("restore originals");
				check("restore original disk bytes while app is stopped", () =>
					restoreColdstartFiles(vaults, backupDir, backups, manifest.id),
				);
				current = start(previousPid, "restore originals (not a measured slot)");
				const restored = host(Object.fromEntries(before.windows.map((win) => [win.vaultPath, win])));
				assertColdstartInventory(restored, vaults);
				report.restoration.after = restored;
				check("runtime/layout/locale/current clock", () => {
					for (const original of before.windows) {
						const after = restored.windows.find((win) => win.name === original.name);
						for (const field of [
							"locale",
							"throttling",
							"restricted",
							"enabled",
							"loaded",
							"theme",
							"cssTheme",
						])
							assert.deepEqual(
								after[field],
								original[field],
								`Original ${field} not restored in ${original.name}`,
							);
						assert.equal(
							Math.abs(after.clock - after.realClock) < 2_000,
							true,
							`Original clock is not current in ${original.name}`,
						);
						const oldLayout = coldstartLayoutIdentity(original.layout, TIMELINE_VIEW);
						const newLayout = coldstartLayoutIdentity(after.layout, TIMELINE_VIEW);
						report.restoration.sessionIdentities ??= {};
						report.restoration.sessionIdentities[original.name] = {
							before: oldLayout.sessions,
							after: newLayout.sessions,
						};
						assert.deepEqual(
							newLayout.layout,
							oldLayout.layout,
							`Original layout not restored in ${original.name}`,
						);
					}
				});
				// Startup and layout restoration may autosave; cancel known saves above, then preserve the original file bytes.
				check("restore original config bytes after startup autosave", () => {
					for (const name of COLDSTART_FIXTURES)
						for (const [file, expected] of Object.entries(backups[name].config)) {
							const target = path.join(vaults[name], ".obsidian", file);
							if (expected) writeFileSync(target, readFileSync(path.join(backupDir, name, file)));
							else rmSync(target, { force: true });
						}
				});
				check("original TCW plugin and three config files byte-exact", () =>
					verifyFiles(vaults, backups, manifest.id),
				);
				check("all four fixture notes byte-exact", notesExact);
				report.restoration.complete = true;
			} catch (error) {
				report.errors.push(`Restoration: ${error.stack ?? error}`);
				save();
			}
		}
	}
	report.complete = report.errors.length === 0 && report.samples.length === 20 && report.restoration.complete;
	report.finishedAt = new Date().toISOString();
	save();
	console.log(`coldstart-check: ${report.complete ? "PASS" : "FAIL"}: ${output.file}`);
	return report.complete ? 0 : 1;
}

export function startupNotReady(error) {
	return (
		error.message.includes("NOT_READY:") ||
		error.message.includes("the Obsidian CLI did not answer") ||
		error.message.includes(
			'the Obsidian CLI failed for "eval": The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again.',
		) ||
		error.message.includes(
			'code run in Obsidian failed: Error: Command "eval" not found. It may require a plugin to be enabled.',
		)
	);
}

/** Used only while an explicitly launched app is starting, including before a recovery quit. Never relaunches. */
export function awaitColdstartHost(read, paths, previousPid, timeoutMs, clock = {}) {
	return waitForColdstart(
		() => {
			const value = read();
			if (value.windows.length < Object.keys(paths).length || value.windows.some((win) => !win.layoutReady))
				throw new Error("NOT_READY: not all fixture layouts have opened.");
			assertColdstartInventory(value, paths);
			assert.notEqual(value.mainPid, previousPid, "The main process did not change");
			return value;
		},
		timeoutMs,
		"complete verified startup before sampling or recovery quit",
		{ ...clock, retry: startupNotReady },
	);
}

export async function runColdstartCheck(argv) {
	const args = parseColdstartArgs(argv);
	const output = coldstartReportPaths(args.report);
	mkdirSync(output.directory, { recursive: true });
	const report = {
		schema: 1,
		kind: "coldstart-identity",
		note: "Ten real app restarts, both fixtures per slot. Identity/stability only, not a performance benchmark. Backups cover the TCW plugin plus community-plugins.json, workspace.json and appearance.json in the four fixtures, not all plugins. A separate final restart restores the original TCW plugins. Old clock-function and timeline-session identities cannot survive restart.",
		complete: false,
		startedAt: new Date().toISOString(),
		samples: [],
		restarts: [],
		quitRequests: [],
		errors: [],
		restoration: { complete: false, checks: [] },
	};
	const save = () => writeFileSync(output.file, json(report));
	writeFileSync(output.file, json(report), { flag: "wx" });
	try {
		return await performColdstartCheck(args, output, report, save);
	} catch (error) {
		report.errors.push(error.stack ?? String(error));
		report.finishedAt = new Date().toISOString();
		save();
		console.error(`coldstart-check: FAIL: ${output.file}: ${error.message}`);
		return 1;
	}
}

if (process.argv[1] && import.meta.url && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runColdstartCheck(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			console.error(`coldstart-check: ${error.stack ?? error}`);
			process.exitCode = 1;
		},
	);
}
