import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "module";
import path from "path";
import ts from "typescript";

import { MAX_TS_EXPECT_ERROR, isPluginSourceFile, privateApiViolations } from "../scripts/private-api-check.mjs";

/** The tests run from apps/obsidian-plugin, see scripts/test.mjs. */
const PLUGIN_ROOT = path.resolve(".");
const fromPlugin = createRequire(path.join(PLUGIN_ROOT, "package.json"));
const TYPINGS = fromPlugin.resolve("obsidian/obsidian.d.ts");
/** The bundled TypeScript needs the original lib directory. */
const LIB_DIR = path.dirname(fromPlugin.resolve("typescript"));

/** Small in-memory files, compiled against the same Obsidian typings as the plugin. */
function programFor(files: Record<string, string>): ts.Program {
	const sources = new Map(Object.entries(files).map(([file, source]) => [path.resolve(PLUGIN_ROOT, file), source]));
	const options: ts.CompilerOptions = {
		strict: true,
		target: ts.ScriptTarget.ES2018,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ["lib.es2021.d.ts", "lib.dom.d.ts"],
		types: [],
		noEmit: true,
		paths: { obsidian: [TYPINGS] },
	};
	const host = ts.createCompilerHost(options);
	host.getDefaultLibLocation = () => LIB_DIR;
	host.getDefaultLibFileName = (compilerOptions) => path.join(LIB_DIR, ts.getDefaultLibFileName(compilerOptions));
	const { getSourceFile, fileExists, readFile } = host;
	host.getSourceFile = (fileName, language, ...rest) => {
		const source = sources.get(fileName);
		return source === undefined
			? getSourceFile(fileName, language, ...rest)
			: ts.createSourceFile(fileName, source, language);
	};
	host.fileExists = (fileName) => sources.has(fileName) || fileExists(fileName);
	host.readFile = (fileName) => sources.get(fileName) ?? readFile(fileName);
	const program = ts.createProgram([...sources.keys()], options, host);
	const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
	assert.deepEqual(
		errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
		[],
		"the examples compile",
	);
	return program;
}

function check(files: Record<string, string>) {
	return privateApiViolations(programFor(files), {
		relativeTo: PLUGIN_ROOT,
		isPluginFile: () => true,
	});
}

const HEADER = `import { App } from "obsidian";
declare const app: App;
`;
const COMMANDS = `import { App } from "obsidian";
class Example {
	constructor(private app: App) {}
	run() {
		// @ts-expect-error commands is not public.
		this.app.commands.commands;
	}
}
`;

test("timeline/src/x.ts containing this.app.commands.commands fails with the message", () => {
	const result = check({ "timeline/src/x.ts": COMMANDS });
	assert.deepEqual(result.violations, [
		{
			file: "timeline/src/x.ts",
			line: 6,
			name: "commands",
			message: "private API app.commands at timeline/src/x.ts:6",
		},
	]);
	assert.deepEqual(result.tsExpectErrors, [{ file: "timeline/src/x.ts", line: 5 }]);
});

test("the same code in timeline/src/tasksplugin.ts passes", () => {
	const result = check({ "timeline/src/tasksplugin.ts": COMMANDS });
	assert.deepEqual(result.violations, []);
	assert.deepEqual(result.tsExpectErrors, [{ file: "timeline/src/tasksplugin.ts", line: 5 }]);
});

test("an app.plugins or app.commands access in obsidianbridge.tsx fails", () => {
	for (const name of ["plugins", "commands"]) {
		const result = check({
			"timeline/src/obsidianbridge.tsx": HEADER + `// @ts-expect-error ${name} is not public.\napp.${name};\n`,
		});
		assert.deepEqual(
			result.violations.map((use) => use.message),
			[`private API app.${name} at timeline/src/obsidianbridge.tsx:4`],
		);
	}
});

test("a second @ts-expect-error fails", () => {
	assert.equal(MAX_TS_EXPECT_ERROR, 1);
	const first = `export {};
// @ts-expect-error an intentional type error.
const one: number = "one";
`;
	const second = `export {};
/* @ts-expect-error an intentional type error. */
const two: number = "two";
`;
	assert.deepEqual(check({ "timeline/src/tasksplugin.ts": first }).violations, []);
	const result = check({
		"timeline/src/tasksplugin.ts": first,
		"utils/x.ts": second,
	});
	assert.deepEqual(result.tsExpectErrors, [
		{ file: "timeline/src/tasksplugin.ts", line: 2 },
		{ file: "utils/x.ts", line: 2 },
	]);
	assert.equal(result.violations.length, 1);
	const [violation] = result.violations;
	assert.equal(violation.name, "@ts-expect-error");
	assert.match(violation.message, /2 @ts-expect-error comments exceed the maximum 1/);
	for (const { file, line } of result.tsExpectErrors) assert.ok(violation.message.includes(`${file}:${line}`));
});

