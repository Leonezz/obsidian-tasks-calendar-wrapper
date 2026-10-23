import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import path from "path";
import ts from "typescript";

import { apiFloorViolations, compareVersions } from "../scripts/api-floor-check.mjs";

// The API floor check, scripts/api-floor-check.mjs, on small files against Obsidian's own typings (1.14.4), where
// Modal.setCloseCallback is @since 1.10.0 and SettingTab.update @since 1.13.0.

/** The tests run from apps/obsidian-plugin, see scripts/test.mjs. */
const fromPlugin = createRequire(path.resolve("package.json"));
/** The typings the plugin builds against. */
const TYPINGS = fromPlugin.resolve("obsidian/obsidian.d.ts");
/** TypeScript's own lib files: the test's bundle of typescript would look for them next to itself. */
const LIB_DIR = path.dirname(fromPlugin.resolve("typescript"));
const FILE = path.resolve("api-floor-example.ts");

/** The uses the check reports in this source, as "line:name@since". */
function reported(source: string, floor: string): string[] {
	return check(source, floor).map((use) => `${use.line}:${use.name}@${use.since}`);
}

/** The uses the check reports in this source. */
function check(source: string, floor: string) {
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
	host.getSourceFile = (fileName, language, ...rest) =>
		fileName === FILE
			? ts.createSourceFile(fileName, source, language)
			: getSourceFile(fileName, language, ...rest);
	host.fileExists = (fileName) => fileName === FILE || fileExists(fileName);
	host.readFile = (fileName) => (fileName === FILE ? source : readFile(fileName));
	const program = ts.createProgram([FILE], options, host);
	const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
	assert.deepEqual(
		errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
		[],
		"the example compiles",
	);
	return apiFloorViolations(program, floor, (fileName) => fileName === FILE);
}

const HEADER = `import { App, ConfirmationModal, DisplayValueComponent, getLanguage, Modal, Notice, Plugin, PluginSettingTab, requireApiVersion } from "obsidian";
declare const app: App;
declare const modal: Modal;
`;

test("a use of an API newer than the floor is reported with its line, and none at or above its version", () => {
	const source = HEADER + "modal.setCloseCallback(() => {});\n";
	assert.deepEqual(reported(source, "1.7.2"), ["4:setCloseCallback@1.10.0"]);
	assert.deepEqual(reported(source, "1.10.0"), []);
	assert.deepEqual(reported(source, "1.11.4"), []);
});

test("requireApiVersion of the API's version or newer gates it: if, else, an early return, && and ?:", () => {
	const gated = [
		`if (requireApiVersion("1.10.0")) modal.setCloseCallback(() => {});`,
		`if (requireApiVersion("1.12.0")) { modal.setCloseCallback(() => {}); }`,
		`if (!requireApiVersion("1.10.0")) modal.close(); else modal.setCloseCallback(() => {});`,
		`function f() { if (!requireApiVersion("1.10.0")) return; modal.setCloseCallback(() => {}); }`,
		`for (;;) { if (!requireApiVersion("1.10.0")) { break; } modal.setCloseCallback(() => {}); }`,
		`requireApiVersion("1.10.0") && modal.setCloseCallback(() => {});`,
		`const set = requireApiVersion("1.10.0") ? modal.setCloseCallback(() => {}) : null;`,
		`if (requireApiVersion("1.2.0") && (requireApiVersion("1.10.0"))) modal.setCloseCallback(() => {});`,
		// The running Obsidian does not change, so a gate around a callback holds when it runs.
		`if (requireApiVersion("1.10.0")) setTimeout(() => modal.setCloseCallback(() => {}), 0);`,
	];
	for (const line of gated) assert.deepEqual(reported(HEADER + line + "\n", "1.7.2"), [], line);
	const ungated = [
		`if (requireApiVersion("1.9.0")) modal.setCloseCallback(() => {});`,
		`if (requireApiVersion("1.10.0")) modal.close(); else modal.setCloseCallback(() => {});`,
		`if (!requireApiVersion("1.10.0")) modal.setCloseCallback(() => {});`,
		`if (requireApiVersion("1.10.0") || requireApiVersion("1.0.0")) modal.setCloseCallback(() => {});`,
		`requireApiVersion("1.10.0") || modal.setCloseCallback(() => {});`,
		`const set = requireApiVersion("1.10.0") ? null : modal.setCloseCallback(() => {});`,
		`function f() { if (!requireApiVersion("1.10.0")) modal.close(); modal.setCloseCallback(() => {}); }`,
		`function f() { modal.setCloseCallback(() => {}); if (!requireApiVersion("1.10.0")) return; }`,
		`const v = "1.10.0"; if (requireApiVersion(v)) modal.setCloseCallback(() => {});`,
	];
	for (const line of ungated)
		assert.deepEqual(reported(HEADER + line + "\n", "1.7.2"), [`4:setCloseCallback@1.10.0`], line);
});

