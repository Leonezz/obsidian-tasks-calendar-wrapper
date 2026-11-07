import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(process.cwd(), "../..");
assert.ok(
	existsSync(path.join(root, "eslint.config.mjs")),
	`Plugin UI boundary tests must run from apps/obsidian-plugin; no eslint.config.mjs found at ${root}`,
);
// The plugin runner bundles tests; ESLint must load its own dependencies from node_modules.
const fromRoot = createRequire(path.join(root, "package.json"));
const { ESLint } = fromRoot("eslint") as typeof import("eslint");
const eslint = new ESLint({ cwd: root });
const pluginFile = "apps/obsidian-plugin/timeline/src/fixture.ts";
const pluginTest = "apps/obsidian-plugin/tests/fixture.ts";
const uiMessage =
	"The plugin imports ui only through its public entry, @tasks-calendar-wrapper/ui; export what it needs from packages/ui/src/index.ts.";
const internalPaths = ["@tasks-calendar-wrapper/ui/src/contexts", "../../../packages/ui/src/contexts"];

async function lint(code: string, filePath: string) {
	const results = await eslint.lintText(code, { filePath: path.join(root, filePath) });
	assert.equal(results.length, 1);
	assert.equal(results[0].fatalErrorCount, 0, JSON.stringify(results[0].messages));
	return results[0].messages;
}

async function expectUiBoundary(filePath: string): Promise<void> {
	const results = await Promise.all(
		internalPaths.map((specifier) =>
			lint(`import { HostContext } from "${specifier}";\nexport const context = HostContext;\n`, filePath),
		),
	);
	const missing = internalPaths.filter(
		(_, index) =>
			!results[index].some(
				({ ruleId, message }) => ruleId === "no-restricted-imports" && message.endsWith(uiMessage),
			),
	);
	assert.deepEqual(missing, [], `Expected the UI boundary message for every import in ${filePath}`);
}

test("a plugin file that imports a ui internal path fails lint", async () => {
	await expectUiBoundary(pluginFile);
});

test("a plugin test that imports a ui internal path fails lint", async () => {
	await expectUiBoundary(pluginTest);
});

test("the plugin may import the ui public entry", async () => {
	const results = await Promise.all(
		[pluginFile, pluginTest].map((filePath) =>
			lint(
				'import { HostContext } from "@tasks-calendar-wrapper/ui";\nexport const context = HostContext;\n',
				filePath,
			),
		),
	);
	for (const messages of results) assert.deepEqual(messages, []);
});

test("a plugin file importing moment still fails lint", async () => {
	const messages = await lint('import moment from "moment";\nexport const now = moment();\n', pluginFile);
	assert.ok(
		messages.some(
			({ ruleId, message }) =>
				ruleId === "no-restricted-imports" &&
				message.endsWith(
					"Import moment from utils/moment. The npm package would bundle a second moment, set to English instead of the user's Obsidian language.",
				),
		),
		JSON.stringify(messages),
	);
});
