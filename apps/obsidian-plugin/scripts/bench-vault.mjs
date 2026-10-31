/**
 * Writes the benchmark vault that bench-notes.mjs generates into a folder: `pnpm bench:vault <folder> [--scale 10]`,
 * with a folder named bench-vault (bench-vault-x10 for the 40,000-task vault) that is empty or was made by this script,
 * and is not inside another vault, e.g. ~/Documents/projects/tcw-fixtures/bench-vault. Then open that folder in Obsidian
 * once ("Open folder as vault"). The notes are not committed: bench-notes.mjs is their source.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { benchVaultName, benchVaultNotes, scaleOf, withoutScale } from "./bench-notes.mjs";
import { markdownFiles, vaultsAround } from "./fixture-app.mjs";

/** Marks a folder as made by this script, so it is the only kind of folder the script writes into besides empty ones. */
const MARKER = ".bench-vault";

function writeVault(target, scale) {
	// pnpm runs the script in the package folder; a relative folder means one relative to where pnpm was started.
	const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), target);
	const name = benchVaultName(scale);
	if (path.basename(dir) !== name) {
		throw new Error(`the folder must be named ${name}, which is the vault name pnpm bench looks for; got ${dir}.`);
	}
	// Only the benchmark vault itself may have a .obsidian folder, once it was made here and opened in Obsidian.
	const ours = existsSync(path.join(dir, MARKER)) ? realpathSync(dir) : null;
	const vault = vaultsAround(dir).find((found) => found !== ours);
	if (vault) {
		const where = existsSync(dir) && realpathSync(dir) === vault ? "is" : "is inside";
		throw new Error(
			`${dir} ${where} the Obsidian vault at ${vault}, which this script did not make. Pick a folder outside every vault.`,
		);
	}
	const notes = benchVaultNotes(scale);
	if (existsSync(dir)) {
		const entries = readdirSync(dir).filter((name) => name !== ".obsidian" && name !== ".DS_Store");
		if (entries.length > 0 && !existsSync(path.join(dir, MARKER))) {
			throw new Error(`${dir} is not empty and was not made by this script. Pick an empty folder.`);
		}
		const extra = markdownFiles(dir).filter((file) => !notes.has(file));
		if (extra.length > 0)
			throw new Error(
				`${dir} has notes the benchmark vault does not have; remove them first: ${JSON.stringify(extra.slice(0, 10))}`,
			);
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, MARKER), "Made by apps/obsidian-plugin/scripts/bench-vault.mjs.\n");
	let written = 0;
	for (const [file, content] of notes) {
		const full = path.join(dir, file);
		if (existsSync(full) && readFileSync(full, "utf8") === content) continue;
		mkdirSync(path.dirname(full), { recursive: true });
		writeFileSync(full, content);
		written++;
	}
	return { dir, notes: notes.size, written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const usage = `usage: pnpm bench:vault <folder named ${benchVaultName(1)}> | pnpm bench:vault <folder named ${benchVaultName(10)}> --scale 10`;
	try {
		const args = process.argv.slice(2);
		const scale = scaleOf(args);
		const rest = withoutScale(args);
		if (rest.length !== 1) throw new Error(usage);
		const { dir, notes, written } = writeVault(rest[0], scale);
		console.log(
			`bench-vault: ${dir} has the ${notes} notes of the benchmark vault (${written} written). Open it in Obsidian once with "Open folder as vault".`,
		);
	} catch (error) {
		console.error(`bench-vault: ${error.message}`);
		process.exit(1);
	}
}
