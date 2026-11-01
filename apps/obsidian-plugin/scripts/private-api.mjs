/**
 * Checks that the plugin keeps Obsidian's private App APIs in tasksplugin.ts, with no exceptions,
 * and has at most one @ts-expect-error comment, see scripts/private-api-check.mjs. It checks the plugin's own
 * source reached from src/main.ts, with the plugin's tsconfig. Prints each violation with its place and exits 1
 * when there is any, so CI fails on it. `node scripts/private-api.mjs`, or `pnpm private-api` from the repository root.
 */
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { MAX_TS_EXPECT_ERROR, isPluginSourceFile, privateApiViolations } from "./private-api-check.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginRoot, "../..");

function fail(message) {
	console.error(`private-api: ${message}`);
	process.exit(1);
}

const configFile = path.join(pluginRoot, "tsconfig.json");
const config = ts.readConfigFile(configFile, ts.sys.readFile);
if (config.error) fail(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const { options, fileNames, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, pluginRoot);
if (errors.length > 0) fail(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
// What src/main.ts reaches, and the declarations of the plugin's own the tsconfig takes in, such as module shims.
const declarations = fileNames.filter((fileName) => fileName.endsWith(".d.ts") && !fileName.includes("/tests/"));
const program = ts.createProgram([path.join(pluginRoot, "src", "main.ts"), ...declarations], options);
// Without Obsidian's typings App cannot be identified; a program that does not compile fails too.
const typings = program.getSourceFiles().some((file) => /[\\/]obsidian[\\/]obsidian\.d\.ts$/.test(file.fileName));
if (!typings) fail("the obsidian typings are not in the program; run pnpm install.");
const problems = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (problems.length > 0) {
	fail(
		`the plugin does not compile, so its uses cannot be checked:\n${ts.formatDiagnostics(problems, {
			getCanonicalFileName: (fileName) => fileName,
			getCurrentDirectory: () => repoRoot,
			getNewLine: () => "\n",
		})}`,
	);
}

const isPluginFile = (fileName) => isPluginSourceFile(fileName, pluginRoot);
const files = program.getSourceFiles().filter((file) => !file.isDeclarationFile && isPluginFile(file.fileName));
if (files.length < 10) fail(`only ${files.length} files reached from src/main.ts; the program is not the plugin's.`);
const { violations, tsExpectErrors } = privateApiViolations(program, { isPluginFile, relativeTo: pluginRoot });
for (const { message } of violations) console.error(message);
if (violations.length > 0) process.exitCode = 1;
else
	console.log(
		`private-api: ${files.length} files checked; private App APIs stay in timeline/src/tasksplugin.ts; ${tsExpectErrors.length} @ts-expect-error comments (maximum ${MAX_TS_EXPECT_ERROR}).`,
	);
