import { test } from "node:test";
import assert from "node:assert/strict";

import { createEmojiMatcher, createHeaderNormalizer, normalizeHeaderForLink, RegExpFactory } from "../src/links";

/** Stands in for an engine without the `v` flag (before Chrome 112 and iOS 17), which throws a SyntaxError for it. */
const withoutVFlag: RegExpFactory = (pattern, flags) => {
    if (flags.includes("v")) throw new SyntaxError(`Invalid flags supplied to RegExp constructor '${flags}'`);
    return new RegExp(pattern, flags);
};

const normalizers = [
    { engine: "with the v flag", normalize: normalizeHeaderForLink },
    { engine: "without the v flag", normalize: createHeaderNormalizer(withoutVFlag) },
];

for (const { engine, normalize } of normalizers) {
    test(`header normalization keeps emoji, letters and digits (${engine})`, () => {
        assert.equal(normalize("📅 Plan: week 38"), "📅 Plan week 38");
    });

    test(`header normalization keeps multi-codepoint emoji intact (${engine})`, () => {
        assert.equal(normalize("👩‍💻 Work / 🇨🇳 Trip"), "👩‍💻 Work 🇨🇳 Trip");
    });

    test(`header normalization collapses whitespace and punctuation (${engine})`, () => {
        assert.equal(normalize("  Tasks -- (done)  "), "Tasks -- done");
    });

    test(`header normalization drops symbols that are only emoji with U+FE0F (${engine})`, () => {
        assert.equal(normalize("© 2026 ☀️ Plan"), "2026 ☀️ Plan");
    });
}

test("the emoji regex uses the v flag where the engine has it", () => {
    assert.equal(createEmojiMatcher().flags, "vy");
});

test("the emoji regex falls back to the u flag where the engine lacks the v flag", () => {
    assert.equal(createEmojiMatcher(withoutVFlag).flags, "uy");
});

test("an error other than an unsupported flag is not hidden by the fallback", () => {
    const broken: RegExpFactory = () => { throw new TypeError("not a flag problem"); };
    assert.throws(() => createEmojiMatcher(broken), TypeError);
});

test("the emoji regex is built on the first header, not when the normalizer is made", () => {
    const flagsTried: string[] = [];
    const normalize = createHeaderNormalizer((pattern, flags) => {
        flagsTried.push(flags);
        return withoutVFlag(pattern, flags);
    });
    assert.deepEqual(flagsTried, []);
    assert.equal(normalize("🇨🇳 Trip"), "🇨🇳 Trip");
    normalize("📅 Plan");
    assert.deepEqual(flagsTried, ["vy", "uy"]);
});

test("the fallback matches the same emoji as \\p{RGI_Emoji}", () => {
    const rgi = createEmojiMatcher();
    const fallback = createEmojiMatcher(withoutVFlag);
    const matchAtStart = (regex: RegExp, text: string) => {
        regex.lastIndex = 0;
        return regex.exec(text)?.[0] ?? null;
    };
    const samples = [
        "📅", "📅️", "🫨", "☀", "☀️", "©", "©️", "‼️", "🅰", "🅰️", "★", "a", "2026",
        "👍🏽", "✌🏽", "✌", "🏻",
        "🇨🇳", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "1️⃣", "1⃣", "#️⃣",
        "👨‍👩‍👧‍👦", "👩🏽‍💻", "🏳️‍🌈", "❤️‍🔥", "🧑‍⚕️", "🧑‍⚕", "🐈‍⬛", "👁️‍🗨️", "🏃‍➡️", "🫱🏼‍🫲🏿", "🧑🏻‍❤️‍💋‍🧑🏼",
    ];
    for (const sample of samples) {
        assert.equal(matchAtStart(fallback, sample), matchAtStart(rgi, sample), JSON.stringify(sample));
    }
});
