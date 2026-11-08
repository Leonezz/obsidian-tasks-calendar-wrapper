import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cssRules } from "./css-rules";

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
