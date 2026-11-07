import type { DateValue, MomentFactory } from "@tasks-calendar-wrapper/core";

/** What the timeline asks of the app it runs in: the plugin implements it; ui never imports obsidian. */
export interface UiHost {
	/** What Platform.isMobile gave the components. */
	readonly isMobile: boolean;
	/** The current time, which each render used to take from moment(). */
	now(): DateValue;
	/** The moment function, for expandShortcuts and the locale. */
	readonly moment: MomentFactory;
	/** Synchronously returns the rendered HTML of the markdown as seen from the note at sourcePath. */
	renderMarkdown(markdown: string, sourcePath: string): string;
}
