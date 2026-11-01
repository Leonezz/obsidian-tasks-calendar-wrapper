import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FROZEN = "apps/obsidian-plugin/tests/render.dom.test.ts";
const SOURCE = 'import { test } from "node:test";\ntest("kept", () => {\n\tassert.equal(1, 1);\n});\n';
// scripts/test.mjs starts the bundles from the plugin folder; the CLI runs against a disposable repository.
const SCRIPT = path.resolve("scripts/frozen-tests.mjs");
const SCRIPT_URL = pathToFileURL(SCRIPT).href;
const library = () => import(SCRIPT_URL) as Promise<typeof import("../scripts/frozen-tests.mjs")>;

function repository(t: TestContext, files: Record<string, string> = { [FROZEN]: SOURCE }) {
	const dir = mkdtempSync(path.join(tmpdir(), "frozen-tests-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	function write(name: string, source: string) {
		const target = path.join(dir, name);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, source);
	}
	function git(...args: string[]) {
		const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
			cwd: dir,
			env,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
	}
	for (const [name, source] of Object.entries(files)) write(name, source);
	git("init", "--quiet");
	git("add", ".");
	git(
		"-c",
		"user.name=Frozen tests",
		"-c",
		"user.email=frozen@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"base",
	);
	return {
		write,
		remove: (name: string) => rmSync(path.join(dir, name)),
		rename: (from: string, to: string) => renameSync(path.join(dir, from), path.join(dir, to)),
		run(labels?: string, args = ["--base", "HEAD"]) {
			if (arguments.length === 0) labels = '["pure-refactor"]';
			const childEnv: NodeJS.ProcessEnv = { ...env, GITHUB_EVENT_NAME: "pull_request" };
			if (labels === undefined) delete childEnv.PR_LABELS;
			else childEnv.PR_LABELS = labels;
			return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env: childEnv, encoding: "utf8" });
		},
	};
}

test("an import-only change passes", async () => {
	const { compareFrozenFiles, stripImports } = await library();
	const changed = SOURCE.replace(
		'import { test } from "node:test";',
		'// Moved into the harness.\nimport { test as check } from "./harness";\nimport "./setup";',
	);
	assert.deepEqual(compareFrozenFiles({ [FROZEN]: SOURCE }, { [FROZEN]: changed }), []);
	assert.equal(stripImports(SOURCE).text, stripImports(changed).text);
	const body = "assert.equal(1, 1);\n";
	assert.equal(stripImports('import "./setup";\n' + body).text, body);
	assert.deepEqual(compareFrozenFiles({ [FROZEN]: body }, { [FROZEN]: 'import "./setup";\n' + body }), []);
	const ordinary = 'const text = "import is not a declaration";\nvoid import("./dynamic");\n';
	assert.equal(stripImports(ordinary).text, ordinary);
	assert.notDeepEqual(
		compareFrozenFiles({ [FROZEN]: ordinary }, { [FROZEN]: ordinary.replace("dynamic", "other") }),
		[],
	);
});

test("a multi-line import change passes", async () => {
	const { compareFrozenFiles, stripImports } = await library();
	const changed = SOURCE.replace(
		'import { test } from "node:test";',
		'/* The harness now provides the callbacks. */\nimport {\n\ttest as check,\n\ttype TestContext,\n} from "./harness";',
	);
	assert.deepEqual(compareFrozenFiles({ [FROZEN]: SOURCE }, { [FROZEN]: changed }), []);
	assert.equal(stripImports(changed).text, stripImports(SOURCE).text);
	assert.ok(stripImports(changed).lines.some((line) => line.number === 7 && line.text.includes("assert.equal")));
	// Export declarations and import-looking text remain part of the frozen body.
	const exported = 'export { test } from "node:test";\n';
	assert.equal(stripImports(exported).text, exported);
	const importEquals = 'import test = require("node:test");\n';
	assert.equal(stripImports(importEquals).text, importEquals);
	const surrounded =
		'const before = 1; // Keep this statement.\n\n/* Import trivia. */\nimport {\n\ttest,\n} from "node:test";\nconst after = 2;\n';
	assert.equal(stripImports(surrounded).text, "const before = 1; // Keep this statement.\nconst after = 2;\n");
	const trailing = "const before = 1; /* Keep this\n trailing comment. */";
	assert.equal(
		stripImports(trailing + '\nimport "./setup";\nconst after = 2;\n').text,
		trailing + "\nconst after = 2;\n",
	);
	assert.equal(
		stripImports(trailing + ' import "./setup";\nconst after = 2;\n').text,
		trailing + "const after = 2;\n",
	);
});

