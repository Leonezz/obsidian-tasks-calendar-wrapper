/** Checks the fixed Tasks corpus through real timeline controls; oracle fixtures are always read-only. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	captureCases,
	applyNoteDiff,
	PROBE_LINES,
	SETTINGS_GROUPS,
	probeSignature,
} from "./capture-tasks-toggle-lib.mjs";
import { TASKS_PARITY_VAULT, tasksParityNotes } from "./tasks-parity-notes.mjs";
import { TASKS_FILES, TASKS_PLUGIN_ID, TASKS_VERSION, TASKS_PARITY_MARKER } from "./tasks-parity-vault.mjs";
import { otherBenchProcesses } from "./bench-host.mjs";
import {
	buildInfo,
	fixtureCli,
	fixtureVaultPath,
	fixtureWindow,
	installPlugin,
	manifest,
	quietSettings,
	repoRoot,
	restoreApp,
	runAndUndo,
	runScript,
	TIMELINE_VIEW,
	unloadApp,
	vaultsAround,
} from "./fixture-app.mjs";

// Current source/oracle-derived expectations, not a recovered historical #248 manifest. Native results must agree.
const REFUSED = {
	"Dataview fields.md:11": "impossible-date",
	"Emoji dates.md:19": "impossible-date",
	"Emoji dates.md:20": "impossible-date",
	"Parity/Fields 01.md:6": "impossible-date",
	"Parity/Fields 01.md:15": "impossible-date",
	"Parity/Fields 01.md:24": "impossible-date",
	"Parity/Fields 02.md:8": "impossible-date",
	"Parity/Fields 02.md:17": "impossible-date",
	"Parity/Fields 03.md:1": "impossible-date",
	"Parity/Recurrence 04.md:3": "unreadable-date",
	"Parity/Recurrence 04.md:6": "unreadable-date",
	"Parity/Recurrence 05.md:11": "recurrence-lost",
	"Parity/Recurrence 05.md:12": "recurrence-lost",
	"Parity/Recurrence 05.md:13": "recurrence-lost",
};
const HIDDEN = {
	"Structure.md:23": "unsupported-list-marker",
	"Structure.md:76": "unsupported-list-marker",
	"Parity/Syntax 01.md:18": "unsupported-list-marker",
	"Parity/Syntax 01.md:19": "unsupported-list-marker",
	"Parity/Syntax 02.md:14": "unsupported-list-marker",
	"Parity/Syntax 02.md:15": "unsupported-list-marker",
	"Parity/Syntax 03.md:10": "unsupported-list-marker",
	"Parity/Syntax 03.md:11": "unsupported-list-marker",
	"Structure.md:31": "empty-task",
	"Structure.md:32": "empty-task",
	"Structure.md:33": "empty-task",
	"Comments.md:12": "metadata-omits-task",
	"Structure.md:35": "metadata-omits-task",
	"Structure.md:38": "metadata-omits-task",
};
const SESSION = [
	"Emoji dates.md:37",
	"Parity/Recurrence 04.md:12",
	"Parity/Recurrence 04.md:13",
	"Parity/Recurrence 04.md:15",
	"Parity/Recurrence 04.md:16",
	"Parity/Recurrence 04.md:18",
	"Parity/Recurrence 04.md:19",
	"Parity/Recurrence 04.md:21",
	"Parity/Recurrence 04.md:22",
	"Parity/Recurrence 04.md:24",
	"Parity/Recurrence 05.md:0",
	"Parity/Recurrence 05.md:2",
	"Parity/Recurrence 05.md:3",
	"Parity/Recurrence 05.md:5",
	"Parity/Recurrence 05.md:6",
	"Parity/Recurrence 05.md:8",
	"Parity/Recurrence 05.md:9",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseParityArgs(argv) {
	const result = { mode: "check", report: undefined, backupdir: undefined };
	let restore = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--restore") {
			if (restore) throw new Error("duplicate --restore");
			restore = true;
			result.mode = "restore";
			continue;
		}
		const name = ["report", "backupdir"].find((key) => arg === `--${key}` || arg.startsWith(`--${key}=`));
		if (!name)
			throw new Error(
				`unknown argument ${arg}; use --report <absolute-file> --backupdir <absolute-directory> [--restore]`,
			);
		if (result[name] !== undefined) throw new Error(`duplicate --${name}`);
		const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
		if (!value || value.startsWith("--") || !path.isAbsolute(value))
			throw new Error(`--${name} needs an absolute path`);
		result[name] = value;
	}
	if (!result.report || !result.backupdir)
		throw new Error("both --report and --backupdir are required absolute paths");
	return result;
}

function canonical(file) {
	let ancestor = path.resolve(file);
	const tail = [];
	while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
		tail.unshift(path.basename(ancestor));
		ancestor = path.dirname(ancestor);
	}
	return path.join(realpathSync(ancestor), ...tail);
}
const within = (parent, child) => {
	const relative = path.relative(parent, child);
	return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

export function validateParityPaths(args, worktrees = [repoRoot]) {
	for (const file of [args.report, args.backupdir])
		if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink())
			throw new Error("artifact leaf symlinks are unsupported");
	const output = { report: canonical(args.report), backupdir: canonical(args.backupdir) };
	for (const file of Object.values(output)) {
		if (!existsSync(path.dirname(file)) || !lstatSync(path.dirname(file)).isDirectory())
			throw new Error("artifact parent directory must already exist");
		if (worktrees.some((root) => within(canonical(root), file)))
			throw new Error("artifacts must be outside every code worktree");
		if (vaultsAround(file).length) throw new Error("artifacts must be outside every Obsidian vault");
	}
	if (within(output.backupdir, output.report) || within(output.report, output.backupdir))
		throw new Error("report and backup directory must not overlap");
	if (lstatSync(args.report, { throwIfNoEntry: false }))
		throw new Error("report must be new; existing evidence is never overwritten");
	if (args.mode === "restore") {
		if (
			!existsSync(output.backupdir) ||
			!lstatSync(args.backupdir).isDirectory() ||
			lstatSync(args.backupdir).isSymbolicLink()
		)
			throw new Error("restore needs an existing real backup directory");
	} else if (lstatSync(args.backupdir, { throwIfNoEntry: false })) throw new Error("backup directory must be new");
	return output;
}

export function planParityCases(fixture, corpus) {
	const day = fixture?.day;
	const validDay =
		typeof day === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(day) &&
		new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
	if (
		fixture?.format !== 1 ||
		fixture.group !== "default" ||
		fixture.tasksVersion !== TASKS_VERSION ||
		!validDay ||
		fixture.cases?.length !== 724 ||
		corpus.length !== 724
	)
		throw new Error("expected the fixed default Tasks 8.6.0 corpus of 724 cases with its capture day");
	const seen = new Set();
	const result = corpus.map((entry, index) => {
		const recorded = fixture.cases[index];
		const id = `${entry.path}:${entry.line}`;
		for (const key of ["path", "line", "sourceLine", "kind", "recurring", "lineEnding"])
			if (recorded?.[key] !== entry[key]) throw new Error(`corpus identity changed at ${id} (${key})`);
		if (seen.has(id) || typeof recorded.api !== "string" || typeof fixture.notes?.[entry.path] !== "string")
			throw new Error(`missing or duplicate oracle at ${id}`);
		const source = fixture.notes[entry.path]
			.split("\n")
			[entry.line]?.replace(/\r$/, "")
			.replace(entry.line === 0 ? /^\uFEFF/u : /$^/u, "");
		if (source !== entry.sourceLine) throw new Error(`oracle note/source mismatch at ${id}`);
		const diff = recorded.after;
		if (
			!diff ||
			!Number.isInteger(diff.prefix) ||
			!Number.isInteger(diff.suffix) ||
			diff.prefix < 0 ||
			diff.suffix < 0 ||
			diff.prefix + diff.suffix > fixture.notes[entry.path].length ||
			typeof diff.text !== "string"
		)
			throw new Error(`invalid recorded note diff at ${id}`);
		seen.add(id);
		return {
			...recorded,
			id,
			expected: HIDDEN[id] ? "hidden" : REFUSED[id] ? "refused" : "written",
			...(HIDDEN[id] || REFUSED[id] ? { reason: HIDDEN[id] ?? REFUSED[id] } : {}),
			oracle: SESSION.includes(id) ? "session" : "recorded",
		};
	});
	for (const id of [...Object.keys(REFUSED), ...Object.keys(HIDDEN), ...SESSION])
		if (!seen.has(id)) throw new Error(`expected case is missing: ${id}`);
	const session = result
		.filter((entry) => /when done/iu.test(entry.sourceLine) && !/^.*?\[x\]/u.test(entry.sourceLine))
		.map(({ id }) => id)
		.sort();
	if (JSON.stringify(session) !== JSON.stringify([...SESSION].sort()))
		throw new Error("when-done completion identities changed");
	return result;
}

/** Reconstruct only the API's replacement, retaining the note's BOM and every unaffected line ending. */
export function applyOracleLine(before, line, api) {
	const bom = before.startsWith("\uFEFF") ? "\uFEFF" : "";
	const rows = before.slice(bom.length).split("\n");
	if (!Number.isInteger(line) || line < 0 || line >= rows.length) throw new Error("oracle line is outside its note");
	const endingAt = (i) => (i < rows.length - 1 ? (rows[i].endsWith("\r") ? "\r\n" : "\n") : "");
	const ending = endingAt(line),
		between = ending || (line > 0 ? endingAt(line - 1) : "\n");
	const lines = api === "" ? [] : api.split("\n");
	return (
		bom +
		rows
			.slice(0, line)
			.map((row) => row + "\n")
			.join("") +
		lines.map((text, i) => text + (i === lines.length - 1 ? ending : between)).join("") +
		rows.slice(line + 1).join("\n")
	);
}

