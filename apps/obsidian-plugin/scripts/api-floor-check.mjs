/**
 * The API floor check: the plugin may use an Obsidian API newer than the oldest Obsidian it supports only behind
 * requireApiVersion. It reads the `@since` tag Obsidian's typings give each declaration and finds every place in the
 * plugin's own code that uses, at run time, a declaration of the obsidian module newer than the floor, unless that place
 * runs only when requireApiVersion has said the running Obsidian is new enough:
 * - inside `if (requireApiVersion("x"))`, or the else of `if (!requireApiVersion("x"))`;
 * - after `if (!requireApiVersion("x")) return;` (or throw, continue, break) in the same block;
 * - on the right of `requireApiVersion("x") &&`, or in the true branch of `requireApiVersion("x") ? … : …`;
 * where x is the declaration's version or newer. A condition may join several such calls with &&. A gate around a
 * function's definition holds in its body too, as the running Obsidian does not change. A use in a type alone needs
 * no gate, as types do not exist at run time. A declaration without `@since` is taken to be as old as any floor.
 *
 * scripts/api-floor.mjs runs it on the plugin; the tests import it.
 */
import ts from "typescript";

/** Compares dotted version numbers such as 1.11.4 by value; a suffix after a hyphen is ignored. */
export function compareVersions(a, b) {
	const pa = a.split("-")[0].split(".").map(Number);
	const pb = b.split("-")[0].split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

const isObsidianTypings = (fileName) => /[\\/]obsidian[\\/]obsidian\.d\.ts$/.test(fileName);

/** The newest `@since` of the symbol's declarations in Obsidian's typings, or null when it has none there. */
function sinceOf(symbol) {
	let newest = null;
	for (const declaration of symbol.declarations ?? []) {
		if (!isObsidianTypings(declaration.getSourceFile().fileName)) continue;
		for (const tag of ts.getJSDocTags(declaration)) {
			if (tag.tagName.text !== "since") continue;
			const text = (
				typeof tag.comment === "string" ? tag.comment : (ts.getTextOfJSDocComment(tag.comment) ?? "")
			).trim();
			const version = /^\d+(\.\d+)*/.exec(text)?.[0];
			if (version && (newest === null || compareVersions(version, newest) > 0)) newest = version;
		}
	}
	return newest;
}

/** The versions a condition requires when it is true: the requireApiVersion("x") calls it joins with &&. */
function requiredWhenTrue(expression, isRequireApiVersion) {
	const node = skipParentheses(expression);
	if (ts.isCallExpression(node) && isRequireApiVersion(node.expression) && node.arguments.length === 1) {
		const [argument] = node.arguments;
		return ts.isStringLiteralLike(argument) ? [argument.text] : [];
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
		return [
			...requiredWhenTrue(node.left, isRequireApiVersion),
			...requiredWhenTrue(node.right, isRequireApiVersion),
		];
	}
	return [];
}

/** The versions a condition requires when it is false: those of `!requireApiVersion("x")`. */
function requiredWhenFalse(expression, isRequireApiVersion) {
	const node = skipParentheses(expression);
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
		return requiredWhenTrue(node.operand, isRequireApiVersion);
	}
	return [];
}

function skipParentheses(node) {
	return ts.isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;
}

/** Whether running the statement never goes on to the statement after it. */
function leaves(statement) {
	if (ts.isBlock(statement)) return statement.statements.some(leaves);
	return (
		ts.isReturnStatement(statement) ||
		ts.isThrowStatement(statement) ||
		ts.isContinueStatement(statement) ||
		ts.isBreakStatement(statement)
	);
}

