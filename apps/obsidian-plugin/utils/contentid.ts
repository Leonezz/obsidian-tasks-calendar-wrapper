/**
 * An id of a note's text: equal texts give equal ids, and different texts almost surely different ones, so the plugin
 * can tell that a note was read again with the same content without keeping the text. 53 bits, a safe integer.
 */
export type ContentId = number;

/** cyrb53 by bryc (public domain): one pass over the UTF-16 code units, two 32-bit lanes mixed at the end. */
export function contentIdOf(text: string): ContentId {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const unit = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ unit, 2654435761);
		h2 = Math.imul(h2 ^ unit, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
