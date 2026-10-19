/**
 * Bundles every tests/*.test.ts file with esbuild and runs the bundles with
 * the built-in Node test runner. No extra test dependencies are needed.
 */
import esbuild from "esbuild";
import { spawnSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 18) {
	console.error(`pnpm test needs Node 18 or newer for the built-in test runner (found ${process.versions.node}).`);
	process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests");
const entries = readdirSync(testDir)
	.filter((name) => name.endsWith(".test.ts"))
	.map((name) => path.join(testDir, name));

if (entries.length === 0) {
	console.error(`No test files found in ${testDir}`);
	process.exit(1);
}

const outdir = mkdtempSync(path.join(tmpdir(), "tasks-calendar-tests-"));
try {
	await esbuild.build({
		entryPoints: entries,
		outdir,
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node18",
		logLevel: "warning",
		alias: {
			obsidian: path.join(testDir, "stubs", "obsidian.ts"),
			// The view mounts the bridge with createRoot, which needs a DOM; see the stub.
			"react-dom/client": path.join(testDir, "stubs", "react-dom-client.ts"),
		},
	});
	const bundles = readdirSync(outdir)
		.filter((name) => name.endsWith(".js"))
		.map((name) => path.join(outdir, name));
	const env = {
		...process.env,
		// Sorting by text uses localeCompare, whose collation ICU takes from the locale the process starts
		// with. A fixed locale keeps the golden sort orders the same in, say, a Chinese terminal.
		LC_ALL: "en_US.UTF-8",
		LANG: "en_US.UTF-8",
		// Where the golden tests find their fixtures, wherever the tests are started from.
		GOLDEN_FIXTURES: path.resolve(root, "../../fixtures"),
	};
	// From the package folder, where tests such as the release notes test find the manifest.
	const result = spawnSync(process.execPath, ["--test", ...bundles], { stdio: "inherit", env, cwd: root });
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
