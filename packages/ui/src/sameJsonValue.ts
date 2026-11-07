/** Compares the JSON-shaped values used by the timeline's caches, as underscore's isEqual did. */
export function sameJsonValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!sameJsonValue(a[i], b[i])) return false;
		return true;
	}
	const plain = (value: object) =>
		Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
	if (!plain(a) || !plain(b)) return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameJsonValue(left[key], right[key]))
	);
}
