/**
 * Normalizes heading text the way Obsidian links to it. Adapted from Obsidian Dataview, see NOTICE; Dataview built
 * this with parsimmon, and the loop below does at each position exactly what that parser did.
 */
import type { LinkRef } from "./task";

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

/** Letters (any script), ASCII digits, "_" and "-", anchored, as parsimmon's P.regex anchors its regex. */
const WORD = /^(?:[0-9\p{Letter}_-]+)/u;

/** Whitespace, anchored, as parsimmon's P.whitespace matches it. */
const WHITESPACE = /^(?:\s+)/;

/**
 * Builds a header normalizer. The emoji regex is built on the first header rather than when the module loads,
 * so an engine that rejects it cannot stop the plugin from loading.
 *
 * At each position it keeps an emoji or a run of letters, digits, "_" and "-", and turns anything else into a space:
 * whitespace as a run, any other UTF-16 unit on its own. Then it collapses the spaces and trims them.
 */
export function createHeaderNormalizer(createRegExp: RegExpFactory = nativeRegExp): (header: string) => string {
    let emojiAtIndex: RegExp | undefined;
    return header => {
        if (!emojiAtIndex) emojiAtIndex = createEmojiMatcher(createRegExp);
        let kept = "";
        let index = 0;
        while (index < header.length) {
            // The emoji regex is sticky and runs on the whole header, the word and whitespace regexes on what is left.
            emojiAtIndex.lastIndex = index;
            const emoji = emojiAtIndex.exec(header);
            if (emoji) {
                kept += emoji[0];
                index += emoji[0].length;
                continue;
            }
            const rest = header.slice(index);
            const word = WORD.exec(rest);
            if (word) {
                kept += word[0];
                index += word[0].length;
                continue;
            }
            const whitespace = WHITESPACE.exec(rest);
            kept += " ";
            index += whitespace ? whitespace[0].length : 1;
        }
        return kept.split(/\s+/).join(" ").trim();
    };
}

const HEADER_NORMALIZER = createHeaderNormalizer();

/**
 * Normalizes the text in a header to be something that is actually linkable to. This mimics
 * how Obsidian does it's normalization, collapsing repeated spaces and stripping out control characters.
 */
export function normalizeHeaderForLink(header: string): string {
    return HEADER_NORMALIZER(header);
}

// Links to a note, a heading or a block, built as Dataview's Link class builds them, with the same fields as its
// toObject(). Frozen.

/** A link to a whole note. */
export function fileLink(path: string, embed = false, display?: string): LinkRef {
    return Object.freeze({ path, type: "file", subpath: undefined, display, embed });
}

/** A link to a heading in a note; the heading is normalized as Obsidian links to it. */
export function headerLink(path: string, header: string, embed = false, display?: string): LinkRef {
    return Object.freeze({ path, type: "header", subpath: normalizeHeaderForLink(header), display, embed });
}

function blockLink(path: string, id: string | undefined, embed: boolean, display?: string): LinkRef {
    return Object.freeze({ path, type: "block", subpath: id, display, embed });
}

/**
 * The link to a section of a note, from the link to the note and the section's metadata. `text` is the section's
 * text in the note; for a heading, that is its whole line.
 */
export function sectionLink(note: LinkRef, section: { readonly type: string; readonly id?: string }, text: string): LinkRef {
    switch (section.type) {
        case "heading":
            return headerLink(note.path, text, note.embed, note.display);
        case "list":
        case "block":
            return blockLink(note.path, section.id, note.embed, note.display);
        default:
            return fileLink(note.path, note.embed, note.display);
    }
}

/** A link a note makes, from Obsidian's link metadata: to the linked note, with the text shown for it. */
export function outlink(link: { readonly link: string; readonly displayText?: string }): LinkRef {
    return fileLink(link.link, false, link.displayText);
}