export function compareParityNote(before, after, entry, expectedApi) {
	const mode =
		entry.oracle === "recorded" && !before.startsWith("\uFEFF") && !before.includes("\r")
			? "whole-note"
			: "changed-lines";
	const expected =
		mode === "whole-note" && entry.oracle === "recorded"
			? applyNoteDiff(before, entry.after)
			: applyOracleLine(before, entry.line, expectedApi);
	return {
		matches: expected === after,
		mode,
		...(expected !== after
			? {
					detail: `note differs from ${entry.oracle} oracle; expected sha256 ${hash(Buffer.from(expected))}, actual ${hash(Buffer.from(after))}`,
				}
			: {}),
	};
}

const CONFIG = [
	".obsidian/workspace.json",
	".obsidian/appearance.json",
	".obsidian/community-plugins.json",
	".obsidian/app.json",
];

function fileTree(directory, prefix = "") {
	const stat = lstatSync(directory, { throwIfNoEntry: false });
	if (!stat) return [];
	if (stat.isSymbolicLink() || !stat.isDirectory())
		throw new Error(`expected a real fixture directory: ${directory}`);
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const key = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isSymbolicLink()) throw new Error(`symlinks are unsupported in fixture backups: ${key}`);
		return entry.isDirectory() ? fileTree(path.join(directory, entry.name), key) : [key];
	});
}

