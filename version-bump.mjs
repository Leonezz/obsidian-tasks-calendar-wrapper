import { readFileSync, writeFileSync } from "fs";

// Runs from `pnpm version <x.y.z>` for a release to the community store, which reads manifest.json on master.
// Betas are not released this way: they are tagged off master with only manifest.json changed.
const targetVersion = process.env.npm_package_version;

if (!targetVersion) fail("npm_package_version is not set. Run this through `pnpm version <x.y.z>`.");
if (targetVersion.includes("-")) fail(`${targetVersion} is a pre-release. Tag betas off master instead, so the store keeps the released version.`);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
// The plugin is built against these typings, so an older Obsidian may lack an API the build uses.
const typingsVersion = JSON.parse(readFileSync("apps/obsidian-plugin/package.json", "utf8")).devDependencies.obsidian;
if (compareVersions(minAppVersion, typingsVersion) < 0) {
	fail(`minAppVersion ${minAppVersion} in manifest.json is older than the obsidian typings the plugin is built against (${typingsVersion}). Raise minAppVersion first.`);
}

writeJson("manifest.json", { ...manifest, version: targetVersion });

// versions.json tells older Obsidian versions the newest release they can still install.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
writeJson("versions.json", { ...versions, [targetVersion]: minAppVersion });

function writeJson(path, value) {
	writeFileSync(path, JSON.stringify(value, null, "\t") + "\n");
}

function fail(message) {
	console.error(`version-bump: ${message}`);
	process.exit(1);
}

/** Compares dotted version numbers such as 1.11.0 by value; a suffix after a hyphen is ignored. */
function compareVersions(a, b) {
	const pa = a.split("-")[0].split(".").map(Number);
	const pb = b.split("-")[0].split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}
