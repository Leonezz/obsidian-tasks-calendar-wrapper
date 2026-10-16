/**
 * Captures the metadata Obsidian computes for the notes in fixtures/golden-vault, so the golden
 * tests run the plugin on what Obsidian really hands it instead of a hand-written imitation.
 *
 * Open fixtures/golden-vault, or a copy of it in a folder named golden-vault, in Obsidian once ("Open folder
 * as vault"), then run `pnpm capture:golden`. A copy helps where the file dialog cannot reach this checkout.
 * The script talks to the running app through the Obsidian CLI and only ever addresses the vault named
 * golden-vault, after checking that its notes are exactly the fixture notes, byte for byte.
 */
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const VAULT_NAME = "golden-vault";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const vaultDir = path.join(repoRoot, "fixtures", VAULT_NAME);
const outputFile = path.join(repoRoot, "fixtures", `${VAULT_NAME}.metadata.json`);

function fail(message) {
	console.error(`capture-golden: ${message}`);
	process.exit(1);
}

function cliPath() {
	if (process.env.OBSIDIAN_CLI) return process.env.OBSIDIAN_CLI;
	const macApp = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";
	if (process.platform === "darwin" && existsSync(macApp)) return macApp;
	return "obsidian-cli";
}

/** Runs one CLI command against the fixture vault only. */
function cli(...args) {
	const result = spawnSync(cliPath(), [`vault=${VAULT_NAME}`, ...args], { encoding: "utf8", timeout: 60_000 });
	if (result.error) fail(`could not run the Obsidian CLI (${cliPath()}): ${result.error.message}. Set OBSIDIAN_CLI to its path.`);
	if (result.status !== 0) fail(`the Obsidian CLI failed for "${args[0]}": ${(result.stderr || result.stdout).trim()}`);
	return result.stdout.trim();
}

const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");

function markdownFiles(dir, prefix = "") {
	return readdirSync(dir).sort().flatMap(name => {
		if (name.startsWith(".")) return [];
		const full = path.join(dir, name);
		const relative = prefix ? `${prefix}/${name}` : name;
		if (statSync(full).isDirectory()) return markdownFiles(full, relative);
		return name.endsWith(".md") ? [relative] : [];
	});
}

if (!existsSync(vaultDir)) fail(`the fixture vault ${vaultDir} does not exist.`);

// Never read another vault: the vault Obsidian knows as golden-vault has to hold exactly the fixture notes.
const expected = markdownFiles(vaultDir);
const openVaultPath = cli("vault", "info=path");
if (!openVaultPath || !existsSync(openVaultPath)) {
	fail(`Obsidian has no vault "${VAULT_NAME}". Open ${vaultDir}, or a copy of it in a folder named ${VAULT_NAME}, with "Open folder as vault", then run this again.`);
}
const onDisk = markdownFiles(openVaultPath);
const differing = [...new Set([...expected, ...onDisk])].filter(file =>
	!expected.includes(file) || !onDisk.includes(file) ||
	!readFileSync(path.join(vaultDir, file)).equals(readFileSync(path.join(openVaultPath, file))));
if (differing.length) {
	fail(`the vault "${VAULT_NAME}" at ${openVaultPath} is not a copy of fixtures/${VAULT_NAME}; these notes differ: ${JSON.stringify(differing)}.`);
}

// Metadata parsing changes between Obsidian versions, so the capture records which one produced it,
// e.g. "1.14.4 (installer 1.13.7)". The app version is the first word.
const obsidianVersion = cli("version");
if (!/^\d+\.\d+/.test(obsidianVersion)) fail(`unexpected output of "obsidian-cli version": ${obsidianVersion}`);

// Besides the metadata, ask for the vault's folder and, per note, the SHA-256 of the content Obsidian computed
// that metadata from (kept in metadataCache.fileCache, which is not public API). Both are checked below, so the
// metadata is known to come from this vault and from the fixture notes as they are now, not from an older version
// Obsidian has not re-indexed yet.
const code = `JSON.stringify((() => {
	const files = {};
	const hashes = {};
	for (const file of app.vault.getMarkdownFiles()) {
		files[file.path] = app.metadataCache.getFileCache(file);
		hashes[file.path] = app.metadataCache.fileCache?.[file.path]?.hash ?? null;
	}
	return { base: app.vault.adapter.getBasePath?.() ?? null, files, hashes };
})())`;
const raw = cli("eval", `code=${code}`);
const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
let captured;
try {
	captured = JSON.parse(json);
} catch (error) {
	fail(`the CLI did not return JSON: ${error.message}\n${raw.slice(0, 500)}`);
}

const got = Object.keys(captured.files).sort();
const missing = expected.filter(file => !got.includes(file));
const extra = got.filter(file => !expected.includes(file));
if (missing.length || extra.length) {
	fail(`the vault's notes differ from fixtures/${VAULT_NAME}: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}.`);
}
const unindexed = got.filter(file => !captured.files[file]);
if (unindexed.length) fail(`Obsidian has not indexed ${JSON.stringify(unindexed)} yet. Wait a moment and run this again.`);

if (!captured.base || realpathSync(captured.base) !== realpathSync(openVaultPath)) {
	fail(`the metadata came from the vault at ${captured.base}, not ${openVaultPath}. Is more than one vault named ${VAULT_NAME}?`);
}
const notes = Object.fromEntries(expected.map(file => [file, sha256(path.join(vaultDir, file))]));
if (got.some(file => captured.hashes[file] === null)) {
	fail("this Obsidian version does not expose the content hashes the capture checks (metadataCache.fileCache). Update capture-golden.mjs.");
}
const outdated = got.filter(file => captured.hashes[file] !== notes[file]);
if (outdated.length) {
	fail(`Obsidian's metadata for ${JSON.stringify(outdated)} was computed from other content than the fixture notes. Wait until Obsidian has re-indexed them, then run this again.`);
}

/** Sorts object keys so the file only changes when the metadata does. */
function sorted(value) {
	if (Array.isArray(value)) return value.map(sorted);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
	}
	return value;
}

const output = {
	note: "Captured from Obsidian by apps/obsidian-plugin/scripts/capture-golden.mjs. Do not edit by hand.",
	obsidianVersion,
	// The golden tests check these against the fixture notes, so they fail when the metadata is out of date.
	notes,
	files: sorted(Object.fromEntries(got.map(file => [file, captured.files[file]]))),
};
writeFileSync(outputFile, JSON.stringify(output, null, "\t") + "\n");
console.log(`capture-golden: wrote metadata for ${got.length} notes from Obsidian ${obsidianVersion} to ${path.relative(repoRoot, outputFile)}`);
