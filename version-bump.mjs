import { existsSync, readFileSync, writeFileSync } from "fs";

// Runs from `pnpm version <x.y.z>` for a release to the community store, which reads manifest.json on master.
// The release takes the oldest Obsidian it supports, the minAppVersion of next-release.json, into manifest.json and
// versions.json. CI holds the code to it with `pnpm api-floor`, apps/obsidian-plugin/scripts/api-floor.mjs.
// manifest.json on master keeps the released minAppVersion until then, so the store sees no change before the release.
// Betas are not released this way: they are tagged off master with only manifest.json changed, its version and the
// minAppVersion of next-release.json; the release workflow refuses a tag whose manifest.json holds another.
// "preversion" runs it with `check` before npm writes package.json, so a refusal leaves the working tree as it was;
// "version" runs it again to write manifest.json and versions.json.
const checkOnly = process.argv[2] === "check";
const targetVersion = checkOnly ? process.env.npm_new_version : process.env.npm_package_version;
const exactVersion = /^\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/;

if (!targetVersion) fail("the target version is not set. Run this through `pnpm version <x.y.z>`.");
if (targetVersion.includes("-"))
	fail(`${targetVersion} is a pre-release. Tag betas off master instead, so the store keeps the released version.`);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (!existsSync("next-release.json"))
	fail(
		'next-release.json is missing. It holds the minAppVersion of the next release, as { "minAppVersion": "x.y.z" }.',
	);
const { minAppVersion } = JSON.parse(readFileSync("next-release.json", "utf8"));
if (!exactVersion.test(String(minAppVersion)))
	fail(`minAppVersion "${minAppVersion}" in next-release.json is not a version number.`);
if (compareVersions(minAppVersion, manifest.minAppVersion) < 0) {
	fail(
		`minAppVersion ${minAppVersion} in next-release.json is older than the minAppVersion ${manifest.minAppVersion} manifest.json holds. A release does not lower it; if that is meant, set the lower minAppVersion in manifest.json by hand first.`,
	);
}
if (checkOnly) process.exit(0);

writeJson("manifest.json", { ...manifest, version: targetVersion, minAppVersion });

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