function durableWrite(file, bytes, flag = "wx") {
	const fd = openSync(file, flag);
	try {
		writeFileSync(fd, bytes);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	const parent = openSync(path.dirname(file), "r");
	try {
		fsyncSync(parent);
	} finally {
		closeSync(parent);
	}
}
function saveIndex(directory, index) {
	const target = path.join(directory, "backup.json"),
		temporary = `${target}.tmp`;
	durableWrite(temporary, JSON.stringify(index, null, "\t") + "\n");
	renameSync(temporary, target);
	const fd = openSync(directory, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
function fixtureFile(vaultPath, file) {
	const resolved = path.join(vaultPath, file);
	if (canonical(resolved) !== resolved) throw new Error(`fixture symlink path is unsupported: ${file}`);
	return resolved;
}
export function backupParityFixture(directory, vaultPath, notes, runtime) {
	const files = [...notes.keys(), ...CONFIG];
	const folders = [manifest.id, TASKS_PLUGIN_ID].map((id) => `.obsidian/plugins/${id}`);
	for (const folder of folders)
		files.push(...fileTree(fixtureFile(vaultPath, folder)).map((file) => `${folder}/${file}`));
	mkdirSync(directory);
	const index = { schema: 1, vault: TASKS_PARITY_VAULT, vaultPath, runtime, folders, files: {}, complete: false };
	for (const file of files) {
		const source = fixtureFile(vaultPath, file);
		if (existsSync(source) && lstatSync(source).isSymbolicLink()) throw new Error(`symlink fixture file: ${file}`);
		const bytes = existsSync(source) ? readFileSync(source) : null;
		index.files[file] = bytes === null ? null : hash(bytes);
		if (bytes !== null) {
			const target = path.join(directory, "files", file);
			mkdirSync(path.dirname(target), { recursive: true });
			durableWrite(target, bytes);
		}
	}
	index.complete = true;
	saveIndex(directory, index);
	return index;
}

export function readParityBackup(directory, notes) {
	const index = JSON.parse(readFileSync(path.join(directory, "backup.json"), "utf8"));
	if (
		index.schema !== 1 ||
		index.vault !== TASKS_PARITY_VAULT ||
		!index.complete ||
		!path.isAbsolute(index.vaultPath) ||
		JSON.stringify(index.folders) !==
			JSON.stringify([manifest.id, TASKS_PLUGIN_ID].map((id) => `.obsidian/plugins/${id}`)) ||
		index.runtime?.pluginEnabled !== false ||
		index.runtime?.tasksEnabled !== true
	)
		throw new Error("incomplete or incompatible parity backup");
	for (const [file, checksum] of Object.entries(index.files)) {
		if (
			path.isAbsolute(file) ||
			file.split(/[\\/]/).includes("..") ||
			!(
				notes.has(file) ||
				CONFIG.includes(file) ||
				[manifest.id, TASKS_PLUGIN_ID].some((id) => file.startsWith(`.obsidian/plugins/${id}/`))
			)
		)
			throw new Error(`unsafe backup file: ${file}`);
		if (
			checksum !== null &&
			(typeof checksum !== "string" ||
				!/^[a-f0-9]{64}$/.test(checksum) ||
				canonical(path.join(directory, "files", file)) !== path.join(directory, "files", file) ||
				hash(readFileSync(path.join(directory, "files", file))) !== checksum)
		)
			throw new Error(`backup bytes changed: ${file}`);
	}
	for (const file of CONFIG)
		if (!Object.hasOwn(index.files, file)) throw new Error(`backup settings entry missing: ${file}`);
	for (const [file, bytes] of notes)
		if (index.files[file] !== hash(bytes)) throw new Error(`backup does not contain the original corpus: ${file}`);
	return index;
}

function restoreFile(directory, index, file) {
	const target = fixtureFile(index.vaultPath, file);
	if (index.files[file] === null) rmSync(target, { force: true });
	else {
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, readFileSync(path.join(directory, "files", file)));
	}
}

export function verifyParityBackup(index) {
	for (const [file, checksum] of Object.entries(index.files)) {
		const target = fixtureFile(index.vaultPath, file);
		if ((existsSync(target) ? hash(readFileSync(target)) : null) !== checksum)
			throw new Error(`fixture was not restored byte-exact: ${file}`);
	}
	for (const folder of index.folders) {
		const actual = fileTree(path.join(index.vaultPath, folder))
			.map((file) => `${folder}/${file}`)
			.sort();
		const expected = Object.keys(index.files)
			.filter((file) => file.startsWith(`${folder}/`) && index.files[file] !== null)
			.sort();
		if (JSON.stringify(actual) !== JSON.stringify(expected))
			throw new Error(`fixture plugin file set changed: ${folder}`);
	}
}

/** Self-contained page driver. It observes writer events but all writes/Undo originate in actual DOM controls. */
export async function parityPage(input) {
	const { action, pluginId, tasksId, viewType } = input;
	const bytes = async (file) => Buffer.from(await app.vault.adapter.readBinary(file));
	const checksum = (value) => require("crypto").createHash("sha256").update(value).digest("hex");
	const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const wait = async (test, label, limit = 15_000) => {
		const start = performance.now();
		while (!test()) {
			if (window.__tcwParityCheck?.cancelled) throw new Error("parity check cancelled");
			if (performance.now() - start > limit) throw new Error(`parity timeout: ${label}`);
			await pause(20);
		}
	};
	const runtime = () => ({
		layout: app.workspace.getLayout(),
		theme: app.vault.config.theme ?? null,
		locale: window.moment.locale(),
		momentNowSource: window.moment.now.toString(),
		throttling: require("@electron/remote").getCurrentWebContents().getBackgroundThrottling(),
		restricted: !app.plugins.isEnabled(),
		pluginEnabled: app.plugins.enabledPlugins.has(pluginId),
		pluginLoaded: !!app.plugins.plugins[pluginId],
		tasksEnabled: app.plugins.enabledPlugins.has(tasksId),
		tasksLoaded: !!app.plugins.plugins[tasksId],
	});
	if (action === "inspect") {
		if (window.__tcwParityCheck || window.__tcwFixtureSaved)
			throw new Error("earlier fixture state remains; restore it before another check");
		if (
			app.plugins.enabledPlugins.has(pluginId) ||
			app.plugins.plugins[pluginId] ||
			app.workspace.getLeavesOfType(viewType).length
		)
			throw new Error("TCW must be controlled-disabled with no timeline leaf before the parity check");
		if (
			!app.plugins.enabledPlugins.has(tasksId) ||
			app.plugins.plugins[tasksId]?.manifest.version !== input.tasksVersion
		)
			throw new Error("the pinned Tasks plugin must already be enabled");
		const open = app.workspace
			.getLeavesOfType("markdown")
			.filter((leaf) => input.paths.includes(leaf.view.file?.path));
		if (open.length) throw new Error("close every corpus note before checking the timeline writer");
		return runtime();
	}
	if (action === "remember") {
		if (window.__tcwParityCheck) throw new Error("earlier parity state remains");
		window.__tcwParityCheck = {
			runId: input.runId,
			originalNow: window.moment.now,
			originalLocale: window.moment.locale(),
			events: [],
			cancelled: false,
			busy: false,
		};
		return true;
	}
	const state = window.__tcwParityCheck;
	if (action === "tasks-disable") {
		if (app.plugins.plugins[tasksId]) await app.plugins.disablePlugin(tasksId);
		return true;
	}
	if (action === "tasks-enable") {
		if (!(await app.plugins.enablePlugin(tasksId))) throw new Error("Tasks could not be enabled");
		return true;
	}
	if (action === "recovery-inspect") {
		if (!state || state.runId !== input.runId)
			throw new Error(
				"original live parity session is unavailable; retain the durable backup for controlled cold restoration",
			);
		if (
			!window.__tcwFixtureSaved &&
			(app.plugins.enabledPlugins.has(pluginId) ||
				app.plugins.plugins[pluginId] ||
				window.moment.now !== state.originalNow)
		)
			throw new Error("fixture runtime state is missing; controlled cold restoration is required");
		return { fixtureSaved: !!window.__tcwFixtureSaved };
	}
	if (action === "stop") {
		if (state) {
			state.cancelled = true;
			state.stop?.();
		}
		return true;
	}
	if (action === "verify") {
		if (
			!state ||
			state.runId !== input.runId ||
			window.moment.now !== state.originalNow ||
			window.moment.locale() !== state.originalLocale
		)
			throw new Error("the parity clock/locale state did not restore exactly");
		const actual = runtime();
		for (const key of [
			"layout",
			"theme",
			"locale",
			"throttling",
			"restricted",
			"pluginEnabled",
			"pluginLoaded",
			"tasksEnabled",
			"tasksLoaded",
		])
			if (JSON.stringify(actual[key]) !== JSON.stringify(input.runtime[key]))
				throw new Error(`runtime not restored: ${key}`);
		if (input.clear !== false) delete window.__tcwParityCheck;
		return actual;
	}
	if (!state || state.runId !== input.runId)
		throw new Error("the parity window lost its state; use the durable backup for recovery");
	if (action === "open") {
		// Freeze to the oracle's recorded day, so recorded output is compared without rewriting date strings.
		const [year, month, day] = input.day.split("-").map(Number);
		const now = new Date(year, month - 1, day, 12).getTime();
		window.moment.now = () => now;
		window.moment.locale("en");
		const api = () => app.plugins.plugins[tasksId]?.apiV1;
		await wait(
			() =>
				typeof api()?.executeToggleTaskDoneCommand === "function" &&
				JSON.stringify(input.signature) ===
					JSON.stringify(
						new Function("outputs", input.signatureSource)(
							input.probes.map((line) => api().executeToggleTaskDoneCommand(line, input.probePath)),
						),
					),
			"default Tasks settings",
		);
		if (!(await app.plugins.enablePlugin(pluginId))) throw new Error("TCW could not be enabled");
		const others = [];
		app.workspace.iterateRootLeaves((leaf) => others.push(leaf));
		const leaf = app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: viewType, active: true });
		app.workspace.setActiveLeaf(leaf, { focus: false });
		others.filter((other) => other !== leaf).forEach((other) => other.detach());
		state.view = leaf.view;
		const writer = app.plugins.plugins[pluginId]?.writer;
		if (typeof writer?.onWrite !== "function") throw new Error("the build has no observable task writer");
		state.stop = writer.onWrite((event) => state.events.push({ ...event, at: performance.now() }));
		await wait(() => !!state.view.timelineHandle?.result && !state.view.isReloading, "initial committed timeline");
		await pause(350);
		return { day: window.moment().format("YYYY-MM-DD"), logicalRows: state.view.getWindowingInfo?.()?.rowCount };
	}
	if (action !== "case") throw new Error(`unknown parity action ${action}`);
	if (state.busy) throw new Error("a parity case is already running");
	state.busy = true;
	try {
		const { entry } = input;
		const original = await bytes(entry.path);
		if (checksum(original) !== input.originalHash) throw new Error(`original note changed before ${entry.id}`);
		const view = state.view;
		await wait(() => !view.isReloading && !!view.timelineHandle?.result, "committed timeline before click");
		const logical = view.timelineHandle.result.years.flatMap((year) =>
			year.days.flatMap((day) => day.tasks.map(({ task }) => task.id)),
		);
		const metadataTaskIndexed =
			app.metadataCache
				.getFileCache(app.vault.getFileByPath(entry.path))
				?.listItems?.some((item) => item.task !== undefined && item.position.start.line === entry.line) ??
			false;
		if (!logical.includes(entry.id))
			return {
				kind: "hidden",
				metadataTaskIndexed,
				unchanged: checksum(await bytes(entry.path)) === input.originalHash,
			};
		if (typeof view.revealTask !== "function" || !(await view.revealTask(entry.id)))
			throw new Error(`could not reveal ${entry.id}`);
		await pause(350); // Existing list guard is 300 ms; this is a correctness check, not a timing benchmark.
		const root = view.containerEl.querySelector(".taskido");
		const rows = [...root.querySelectorAll(".task")].filter(
			(row) =>
				row.getAttribute("data-link") === entry.path && Number(row.getAttribute("data-line")) === entry.line,
		);
		const row = rows.find((item) => item.getBoundingClientRect().height > 0);
		if (!row || row.hasAttribute("aria-busy")) throw new Error(`no idle DOM row for ${entry.id}`);
		const checkbox = row.querySelector(":scope > .timeline > label.icon");
		if (!checkbox) throw new Error(`no built-in checkbox label for ${entry.id}`);
		const previousFocus = document.activeElement;
		let focused = false;
		const onFocus = () => {
			focused = true;
		};
		row.addEventListener("focusin", onFocus);
		try {
			row.focus({ preventScroll: true });
		} finally {
			row.removeEventListener("focusin", onFocus);
		}
		if (!focused && row.contains(document.activeElement))
			row.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: previousFocus }));
		const expectedApi =
			entry.oracle === "session"
				? app.plugins.plugins[tasksId].apiV1.executeToggleTaskDoneCommand(entry.sourceLine, entry.path)
				: entry.api;
		if (typeof expectedApi !== "string") throw new Error("same-session Tasks oracle did not return a string");
		const notices = new Set(document.querySelectorAll(".notice"));
		const start = state.events.length;
		for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
			checkbox.dispatchEvent(
				type.startsWith("pointer")
					? new PointerEvent(type, {
							bubbles: true,
							cancelable: true,
							pointerType: "mouse",
							button: 0,
							isPrimary: true,
							view: window,
						})
					: new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view: window }),
			);
		const current = () => state.events.slice(start).filter((event) => event.path === entry.path);
		await wait(
			() =>
				current().some(
					(event) =>
						event.action === "toggle" && ["written", "refused", "failed", "unchanged"].includes(event.kind),
				),
			`terminal toggle for ${entry.id}`,
		);
		const terminal = current().find(
			(event) => event.action === "toggle" && ["written", "refused", "failed", "unchanged"].includes(event.kind),
		);
		if (terminal.kind !== "written")
			return {
				kind: terminal.kind,
				reason: terminal.reason,
				unchanged: checksum(await bytes(entry.path)) === input.originalHash,
				events: current(),
			};
		let undoButton;
		await wait(() => {
			const buttons = [...document.querySelectorAll(".notice")]
				.filter((notice) => !notices.has(notice))
				.flatMap((notice) =>
					[...notice.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Undo"),
				);
			if (buttons.length > 1) throw new Error("multiple new Undo notices for one checkbox click");
			undoButton = buttons[0];
			return !!undoButton;
		}, `own Undo notice for ${entry.id}`);
		const after = (await bytes(entry.path)).toString("utf8");
		undoButton.click();
		await wait(
			() =>
				current().some(
					(event) =>
						event.action === "undo" && ["written", "failed", "refused", "unchanged"].includes(event.kind),
				),
			`real Undo for ${entry.id}`,
		);
		const undo = current().find(
			(event) => event.action === "undo" && ["written", "failed", "refused", "unchanged"].includes(event.kind),
		);
		if (undo.kind !== "written") throw new Error(`Undo was ${undo.kind}, not written`);
		const restored = checksum(await bytes(entry.path)) === input.originalHash;
		await wait(
			() => !view.isReloading && app.metadataCache.fileCache?.[entry.path]?.hash === input.originalHash,
			`original metadata after Undo for ${entry.id}`,
		);
		await pause(550);
		const events = current();
		if (events.some((event) => ["overwritten", "failed", "slow"].includes(event.kind)))
			throw new Error(`unexpected writer event after ${entry.id}: ${JSON.stringify(events)}`);
		return {
			kind: "written",
			expectedApi,
			after,
			restored,
			events,
			pointerSequence: ["pointerdown", "mousedown", "pointerup", "mouseup", "click"],
			undo: "notice-button",
		};
	} finally {
		state.busy = false;
	}
}