test("unchanged frozen test guards pass", async () => {
	const { compareGuardFiles } = await library();
	const files = {
		"apps/obsidian-plugin/scripts/frozen-tests.mjs": SOURCE,
		"apps/obsidian-plugin/tests/frozentests.test.ts": SOURCE,
		".github/workflows/ci.yml": "name: CI\n",
	};
	assert.deepEqual(compareGuardFiles(files, { ...files }), []);
	assert.deepEqual(compareGuardFiles({}, {}), []);
});

test("changed frozen test guards fail and name every file", async () => {
	const { compareGuardFiles } = await library();
	for (const file of [
		"apps/obsidian-plugin/scripts/frozen-tests.mjs",
		"apps/obsidian-plugin/tests/frozentests.test.ts",
		".github/workflows/ci.yml",
	]) {
		const changed = SOURCE.replace('"node:test"', '"./harness"');
		assert.deepEqual(compareGuardFiles({ [file]: SOURCE }, { [file]: changed }), [{ path: file, deleted: false }]);
		assert.deepEqual(compareGuardFiles({ [file]: Buffer.from([0xff]) }, { [file]: Buffer.from([0xfe]) }), [
			{ path: file, deleted: false },
		]);
	}
	const outside = "apps/obsidian-plugin/tests/interactions.dom.test.ts";
	assert.deepEqual(compareGuardFiles({ [outside]: SOURCE }, { [outside]: "changed" }), []);
});

test("deleted frozen test guards fail", async () => {
	const { compareGuardFiles } = await library();
	for (const file of [
		"apps/obsidian-plugin/scripts/frozen-tests.mjs",
		"apps/obsidian-plugin/tests/frozentests.test.ts",
		".github/workflows/ci.yml",
	])
		assert.deepEqual(compareGuardFiles({ [file]: SOURCE }, {}), [{ path: file, deleted: true }]);
});

test("a changed assertion fails and names the line", async (t) => {
	const { compareFrozenFiles, formatChanges } = await library();
	const changed = SOURCE.replace("assert.equal(1, 1)", "assert.equal(1, 2)");
	const differences = compareFrozenFiles({ [FROZEN]: SOURCE }, { [FROZEN]: changed });
	assert.equal(differences.length, 1);
	assert.equal(differences[0].path, FROZEN);
	assert.equal(differences[0].deleted, false);
	assert.deepEqual(differences[0].changes, [
		{ side: "base", line: 3, text: "\tassert.equal(1, 1);\n" },
		{ side: "current", line: 3, text: "\tassert.equal(1, 2);\n" },
	]);
	const report = formatChanges(differences);
	assert.ok(report.includes(FROZEN));
	assert.match(report, /3.*assert\.equal\(1, 2\)/);
	for (const body of [SOURCE.replace("\tassert", "  assert"), SOURCE.replaceAll("\n", "\r\n"), SOURCE.trimEnd()])
		assert.notDeepEqual(
			compareFrozenFiles({ [FROZEN]: SOURCE }, { [FROZEN]: body }),
			[],
			"non-import bytes are frozen",
		);
	const repo = repository(t);
	repo.write(FROZEN, changed);
	const checked = repo.run();
	assert.equal(checked.status, 1, checked.stderr);
	assert.ok((checked.stdout + checked.stderr).includes(FROZEN));
	assert.match(checked.stdout + checked.stderr, /3.*assert\.equal\(1, 2\)/);
	const reported = repo.run(undefined, ["--report", "--base", "HEAD"]);
	assert.equal(reported.status, 0, reported.stderr);
	assert.ok(reported.stdout.includes(FROZEN));
	assert.match(reported.stdout, /3.*assert\.equal\(1, 2\)/);
});

