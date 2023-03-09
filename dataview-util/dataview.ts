import emojiRegex from "emoji-regex";
import * as P from "parsimmon";

/** Get the "title" for a file, by stripping other parts of the path as well as the extension. */
export function getFileTitle(path: string): string {
    if (path.includes("/")) path = path.substring(path.lastIndexOf("/") + 1);
    if (path.endsWith(".md")) path = path.substring(0, path.length - 3);
    return path;
}

const HEADER_CANONICALIZER: P.Parser<string> = P.alt(
    P.regex(new RegExp(emojiRegex(), "")),
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