/**
 * The two builds the A/B mode of bench.mjs measures: a git ref built in a temporary worktree, or this checkout's
 * release build. Each is copied into a folder of its own first, so that nothing that rebuilds a checkout during the run
 * changes what is measured.
 */
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { buildInfo, releaseBuild, repoRoot, runAndUndo, ScriptError } from "./fixture-app.mjs";

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Copies main.js and styles.css into `into`, and records their hashes next to `info`. */
function keep(files, into, info) {
	mkdirSync(into, { recursive: true });
	const kept = { mainJs: path.join(into, "main.js"), stylesCss: path.join(into, "styles.css") };
	copyFileSync(files.mainJs, kept.mainJs);
	copyFileSync(files.stylesCss, kept.stylesCss);
	return { ...info, ...kept, mainJsSha256: sha256(kept.mainJs), stylesCssSha256: sha256(kept.stylesCss) };
}

/** This checkout's release build, which `pnpm bench` has just made, kept in `into`. */
export function localBuild(into) {
	const files = releaseBuild();
	if (!existsSync(files.mainJs))
		throw new ScriptError(`${path.relative(repoRoot, files.mainJs)} does not exist. Run \`pnpm build\` first.`);
	return keep(files, into, { ref: "this checkout", ...buildInfo() });
}

function run(command, args, cwd, what) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.error) throw new ScriptError(`could not ${what}: ${result.error.message}`);
	if (result.status !== 0)
		throw new ScriptError(`could not ${what}:\n${`${result.stdout}\n${result.stderr}`.trim().slice(-4000)}`);
	return result.stdout.trim();
}

/**
 * Builds the plugin at a git ref and keeps main.js and styles.css in `into`: checks the ref out in a temporary
 * worktree, installs its dependencies from its own lockfile, runs its `pnpm build`, and removes the worktree again.
 * The progress line uses `label` as its prefix, defaulting to "bench".
 */
export function buildAt(ref, into, label = "bench") {
	const commit = run(
		"git",
		["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
		repoRoot,
		`find the commit ${ref}`,
	);
	const tree = mkdtempSync(path.join(os.tmpdir(), "tcw-bench-build-"));
	// git worktree add wants a folder that does not exist yet.
	const checkout = path.join(tree, "checkout");
	try {
		run("git", ["worktree", "add", "--detach", checkout, commit], repoRoot, `check out ${ref}`);
	} catch (error) {
		rmSync(tree, { recursive: true, force: true });
		throw error;
	}
	return runAndUndo(() => {
		console.log(`${label}: building ${ref} (${commit.slice(0, 7)}) in a temporary worktree`);
		run(
			"pnpm",
			["install", "--frozen-lockfile", "--prefer-offline"],
			checkout,
			`install the dependencies of ${ref}`,
		);
		run("pnpm", ["build"], checkout, `build ${ref}`);
		const packageDir = path.join(checkout, "apps", "obsidian-plugin");
		const files = {
			mainJs: path.join(packageDir, "dist", "main.js"),
			stylesCss: path.join(packageDir, "styles.css"),
		};
		if (!existsSync(files.mainJs))
			throw new ScriptError(
				`building ${ref} made no apps/obsidian-plugin/dist/main.js; the A/B mode needs a commit with the plugin in apps/obsidian-plugin.`,
			);
		const version = JSON.parse(readFileSync(path.join(checkout, "manifest.json"), "utf8")).version;
		return keep(files, into, { ref, commit: commit.slice(0, 7), version });
	}, [
		[
			`remove the worktree ${checkout}`,
			() => run("git", ["worktree", "remove", "--force", checkout], repoRoot, `remove the worktree ${checkout}`),
		],
		[`remove ${tree}`, () => rmSync(tree, { recursive: true, force: true })],
	]);
}
