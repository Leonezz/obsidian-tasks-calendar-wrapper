import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TOUCH_TARGETS } from "../scripts/screenshots-mobile.mjs";
import { cssRules } from "./css-rules";

const whitespace = (text: string) => text.replace(/\s+/g, " ").trim();

function expandedSelectors(selector: string): string[] {
	const group = /:is\(([^()]*)\)/.exec(selector);
	if (!group) return [whitespace(selector.replace(/\s*>\s*/g, " > "))];
	return group[1].split(",").flatMap((part) => expandedSelectors(selector.replace(group[0], part.trim())));
}

function properties(body: string): string[] {
	return body
		.split(";")
		.map((declaration) => declaration.split(":")[0].trim())
		.filter(Boolean);
}

const declarations = (body: string) =>
	body.split(";").flatMap((declaration) => {
		const colon = declaration.indexOf(":");
		return colon < 0
			? []
			: [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()] as [string, string]];
	});

function timelineTokens(): Map<string, string> {
	return new Map(
		cssRules(readFileSync("styles.css", "utf8"))
			.filter(({ selectors }) => selectors.includes(".taskido"))
			.flatMap(({ body }) => declarations(body).filter(([name]) => name.startsWith("--tcw-"))),
	);
}

/** Walk complete var() expressions, including nested fallbacks. */
function replaceTokens(
	value: string,
	replace: (name: string, fallback: string | undefined, reference: string) => string,
): string {
	const pattern = /var\(\s*(--tcw-[\w-]+)/g;
	let result = "";
	let cursor = 0;
	for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
		let end = match.index + 4;
		let depth = 1;
		while (end < value.length && depth > 0) {
			if (value[end] === "(") depth++;
			if (value[end] === ")") depth--;
			end++;
		}
		assert.equal(depth, 0, value);
		const comma = value.slice(match.index + 4, end - 1).indexOf(",");
		const fallback = comma < 0 ? undefined : value.slice(match.index + 4 + comma + 1, end - 1).trim();
		result += value.slice(cursor, match.index) + replace(match[1], fallback, value.slice(match.index, end));
		cursor = end;
		pattern.lastIndex = end;
	}
	return result + value.slice(cursor);
}

/** Resolve plugin defaults while leaving the original variables at their consuming element. */
function resolvedTokens(value: string, tokens = timelineTokens(), seen: readonly string[] = []): string {
	return replaceTokens(value, (name, fallback, reference) => {
		const token = tokens.get(name);
		if (token === undefined || token === "initial")
			return fallback === undefined ? reference : resolvedTokens(fallback, tokens, seen);
		assert.ok(!seen.includes(name), `token cycle: ${[...seen, name].join(" -> ")}`);
		return resolvedTokens(token, tokens, [...seen, name]);
	});
}

test("status colors, spacing and badge tokens preserve their initial values", () => {
	const tokens = timelineTokens();
	for (const name of ["warning", "focus", "focus-hsl", "overdue", "done", "process"])
		assert.equal(tokens.get(`--tcw-color-${name}`), "initial", name);
	for (const [name, value] of Object.entries({
		"--tcw-color-shadow": "rgba(0, 0, 0, 0.1)",
		"--tcw-space-1": "2px",
		"--tcw-space-2": "3px",
		"--tcw-space-3": "5px",
		"--tcw-space-4": "10px",
		"--tcw-space-5": "20px",
		"--tcw-strip-width": "50px",
		"--tcw-radius-badge": "10px",
		"--tcw-row-line-height": "22px",
		"--tcw-badge-bg": "none",
	}))
		assert.equal(resolvedTokens(`var(${name})`, tokens), value, name);
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	const legacy = new Map(
		rules.filter(({ selectors }) => selectors.includes(".taskido")).flatMap(({ body }) => declarations(body)),
	);
	assert.equal(legacy.get("--taskido-color-warning"), "var(--color-red)");
	assert.equal(legacy.get("--taskido-color-focus"), "var(--text-accent, var(--interactive-accent))");
	assert.equal(legacy.get("--taskido-color-focus-hsl"), "var(--interactive-accent-hsl)");
	assert.equal(legacy.get("--taskido-color-overdue"), "var(--taskido-color-warning)");
	assert.equal(legacy.get("--taskido-color-done"), "var(--color-green)");
	assert.equal(legacy.get("--taskido-color-process"), "var(--color-orange)");
});

