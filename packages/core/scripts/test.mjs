/**
 * Bundles every tests/*.test.ts file with esbuild and runs the bundles with the built-in Node test runner,
 * like the plugin's scripts/test.mjs, but without the obsidian stub: core never imports obsidian.
 *
 * First it bundles src/index.ts on its own and fails if anything in it would load moment or obsidian.
 * core gets Obsidian's moment passed in, so a value import of either would bundle a second copy or break
 * outside Obsidian. ESLint catches direct imports; this also catches ones that slip past it.
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

const forbiddenAtRuntime = {
	name: "forbid-moment-and-obsidian",
	setup(build) {
		build.onResolve({ filter: /^(moment|obsidian)(\/|$)/ }, (args) => ({
			errors: [
				{
					text: `${args.importer} loads "${args.path}" at runtime; core must get moment passed in and must not use obsidian.`,
				},
			],
		}));
	},
};

try {
	// Bundled for the browser, as the plugin's esbuild.config.mjs bundles core into main.js.
	await esbuild.build({
		entryPoints: [path.join(root, "src", "index.ts")],
		bundle: true,
		write: false,
		platform: "browser",
		format: "esm",
		logLevel: "error",
		plugins: [forbiddenAtRuntime],
	});
} catch (error) {
	// esbuild has already printed each error with its file and line.
	if (!error.errors) throw error;
	if (error.errors.some((message) => message.pluginName === forbiddenAtRuntime.name)) {
		console.error("packages/core must bundle without moment or obsidian.");
	}
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
	// A fixed locale, so localeCompare collates the same everywhere (see the plugin's scripts/test.mjs),
	// and a fixed time zone, so the date tests give the same days on every machine.
	const env = { ...process.env, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8", TZ: "UTC" };
	const result = spawnSync(process.execPath, ["--test", ...bundles], { stdio: "inherit", env, cwd: root });
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
