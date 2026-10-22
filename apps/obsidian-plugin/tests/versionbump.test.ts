import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// version-bump.mjs, which `pnpm version <x.y.z>` runs for a release to the community store: the release takes the
// version and the minAppVersion that next-release.json holds into manifest.json and versions.json.

/** The tests run from apps/obsidian-plugin, see scripts/test.mjs. */
const SCRIPT = path.resolve("../../version-bump.mjs");

const MANIFEST = { id: "tasks-calendar-wrapper", version: "0.3.7", minAppVersion: "1.7.2", isDesktopOnly: false };
const VERSIONS = { "0.3.6": "1.7.2", "0.3.7": "1.7.2" };

/** A repository root with these files, given as values, written as the repository writes JSON. */
function repoWith(files: Record<string, unknown>) {
	const dir = mkdtempSync(path.join(tmpdir(), "version-bump-"));
	for (const [name, value] of Object.entries(files)) {
		writeFileSync(
			path.join(dir, name),
			typeof value === "string" ? value : JSON.stringify(value, null, "\t") + "\n",
		);
	}
	return {
		/** Runs the script as npm does: `check` before package.json is written, then without it. */
		run(version: string, mode: "check" | "write") {
			const env = { ...process.env, npm_new_version: "", npm_package_version: "" };
			if (mode === "check") env.npm_new_version = version;
			else env.npm_package_version = version;
			const result = spawnSync(process.execPath, [SCRIPT, ...(mode === "check" ? ["check"] : [])], {
				cwd: dir,
				env,
				encoding: "utf8",
			});
			return { status: result.status, stderr: result.stderr };
		},
		read: (name: string) => readFileSync(path.join(dir, name), "utf8"),
		remove: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("a release takes its version, and the minAppVersion of next-release.json, into manifest.json and versions.json", () => {
	const repo = repoWith({
		"manifest.json": MANIFEST,
		"versions.json": VERSIONS,
		"next-release.json": { minAppVersion: "1.11.4" },
	});
	try {
		assert.deepEqual(repo.run("0.4.0", "check"), { status: 0, stderr: "" });
		assert.equal(repo.read("manifest.json"), JSON.stringify(MANIFEST, null, "\t") + "\n", "check writes nothing");
		assert.deepEqual(repo.run("0.4.0", "write"), { status: 0, stderr: "" });
		assert.equal(
			repo.read("manifest.json"),
			JSON.stringify({ ...MANIFEST, version: "0.4.0", minAppVersion: "1.11.4" }, null, "\t") + "\n",
		);
		assert.equal(repo.read("versions.json"), JSON.stringify({ ...VERSIONS, "0.4.0": "1.11.4" }, null, "\t") + "\n");
	} finally {
		repo.remove();
	}
});

test("a release refuses a pre-release, and a next-release.json that is missing, not a version or lower than before", () => {
	const cases: [Record<string, unknown>, string, RegExp][] = [
		[{ minAppVersion: "1.11.4" }, "0.4.0-beta.3", /0\.4\.0-beta\.3 is a pre-release/],
		[
			{ minAppVersion: "1.11.x" },
			"0.4.0",
			/minAppVersion "1\.11\.x" in next-release\.json is not a version number/,
		],
		[{}, "0.4.0", /minAppVersion "undefined" in next-release\.json is not a version number/],
		[
			{ minAppVersion: "1.6.0" },
			"0.4.0",
			/1\.6\.0 in next-release\.json is older than the minAppVersion 1\.7\.2 manifest\.json holds/,
		],
	];
	for (const [nextRelease, version, message] of cases) {
		const repo = repoWith({
			"manifest.json": MANIFEST,
			"versions.json": VERSIONS,
			"next-release.json": nextRelease,
		});
		try {
			for (const mode of ["check", "write"] as const) {
				const { status, stderr } = repo.run(version, mode);
				assert.equal(status, 1, `${JSON.stringify(nextRelease)} ${version} ${mode}`);
				assert.match(stderr, message);
			}
			assert.equal(repo.read("manifest.json"), JSON.stringify(MANIFEST, null, "\t") + "\n");
		} finally {
			repo.remove();
		}
	}
	const without = repoWith({ "manifest.json": MANIFEST, "versions.json": VERSIONS });
	try {
		const { status, stderr } = without.run("0.4.0", "check");
		assert.equal(status, 1);
		assert.match(stderr, /next-release\.json/);
	} finally {
		without.remove();
	}
});