test("live legacy and Obsidian defaults resolve on their consuming element", () => {
	const defaults = new Map(
		Object.entries({
			"--tcw-color-warning": "var(--taskido-color-warning)",
			"--tcw-color-focus": "var(--taskido-color-focus)",
			"--tcw-color-focus-hsl": "var(--taskido-color-focus-hsl)",
			"--tcw-color-overdue": "var(--taskido-color-overdue)",
			"--tcw-color-done": "var(--taskido-color-done)",
			"--tcw-color-process": "var(--taskido-color-process)",
			"--tcw-color-text": "var(--text-normal)",
			"--tcw-color-muted": "var(--text-muted)",
			"--tcw-color-faint": "var(--text-faint)",
			"--tcw-color-link": "var(--text-accent, var(--interactive-accent))",
			"--tcw-color-hover-bg": "var(--background-modifier-hover)",
			"--tcw-color-border": "var(--background-modifier-border)",
			"--tcw-color-checkbox-border": "var(--checkbox-border-color)",
			"--tcw-color-checkbox-hover": "var(--checkbox-border-color-hover)",
			"--tcw-control-bg": "var(--interactive-normal)",
			"--tcw-control-shadow": "var(--input-shadow)",
			"--tcw-control-border-width": "var(--input-border-width)",
			"--tcw-entry-bg": "var(--background-modifier-form-field)",
			"--tcw-option-bg": "var(--background-primary)",
			"--tcw-checkbox-size": "var(--checkbox-size)",
			"--tcw-badge-fg": "var(--tcw-color-muted, var(--text-muted))",
			"--tcw-support-gap": "var(--size-4-2)",
			"--tcw-support-margin": "var(--size-4-4)",
		}),
	);
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	for (const [token] of defaults) {
		const definitions = rules.flatMap(({ body }) => declarations(body).filter(([name]) => name === token));
		assert.ok(definitions.length > 0, token);
		assert.ok(
			definitions.every(([, value]) => value === "initial"),
			`${token} must not capture an ancestor's value`,
		);
	}
	for (const { selectors, body } of rules) {
		for (const [property, value] of declarations(body).filter(([name]) => !name.startsWith("--"))) {
			replaceTokens(value, (name, fallback, reference) => {
				const expected =
					name === "--tcw-color-warning" && selectors.includes(".tasks-calendar-wrapper-setting-warning")
						? "var(--text-error)"
						: defaults.get(name);
				if (expected !== undefined)
					assert.equal(whitespace(fallback ?? ""), expected, `${selectors}: ${property}: ${name}`);
				return reference;
			});
		}
	}
	const muted = rules.find(
		({ selectors, body }) =>
			selectors.includes(".taskido .task .info .tag") && /color: var\(--tcw-badge-fg/.test(body),
	);
	assert.ok(muted);
	assert.match(muted.body, /color:\s*var\(--tcw-badge-fg,\s*var\(--tcw-color-muted,\s*var\(--text-muted\)\)\)/);
});

test("color literals occur only in scoped token definitions", () => {
	for (const { selectors, body } of cssRules(readFileSync("styles.css", "utf8"))) {
		for (const [name, value] of declarations(body)) {
			if (name.startsWith("--tcw-")) continue;
			assert.doesNotMatch(
				value,
				/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/i,
				`${selectors}: ${name}`,
			);
			if (!name.startsWith("--"))
				for (const [, variable] of replaceTokens(value, () => "").matchAll(/var\(\s*(--[\w-]+)/g))
					assert.ok(
						variable.startsWith("--tcw-") ||
							["--task-color", "--tag-color", "--tag-background"].includes(variable),
						`${selectors}: ${name}: ${variable}`,
					);
			if (/^(?:color|background(?:-color)?|stroke|fill)$/.test(name) && !name.startsWith("--"))
				assert.ok(
					/^(?:var\(|inherit$|currentColor$|transparent$|none$)/i.test(value),
					`${selectors}: ${name}: ${value}`,
				);
		}
	}
});

test("pixel literals outside token definitions are limited to glyphs, fine lines and zero", () => {
	const allowed = new Map([
		[".taskido .tcw-sr-only", new Set(["1px", "-1px"])],
		[".taskido .timeline .icon svg", new Set(["1.75px"])],
		[".taskido .info svg", new Set(["12px", "1.75px"])],
		[".taskido .quickEntryPanel svg", new Set(["15px", "1.75px"])],
	]);
	for (const { selectors, body } of cssRules(readFileSync("styles.css", "utf8"))) {
		for (const [name, value] of declarations(body)) {
			if (name.startsWith("--tcw-")) continue;
			for (const [literal] of value.matchAll(/-?\d+(?:\.\d+)?px\b/g))
				for (const selector of selectors)
					assert.ok(
						literal === "0px" || allowed.get(selector)?.has(literal),
						`${selector}: ${name}: ${literal}`,
					);
		}
	}
});

test("every tcw token reference is defined in a scoped rule or by the day component", () => {
	const css = readFileSync("styles.css", "utf8");
	const rules = cssRules(css);
	const definitions = new Set<string>();
	const scopes = new Set([
		".taskido",
		".is-mobile .taskido",
		".tasks-calendar-wrapper-settings",
		".tasks-calendar-wrapper-setting-warning",
		".tasks-calendar-wrapper-whats-new",
	]);
	for (const { selectors, body } of rules) {
		for (const [name] of declarations(body).filter(([name]) => name.startsWith("--tcw-"))) {
			assert.ok(
				selectors.every((selector) => scopes.has(selector)),
				`${name}: ${selectors}`,
			);
			definitions.add(name);
		}
	}
	assert.match(readFileSync("../../packages/ui/src/timeline/Day.tsx", "utf8"), /"--tcw-day-estimate"\s*:/);
	definitions.add("--tcw-day-estimate");
	for (const [, name] of css.matchAll(/var\(\s*(--tcw-[\w-]+)/g)) assert.ok(definitions.has(name), name);
	for (const name of timelineTokens().keys()) resolvedTokens(`var(${name})`);
});

test("the tag stack level and file option wrapping moved from inline styles without changing values", () => {
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	assert.ok(
		rules.some(
			({ selectors, body }) =>
				selectors.includes(".taskido a.tag") &&
				declarations(body).some(([name, value]) => name === "z-index" && value === "9999"),
		),
	);
	assert.ok(
		rules.some(
			({ selectors, body }) =>
				selectors.includes(".taskido .quickEntryPanel .fileSelect option") &&
				declarations(body).some(([name, value]) => name === "white-space" && value === "nowrap"),
		),
	);
});

test("content-visibility is set only on the skipped day's selector", () => {
	const selectors = cssRules(readFileSync("styles.css", "utf8"))
		.filter(({ body }) => /(^|[;\s])content-visibility\s*:/.test(body))
		.flatMap(({ selectors }) => selectors);
	assert.deepEqual([...new Set(selectors)].sort(), [".taskido .details.tcw-day"]);
});

test("the focus ring is drawn only on :focus-visible from --tcw-focus-ring", () => {
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	const scoped = rules.filter(({ selectors }) => selectors.some((selector) => /\.taskido\b/.test(selector)));
	assert.deepEqual(
		scoped.flatMap(({ selectors }) => selectors.filter((selector) => /:focus(?!-visible)/.test(selector))),
		[],
		"timeline focus styles must use :focus-visible, never :focus",
	);
	assert.ok(
		rules.some(
			({ selectors, body }) =>
				selectors.includes(".taskido") &&
				/(?:^|[;\s])--tcw-focus-ring\s*:[^;{}]*var\(\s*--interactive-accent\s*\)/.test(body),
		),
		".taskido must define --tcw-focus-ring from var(--interactive-accent)",
	);
	assert.ok(
		scoped.some(
			({ selectors, body }) =>
				selectors.some((selector) => selector.includes(":focus-visible")) &&
				/(?:^|[;\s])outline\s*:[^;{}]*var\(\s*--tcw-focus-ring\s*\)/.test(body),
		),
		"a timeline :focus-visible outline must use var(--tcw-focus-ring)",
	);
});

test("every :hover rule is inside @media (hover: hover)", () => {
	const hover = cssRules(readFileSync("styles.css", "utf8")).filter(({ selectors }) =>
		selectors.some((selector) => selector.includes(":hover")),
	);
	assert.ok(hover.length > 0, "the stylesheet must keep its hover rules");
	for (const { selectors, atRules } of hover) {
		assert.ok(
			atRules?.some((rule) => /^@media\s+\(\s*hover\s*:\s*hover\s*\)$/.test(rule)),
			`${selectors.join(", ")} must be inside @media (hover: hover)`,
		);
	}
});

test("every touch target gets --tcw-touch-target only under .is-mobile", () => {
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	const definitions = rules.filter(({ body }) => /(?:^|[;\s])--tcw-touch-target\s*:/.test(body));
	assert.equal(definitions.length, 1, "--tcw-touch-target must be defined in exactly one rule");
	assert.deepEqual(definitions[0].selectors, [".is-mobile .taskido"]);
	assert.match(definitions[0].body, /(?:^|[;\s])--tcw-touch-target\s*:\s*44px\s*(?:;|$)/);
	for (const { selectors, body } of rules) {
		if (!body.includes("--tcw-touch-target")) continue;
		for (const selector of selectors) {
			assert.ok(selector.startsWith(".is-mobile "), `${selector} must scope --tcw-touch-target to mobile`);
		}
	}
	const sized = rules
		.filter(({ body }) => /var\(\s*--tcw-touch-target\s*\)/.test(body))
		.flatMap(({ selectors }) => selectors)
		.filter((selector) => selector.startsWith(".is-mobile "))
		.flatMap((selector) => expandedSelectors(selector.slice(".is-mobile ".length)));
	for (const target of TOUCH_TARGETS) {
		for (const selector of expandedSelectors(`.taskido ${target.selector}`)) {
			assert.ok(
				sized.includes(selector),
				`${target.name}: ${selector} must use var(--tcw-touch-target) on mobile`,
			);
		}
	}
});

test("info-line touch targets keep their 44 px boxes inside the line on mobile", () => {
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	const problems: string[] = [];
	for (const { selectors, body } of rules) {
		for (const selector of selectors.flatMap(expandedSelectors)) {
			if (
				!selector.startsWith(".is-mobile ") ||
				!/(?:a\.(?:menu|modify)\b|\.info > \.(?:tag|relative|repeat|priority|file)\b)/.test(selector)
			)
				continue;
			for (const declaration of body.split(";")) {
				const [name, value] = declaration.split(":").map((part) => part.trim());
				if (name.startsWith("margin") && !/^0(?:\s+0){0,3}$/.test(value))
					problems.push(`${selector}: ${name}: ${value} must use only zero margins`);
			}
		}
	}
	const strip = rules.filter(({ selectors }) =>
		selectors.flatMap(expandedSelectors).includes(".is-mobile .taskido .task .timeline label.icon"),
	);
	if (!strip.some(({ body }) => /(?:^|[;\s])position\s*:\s*relative\s*(?:;|$)/.test(body)))
		problems.push("the mobile strip label.icon must declare position: relative");
	if (!strip.some(({ body }) => /(?:^|[;\s])z-index\s*:\s*[1-9]\d*\s*(?:;|$)/.test(body)))
		problems.push("the mobile strip label.icon must declare a positive z-index");
	assert.deepEqual(
		problems,
		[],
		"mobile info targets must retain their boxes and the strip must stay above its line",
	);
});

test("a mobile row is at least one touch target tall, so neighbouring checkbox targets do not overlap", () => {
	const rows = cssRules(readFileSync("styles.css", "utf8")).filter(({ selectors }) =>
		selectors.flatMap(expandedSelectors).includes(".is-mobile .taskido .task"),
	);
	assert.ok(
		rows.some(({ body }) => /(?:^|[;\s])min-height\s*:\s*var\(--tcw-touch-target\)\s*(?:;|$)/.test(body)),
		"a one-line row (noInfo) must be as tall as the strip checkbox's target",
	);
});

test("mobile rules do not change glyph sizes or the strip width", () => {
	const rules = cssRules(readFileSync("styles.css", "utf8"));
	for (const { selectors, body } of rules) {
		for (const selector of selectors.filter((selector) => selector.includes(".is-mobile"))) {
			const names = properties(body);
			assert.deepEqual(
				names.filter((name) => ["font-size", "line-height", "scale", "transform"].includes(name)),
				[],
				`${selector} must preserve glyph sizes`,
			);
			for (const expanded of expandedSelectors(selector)) {
				const element = expanded.split(/[\s>+~]+/).pop() ?? "";
				if (
					/(?:^|[^\w-])svg\b/.test(element) ||
					(/\.icon\b/.test(element) && !/^label\.icon\b/.test(element))
				) {
					assert.deepEqual(
						names.filter((name) => /^(?:(?:min|max)-)?(?:width|height)$/.test(name)),
						[],
						`${selector} must not resize a glyph`,
					);
				}
				if (/\.timeline\b/.test(element))
					assert.ok(!names.includes("width"), `${selector} must not resize the strip`);
			}
		}
	}
	assert.ok(
		rules.some(
			({ selectors, body }) =>
				selectors.includes(".taskido .timeline") &&
				/(?:^|[;\s])width\s*:\s*50px\s*(?:;|$)/.test(resolvedTokens(body)),
		),
		"the timeline strip must stay 50px wide",
	);
});

test("the hover rules keep their selectors and declarations", () => {
	const hover = cssRules(readFileSync("styles.css", "utf8"))
		.filter(({ selectors }) => selectors.some((selector) => selector.includes(":hover")))
		.map(({ selectors, body }) => ({ selectors, body: whitespace(resolvedTokens(body)) }));
	assert.deepEqual(hover, [
		{
			selectors: [".taskido .timeline .icon svg:hover"],
			body: whitespace(`
	color: var(--checkbox-border-color-hover);
	scale: 1.3;
`),
		},
		{
			selectors: [".taskido .quickEntryPanel select:hover", ".taskido .quickEntryPanel button:hover"],
			body: whitespace(`
	color: var(--text-normal);
`),
		},
		{
			selectors: [".taskido .task:hover"],
			body: whitespace(`
	background: var(--background-modifier-hover);
`),
		},
	]);
});
