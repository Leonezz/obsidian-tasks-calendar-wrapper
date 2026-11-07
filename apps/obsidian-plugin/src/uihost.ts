import { MarkdownRenderer, Platform, type Component } from "obsidian";
import type { UiHost } from "@tasks-calendar-wrapper/ui";
import { moment } from "../utils/moment";

/** Keeps 40,000 renders until heapAfterLoad is measured at the beta check. */
export const MARKDOWN_CACHE_CAPACITY = 40_000;

export interface PluginUiHost extends UiHost {
	/** Drops every cached render before the view mounts or publishes a reload. */
	clearMarkdownCache(): void;
}

export interface UiHostOptions {
	/** The component that owns the renders: TasksTimelineView.view until step 17 gives each view its own. */
	readonly owner: () => Component;
	/** The detached element a render goes into; Obsidian's DOM in the app, a stand-in in the tests. */
	readonly createElement?: () => HTMLElement;
	readonly capacity?: number;
}

/**
 * Caches markdown between reloads. The view clears before mounting and before a reload reaches the store,
 * so rows remounting in the reload's render cannot read old entries.
 */
export function createUiHost(options: UiHostOptions): PluginUiHost {
	const { owner, createElement = () => document.createElement("a"), capacity = MARKDOWN_CACHE_CAPACITY } = options;
	if (!Number.isInteger(capacity) || capacity <= 0)
		throw new Error(`the markdown cache capacity must be a positive integer, got ${capacity}`);
	const cache = new Map<string, string>();
	return {
		isMobile: Platform.isMobile,
		now: () => moment(),
		moment,
		renderMarkdown(markdown, sourcePath) {
			const key = sourcePath + "\u0000" + markdown;
			const cached = cache.get(key);
			if (cached !== undefined) {
				cache.delete(key);
				cache.set(key, cached);
				return cached;
			}
			const el = createElement();
			void MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, owner());
			const html = el.firstElementChild!.innerHTML;
			cache.set(key, html);
			while (cache.size > capacity) cache.delete(cache.keys().next().value!);
			return html;
		},
		clearMarkdownCache() {
			cache.clear();
		},
	};
}
