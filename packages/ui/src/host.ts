import type { DateValue, MomentFactory } from "@tasks-calendar-wrapper/core";

export interface TimelineHandle {
	revealTask(taskId: string): Promise<boolean>;
	revealDay(dayKey: string): Promise<boolean>;
	getWindowingInfo(): TimelineWindowingInfo;
}

export interface TimelineWindowingInfo {
	readonly rowCount: number;
	readonly windowed: boolean;
}

export interface TimelineWindowHost {
	getScrollElement(): HTMLElement | undefined;
	getMinRows(): number | undefined;
	connect(handle: TimelineHandle | undefined): void;
}

/** What the timeline asks of the app it runs in: the plugin implements it; ui never imports obsidian. */
export interface UiHost {
	/** Optional viewport of a mounted timeline. A host without one keeps the complete DOM. */
	readonly windowing?: TimelineWindowHost;
	/** What Platform.isMobile gave the components. */
	readonly isMobile: boolean;
	/** The current time, which each render used to take from moment(). */
	now(): DateValue;
	/** The moment function, for expandShortcuts and the locale. */
	readonly moment: MomentFactory;
	/** Synchronously returns the rendered HTML of the markdown as seen from the note at sourcePath. */
	renderMarkdown(markdown: string, sourcePath: string): string;
}