function writeReport(file, report) {
	const temporary = `${file}.tmp`;
	durableWrite(temporary, JSON.stringify(report, null, "\t") + "\n");
	renameSync(temporary, file);
}

/** The existing synchronous runAndUndo still runs every normal fixture undo after async work or a handled signal. */
export async function runParityCheck(args) {
	const ps = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
	const others = otherBenchProcesses(ps, process.pid);
	if (others.length) throw new Error(`another native driver is running: ${JSON.stringify(others)}`);
	const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot, encoding: "utf8" })
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice(9));
	const output = validateParityPaths(args, worktrees);
	const notes = tasksParityNotes();
	const fixtureBytes = readFileSync(path.join(repoRoot, "fixtures/tasks-toggle/default.json"));
	const fixture = JSON.parse(fixtureBytes.toString("utf8"));
	const cases = planParityCases(fixture, captureCases());
	const cli = fixtureCli(TASKS_PARITY_VAULT);
	const evaluate = (action, extra = {}, timeout = 120_000) =>
		cli.evaluate(
			parityPage,
			{ action, pluginId: manifest.id, tasksId: TASKS_PLUGIN_ID, viewType: TIMELINE_VIEW, ...extra },
			timeout,
		);
	const vaultPath =
		args.mode === "restore"
			? realpathSync(cli.run("vault", "info=path"))
			: realpathSync(
					fixtureVaultPath(
						cli,
						TASKS_PARITY_VAULT,
						notes,
						"Open the generated tasks-parity fixture before checking.",
					),
				);
	if (
		path.basename(vaultPath) !== TASKS_PARITY_VAULT ||
		readFileSync(fixtureFile(vaultPath, TASKS_PARITY_MARKER), "utf8") !==
			"Made by apps/obsidian-plugin/scripts/tasks-parity-vault.mjs.\n"
	)
		throw new Error("only the generated tasks-parity vault is allowed");
	if (realpathSync(cli.evaluate(() => app.vault.adapter.getBasePath())) !== vaultPath)
		throw new Error("the live tasks-parity window points to a different vault path");
	const report = {
		schema: 1,
		mode: args.mode,
		build: buildInfo(),
		vault: TASKS_PARITY_VAULT,
		vaultPath,
		oracleSha256: hash(fixtureBytes),
		clock: {
			day: fixture.day,
			policy: "pinned captured day; 17 when-done oracles obtained in memory in this same session",
		},
		backupdir: output.backupdir,
		complete: false,
		cases: [],
		restoration: [],
	};
	writeReport(output.report, report);
	let interrupted;
	const onSignal = (signal) => {
		interrupted = signal;
	};
	const onInt = () => onSignal("SIGINT"),
		onTerm = () => onSignal("SIGTERM");
	process.on("SIGINT", onInt);
	process.on("SIGTERM", onTerm);
	const checkpoint = async () => {
		await new Promise((resolve) => setImmediate(resolve));
		if (interrupted) throw new Error(`${interrupted}: parity check cancelled; running normal fixture undo`);
	};
	const restoreStep = (name, fn) => [
		name,
		() => {
			try {
				fn();
				report.restoration.push({ name, ok: true });
			} catch (error) {
				report.restoration.push({ name, ok: false, error: String(error) });
				throw error;
			} finally {
				writeReport(output.report, report);
			}
		},
	];
	try {
		let index,
			runtime,
			runId,
			windowFixture,
			remembered = false,
			recovery;
		if (args.mode === "restore") {
			index = readParityBackup(output.backupdir, notes);
			if (realpathSync(index.vaultPath) !== vaultPath || typeof index.runId !== "string")
				throw new Error("backup belongs to a different tasks-parity path or has no run identity");
			({ runtime, runId } = index);
			recovery = evaluate("recovery-inspect", { runId });
			remembered = true;
		} else {
			for (const name of ["main.js", "manifest.json", "styles.css"])
				if (
					hash(readFileSync(fixtureFile(vaultPath, `.obsidian/plugins/${TASKS_PLUGIN_ID}/${name}`))) !==
					TASKS_FILES[name].sha256
				)
					throw new Error(`Tasks ${TASKS_VERSION} asset mismatch: ${name}`);
			if (lstatSync(path.join(vaultPath, ".obsidian/.tcw-fixture-backup"), { throwIfNoEntry: false }))
				throw new Error("an earlier fixture plugin backup remains; recover it first");
			runtime = evaluate("inspect", { paths: [...notes.keys()], tasksVersion: TASKS_VERSION });
			index = backupParityFixture(output.backupdir, vaultPath, notes, runtime);
			runId = hash(Buffer.from(`${Date.now()}-${Math.random()}`));
			index.runId = runId;
			saveIndex(output.backupdir, index);
			readParityBackup(output.backupdir, notes);
		}
		const restoreTaskSettings = () => {
			const file = `.obsidian/plugins/${TASKS_PLUGIN_ID}/data.json`;
			if (!(file in index.files)) rmSync(fixtureFile(vaultPath, file), { force: true });
			else restoreFile(output.backupdir, index, file);
		};
		const restoreNotes = () => {
			for (const file of notes.keys()) {
				if (!(file in index.files)) rmSync(fixtureFile(vaultPath, file), { force: true });
				else restoreFile(output.backupdir, index, file);
			}
			restoreTaskSettings();
		};
		const restorePlugin = () => {
			// Recovery uses the durable bytes from this same live run, never a newly installed build.
			const folder = `.obsidian/plugins/${manifest.id}`;
			rmSync(fixtureFile(vaultPath, folder), { recursive: true, force: true });
			for (const file of Object.keys(index.files).filter((file) => file.startsWith(`${folder}/`)))
				restoreFile(output.backupdir, index, file);
			rmSync(fixtureFile(vaultPath, ".obsidian/.tcw-fixture-backup"), { recursive: true, force: true });
		};
		let undo;
		if (args.mode === "check") {
			const plugin = installPlugin(
				vaultPath,
				quietSettings({
					hideStatusTasks: [],
					hideSubTasks: false,
					filterEmpty: true,
					includePaths: [],
					excludePaths: [],
					useIncludeTags: false,
					useExcludeTags: false,
					excludeProperties: {},
					useBuiltinStyle: true,
					openNoteInsteadOfInPlace: false,
				}),
			);
			windowFixture = fixtureWindow(cli, TASKS_PARITY_VAULT, plugin);
			undo = windowFixture.undoSteps;
		} else {
			undo = [
				[
					"unload the plugin",
					() => {
						if (
							recovery.fixtureSaved &&
							cli.evaluate(unloadApp, { pluginId: manifest.id, viewType: TIMELINE_VIEW }) === false
						)
							throw new Error("live fixture state disappeared during recovery");
					},
				],
				["restore the plugin folder", restorePlugin],
				[
					"restore the app",
					() => {
						if (recovery.fixtureSaved && cli.evaluate(restoreApp, { pluginId: manifest.id }) === false)
							throw new Error("live fixture state disappeared during recovery");
					},
				],
			];
		}
		let failure;
		try {
			if (args.mode === "check") {
				evaluate("remember", { runId });
				remembered = true;
				await checkpoint();
				windowFixture.prepare();
				evaluate("tasks-disable");
				writeFileSync(fixtureFile(vaultPath, `.obsidian/plugins/${TASKS_PLUGIN_ID}/data.json`), "{}\n");
				evaluate("tasks-enable");
				report.opening = evaluate("open", {
					runId,
					day: fixture.day,
					signature: SETTINGS_GROUPS[0].signature,
					signatureSource: `return (${probeSignature.toString()})(outputs);`,
					probes: PROBE_LINES,
					probePath: cases[0].path,
				});
				if (report.opening.day !== fixture.day)
					throw new Error("the timeline is not using the oracle's captured day");
				for (const entry of cases) {
					await checkpoint();
					const original = notes.get(entry.path);
					let result;
					try {
						const actual = evaluate("case", { runId, entry, originalHash: hash(original) });
						const comparison =
							actual.kind === "written"
								? compareParityNote(original.toString("utf8"), actual.after, entry, actual.expectedApi)
								: undefined;
						const matches =
							actual.kind === entry.expected &&
							(entry.expected === "written"
								? actual.restored && comparison.matches
								: actual.unchanged &&
									(entry.expected !== "refused" || actual.reason === entry.reason) &&
									(entry.reason !== "metadata-omits-task" || actual.metadataTaskIndexed === false));
						result = {
							id: entry.id,
							expected: entry.expected,
							reason: entry.reason,
							oracle: entry.oracle,
							actual,
							comparison,
							matches: !!matches,
						};
					} catch (error) {
						result = {
							id: entry.id,
							expected: entry.expected,
							matches: false,
							error: String(error?.stack ?? error),
						};
					}
					report.cases.push(result);
					writeReport(output.report, report);
					if (!result.matches) throw new Error(`parity failed at ${entry.id}; see ${output.report}`);
				}
			}
			await checkpoint();
		} catch (error) {
			failure = error;
		}
		runAndUndo(() => {
			if (failure) throw failure;
		}, [
			restoreStep("stop parity observation", () => {
				if (remembered) evaluate("stop");
			}),
			restoreStep(...undo[0]),
			restoreStep("disable Tasks before restoring its settings", () => evaluate("tasks-disable")),
			restoreStep("restore all original notes and Tasks settings", restoreNotes),
			restoreStep(...undo[1]),
			restoreStep("restore enabled Tasks", () => evaluate("tasks-enable")),
			restoreStep(...undo[2]),
			restoreStep("restore original on-disk settings/layout", () => {
				// Tasks loads the original values before this final byte restoration, even if it migrated data on enable.
				restoreTaskSettings();
				for (const file of CONFIG) restoreFile(output.backupdir, index, file);
			}),
			restoreStep("verify original notes/plugin/settings bytes", () => verifyParityBackup(index)),
			restoreStep("verify clock, locale, throttling and layout", () => {
				if (remembered)
					evaluate("verify", { runId, runtime, clear: report.restoration.every((step) => step.ok) });
			}),
		]);
		if (args.mode === "restore") {
			report.complete = true;
			return report;
		}
		report.complete = report.cases.length === 724 && report.cases.every((entry) => entry.matches);
		report.counts = Object.fromEntries(
			["written", "refused", "hidden"].map((kind) => [
				kind,
				report.cases.filter((entry) => entry.actual?.kind === kind).length,
			]),
		);
		if (
			!report.complete ||
			report.counts.written !== 696 ||
			report.counts.refused !== 14 ||
			report.counts.hidden !== 14
		)
			throw new Error("parity coverage is not exactly 696/14/14");
		return report;
	} catch (error) {
		report.error = String(error?.stack ?? error);
		throw error;
	} finally {
		report.counts = Object.fromEntries(
			["written", "refused", "hidden"].map((kind) => [
				kind,
				report.cases.filter((entry) => entry.actual?.kind === kind).length,
			]),
		);
		report.checked = report.cases.length;
		process.off("SIGINT", onInt);
		process.off("SIGTERM", onTerm);
		writeReport(output.report, report);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
	await runScript("tasks-parity-check", async () => {
		await runParityCheck(parseParityArgs(process.argv.slice(2)));
		return 0;
	});
