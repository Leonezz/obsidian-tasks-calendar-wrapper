import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { copy, type Copy } from "@tasks-calendar-wrapper/core";
import { settingsSchema } from "../src/settings-schema";

const roots = ["src", "timeline/src", "utils", "../../packages/ui/src", "../../packages/core/src"];
const copyFile = path.normalize("../../packages/core/src/copy.ts");
const literalWhitelist = new Set(["utils/whatsnew.ts"]);
const taskSyntax = /^(?:(?:📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌|🔁|⏫|🔼|🔽|⏬|🔺)\uFE0F?)+$/u;

/** Like ux-consistency, these paths are relative to the runner's apps/obsidian-plugin cwd. */
function filesIn(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "tests") return [];
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? filesIn(file) : [file];
	});
}

function sources(): ts.SourceFile[] {
	return roots
		.flatMap(filesIn)
		.filter((file) => /\.tsx?$/.test(file) && file !== copyFile)
		.map((file) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true));
}

function location(source: ts.SourceFile, node: ts.Node): string {
	return `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
}

function dotPath(node: ts.Node): string | undefined {
	if (ts.isIdentifier(node)) return node.text;
	if (!ts.isPropertyAccessExpression(node)) return undefined;
	const left = dotPath(node.expression);
	return left === undefined ? undefined : `${left}.${node.name.text}`;
}

function debugCall(node: ts.Node): boolean {
	if (!ts.isCallExpression(node)) return false;
	const name = dotPath(node.expression);
	return name !== undefined && (name.startsWith("console.") || name.includes(".logger."));
}

function isNotice(node: ts.Node): node is ts.NewExpression {
	return ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Notice";
}

function propertyName(node: ts.PropertyName): string | undefined {
	return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function visibleLiterals(source: ts.SourceFile): string[] {
	const failures = new Set<string>();
	const flag = (node: ts.Node, kind: string): void => {
		failures.add(`${location(source, node)}: ${kind}: ${node.getText(source)}`);
	};
	const literalsIn = (node: ts.Node | undefined, kind: string): void => {
		if (!node || debugCall(node)) return;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			if (!taskSyntax.test(node.text)) flag(node, kind);
			return;
		}
		if (ts.isTemplateExpression(node)) {
			flag(node, kind);
			return;
		}
		ts.forEachChild(node, (child) => literalsIn(child, kind));
	};
	const objectCopy = (node: ts.Node | undefined, names: readonly string[], kind: string): void => {
		if (!node || !ts.isObjectLiteralExpression(node)) return;
		for (const property of node.properties) {
			if (ts.isPropertyAssignment(property) && names.includes(propertyName(property.name) ?? "")) {
				literalsIn(property.initializer, kind);
			}
		}
	};
	const visit = (node: ts.Node): void => {
		if (debugCall(node)) return;
		if (ts.isJsxText(node) && /\S/u.test(node.text) && !taskSyntax.test(node.text.trim())) flag(node, "JSX text");
		if (
			ts.isJsxExpression(node) &&
			!ts.isJsxAttribute(node.parent) &&
			node.expression &&
			(ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))
		) {
			literalsIn(node.expression, "JSX text expression");
		}
		if (ts.isJsxAttribute(node) && ["aria-label", "placeholder", "title"].includes(node.name.getText(source))) {
			literalsIn(node.initializer, `${node.name.getText(source)} attribute`);
		}
		if (isNotice(node)) {
			for (const argument of node.arguments ?? []) literalsIn(argument, "Notice argument");
		}
		if (ts.isCallExpression(node)) {
			const method = ts.isPropertyAccessExpression(node.expression)
				? node.expression.name.text
				: ts.isIdentifier(node.expression)
					? node.expression.text
					: undefined;
			if (method && ["setTooltip", "setButtonText", "setTitle", "setText", "setContent"].includes(method)) {
				literalsIn(node.arguments[0], `${method} argument`);
			}
			// Brief-derived extension: Obsidian's text options, commands and modal titles.
			if (method && ["setName", "setDesc", "setPlaceholder"].includes(method)) {
				const argument = node.arguments[0];
				if (
					argument &&
					(ts.isStringLiteral(argument) ||
						ts.isNoSubstitutionTemplateLiteral(argument) ||
						ts.isTemplateExpression(argument))
				) {
					literalsIn(argument, `${method} argument`);
				}
			}
			if (method === "addOptions" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
				for (const property of node.arguments[0].properties) {
					if (ts.isPropertyAssignment(property)) literalsIn(property.initializer, "addOptions label");
				}
			}
			if (method === "createEl") objectCopy(node.arguments[1], ["text"], "createEl text");
			if (method === "addCommand") objectCopy(node.arguments[0], ["name"], "addCommand name");
			if (method === "confirm") {
				objectCopy(node.arguments[0], ["title", "message", "confirmText"], "ConfirmModal option");
			}
		}
		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "ConfirmModal") {
			for (const argument of node.arguments ?? []) {
				objectCopy(argument, ["title", "message", "confirmText"], "ConfirmModal option");
			}
		}
		if (ts.isReturnStatement(node)) {
			let owner: ts.Node | undefined = node.parent;
			while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
			if (owner && ts.isMethodDeclaration(owner) && propertyName(owner.name) === "getDisplayText") {
				literalsIn(node.expression, "getDisplayText return");
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return [...failures];
}

test("no user-visible string literal is written outside copy.ts", () => {
	const failures = sources()
		.filter((source) => !literalWhitelist.has(source.fileName))
		.flatMap(visibleLiterals);
	assert.deepEqual(failures, [], failures.join("\n"));
});

test("new Notice( appears only in notices.ts", () => {
	const notices: string[] = [];
	const failures: string[] = [];
	for (const source of sources()) {
		if (source.fileName === "src/settings.ts") continue;
		const visit = (node: ts.Node): void => {
			if (isNotice(node)) {
				const site = location(source, node);
				notices.push(site);
				let owner: ts.Node | undefined = node.parent;
				while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
				if (
					source.fileName !== "timeline/src/notices.ts" ||
					!owner ||
					!ts.isFunctionDeclaration(owner) ||
					owner.name?.text !== "reportNotice"
				) {
					failures.push(`${site}: new Notice must be inside notices.ts's reportNotice`);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	assert.deepEqual(failures, [], failures.join("\n"));
	assert.equal(notices.length, 1, `expected exactly one new Notice, found: ${notices.join(", ")}`);
});

