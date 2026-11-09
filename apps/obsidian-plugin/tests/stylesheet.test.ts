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
				selectors.includes(".taskido .timeline") && /(?:^|[;\s])width\s*:\s*50px\s*(?:;|$)/.test(body),
		),
		"the timeline strip must stay 50px wide",
	);
});

test("the hover rules keep their selectors and declarations", () => {
	const hover = cssRules(readFileSync("styles.css", "utf8"))
		.filter(({ selectors }) => selectors.some((selector) => selector.includes(":hover")))
		.map(({ selectors, body }) => ({ selectors, body: whitespace(body) }));
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
