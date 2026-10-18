/**
 * Recreates the globals that Obsidian provides at runtime and that the
 * parsing code relies on. Import this before any module under test.
 */
import moment from "moment";

declare global {
	interface Array<T> {
		contains(target: T): boolean;
	}
}

const globalScope = globalThis as unknown as { window?: { moment: typeof moment } };
globalScope.window = { ...(globalScope.window ?? {}), moment };

/** Obsidian's createEl. The task rows only hand it to MarkdownRenderer, which fills it in. */
const scope = globalThis as unknown as { createEl?: () => { firstElementChild: unknown } };
scope.createEl ??= () => ({ firstElementChild: null });

if (!Array.prototype.contains) {
	Object.defineProperty(Array.prototype, "contains", {
		value: function <T>(this: T[], target: T) {
			return this.includes(target);
		},
		configurable: true,
	});
}
