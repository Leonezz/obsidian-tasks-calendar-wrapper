/**
 * The golden vault as the tests read it: fixtures/golden-vault and the metadata Obsidian computed for its notes, see
 * scripts/capture-golden.mjs, and an app that hands both out the way the adapter reads them.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const FIXTURES = process.env.GOLDEN_FIXTURES ?? "";
const VAULT = path.join(FIXTURES, "golden-vault");
const METADATA = path.join(FIXTURES, "golden-vault.metadata.json");

export interface CapturedVault {
	obsidianVersion: string;
	/** The SHA-256 of each note the metadata was computed from. */
	notes: Record<string, string>;
	files: Record<string, unknown>;
}

function notesOnDisk(dir: string, prefix = ""): string[] {
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			if (name.startsWith(".")) return [];
			const relative = prefix ? `${prefix}/${name}` : name;
			if (statSync(path.join(dir, name)).isDirectory()) return notesOnDisk(path.join(dir, name), relative);
			return name.endsWith(".md") ? [relative] : [];
		});
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

let loaded: CapturedVault | undefined;

/** The captured metadata, after checking that it was computed from exactly the notes in the fixture vault. */
export function loadVault(): CapturedVault {
	if (loaded) return loaded;
	if (!FIXTURES) assert.fail("GOLDEN_FIXTURES is not set. Run the tests with `pnpm test`, which sets it.");
	if (!existsSync(METADATA)) {
		assert.fail(`${METADATA} is missing. Open fixtures/golden-vault in Obsidian and run \`pnpm capture:golden\`.`);
	}
	const vault = JSON.parse(readFileSync(METADATA, "utf8")) as CapturedVault;
	const onDisk = notesOnDisk(VAULT);
	const captured = Object.keys(vault.notes ?? {}).sort();
	const stale = [...new Set([...onDisk, ...captured])].filter(
		(note) =>
			!onDisk.includes(note) || !captured.includes(note) || sha256(path.join(VAULT, note)) !== vault.notes[note],
	);
	if (stale.length > 0) {
		assert.fail(
			`the metadata does not match these fixture notes: ${JSON.stringify(stale)}. ` +
				"Recapture it with `pnpm capture:golden` (not UPDATE_GOLDEN=1), then regenerate the snapshots.",
		);
	}
	assert.deepEqual(Object.keys(vault.files).sort(), captured, "every captured note has metadata");
	loaded = vault;
	return vault;
}

export interface ReadOrder {
	/** Lists the notes in reverse, unlike the sorted list of a fresh vault. */
	reversed?: boolean;
	/** Delays each read by a different time, so reads finish out of order. */
	staggered?: boolean;
}

/** An app with just what the adapter reads: the notes of the fixture vault and the metadata Obsidian computed for them. */
export function goldenApp(vault: CapturedVault, order: ReadOrder = {}, handedOut: unknown[] = []) {
	const paths = Object.keys(vault.files).sort();
	if (order.reversed) paths.reverse();
	const files = paths.map((filePath) => ({
		path: filePath,
		basename: path.basename(filePath, ".md"),
		extension: "md",
	}));
	const wait = (file: string) => new Promise((resolve) => setTimeout(resolve, (file.length * 7) % 13));
	return {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: async (file: { path: string }) => {
				if (order.staggered) await wait(file.path);
				return readFileSync(path.join(VAULT, file.path), "utf8");
			},
		},
		metadataCache: {
			// A copy each time, so nothing a run does to the metadata can leak into the next one. The copies are
			// kept in handedOut, so a test can check that parsing left Obsidian's objects as they were.
			getFileCache: (file: { path: string }) => {
				const cache = structuredClone(vault.files[file.path] ?? null);
				handedOut.push(cache);
				return cache;
			},
		},
	} as never;
}
