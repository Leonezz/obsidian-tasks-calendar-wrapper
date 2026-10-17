/**
 * Bundles every tests/*.test.ts file with esbuild and runs the bundles with the built-in Node test runner,
 * like the plugin's scripts/test.mjs, but without the obsidian stub: core never imports obsidian.
 */
import esbuild from "esbuild";
import { spawnSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests");
const entries = readdirSync(testDir)
	.filter((name) => name.endsWith(".test.ts"))
	.map((name) => path.join(testDir, name));

if (entries.length === 0) {
	console.error(`No test files found in ${testDir}`);
	process.exit(1);
}

const outdir = mkdtempSync(path.join(tmpdir(), "tasks-calendar-core-tests-"));
try {
	await esbuild.build({
		entryPoints: entries,
		outdir,
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node18",
		logLevel: "warning",
	});
	const bundles = readdirSync(outdir)
		.filter((name) => name.endsWith(".js"))
		.map((name) => path.join(outdir, name));
	// A fixed locale, so localeCompare collates the same everywhere (see the plugin's scripts/test.mjs).
	const env = { ...process.env, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" };
	const result = spawnSync(process.execPath, ["--test", ...bundles], { stdio: "inherit", env, cwd: root });
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
