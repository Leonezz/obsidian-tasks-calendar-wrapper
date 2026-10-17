import * as P from "parsimmon";

/** Builds a RegExp. Tests pass one that rejects the `v` flag to stand in for an older engine. */
export type RegExpFactory = (pattern: string, flags: string) => RegExp;

const nativeRegExp: RegExpFactory = (pattern, flags) => new RegExp(pattern, flags);

/** One RGI emoji, including multi-codepoint sequences such as flags, keycaps and ZWJ sequences. Needs the `v` flag. */
const RGI_EMOJI = "\\p{RGI_Emoji}";

/**
 * One emoji without a ZWJ: a skin tone sequence, an emoji-presentation character, a pictograph that U+FE0F turns into
 * an emoji, or a pictograph too new for the engine's Unicode data. Tag characters follow for subdivision flags.
 */
const EMOJI_ELEMENT = "(?:\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F|(?!\\p{Emoji})\\p{Extended_Pictographic})(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?";

/**
 * `\p{RGI_Emoji}` rebuilt from properties the `u` flag knows. It matches the same flags, keycaps and ZWJ sequences,
 * but it cannot tell a recommended sequence from any other, so it also takes a lone regional indicator, an invalid
 * pair such as 🇦🇦, and a skin tone on emoji that Unicode never pairs with one, such as 👪.
 */
const EMOJI_SEQUENCE = `\\p{Regional_Indicator}{2}|[0-9#*]\\uFE0F\\u20E3|${EMOJI_ELEMENT}(?:\\u200D${EMOJI_ELEMENT})*`;

/**
 * Builds a sticky regex that matches one emoji at `lastIndex`. The `v` flag that `\p{RGI_Emoji}` needs arrived in
 * Chrome 112 and iOS 17; older engines throw a SyntaxError for it and get the `u` flag approximation instead.
 */
export function createEmojiMatcher(createRegExp: RegExpFactory = nativeRegExp): RegExp {
    try {
        return createRegExp(RGI_EMOJI, "vy");
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return createRegExp(EMOJI_SEQUENCE, "uy");
    }
}

/** Moved to packages/core, which reads daily note names with it; re-exported for the modules that import it from here. */
export { getFileTitle } from "@tasks-calendar-wrapper/core";

/**
 * Builds a header normalizer. The emoji regex is built on the first header rather than when the module loads,
 * so an engine that rejects it cannot stop the plugin from loading.
 */
export function createHeaderNormalizer(createRegExp: RegExpFactory = nativeRegExp): (header: string) => string {
    let emojiAtIndex: RegExp | undefined;
    // P.regex rejects the `v` flag that `\p{RGI_Emoji}` needs, so the match is done by hand.
    const emoji: P.Parser<string> = P.Parser((input, index) => {
        if (!emojiAtIndex) emojiAtIndex = createEmojiMatcher(createRegExp);
        emojiAtIndex.lastIndex = index;
        const match = emojiAtIndex.exec(input);
        return match ? P.makeSuccess(index + match[0].length, match[0]) : P.makeFailure(index, "an emoji");
    });
    const canonicalizer: P.Parser<string> = P.alt(
        emoji,
        P.regex(/[0-9\p{Letter}_-]+/u),
        P.whitespace.map(_ => " "),
        P.any.map(_ => " ")
    )
        .many()
        .map(result => {
            return result.join("").split(/\s+/).join(" ").trim();
        });
    return header => canonicalizer.tryParse(header);
}

const HEADER_NORMALIZER = createHeaderNormalizer();

/**
 * Normalizes the text in a header to be something that is actually linkable to. This mimics
 * how Obsidian does it's normalization, collapsing repeated spaces and stripping out control characters.
 */
export function normalizeHeaderForLink(header: string): string {
    return HEADER_NORMALIZER(header);
}