/** The versions the code around the node has made sure of when the node runs. */
function guaranteedAt(node, isRequireApiVersion) {
	const versions = [];
	let child = node;
	for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
		if (ts.isIfStatement(parent)) {
			if (child === parent.thenStatement)
				versions.push(...requiredWhenTrue(parent.expression, isRequireApiVersion));
			if (child === parent.elseStatement)
				versions.push(...requiredWhenFalse(parent.expression, isRequireApiVersion));
		} else if (ts.isConditionalExpression(parent)) {
			if (child === parent.whenTrue) versions.push(...requiredWhenTrue(parent.condition, isRequireApiVersion));
			if (child === parent.whenFalse) versions.push(...requiredWhenFalse(parent.condition, isRequireApiVersion));
		} else if (
			ts.isBinaryExpression(parent) &&
			parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
			child === parent.right
		) {
			versions.push(...requiredWhenTrue(parent.left, isRequireApiVersion));
		} else if (
			ts.isBlock(parent) ||
			ts.isSourceFile(parent) ||
			ts.isModuleBlock(parent) ||
			ts.isCaseClause(parent)
		) {
			// `if (!requireApiVersion("x")) return;` before the statement in the same block.
			for (const statement of parent.statements) {
				if (statement === child) break;
				if (ts.isIfStatement(statement) && !statement.elseStatement && leaves(statement.thenStatement)) {
					versions.push(...requiredWhenFalse(statement.expression, isRequireApiVersion));
				}
			}
		}
	}
	return versions;
}

/** The declarations whose own name is no use of what it names, such as a method that overrides a newer hook. */
const OWN_DECLARATIONS = new Set([
	ts.SyntaxKind.ClassDeclaration,
	ts.SyntaxKind.EnumMember,
	ts.SyntaxKind.FunctionDeclaration,
	ts.SyntaxKind.GetAccessor,
	ts.SyntaxKind.InterfaceDeclaration,
	ts.SyntaxKind.MethodDeclaration,
	ts.SyntaxKind.MethodSignature,
	ts.SyntaxKind.Parameter,
	ts.SyntaxKind.PropertyAssignment,
	ts.SyntaxKind.PropertyDeclaration,
	ts.SyntaxKind.PropertySignature,
	ts.SyntaxKind.SetAccessor,
	ts.SyntaxKind.TypeAliasDeclaration,
	ts.SyntaxKind.VariableDeclaration,
]);

/** Whether the identifier does not run: in a type, an import or export, or the name of a declaration of the plugin's. */
function notARunTimeUse(identifier) {
	const parent = identifier.parent;
	if (ts.isPartOfTypeNode(identifier)) return true;
	if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
	if (ts.isExportSpecifier(parent)) return true;
	// `implements X` and an interface's `extends X` name types; a class's `extends X` runs.
	if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent)) {
		return (
			parent.parent.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(parent.parent.parent)
		);
	}
	return OWN_DECLARATIONS.has(parent.kind) && parent.name === identifier;
}

/**
 * The run-time uses of declarations of Obsidian's typings newer than the floor that no requireApiVersion gates, in the
 * given files of the program, each as { file, line, column, name, since }.
 */
export function apiFloorViolations(program, floor, isPluginFile) {
	const checker = program.getTypeChecker();
	const isRequireApiVersion = (expression) => {
		const symbol = checker.getSymbolAtLocation(expression);
		const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
		return (
			target?.name === "requireApiVersion" &&
			(target.declarations ?? []).some((d) => isObsidianTypings(d.getSourceFile().fileName))
		);
	};
	const violations = [];
	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile || !isPluginFile(sourceFile.fileName)) continue;
		const visit = (node) => {
			if (ts.isIdentifier(node) && !notARunTimeUse(node)) {
				let symbol = checker.getSymbolAtLocation(node);
				if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
				const since = symbol ? sinceOf(symbol) : null;
				if (since !== null && compareVersions(since, floor) > 0) {
					const gated = guaranteedAt(node, isRequireApiVersion).some((v) => compareVersions(v, since) >= 0);
					if (!gated) {
						const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
						violations.push({
							file: sourceFile.fileName,
							line: line + 1,
							column: character + 1,
							name: node.text,
							since,
						});
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return violations;
}
