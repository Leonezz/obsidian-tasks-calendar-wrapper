/**
 * Bundles every tests/*.test.ts file with esbuild and runs Node's test runner, following the plugin's runner.
 * DOM tests mount React in jsdom.
 */
import esbuild from "esbuild";
import { spawnSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 18) {
	console.error(`pnpm test needs Node 18 or newer for the built-in test runner (found ${process.versions.node}).`);
	process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const testDir = path.join(root, "tests");
const entries = readdirSync(testDir)
	.filter((name) => name.endsWith(".test.ts"))
	.map((name) => path.join(testDir, name));
const domEntries = entries.filter((name) => name.endsWith(".dom.test.ts"));
const staticEntries = entries.filter((name) => !name.endsWith(".dom.test.ts"));

if (entries.length === 0) {
	console.error(`No test files found in ${testDir}`);
	process.exit(1);
}

const nodeEslint = {
	name: "node-eslint",
	setup(build) {
		// ESLint loads its own dependencies from node_modules, which the temporary outdir does not have.
		build.onResolve({ filter: /^eslint$/ }, () => ({ path: require.resolve("eslint"), external: true }));
	},
};

const outdir = mkdtempSync(path.join(tmpdir(), "tasks-calendar-ui-tests-"));
try {
	const buildOptions = {
		outdir,
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node18",
		logLevel: "warning",
		plugins: [nodeEslint],
	};
	const builds = [];
	if (staticEntries.length > 0) {
		builds.push(esbuild.build({ ...buildOptions, entryPoints: staticEntries }));
	}
	if (domEntries.length > 0) {
		builds.push(
			esbuild.build({
				...buildOptions,
				entryPoints: domEntries,
				// Install the DOM before any bundled imports, including React, are evaluated.
				banner: { js: `require(${JSON.stringify(path.join(root, "scripts", "dom-env.cjs"))});` },
				plugins: [
					nodeEslint,
					{
						name: "node-react",
						setup(build) {
							// Native modules let act use Node's timers, without leaving MessageChannel ports open.
							build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path: specifier }) => ({
								path: require.resolve(specifier),
								external: true,
							}));
						},
					},
				],
			}),
		);
	}
	await Promise.all(builds);
	const bundles = readdirSync(outdir)
		.filter((name) => name.endsWith(".js"))
		.map((name) => path.join(outdir, name));
	const env = {
		...process.env,
		// Keep localeCompare's collation independent of the terminal's locale.
		LC_ALL: "en_US.UTF-8",
		LANG: "en_US.UTF-8",
	};
	const result = spawnSync(process.execPath, ["--test", ...bundles], { stdio: "inherit", env, cwd: root });
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
