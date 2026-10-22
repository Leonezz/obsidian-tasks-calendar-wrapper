/**
 * Checks that the plugin uses no Obsidian API newer than the minAppVersion of next-release.json without a
 * requireApiVersion gate, see scripts/api-floor-check.mjs. It checks the code the bundle holds: what src/main.ts imports,
 * with the plugin's tsconfig. Prints each use with its place and exits 1 when there is any, so CI and the release
 * workflow fail on it. `node scripts/api-floor.mjs`, or `pnpm api-floor` from the repository root.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { apiFloorViolations } from "./api-floor-check.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginRoot, "../..");
const nextRelease = path.join(repoRoot, "next-release.json");

function fail(message) {
	console.error(`api-floor: ${message}`);
	process.exit(1);
}

if (!existsSync(nextRelease))
	fail(`${nextRelease} is missing; it holds the minAppVersion the code is checked against.`);
const floor = JSON.parse(readFileSync(nextRelease, "utf8")).minAppVersion;
if (!/^\d+(\.\d+)*$/.test(String(floor)))
	fail(`minAppVersion "${floor}" in next-release.json is not a version number.`);

const configFile = path.join(pluginRoot, "tsconfig.json");
const config = ts.readConfigFile(configFile, ts.sys.readFile);
if (config.error) fail(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, pluginRoot);
if (errors.length > 0) fail(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
const program = ts.createProgram([path.join(pluginRoot, "src", "main.ts")], options);

// Every file of the program but the declarations and what comes from node_modules: the code the bundle holds.
const isPluginFile = (fileName) => !fileName.split(/[\\/]/).includes("node_modules");
const violations = apiFloorViolations(program, floor, isPluginFile);
const files = program.getSourceFiles().filter((file) => !file.isDeclarationFile && isPluginFile(file.fileName));
if (files.length < 10) fail(`only ${files.length} files reached from src/main.ts; the program is not the plugin's.`);
for (const { file, line, column, name, since } of violations) {
	console.error(
		`${path.relative(repoRoot, file)}:${line}:${column}: ${name} is in Obsidian from ${since}, newer than the floor ${floor}; gate it with requireApiVersion("${since}").`,
	);
}
if (violations.length > 0)
	fail(`${violations.length} use(s) of an API newer than ${floor} without a requireApiVersion gate.`);
console.log(
	`api-floor: ${files.length} files use no Obsidian API newer than ${floor} without a requireApiVersion gate.`,
);
