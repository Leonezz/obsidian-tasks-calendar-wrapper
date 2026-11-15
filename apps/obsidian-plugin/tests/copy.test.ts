import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { copy, type Copy, type SettingType } from "@tasks-calendar-wrapper/core";
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

/** Parameters that copy functions take as lists; the snapshot passes each as one placeholder item. */
const listParameters = new Set(["dates"]);

function snapshot(value: unknown): SnapshotValue {
	if (typeof value === "string") return value;
	if (typeof value === "function") {
		const placeholder = (name: string | symbol) => `{${String(name)}}`;
		const rendered: unknown = value(
			new Proxy(
				{},
				{
					get: (_target, name) =>
						typeof name === "string" && listParameters.has(name) ? [placeholder(name)] : placeholder(name),
				},
			),
		);
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
	// Brief-derived extension: the schema routes control, heading, type and application-time copy.
	const types = [
		"boolean",
		"string",
		"stringList",
		"stringMap",
		"stringListMap",
	] as const satisfies readonly SettingType[];
	for (const type of types) used.add(`copy.settings.tab.expectedType.${type}`);
	for (const spec of settingsSchema) {
		if (spec.control !== "none" && spec.group !== undefined && spec.group in copy.settings.groups) {
			used.add(`copy.settings.groups.${spec.group}`);
		}
		if (spec.control !== "none" && spec.readWhen in copy.settings.tab.appliesWhen) {
			used.add(`copy.settings.tab.appliesWhen.${spec.readWhen}`);
		}
		if (spec.copy === undefined) continue;
		const prefix = `copy.settings.${spec.copy}`;
		const texts = copy.settings[spec.copy];
		used.add(`${prefix}.name`);
		used.add(`${prefix}.desc`);
		for (const key of Object.values(spec.options ?? {})) used.add(`${prefix}.options.${key}`);
		if (["text", "textArea", "momentFormat"].includes(spec.control) && "placeholder" in texts) {
			used.add(`${prefix}.placeholder`);
		}
		if (spec.control === "momentFormat" && "descAfterLink" in texts) used.add(`${prefix}.descAfterLink`);
		if (spec.control === "tagPalette" && "addTooltip" in texts) used.add(`${prefix}.addTooltip`);
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

test("settings copy follows the style guide", () => {
	const sentenceCase = (text: string, name: string): void => {
		assert.match(text, /^\p{Lu}/u, `${name}: starts with an upper-case letter`);
		assert.doesNotMatch(text, /\.$/u, `${name}: no final full stop`);
		const unquoted = text
			.replace(/"[^"]*"|“[^”]*”|(?<!\p{L})'[^']*'|‘[^’]*’|\[[^\]]*\]|\([^)]*\)/gu, "")
			.replace(/\b(?:Tasks Timeline|Tasks|Obsidian|Dataview)\b/gu, (product) => product.toLowerCase())
			.replace(/^\p{Lu}/u, (first) => first.toLowerCase());
		assert.doesNotMatch(unquoted, /(?:^|[^\p{L}\p{N}])\p{Lu}/u, `${name}: sentence case (${text})`);
	};
	const emoji = (text: string, name: string, description: boolean, tooltip: boolean): void => {
		for (const [symbol] of text.matchAll(/(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0F?/gu)) {
			assert.ok(
				!tooltip && (taskSyntax.test(symbol) || (description && symbol === "✏️")),
				`${name}: unexpected emoji ${symbol}`,
			);
		}
	};
	const walk = (value: unknown, prefix: string): void => {
		assert.ok(value && typeof value === "object" && !Array.isArray(value), prefix);
		const entries = value as Record<string, unknown>;
		for (const [key, child] of Object.entries(entries)) {
			if (key === "options") continue;
			const name = `${prefix}.${key}`;
			if (child && typeof child === "object") {
				walk(child, name);
				continue;
			}
			const text = snapshot(child);
			assert.equal(typeof text, "string", name);
			if (typeof text !== "string") continue;
			const description = key === "desc" || key.endsWith("Desc") || key === "descAfterLink";
			const tooltip = key.endsWith("Tooltip") || key === "resetToDefault";
			if (key === "name" || key.endsWith("Name") || prefix.endsWith(".groups") || tooltip) {
				sentenceCase(text, name);
			}
			if (description && key !== "descAfterLink") {
				const complete =
					typeof entries.descAfterLink === "string"
						? text + copy.settings.tab.momentDocsLink + entries.descAfterLink
						: text;
				assert.doesNotMatch(complete, / {2,}|[\n\t]/u, `${name}: no continuation whitespace`);
				assert.match(complete, /[.!?]$/u, `${name}: ends with a sentence-ending mark`);
			}
			emoji(text, name, description, tooltip);
		}
	};
	walk(copy.settings, "copy.settings");
});

type TimelineCopyRole =
	"label" | "sentence" | "error" | "prefix" | "suffix" | "appendSentence" | "phrase" | "summary" | "glyph";

/** These fragments are composed by callers; trimming or capitalising them would change the resulting message. */
const fragmentRoles: Readonly<Record<string, TimelineCopyRole>> = {
	"quickEntry.from": "prefix",
	"quickEntry.to": "prefix",
	"quickEntry.priorities": "prefix",
	"row.createdPrefix": "prefix",
	"row.startPrefix": "prefix",
	"row.scheduledPrefix": "prefix",
	"row.duePrefix": "prefix",
	"row.donePrefix": "prefix",
	"row.recurrencePrefix": "prefix",
	"row.priorityPrefix": "prefix",
	"row.prioritySuffix": "suffix",
	"row.summary": "summary",
	"row.menuGlyph": "glyph",
	"row.modifyGlyph": "glyph",
	"notices.changeDateWithMenu": "appendSentence",
	"notices.localDigits": "appendSentence",
	"notices.fixInNote": "appendSentence",
	"notices.dialogChangesNotUndone": "appendSentence",
	"notices.couldNotUndo": "prefix",
	"notices.touchMenu": "phrase",
	"notices.rightClick": "phrase",
};
const errorTails = new Set([
	"writeFailure",
	"tasksDialogError",
	"tasksDialogFailure",
	"openFailure",
	"fileMissing",
	"reloadFailure",
]);
const noticeLabels = new Set(["editNotSaved", "editChangedBack", "copy", "openNote", "redo", "undo"]);
const modalSentences = new Set(["createNoteMessage", "removeRecurrenceMessage", "support"]);

function timelineRole(name: string): TimelineCopyRole {
	if (fragmentRoles[name]) return fragmentRoles[name];
	const [group, key] = name.split(".");
	if (["counters", "quickEntry", "row", "timeline", "commands", "menus"].includes(group)) return "label";
	if (group === "modals") return modalSentences.has(key) ? "sentence" : "label";
	if (group === "notices") return errorTails.has(key) ? "error" : noticeLabels.has(key) ? "label" : "sentence";
	assert.fail(`copy.${name}: assign the new group a text role`);
}

/** Validate fixed English only. Braced fields stand for user data, never text to recase. */
function labelText(text: string, name: string): void {
	assert.equal(text, text.trim(), `${name}: labels have no boundary whitespace`);
	for (const [symbol] of text.matchAll(/(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0F?/gu))
		assert.ok(taskSyntax.test(symbol), `${name}: unexpected label emoji ${symbol}`);
	const words = text.replace(/(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0F?/gu, "").trim();
	assert.match(words, /^\p{Lu}/u, `${name}: labels need English text beginning with a capital`);
	assert.doesNotMatch(words, /\.$/u, `${name}: labels have no final full stop`);
	for (const [product] of words.matchAll(
		/\b(?:tasks calendar wrapper|tasks timeline|obsidian|dataview|github|utf-8)\b/giu,
	))
		assert.ok(
			["Tasks Calendar Wrapper", "Tasks Timeline", "Obsidian", "Dataview", "GitHub", "UTF-8"].includes(product),
			`${name}: retain product spelling (${product})`,
		);
	const fixed = words
		.replace(/\{[A-Za-z_$][\w$]*\}/gu, "value")
		.replace(/\b(?:Tasks Calendar Wrapper|Tasks Timeline|Obsidian|Dataview|GitHub|Tasks|UTF-8)\b/gu, (product) =>
			product.toLowerCase(),
		)
		.replace(/^\p{Lu}/u, (first) => first.toLowerCase());
	assert.doesNotMatch(fixed, /(?:^|[^\p{L}\p{N}])\p{Lu}/u, `${name}: use sentence case`);
}

function sentenceText(text: string, name: string): void {
	assert.equal(text, text.trim(), `${name}: complete messages have no boundary whitespace`);
	assert.doesNotMatch(text, / {2,}|[\n\t]/u, `${name}: no layout whitespace`);
	assert.match(text, /[.!?]$/u, `${name}: complete messages end with punctuation`);
	// A leading task, note or count keeps the supplied spelling and case.
	if (!/^(?:“)?\{/u.test(text)) assert.match(text, /^\p{Lu}/u, `${name}: capitalise the fixed opening`);
}

function assertTimelineText(text: string, role: TimelineCopyRole, name: string): void {
	if (role === "label") return labelText(text, name);
	if (role === "sentence") return sentenceText(text, name);
	if (role === "error") {
		assert.match(text, /: \{(?:reason|path)\}$/u, `${name}: leave the supplied error/path tail verbatim`);
		return labelText(text.slice(0, text.lastIndexOf(": ")), name);
	}
	if (role === "prefix") {
		assert.ok(text.endsWith(" ") && !text.endsWith("  "), `${name}: exactly one joining space`);
		return labelText(text.slice(0, -1), name);
	}
	if (role === "suffix") {
		assert.ok(text.startsWith(" ") && !text.startsWith("  "), `${name}: exactly one joining space`);
		assert.match(text.slice(1), /^[a-z]+$/u, `${name}: lower-case continuation`);
		return;
	}
	if (role === "appendSentence") {
		assert.ok(text.startsWith(" ") && !text.startsWith("  "), `${name}: exactly one joining space`);
		return sentenceText(text.slice(1), name);
	}
	if (role === "phrase") {
		assert.equal(text, text.trim(), name);
		assert.match(text, /^the [a-z]/u, `${name}: phrase follows “Use”`);
		assert.doesNotMatch(text, /\p{Lu}|[.!?]$/u, `${name}: lower-case phrase without sentence-ending punctuation`);
		return;
	}
	if (role === "summary") {
		assert.equal(text, "{status}, {dates}, {note}", `${name}: preserve supplied values and order`);
		return;
	}
	assert.ok(
		name === "row.menuGlyph" || name === "row.modifyGlyph",
		`${name}: only declared visual glyphs are exempt`,
	);
}

test("timeline copy follows the style guide for its text role", () => {
	for (const [name, value] of leaves(copy)) {
		const key = name.slice("copy.".length);
		if (key.startsWith("settings.")) continue;
		const role = timelineRole(key);
		const rendered = snapshot(value);
		assert.ok(typeof rendered === "string" || Array.isArray(rendered), name);
		for (const text of typeof rendered === "string" ? [rendered] : (rendered as string[]))
			assertTimelineText(text, role, key);
	}
	assert.equal(copy.row.menuGlyph, "⋯");
	assert.equal(copy.row.modifyGlyph, "✏️");
	assert.match(copy.row.menuAria, /^Open /u);
	assert.match(copy.row.modifyAria, /^Edit /u);
});

test("text-role checks reject title case and emoji-only controls without recasing data or error tails", () => {
	for (const text of ["Toggle To-do Counter", "📆 date", "➕", "Add task.", "Star on github"])
		assert.throws(() => labelText(text, "invalid label"));
	for (const text of ["the right-click Menu", "the right-click menu."])
		assert.throws(() => assertTimelineText(text, "phrase", "invalid continuation"));
	assert.throws(() => sentenceText("Nothing was written", "invalid message"));
	assert.doesNotThrow(() => labelText("What's new in Tasks Calendar Wrapper", "product name"));
	assert.doesNotThrow(() => labelText("Star on GitHub", "product name"));
	assert.doesNotThrow(() => assertTimelineText("Could not open {path}: {reason}", "error", "error tail"));
	assert.throws(() => assertTimelineText("Could not open {path}: {reason}.", "error", "error tail"));
	assert.equal(
		copy.notices.tasksDialogFailure({ reason: 'Disk "WORK" is busy.' }),
		'The Tasks edit dialog failed: Disk "WORK" is busy.',
	);
	assert.equal(
		copy.notices.reloadFailure({ reason: { toString: () => "WHY?" } }),
		"Could not reload tasks from notes: WHY?",
	);
	assert.equal(
		copy.row.summary({ status: "Due", dates: ["Due: NOW", "Start: THEN"], note: "WORK NOTES" }),
		"Due, Due: NOW, Start: THEN, WORK NOTES",
	);
});

test("unreadable-note copy uses the existing count parameter for singular and plural messages", () => {
	assert.equal(
		copy.notices.readFailures({ count: 1 }),
		"Tasks Calendar Wrapper: 1 note could not be read. Its tasks are missing from the timeline. See the developer console.",
	);
	assert.equal(
		copy.notices.readFailures({ count: 2 }),
		"Tasks Calendar Wrapper: 2 notes could not be read. Their tasks are missing from the timeline. See the developer console.",
	);
});
