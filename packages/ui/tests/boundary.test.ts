import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";

const root = path.resolve(process.cwd(), "../..");
assert.ok(
	existsSync(path.join(root, "eslint.config.mjs")),
	`UI boundary tests must run from packages/ui; no eslint.config.mjs found at ${root}`,
);
const eslint = new ESLint({ cwd: root });

async function ruleIds(code: string): Promise<(string | null)[]> {
	const results = await eslint.lintText(code, { filePath: path.join(root, "packages/ui/src/boundary-fixture.ts") });
	assert.equal(results.length, 1);
	assert.equal(results[0].fatalErrorCount, 0, JSON.stringify(results[0].messages));
	return results[0].messages.map(({ ruleId }) => ruleId);
}

async function expectRule(fixtures: readonly string[], rule: string): Promise<void> {
	const results = await Promise.all(fixtures.map(ruleIds));
	const missing = fixtures.filter((_, index) => !results[index].includes(rule));
	assert.deepEqual(missing, [], `Expected ${rule} for every fixture; missing for ${JSON.stringify(missing)}`);
}

test("a ui file that imports obsidian fails lint", async () => {
	await expectRule(
		['import { Platform } from "obsidian";\nexport const mobile = Platform.isMobile;\n'],
		"no-restricted-imports",
	);
});

test("a ui file that imports underscore, the plugin or reaches into apps fails lint", async () => {
	await expectRule(
		[
			'import underscore from "underscore";\nexport const same = underscore.isEqual(1, 1);\n',
			'import isEqual from "underscore/modules/isEqual.js";\nexport const same = isEqual(1, 1);\n',
			'import * as plugin from "@tasks-calendar-wrapper/obsidian-plugin";\nexport const app = plugin;\n',
			'import * as views from "../../../apps/obsidian-plugin/src/views";\nexport const view = views;\n',
		],
		"no-restricted-imports",
	);
});

test("a ui file that calls createEl or createDiv fails lint", async () => {
	await expectRule(['export const a = createEl("a");\n', "export const d = createDiv();\n"], "no-restricted-globals");
});

test("a ui file that imports moment, even its types, fails lint", async () => {
	await expectRule(
		['import type { Moment } from "moment";\nexport type M = Moment;\n', 'import "moment/locale/de";\n'],
		"no-restricted-imports",
	);
});

test("a ui file importing react and core passes lint", async () => {
	const messages = await ruleIds(
		'import { useState } from "react";\nimport type { Store } from "@tasks-calendar-wrapper/core";\nexport function useCount(store: Store<number>): number {\n\tconst [n] = useState(store.getSnapshot());\n\treturn n;\n}\n',
	);
	assert.deepEqual(messages, []);
});
