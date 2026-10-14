import * as P from "parsimmon";

/**
 * Parses one RGI emoji, including multi-codepoint sequences such as flags and ZWJ sequences.
 * P.regex rejects the `v` flag that `\p{RGI_Emoji}` needs, so the match is done by hand.
 */
const EMOJI_AT_INDEX = new RegExp("\\p{RGI_Emoji}", "vy");
const EMOJI: P.Parser<string> = P.Parser((input, index) => {
    EMOJI_AT_INDEX.lastIndex = index;
    const match = EMOJI_AT_INDEX.exec(input);
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