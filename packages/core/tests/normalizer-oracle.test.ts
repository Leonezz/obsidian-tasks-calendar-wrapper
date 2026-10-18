import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

import { createHeaderNormalizer, RegExpFactory } from "../src/links";
import { createHeaderNormalizer as createOracle } from "./oracle/dataview-normalizer";

// core's header normalizer replaced a parsimmon parser. It must give exactly what that parser gave, for every
// heading, or section links of tasks change. The parser is kept as the oracle until parsimmon goes in step 9.

const nativeRegExp: RegExpFactory = (pattern, flags) => new RegExp(pattern, flags);

/** Stands in for an engine without the `v` flag (before Chrome 112 and iOS 17), which throws a SyntaxError for it. */
const withoutVFlag: RegExpFactory = (pattern, flags) => {
    if (flags.includes("v")) throw new SyntaxError(`Invalid flags supplied to RegExp constructor '${flags}'`);
    return new RegExp(pattern, flags);
};

/** The test runner works in packages/core. */
const repoRoot = path.resolve(process.cwd(), "../..");

function markdownFiles(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        if (entry.name.startsWith(".")) return [];
        const full = path.join(folder, entry.name);
        return entry.isDirectory() ? markdownFiles(full) : entry.name.endsWith(".md") ? [full] : [];
    });
}

/** The text of every ATX heading in the example and golden vaults. */
function vaultHeadings(): string[] {
    const folders = ["fixtures/golden-vault", "ExampleVault"].map(folder => path.join(repoRoot, folder));
    for (const folder of folders) assert.ok(existsSync(folder), `${folder} is missing`);
    return folders.flatMap(markdownFiles).flatMap(file =>
        readFileSync(file, "utf8").split(/\r?\n/).flatMap(line => /^#{1,6}[ \t]+(.*)$/.exec(line)?.[1] ?? []));
}

/** Headings picked for the ways the two could part: emoji sequences, surrogates, whitespace and scripts. */
const pickedHeadings = [
    "", " ", "\t", "a", "-", "_", "--", "Tasks -- (done)", "  Inbox   Alias  heading ",
    "📅 Plan: week 38", "👩‍💻 Work / 🇨🇳 Trip", "© 2026 ☀️ Plan", "™ Trademark", "1️⃣ First", "#️⃣ Hash", "1⃣ bare keycap",
    "👍🏽 Thumbs", "🏻 lone tone", "🏳️‍🌈 Pride", "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland", "🇦🇦 invalid pair", "🇨 lone indicator", "👪🏽 tone on family",
    "❤️‍🔥", "🧑‍⚕️🧑‍⚕", "👁️‍🗨️", "🏃‍➡️", "🫱🏼‍🫲🏿", "🧑🏻‍❤️‍💋‍🧑🏼", "👨‍👩‍👧‍👦 Family",
    "任务 计划", "مهمة اليوم", "٢٠٢٦ أرقام", "Café", "Café", "Ελληνικά", "Русский", "日本語のタスク", "한국어",
    "𝒜𝕏 script letters", "𝟘 math digit", "\uD83D lone high", "\uDE00 lone low", "a\uD83Db", "\uDE00\uD83D",
    "tabs\tand nbsp", "line separator", "ideographic　space", "zero​width", "joiner‍alone",
    "vs16 alone ️", "vs15 ☀︎", "tag \u{E0067} alone", "keycap ⃣ alone",
];

/** Deterministic random headings from the pieces above, so a failure can be reproduced. */
function generatedHeadings(count: number): string[] {
    const pieces = [
        "a", "Z", "7", "-", "_", " ", "  ", "\t", " ", "　", " ", ":", "/", "(", ")", "#", ".", "!", "'",
        "任", "务", "م", "٢", "é", "́", "Ω", "𝒜", "𝟘",
        "📅", "☀", "️", "︎", "‍", "⃣", "©", "™", "👍", "\u{1F3FD}", "🇨", "🇳", "\u{E0067}", "\u{E007F}",
        "👩‍💻", "🏳️‍🌈", "1️⃣", "\uD83D", "\uDE00", "​",
    ];
    let seed = 0x5eed;
    const random = () => {
        // mulberry32
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: count }, () =>
        Array.from({ length: 1 + Math.floor(random() * 12) }, () => pieces[Math.floor(random() * pieces.length)]).join(""));
}

const corpus = [...vaultHeadings(), ...pickedHeadings, ...generatedHeadings(10_000)];

test("the corpus has the vault headings, the picked ones and the generated ones", () => {
    assert.ok(vaultHeadings().length >= 18, `only ${vaultHeadings().length} vault headings`);
    assert.ok(corpus.length > 10_000);
});

for (const [engine, factory] of [["with the v flag", nativeRegExp], ["without the v flag", withoutVFlag]] as const) {
    test(`every heading normalizes as the parsimmon parser normalized it (${engine})`, () => {
        const normalize = createHeaderNormalizer(factory);
        const oracle = createOracle(factory);
        for (const heading of corpus) {
            assert.equal(normalize(heading), oracle(heading), JSON.stringify(heading));
        }
    });
}
