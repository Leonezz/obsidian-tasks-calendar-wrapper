import { test } from "node:test";
import assert from "node:assert/strict";

import { createEmojiMatcher, normalizeHeaderForLink } from "../dataview-util/dataview";

/** Stands in for an engine without the regex `v` flag, such as iOS before 17 or Chromium before 112. */
const withoutVFlag = (source: string, flags: string) => {
    if (flags.includes("v")) throw new SyntaxError(`Invalid flags supplied to RegExp constructor '${flags}'`);
    return new RegExp(source, flags);
};

const emojiSamples = [
    "📅", "👍", "👍🏽", "☝🏽", "❤️", "❤️‍🔥", "👩‍💻", "🧑🏽‍💻", "🏃🏽‍♀️", "👨‍👩‍👧‍👦", "🏳️‍🌈", "🇨🇳", "🇺🇸", "1️⃣", "#️⃣",
    "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
];
const notEmojiSamples = ["a", "1", "#", "©", "❤", " ", "-", "中"];

function matchAtStart(regex: RegExp, text: string): string | null {
    regex.lastIndex = 0;
    return regex.exec(text)?.[0] ?? null;
}

test("header normalization keeps emoji, letters and digits", () => {
    assert.equal(normalizeHeaderForLink("📅 Plan: week 38"), "📅 Plan week 38");
});

test("header normalization keeps multi-codepoint emoji intact", () => {
    assert.equal(normalizeHeaderForLink("👩‍💻 Work / 🇨🇳 Trip"), "👩‍💻 Work 🇨🇳 Trip");
});

test("header normalization collapses whitespace and punctuation", () => {
    assert.equal(normalizeHeaderForLink("  Tasks -- (done)  "), "Tasks -- done");
});

test("an engine without the v flag gets the fallback emoji matcher instead of an error", () => {
    const matcher = createEmojiMatcher(withoutVFlag);
    assert.equal(matcher.flags.includes("v"), false);
    for (const emoji of emojiSamples) assert.equal(matchAtStart(matcher, emoji + " rest"), emoji, `fallback should match ${emoji}`);
    for (const text of notEmojiSamples) assert.equal(matchAtStart(matcher, text), null, `fallback should not match ${text}`);
});

test("the fallback matches the same emoji as \\p{RGI_Emoji}", () => {
    const rgi = createEmojiMatcher();
    const fallback = createEmojiMatcher(withoutVFlag);
    assert.equal(rgi.flags.includes("v"), true, "this Node supports the v flag, so the RGI matcher is used");
    for (const text of [...emojiSamples, ...notEmojiSamples]) {
        assert.equal(matchAtStart(fallback, text), matchAtStart(rgi, text), `different match for ${text}`);
    }
});

test("errors other than an unsupported regex are not swallowed", () => {
    const broken = () => { throw new TypeError("not a regex problem"); };
    assert.throws(() => createEmojiMatcher(broken), TypeError);
});
