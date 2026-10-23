import { test } from "node:test";
import assert from "node:assert/strict";

import { contentIdOf } from "../utils/contentid";

// The id the plugin keeps of a warned note's text, to tell a note read again with the same content.

test("the same text gives the same id, a safe integer, every time", () => {
	const text = "- [ ] pay the rent [due:: soon]\n- [ ] and this [scheduled:: later]";
	assert.equal(contentIdOf(text), contentIdOf(String(text)));
	assert.ok(Number.isSafeInteger(contentIdOf(text)) && contentIdOf(text) >= 0);
	// Pinned, so a change of the hash, which would tell every warning again once after an update, is seen.
	assert.equal(contentIdOf(""), 3338908027751811);
	assert.equal(contentIdOf("a"), 7929297801672961);
});

test("texts that differ by a space, an order, one unit in 10,000 or a surrogate pair give other ids", () => {
	const long = "x".repeat(10_000);
	const pairs: [string, string][] = [
		["", " "],
		["ab", "ba"],
		[long, long.slice(0, 5_000) + "y" + long.slice(5_001)],
		["- [ ] 😀", "- [ ] 😁"],
		["- [ ] a\n", "- [ ] a\r\n"],
	];
	for (const [a, b] of pairs)
		assert.notEqual(contentIdOf(a), contentIdOf(b), JSON.stringify([a.slice(0, 20), b.slice(0, 20)]));
});
