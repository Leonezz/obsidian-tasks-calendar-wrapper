import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function sources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) ? [file] : [];
	});
}

/** Follow local style-object assignments too, so style={style} cannot hide a normal CSS property. */
function inlineStyleProblems(source: string, file = "fixture.tsx"): string[] {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const problems: string[] = [];
	function unwrap(expression: ts.Expression): ts.Expression {
		while (
			ts.isAsExpression(expression) ||
			ts.isTypeAssertionExpression(expression) ||
			ts.isParenthesizedExpression(expression) ||
			ts.isSatisfiesExpression(expression)
		)
			expression = expression.expression;
		return expression;
	}
	function check(expression: ts.Expression): void {
		const value = unwrap(expression);
		if (ts.isConditionalExpression(value)) {
			check(value.whenTrue);
			check(value.whenFalse);
			return;
		}
		if ((ts.isIdentifier(value) && value.text === "undefined") || value.kind === ts.SyntaxKind.NullKeyword) return;
		if (!ts.isObjectLiteralExpression(value)) {
			problems.push(`${file}: inline style must be an explicit custom-property object: ${value.getText(parsed)}`);
			return;
		}
		for (const property of value.properties) {
			const name = ts.isPropertyAssignment(property) ? property.name : undefined;
			if (!name || !ts.isStringLiteral(name) || !name.text.startsWith("--")) {
				const { line } = parsed.getLineAndCharacterOfPosition(property.getStart(parsed));
				problems.push(`${file}:${line + 1}: ${property.getText(parsed)}`);
			}
		}
	}
	function style(expression: ts.Expression): void {
		const value = unwrap(expression);
		if (!ts.isIdentifier(value)) return check(value);
		let assignments = 0;
		const isStyle = (expression: ts.Expression) => {
			const target = unwrap(expression);
			return ts.isIdentifier(target) && target.text === value.text;
		};
		const isMember = (expression: ts.Expression) => {
			const target = unwrap(expression);
			return (
				(ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) &&
				isStyle(target.expression)
			);
		};
		function find(node: ts.Node): void {
			if (
				(ts.isBinaryExpression(node) &&
					node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
					node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
					isMember(node.left)) ||
				((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
					[ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
					isMember(node.operand)) ||
				(ts.isDeleteExpression(node) && isMember(node.expression)) ||
				(ts.isCallExpression(node) &&
					ts.isPropertyAccessExpression(node.expression) &&
					node.expression.expression.getText(parsed) === "Object" &&
					["assign", "defineProperty", "defineProperties"].includes(node.expression.name.text) &&
					node.arguments[0] &&
					isStyle(node.arguments[0]))
			)
				problems.push(`${file}: do not mutate inline-style object members: ${node.getText(parsed)}`);
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.name.text === value.getText(parsed) &&
				node.initializer
			) {
				assignments++;
				check(node.initializer);
			} else if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isIdentifier(node.left) &&
				node.left.text === value.getText(parsed)
			) {
				assignments++;
				check(node.right);
			}
			ts.forEachChild(node, find);
		}
		find(parsed);
		if (assignments === 0) problems.push(`${file}: cannot inspect inline style ${value.text}`);
	}
	function visit(node: ts.Node): void {
		if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "style") {
			if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression)
				style(node.initializer.expression);
			else problems.push(`${file}: inline style must use a custom-property object`);
		}
		ts.forEachChild(node, visit);
	}
	visit(parsed);
	return problems;
}

test("components set only custom properties in inline styles", () => {
	const files = sources("src");
	assert.ok(files.length > 0);
	assert.deepEqual(
		files.flatMap((file) => inlineStyleProblems(readFileSync(file, "utf8"), file)),
		[],
	);
});

test("the inline-style check rejects ordinary CSS properties and unresolved style objects", () => {
	for (const source of [
		'const row = <div style={{ color: "red" }} />;',
		'const row = <div style={{ "--task-color": color, zIndex: 9999 }} />;',
		'const style = { whiteSpace: "nowrap" }; const row = <option style={style} />;',
		'let style; if (color) style = { "--tag-color": color }; else style = { zIndex: 9999 }; const row = <a style={style} />;',
		'const style = { "--tag-color": color }; style.zIndex = 9999; const row = <a style={style} />;',
		'const style = { "--tag-color": color }; style["zIndex"] = 9999; const row = <a style={style} />;',
		'const style = { "--tag-color": color }; style.zIndex += 1; const row = <a style={style} />;',
		'const style = { "--tag-color": color }; style.zIndex++; const row = <a style={style} />;',
		'const style = { "--tag-color": color }; delete style.zIndex; const row = <a style={style} />;',
		'const style = { "--tag-color": color }; Object.assign(style, { zIndex: 9999 }); const row = <a style={style} />;',
		'const style = { "--tag-color": color }; Object.defineProperty(style, "zIndex", { value: 9999 }); const row = <a style={style} />;',
		"const row = <div style={{ ...unknown }} />;",
		"const row = <div style={unknown} />;",
		'const row = <div style="color: red" />;',
	])
		assert.ok(inlineStyleProblems(source).length > 0, source);
	assert.deepEqual(
		inlineStyleProblems(
			'let style; if (color) style = { "--tag-color": color }; else style = { "--tag-color": "var(--text-muted)" }; const row = <a style={style} />; const task = <div style={shown ? { "--task-color": color } as React.CSSProperties : undefined} />;',
		),
		[],
	);
});