test("inherited members count; types, imports and the plugin's own overrides do not", () => {
	const inherited = `class Tab extends PluginSettingTab {
	display(): void {}
	redraw(): void {
		this.update();
	}
}
`;
	assert.deepEqual(reported(HEADER + inherited, "1.11.4"), ["7:update@1.13.0"]);
	const typesOnly = `type Update = PluginSettingTab["update"];
let callback: Modal["setCloseCallback"] | null = null;
class Wrapper extends Plugin {
	async onExternalSettingsChange(): Promise<void> {}
}
export type { Update, Wrapper };
export { callback };
`;
	assert.deepEqual(reported(HEADER + typesOnly, "1.0.0"), []);
});

test("a property taken by destructuring and a value put in an object by shorthand are uses", () => {
	assert.deepEqual(reported(HEADER + "const { setCloseCallback } = modal;\n", "1.7.2"), [
		"4:setCloseCallback@1.10.0",
	]);
	assert.deepEqual(reported(HEADER + "const { setCloseCallback: set } = modal;\n", "1.7.2"), [
		"4:setCloseCallback@1.10.0",
	]);
	assert.deepEqual(reported(HEADER + "const deps = { getLanguage };\n", "1.7.2"), ["4:getLanguage@1.8.7"]);
	assert.deepEqual(reported(HEADER + "const deps = { lang: getLanguage };\n", "1.7.2"), ["4:getLanguage@1.8.7"]);
	assert.deepEqual(reported(HEADER + `if (requireApiVersion("1.8.7")) console.log({ getLanguage });\n`, "1.7.2"), []);
});

test("a call of an overloaded method counts the overload it calls", () => {
	const source = HEADER + `app.workspace.on("window-open", () => {});\napp.workspace.on("url-menu", () => {});\n`;
	// window-open is @since 0.15.3, url-menu @since 1.5.1, both overloads of Workspace.on.
	assert.deepEqual(reported(source, "1.4.0"), ["5:on@1.5.1"]);
	assert.deepEqual(reported(source, "0.15.3"), ["5:on@1.5.1"]);
	assert.deepEqual(reported(source, "1.5.1"), []);
});

test("typeof in a type needs no gate; an early return on || and a break in default: gate what follows", () => {
	assert.deepEqual(
		reported(HEADER + "let m: InstanceType<typeof ConfirmationModal> | null = null;\nm = null;\n", "1.11.4"),
		[],
	);
	assert.deepEqual(reported(HEADER + "type F = typeof modal.setCloseCallback;\nexport type { F };\n", "1.7.2"), []);
	const gated = [
		`function f(ready: boolean) { if (!requireApiVersion("1.10.0") || !ready) return; modal.setCloseCallback(() => {}); }`,
		`function f(x: number) { switch (x) { default: if (!requireApiVersion("1.10.0")) break; modal.setCloseCallback(() => {}); } }`,
		`if (!(requireApiVersion("1.10.0") && requireApiVersion("1.0.0"))) modal.close(); else modal.setCloseCallback(() => {});`,
	];
	for (const line of gated) assert.deepEqual(reported(HEADER + line + "\n", "1.7.2"), [], line);
	const ungated = `function f(ready: boolean) { if (!requireApiVersion("1.10.0") && !ready) return; modal.setCloseCallback(() => {}); }`;
	assert.deepEqual(reported(HEADER + ungated + "\n", "1.7.2"), ["4:setCloseCallback@1.10.0"], ungated);
});

