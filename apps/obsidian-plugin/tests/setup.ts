/**
 * Recreates the globals Obsidian provides at runtime that the modules under test use. Import this before any of them.
 */

/** Obsidian's createEl. The task rows only hand it to MarkdownRenderer, which fills it in. */
const scope = globalThis as unknown as { createEl?: () => { firstElementChild: unknown } };
scope.createEl ??= () => ({ firstElementChild: null });
