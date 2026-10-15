import * as P from "parsimmon";

type RegExpFactory = (source: string, flags: string) => RegExp;

/** One emoji, with an optional skin tone or emoji presentation selector, as the `u` flag can describe it. */
const EMOJI_PART = "(?:\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)";

/** The sequences `\p{RGI_Emoji}` matches, spelled out for engines without the `v` flag. */
const FALLBACK_EMOJI_SOURCE = [
    "\\u{1F3F4}[\\u{E0020}-\\u{E007E}]+\\u{E007F}", // subdivision flags, such as England
    "\\p{Regional_Indicator}{2}", // country flags
    "[0-9#*]\\uFE0F\\u20E3", // keycaps
    `${EMOJI_PART}(?:\\u200D${EMOJI_PART})*`, // single emoji and ZWJ sequences
].join("|");

/**
 * Matches one emoji at `lastIndex`, including multi-codepoint sequences such as flags and ZWJ sequences.
 * `\p{RGI_Emoji}` needs the `v` flag, which iOS before 17 and Chromium before 112 reject with a SyntaxError.
 * Those engines get a `u` flag pattern for the same sequences instead.
 */
export function createEmojiMatcher(createRegExp: RegExpFactory = (source, flags) => new RegExp(source, flags)): RegExp {
    try {
        return createRegExp("\\p{RGI_Emoji}", "vy");
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return createRegExp(FALLBACK_EMOJI_SOURCE, "uy");
    }
}

/**
 * Built on first use, not when the module loads: building it at load time on an engine without the `v` flag
 * threw while the plugin was loading, so the plugin did not load at all.
 */
let emojiAtIndex: RegExp | undefined;

/** Parses one emoji. P.regex rejects the `v` flag, so the match is done by hand. */
const EMOJI: P.Parser<string> = P.Parser((input, index) => {
    emojiAtIndex ??= createEmojiMatcher();
    emojiAtIndex.lastIndex = index;
    const match = emojiAtIndex.exec(input);
    return match ? P.makeSuccess(index + match[0].length, match[0]) : P.makeFailure(index, "an emoji");
});

/** Get the "title" for a file, by stripping other parts of the path as well as the extension. */
export function getFileTitle(path: string): string {
    if (path.includes("/")) path = path.substring(path.lastIndexOf("/") + 1);
    if (path.endsWith(".md")) path = path.substring(0, path.length - 3);
    return path;
}

const HEADER_CANONICALIZER: P.Parser<string> = P.alt(
    EMOJI,
    P.regex(/[0-9\p{Letter}_-]+/u),
    P.whitespace.map(_ => " "),
    P.any.map(_ => " ")
)
    .many()
    .map(result => {
        return result.join("").split(/\s+/).join(" ").trim();
    });

/**
 * Normalizes the text in a header to be something that is actually linkable to. This mimics
 * how Obsidian does it's normalization, collapsing repeated spaces and stripping out control characters.
 */
export function normalizeHeaderForLink(header: string): string {
    return HEADER_CANONICALIZER.tryParse(header);
}