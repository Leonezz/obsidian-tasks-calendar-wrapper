import type { Component } from "obsidian";
import type { UiHost } from "@tasks-calendar-wrapper/ui";

/** Keeps 40,000 renders by default; step 5 of the restructuring sizes it from the heap. */
export const MARKDOWN_CACHE_CAPACITY = 40_000;

export interface PluginUiHost extends UiHost {
	/** Drops every cached render. The view calls it when a list commits (wired in step 5). */
	clearMarkdownCache(): void;
}

export interface UiHostOptions {
	/** The component that owns the renders: TasksTimelineView.view until step 17 gives each view its own. */
	readonly owner: () => Component;
	/** The detached element a render goes into; Obsidian's DOM in the app, a stand-in in the tests. */
	readonly createElement?: () => HTMLElement;
	readonly capacity?: number;
}

export function createUiHost(options: UiHostOptions): PluginUiHost {
	throw new Error("not implemented");
}