test("string element access and internalPlugins are private App accesses", () => {
	const result = check({
		"timeline/src/x.ts":
			HEADER +
			`// @ts-expect-error plugins is not public.
app["plugins"];
// @ts-expect-error internalPlugins is not public.
app.internalPlugins;
`,
	});
	assert.deepEqual(
		result.violations.filter((use) => use.name !== "@ts-expect-error").map((use) => use.message),
		["private API app.plugins at timeline/src/x.ts:4", "private API app.internalPlugins at timeline/src/x.ts:6"],
	);
});

test("commands on a non-App receiver or an unrelated class named App passes", () => {
	const result = check({
		"timeline/src/x.ts": `export {};
const receiver = { commands: { commands: {} } };
receiver.commands.commands;
class App { commands = {}; }
new App().commands;
`,
	});
	assert.deepEqual(result.violations, []);
});

test("App subclasses, including generic subclasses, and unions or intersections containing App are checked", () => {
	const result = check({
		"timeline/src/x.ts":
			HEADER +
			`class Base extends App {} class Child<T> extends Base { value?: T; }
declare const child: Child<string>;
declare const union: App | { other: string };
declare const intersection: App & { other: string };
// @ts-expect-error commands is not public.
child.commands;
// @ts-expect-error plugins is not public.
union.plugins;
// @ts-expect-error internalPlugins is not public.
intersection.internalPlugins;
`,
	});
	assert.deepEqual(
		result.violations.filter((use) => use.name !== "@ts-expect-error").map((use) => use.message),
		[
			"private API app.commands at timeline/src/x.ts:8",
			"private API app.plugins at timeline/src/x.ts:10",
			"private API app.internalPlugins at timeline/src/x.ts:12",
		],
	);
});

test("files outside the plugin source are not checked", () => {
	const excluded = [
		"node_modules/fixture/index.ts",
		"timeline/src/generated.d.ts",
		"scripts/example.ts",
		"tests/example.ts",
		"../other-plugin/src/x.ts",
	];
	const source =
		HEADER +
		`// @ts-expect-error commands is not public.
app.commands;
`;
	for (const file of excluded)
		assert.equal(isPluginSourceFile(path.resolve(PLUGIN_ROOT, file), PLUGIN_ROOT), false, file);
	for (const file of ["src/main.ts", "timeline/src/x.ts", "utils/x.ts"])
		assert.equal(isPluginSourceFile(path.resolve(PLUGIN_ROOT, file), PLUGIN_ROOT), true, file);
	const result = check(Object.fromEntries(excluded.map((file) => [file, source])));
	assert.deepEqual(result.violations, []);
	assert.deepEqual(result.tsExpectErrors, []);
});

test("the caller can narrow the checked files", () => {
	const program = programFor({ "timeline/src/x.ts": COMMANDS });
	const result = privateApiViolations(program, { relativeTo: PLUGIN_ROOT, isPluginFile: () => false });
	assert.deepEqual(result.violations, []);
	assert.deepEqual(result.tsExpectErrors, []);
});

test("only comments count as @ts-expect-error, not strings, templates, or regular expressions", () => {
	const result = check({
		"timeline/src/x.ts": `export {};
const quoted = "// @ts-expect-error";
const template = \`/* @ts-expect-error */\`;
const pattern = /[/*] @ts-expect-error/;
const interpolated = \`@ts-expect-error \${quoted} @ts-expect-error\`;
// @ts-expect-error an intentional type error.
const value: number = "text";
`,
	});
	assert.deepEqual(result.violations, []);
	assert.deepEqual(result.tsExpectErrors, [{ file: "timeline/src/x.ts", line: 6 }]);
});

test("the real plugin has one @ts-expect-error comment and no private API violations", () => {
	const output = execFileSync(process.execPath, ["scripts/private-api.mjs"], {
		cwd: PLUGIN_ROOT,
		encoding: "utf8",
	});
	assert.match(output, /1 @ts-expect-error comments \(maximum 1\)/);
});
