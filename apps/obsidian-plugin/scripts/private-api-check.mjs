/**
 * Keeps Obsidian's private App APIs in tasksplugin.ts, with two counted exceptions until step 9. Receiver types
 * must name the App class in Obsidian's typings, inherit it, or contain it in a union or intersection. Structural
 * lookalikes and any do not count. Comments in the checked files also have a budget for @ts-expect-error.
 * scripts/private-api.mjs runs it on the plugin; the tests import it.
 */
import path from "path";
import ts from "typescript";

// Step 9 makes this exactly 1, in tasksplugin.ts.
export const MAX_TS_EXPECT_ERROR = 3;

// Step 9 deletes this list: the pencil's visibility and edit-task command move into tasksplugin.ts.
export const STEP_8_ALLOW = [
	{ file: "timeline/src/obsidianbridge.tsx", name: "plugins", count: 1 },
	{ file: "timeline/src/obsidianbridge.tsx", name: "commands", count: 1 },
];

const PRIVATE_NAMES = new Set(["commands", "plugins", "internalPlugins"]);
const relativeFile = (fileName, relativeTo) => path.relative(relativeTo, fileName).replaceAll("\\", "/");

/** Only the plugin's own source, even when the program reaches other workspace packages. */
export function isPluginSourceFile(fileName, relativeTo) {
	const file = relativeFile(fileName, relativeTo);
	return (
		file !== ".." &&
		!file.startsWith("../") &&
		!path.isAbsolute(file) &&
		!/\.d\.[cm]?ts$/.test(file) &&
		!file.split("/").some((part) => ["node_modules", "scripts", "tests"].includes(part))
	);
}

/** App identity comes from its declaration, not the spelling of a local class or a compatible object shape. */
function containsApp(type, checker, seen = new Set()) {
	if (seen.has(type)) return false;
	seen.add(type);
	if (type.isUnionOrIntersection()) return type.types.some((part) => containsApp(part, checker, seen));
	if (type.flags & ts.TypeFlags.TypeParameter) {
		const constraint = checker.getBaseConstraintOfType(type);
		return constraint ? containsApp(constraint, checker, seen) : false;
	}
	if (type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference && type.target !== type)
		return containsApp(type.target, checker, seen);
	if (!(type.flags & ts.TypeFlags.Object) || !(type.objectFlags & ts.ObjectFlags.ClassOrInterface)) return false;
	if (
		type
			.getSymbol()
			?.declarations?.some(
				(declaration) =>
					ts.isClassDeclaration(declaration) &&
					declaration.name?.text === "App" &&
					/[\\/]obsidian[\\/]obsidian\.d\.ts$/.test(declaration.getSourceFile().fileName),
			)
	)
		return true;
	return checker.getBaseTypes(type).some((base) => containsApp(base, checker, seen));
}

/** Token boundaries locate comments without treating strings, template text, regexes or JSX text as comments. */
function expectErrorPlaces(sourceFile, file) {
	const comments = new Map();
	const collect = (ranges) => {
		for (const range of ranges ?? []) comments.set(range.pos, range);
	};
	const visit = (node) => {
		for (const position of [node.pos, node.end]) {
			collect(ts.getLeadingCommentRanges(sourceFile.text, position));
			collect(ts.getTrailingCommentRanges(sourceFile.text, position));
		}
		for (const child of node.getChildren(sourceFile)) visit(child);
	};
	visit(sourceFile);
	const places = [];
	for (const { pos, end } of [...comments.values()].sort((a, b) => a.pos - b.pos)) {
		for (const match of sourceFile.text.slice(pos, end).matchAll(/@ts-expect-error\b/g)) {
			const { line } = sourceFile.getLineAndCharacterOfPosition(pos + match.index);
			places.push({ file, line: line + 1 });
		}
	}
	return places;
}

/** Private accesses and an exceeded comment budget, with plugin-relative paths and lines from 1. */
export function privateApiViolations(program, { isPluginFile, relativeTo, allow = STEP_8_ALLOW }) {
	const checker = program.getTypeChecker();
	const violations = [];
	const tsExpectErrors = [];
	const remaining = allow.map((entry) => ({ ...entry }));
	for (const sourceFile of program.getSourceFiles()) {
		if (
			sourceFile.isDeclarationFile ||
			!isPluginSourceFile(sourceFile.fileName, relativeTo) ||
			!isPluginFile(sourceFile.fileName)
		)
			continue;
		const file = relativeFile(sourceFile.fileName, relativeTo);
		tsExpectErrors.push(...expectErrorPlaces(sourceFile, file));
		if (file === "timeline/src/tasksplugin.ts") continue;
		const visit = (node) => {
			const name = ts.isPropertyAccessExpression(node)
				? node.name.text
				: ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
					? node.argumentExpression.text
					: null;
			if (PRIVATE_NAMES.has(name) && containsApp(checker.getTypeAtLocation(node.expression), checker)) {
				const allowed = remaining.find(
					(entry) => entry.file === file && entry.name === name && entry.count > 0,
				);
				if (allowed) allowed.count--;
				else {
					const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
					violations.push({
						file,
						line: line + 1,
						name,
						message: `private API app.${name} at ${file}:${line + 1}`,
					});
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	if (tsExpectErrors.length > MAX_TS_EXPECT_ERROR) {
		violations.push({
			...tsExpectErrors[0],
			name: "@ts-expect-error",
			message: `${tsExpectErrors.length} @ts-expect-error comments exceed the maximum ${MAX_TS_EXPECT_ERROR}: ${tsExpectErrors.map(({ file, line }) => `${file}:${line}`).join(", ")}`,
		});
	}
	return { violations, tsExpectErrors };
}