type SnapshotValue = string | readonly string[] | { readonly [key: string]: SnapshotValue };

function snapshot(value: unknown): SnapshotValue {
	if (typeof value === "string") return value;
	if (typeof value === "function") {
		const rendered: unknown = value(new Proxy({}, { get: (_target, name) => `{${String(name)}}` }));
		assert.equal(typeof rendered, "string");
		return rendered as string;
	}
	if (Array.isArray(value)) {
		assert.ok(value.every((entry: unknown) => typeof entry === "string"));
		return value as string[];
	}
	assert.ok(value && typeof value === "object");
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)]));
}

test("the copy table matches fixtures/copy/en.json", () => {
	const file = path.resolve("../../fixtures/copy/en.json");
	const updateCommand = "UPDATE_COPY=1 pnpm test";
	const actual = JSON.stringify(snapshot(copy), null, "\t") + "\n";
	if (process.env.UPDATE_COPY === "1") {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, actual);
	}
	assert.ok(existsSync(file), `${file} is missing; create it with \`${updateCommand}\`.`);
	assert.ok(readFileSync(file).equals(Buffer.from(actual)), `${file} differs; update it with \`${updateCommand}\`.`);
});

function leaves(value: unknown, prefix = "copy"): [string, unknown][] {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return Object.entries(value).flatMap(([key, entry]) => leaves(entry, `${prefix}.${key}`));
	}
	return [[prefix, value]];
}

test("every copy key is used", () => {
	const used = new Set<string>();
	for (const source of sources()) {
		const visit = (node: ts.Node): void => {
			if (ts.isPropertyAccessExpression(node)) {
				const name = dotPath(node);
				if (name?.startsWith("copy.")) used.add(name);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	// Brief-derived extension: the schema routes only names, descriptions and dropdown labels.
	for (const spec of settingsSchema) {
		if (spec.copy === undefined) continue;
		const prefix = `copy.settings.${spec.copy}`;
		used.add(`${prefix}.name`);
		used.add(`${prefix}.desc`);
		for (const key of Object.values(spec.options ?? {})) used.add(`${prefix}.options.${key}`);
	}
	const unused = leaves(copy)
		.map(([name]) => name)
		.filter((name) => !used.has(name));
	assert.deepEqual(unused, [], `unused copy keys: ${unused.join(", ")}`);
});

type Assert<T extends true> = T;
type ValidLeaves<T> = T extends string | readonly string[]
	? true
	: T extends (...args: infer P) => infer R
		? P extends [object]
			? R extends string
				? true
				: false
			: false
		: T extends object
			? { [K in keyof T]: ValidLeaves<T[K]> }[keyof T]
			: false;
type Translated<T> = T extends string
	? "Translated copy"
	: T extends readonly string[]
		? readonly ["Translated copy"]
		: T extends (...args: infer P) => infer R
			? (...args: P) => R
			: { [K in keyof T]: Translated<T[K]> };

/** Never executed: pnpm typecheck checks function parameters and translation shape. */
function checkCopyTypes(translated: Translated<typeof copy>): void {
	const translation = translated satisfies Copy;
	const validLeaves: Assert<ValidLeaves<Copy>> = true;
	// @ts-expect-error Parameterised copy requires its object parameter.
	copy.notices.openFailure();
	// @ts-expect-error Both path and reason are required.
	copy.notices.openFailure({ path: "note.md" });
	// @ts-expect-error A translation cannot omit a group.
	const missing = {} satisfies Copy;
	// @ts-expect-error A translation cannot add an unknown key.
	const extra = { ...copy, extra: "Unexpected" } satisfies Copy;
	void [translation, validLeaves, missing, extra];
}

test("parameterised copy are typed functions", () => {
	void checkCopyTypes;
	for (const [name, value] of leaves(copy)) {
		for (const text of typeof value === "string" ? [value] : Array.isArray(value) ? value : []) {
			assert.doesNotMatch(text, /\{[A-Za-z_$][\w$]*\}/u, `${name}: placeholders belong in a typed function`);
		}
	}
	const frozen = (value: unknown, name: string): void => {
		if (value && (typeof value === "object" || typeof value === "function")) {
			assert.ok(Object.isFrozen(value), `${name} must be frozen`);
			for (const [key, child] of Object.entries(value)) frozen(child, `${name}.${key}`);
		}
	};
	frozen(copy, "copy");
});