test("a deleted frozen file fails", async (t) => {
	const { compareFrozenFiles, formatChanges } = await library();
	const differences = compareFrozenFiles({ [FROZEN]: SOURCE }, {});
	assert.equal(differences.length, 1);
	assert.equal(differences[0].path, FROZEN);
	assert.equal(differences[0].deleted, true);
	assert.match(formatChanges(differences), /deleted/i);
	const repo = repository(t);
	repo.remove(FROZEN);
	const deleted = repo.run();
	assert.equal(deleted.status, 1, deleted.stderr);
	assert.ok((deleted.stdout + deleted.stderr).includes(FROZEN));
	repo.write(FROZEN, SOURCE);
	repo.rename(FROZEN, FROZEN.replace("render.dom", "renamed"));
	const renamed = repo.run();
	assert.equal(renamed.status, 1, renamed.stderr);
	assert.ok((renamed.stdout + renamed.stderr).includes(FROZEN));
});

test("without the label nothing is checked", async (t) => {
	const { parseLabels } = await library();
	assert.deepEqual(parseLabels("[]", "pull_request"), []);
	assert.deepEqual(parseLabels('["bug", "pure-refactor"]', "pull_request"), ["bug", "pure-refactor"]);
	assert.deepEqual(parseLabels(undefined, "push"), []);
	const repo = repository(t);
	repo.remove(FROZEN);
	const result = repo.run("[]");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "pure-refactor label not set: frozen tests not checked\n");
	assert.equal(result.stderr, "");
	// A bad base is an input error even when this run has no pure-refactor label.
	const invalidBase = repo.run("[]", ["--base", "missing-frozen-tests-base"]);
	assert.equal(invalidBase.status, 1);
	assert.match(invalidBase.stderr, /missing-frozen-tests-base/);
	assert.match(invalidBase.stderr, /fetch|valid|available/i);
	const missingBase = repo.run("[]", []);
	assert.equal(missingBase.status, 1);
	assert.match(missingBase.stderr, /--base/);
});

test("missing PR_LABELS on a pull request is an error", async (t) => {
	const { parseLabels } = await library();
	for (const raw of [undefined, "", "not json", "{}", '["pure-refactor", 3]', "null"]) {
		assert.throws(() => parseLabels(raw, "pull_request"), /PR_LABELS/);
	}
	const repo = repository(t);
	for (const raw of [undefined, "not json", "{}", '["pure-refactor", 3]']) {
		const result = repo.run(raw);
		assert.equal(result.status, 1, String(raw));
		assert.match(result.stderr, /PR_LABELS/);
		assert.match(result.stderr, /JSON|array/);
	}
});

test("notices*.test.ts are frozen by glob", async (t) => {
	const { FROZEN_FILES, compareFrozenFiles } = await library();
	assert.deepEqual(FROZEN_FILES, [
		FROZEN,
		"apps/obsidian-plugin/tests/render-timeline.dom.test.ts",
		"apps/obsidian-plugin/tests/views.test.ts",
		"apps/obsidian-plugin/tests/rowmenu.test.ts",
		"apps/obsidian-plugin/tests/datemodal.test.ts",
		"apps/obsidian-plugin/tests/notices*.test.ts",
	]);
	const notice = "apps/obsidian-plugin/tests/notices-future.test.ts";
	const changed = SOURCE.replace("assert.equal(1, 1)", "assert.equal(1, 2)");
	assert.equal(compareFrozenFiles({ [notice]: SOURCE }, { [notice]: changed })[0].path, notice);
	assert.equal(compareFrozenFiles({ [notice]: SOURCE }, {})[0].deleted, true);
	assert.equal(compareFrozenFiles({}, { [notice]: SOURCE })[0].path, notice);
	const outside = "apps/obsidian-plugin/tests/interactions.dom.test.ts";
	assert.deepEqual(compareFrozenFiles({ [outside]: SOURCE }, { [outside]: changed }), []);
	const repo = repository(t, { [notice]: SOURCE });
	repo.remove(notice);
	const deleted = repo.run();
	assert.equal(deleted.status, 1, deleted.stderr);
	assert.ok((deleted.stdout + deleted.stderr).includes(notice));
	repo.write(notice, SOURCE);
	const added = "apps/obsidian-plugin/tests/notices-new.test.ts";
	repo.write(added, changed);
	const current = repo.run();
	assert.equal(current.status, 1, current.stderr);
	assert.ok((current.stdout + current.stderr).includes(added));
});
