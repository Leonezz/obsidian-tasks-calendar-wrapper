import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeHeaderForLink } from "../dataview-util/dataview";

test("header normalization keeps emoji, letters and digits", () => {
    assert.equal(normalizeHeaderForLink("📅 Plan: week 38"), "📅 Plan week 38");
});

test("header normalization keeps multi-codepoint emoji intact", () => {
    assert.equal(normalizeHeaderForLink("👩‍💻 Work / 🇨🇳 Trip"), "👩‍💻 Work 🇨🇳 Trip");
});

test("header normalization collapses whitespace and punctuation", () => {
    assert.equal(normalizeHeaderForLink("  Tasks -- (done)  "), "Tasks -- done");
});
