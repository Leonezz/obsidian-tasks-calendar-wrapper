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
