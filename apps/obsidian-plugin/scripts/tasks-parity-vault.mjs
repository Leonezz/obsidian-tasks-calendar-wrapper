/**
 * Writes the golden and generated parity notes, Tasks 8.6.0 and this checkout's plugin build:
 * `pnpm tasks-parity:vault <folder named tasks-parity> [--tasks-assets <dir>]`.
 * Keep the folder outside this repository and every vault, e.g. ~/Documents/projects/tcw-fixtures/tasks-parity.
 * Open it once with "Open folder as vault", turn community plugins on, and keep Obsidian's language English.
 * This is the only vault our scripts ever install Tasks into; its settings belong to the later capture script.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { manifest, markdownFiles, quietSettings, releaseBuild, repoRoot, vaultsAround } from "./fixture-app.mjs";
import { TASKS_PARITY_VAULT, tasksParityNotes } from "./tasks-parity-notes.mjs";

export const TASKS_PARITY_MARKER = ".tasks-parity-vault";
export const TASKS_PLUGIN_ID = "obsidian-tasks-plugin";
export const TASKS_VERSION = "8.6.0";
// Recorded from the official Tasks 8.6.0 release on 2026-10-31; downloads and local assets must match these bytes.
export const TASKS_FILES = {
	"main.js": {
		url: "https://github.com/obsidian-tasks-group/obsidian-tasks/releases/download/8.6.0/main.js",
		sha256: "500f8106d05ddb483bbfec135cac7948022bf6ba7386d1851b28f4d087866e8f",
	},
	"manifest.json": {
		url: "https://github.com/obsidian-tasks-group/obsidian-tasks/releases/download/8.6.0/manifest.json",
		sha256: "2efc88df9e973247360d486b420791c266c8824516919303b948d0192e159127",
	},
	"styles.css": {
		url: "https://github.com/obsidian-tasks-group/obsidian-tasks/releases/download/8.6.0/styles.css",
		sha256: "d70d8ebd41fc23bfd5d59873b1a93ed9554b154546a3e637bd4e042e62d1cf23",
	},
	LICENSE: {
		url: "https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/8.6.0/LICENSE",
		sha256: "88debbb735b26a9f2b022da623acc41867149887e2f34ea2e8bbe94f1c9b9bad",
	},
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function writeIfDifferent(file, bytes) {
	if (existsSync(file) && readFileSync(file).equals(bytes)) return false;
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, bytes);
	return true;
}

function checkTarget(dir, notes) {
	if (path.basename(dir) !== TASKS_PARITY_VAULT)
		throw new Error(`the folder must be named ${TASKS_PARITY_VAULT}; got ${dir}.`);
	const ours = existsSync(path.join(dir, TASKS_PARITY_MARKER)) ? realpathSync(dir) : null;
	const vault = vaultsAround(dir).find((found) => found !== ours);
	if (vault) {
		const where = existsSync(dir) && realpathSync(dir) === vault ? "is" : "is inside";
		throw new Error(
			`${dir} ${where} the Obsidian vault at ${vault}, which this script did not make. Pick a folder outside every vault.`,
		);
	}
	if (!existsSync(dir)) return;
	const entries = readdirSync(dir).filter((name) => name !== ".obsidian" && name !== ".DS_Store");
	if (entries.length > 0 && !existsSync(path.join(dir, TASKS_PARITY_MARKER)))
		throw new Error(`${dir} is not empty and was not made by this script. Pick an empty folder.`);
	const extra = markdownFiles(dir).filter((file) => !notes.has(file));
	if (extra.length)
		throw new Error(
			`${dir} has notes the tasks-parity vault does not have; remove them first: ${JSON.stringify(extra.slice(0, 10))}`,
		);
}

function verifyNotes(dir, notes) {
	const onDisk = new Set(markdownFiles(dir));
	const differing = [...new Set([...notes.keys(), ...onDisk])].filter(
		(file) => !notes.has(file) || !onDisk.has(file) || !readFileSync(path.join(dir, file)).equals(notes.get(file)),
	);
	if (differing.length)
		throw new Error(`the notes in ${dir} differ from the corpus: ${JSON.stringify(differing.slice(0, 10))}`);
}

async function download(url, fetchAsset) {
	let response;
	try {
		response = await fetchAsset(url, { redirect: "follow" });
	} catch (error) {
		throw new Error(`could not download ${url}: ${error.message}`);
	}
	if (!response.ok) throw new Error(`could not download ${url}: HTTP ${response.status}`);
	try {
		return Buffer.from(await response.arrayBuffer());
	} catch (error) {
		throw new Error(`could not download ${url}: ${error.message}`);
	}
}

async function installTasks(dir, files, tasksAssets, readAsset, fetchAsset) {
	let written = 0;
	let kept = 0;
	for (const [name, { url, sha256: expected }] of Object.entries(files)) {
		const full = path.join(dir, ".obsidian", "plugins", TASKS_PLUGIN_ID, name);
		if (existsSync(full) && sha256(readFileSync(full)) === expected) {
			kept++;
			continue;
		}
		const bytes = tasksAssets
			? Buffer.from(await readAsset(path.join(tasksAssets, name)))
			: await download(url, fetchAsset);
		const actual = sha256(bytes);
		if (actual !== expected) throw new Error(`sha256 mismatch for ${name}: expected ${expected}, actual ${actual}`);
		writeIfDifferent(full, bytes);
		written++;
	}
	return { written, kept };
}

function installOurPlugin(dir, files) {
	const pluginDir = path.join(dir, ".obsidian", "plugins", manifest.id);
	let written = 0;
	let kept = 0;
	for (const [file, bytes] of files) {
		if (writeIfDifferent(path.join(pluginDir, file), bytes)) written++;
		else kept++;
	}
	const settings = path.join(pluginDir, "data.json");
	// Opening the vault or capturing it may leave settings worth keeping, even when the build is refreshed.
	if (existsSync(settings)) kept++;
	else {
		writeIfDifferent(settings, Buffer.from(JSON.stringify(quietSettings(), null, "\t")));
		written++;
	}
	return { written, kept };
}

// Overrides make all asset and missing-build paths testable offline; the CLI only supplies tasksAssets.
export async function writeTasksParityVault(
	target,
	{
		tasksAssets,
		fetch: fetchAsset = globalThis.fetch,
		readAsset = readFileSync,
		tasksFiles = TASKS_FILES,
		buildPaths = releaseBuild(),
	} = {},
) {
	// pnpm changes the working directory to the package, while both folder arguments belong to its caller.
	const base = process.env.INIT_CWD ?? process.cwd();
	const dir = path.resolve(base, target);
	const notes = tasksParityNotes();
	checkTarget(dir, notes);
	if (!existsSync(buildPaths.mainJs))
		throw new Error(`${path.relative(repoRoot, buildPaths.mainJs)} does not exist. Run \`pnpm build\` first.`);
	const pluginFiles = new Map([
		["main.js", readFileSync(buildPaths.mainJs)],
		["styles.css", readFileSync(buildPaths.stylesCss)],
		["manifest.json", readFileSync(path.join(repoRoot, "manifest.json"))],
	]);
	let otherWritten = Number(
		writeIfDifferent(
			path.join(dir, TASKS_PARITY_MARKER),
			Buffer.from("Made by apps/obsidian-plugin/scripts/tasks-parity-vault.mjs.\n"),
		),
	);
	let written = 0;
	for (const [file, bytes] of notes) if (writeIfDifferent(path.join(dir, file), bytes)) written++;
	verifyNotes(dir, notes);
	const tasks = await installTasks(
		dir,
		tasksFiles,
		tasksAssets === undefined ? undefined : path.resolve(base, tasksAssets),
		readAsset,
		fetchAsset,
	);
	const plugin = installOurPlugin(dir, pluginFiles);
	otherWritten += Number(
		writeIfDifferent(
			path.join(dir, ".obsidian", "community-plugins.json"),
			Buffer.from(JSON.stringify([TASKS_PLUGIN_ID, manifest.id], null, 2)),
		),
	);
	return {
		dir,
		notes: notes.size,
		written,
		tasksWritten: tasks.written,
		tasksKept: tasks.kept,
		pluginWritten: plugin.written,
		pluginKept: plugin.kept,
		otherWritten,
		totalWritten: written + tasks.written + plugin.written + otherWritten,
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const usage = "usage: pnpm tasks-parity:vault <folder named tasks-parity> [--tasks-assets <dir>]";
	try {
		const args = process.argv.slice(2);
		if (args.length !== 1 && !(args.length === 3 && args[1] === "--tasks-assets")) throw new Error(usage);
		if (args[0].startsWith("--") || args[2]?.startsWith("--")) throw new Error(usage);
		const result = await writeTasksParityVault(args[0], { tasksAssets: args[2] });
		console.log(
			`tasks-parity-vault: ${result.dir} has ${result.notes} notes (${result.written} written); Tasks files ${result.tasksWritten} written/${result.tasksKept} kept; plugin files ${result.pluginWritten} written/${result.pluginKept} kept; ${result.totalWritten} written total. Open it with "Open folder as vault", turn on community plugins and keep Obsidian's language English.`,
		);
	} catch (error) {
		console.error(`tasks-parity-vault: ${error.message}`);
		process.exit(1);
	}
}
