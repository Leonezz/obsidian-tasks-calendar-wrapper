/**
 * Recreates the globals Obsidian provides at runtime that the modules under test use. Import this before any of them.
 */
import { FakeElement, type FakeElementInfo } from "./stubs/obsidian";

const scope = globalThis as unknown as {
	createEl?: () => { firstElementChild: unknown };
	createDiv?: (info?: FakeElementInfo) => FakeElement;
	createFragment?: (callback?: (fragment: FakeElement) => void) => FakeElement;
};

/** Obsidian's createEl. The task rows only hand it to MarkdownRenderer, which fills it in. */
scope.createEl ??= () => ({ firstElementChild: null });

/** Obsidian's createDiv, which the settings tab builds tag badges with. */
scope.createDiv ??= (info) => new FakeElement("div", info);

/** Obsidian's createFragment, which the settings tab builds descriptions with links and warnings in. */
scope.createFragment ??= (callback) => {
	const fragment = new FakeElement("#document-fragment");
	callback?.(fragment);
	return fragment;
};

/** Obsidian adds Array.prototype.contains, not enumerable; the settings tab checks its tag lists with it. */
if (!Object.prototype.hasOwnProperty.call(Array.prototype, "contains")) {
	Object.defineProperty(Array.prototype, "contains", {
		value(this: unknown[], item: unknown) {
			return this.includes(item);
		},
		configurable: true,
		writable: true,
	});
}