test("new and extends of a newer class are uses; a constructor without @since counts its class's", () => {
	// DisplayValueComponent is @since 1.13.1 and its constructor has none; ConfirmationModal is @since 1.13.0.
	assert.deepEqual(reported(HEADER + "declare const el: HTMLElement;\nnew DisplayValueComponent(el);\n", "1.11.4"), [
		"5:DisplayValueComponent@1.13.1",
	]);
	assert.deepEqual(reported(HEADER + "export class Ask extends ConfirmationModal {}\n", "1.11.4"), [
		"4:ConfirmationModal@1.13.0",
	]);
	assert.deepEqual(
		reported(
			HEADER +
				`declare const el: HTMLElement;\nif (requireApiVersion("1.13.1")) new DisplayValueComponent(el);\n`,
			"1.11.4",
		),
		[],
	);
});

test("an early return gates with throw, continue and a block of statements, in a case clause too, and not a hoisted function", () => {
	const gated = [
		`function f() { if (!requireApiVersion("1.10.0")) throw new Error("old"); modal.setCloseCallback(() => {}); }`,
		`for (const x of [1]) { if (!requireApiVersion("1.10.0")) continue; modal.setCloseCallback(() => console.log(x)); }`,
		`function f() { if (!requireApiVersion("1.10.0")) { new Notice("old"); return; } modal.setCloseCallback(() => {}); }`,
		`function f(x: number) { switch (x) { case 1: if (!requireApiVersion("1.10.0")) break; modal.setCloseCallback(() => {}); } }`,
		`const set = !requireApiVersion("1.10.0") ? null : modal.setCloseCallback(() => {});`,
	];
	for (const line of gated) assert.deepEqual(reported(HEADER + line + "\n", "1.7.2"), [], line);
	const hoisted = `function f() { g(); if (!requireApiVersion("1.10.0")) return; function g() { modal.setCloseCallback(() => {}); } }`;
	assert.deepEqual(reported(HEADER + hoisted + "\n", "1.7.2"), ["4:setCloseCallback@1.10.0"], hoisted);
});

test("a destructuring assignment and a property read with a string are uses, at their place", () => {
	const set = `let setCloseCallback: Modal["setCloseCallback"];\n({ setCloseCallback } = modal);\nexport { setCloseCallback };\n`;
	assert.deepEqual(reported(HEADER + set, "1.7.2"), ["5:setCloseCallback@1.10.0"]);
	const renamed = `let set: Modal["setCloseCallback"];\n({ setCloseCallback: set } = modal);\nexport { set };\n`;
	assert.deepEqual(reported(HEADER + renamed, "1.7.2"), ["5:setCloseCallback@1.10.0"]);
	assert.deepEqual(reported(HEADER + `modal["setCloseCallback"](() => {});\n`, "1.7.2"), [
		"4:setCloseCallback@1.10.0",
	]);
	// The column, from 1, of the name.
	const [use] = check(HEADER + "    modal.setCloseCallback(() => {});\n", "1.7.2");
	assert.deepEqual([use.line, use.column], [4, 11]);
});

test("a declaration without @since, such as requireApiVersion, is as old as any floor", () => {
	assert.deepEqual(reported(HEADER + `requireApiVersion("1.0.0");\nmodal.close();\n`, "0.1.0"), []);
});

test("versions compare by their numbers, and a suffix after a hyphen is left out", () => {
	assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
	assert.ok(compareVersions("1.11.4", "1.11.10") < 0);
	assert.equal(compareVersions("1.13", "1.13.0"), 0);
	assert.equal(compareVersions("1.13.0-beta.1", "1.13.0"), 0);
});
