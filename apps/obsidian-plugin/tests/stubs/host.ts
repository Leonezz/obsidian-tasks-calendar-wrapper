import { MarkdownRenderer, Platform } from "obsidian";
import type { UiHost } from "@tasks-calendar-wrapper/ui";
import { TasksTimelineView } from "../../src/views";
import { moment } from "../../utils/moment";

/** Uncached markdown and the test's existing clock, including tests without a DOM. */
export const testHost: UiHost = {
	get isMobile() {
		return Platform.isMobile;
	},
	now: () => moment(),
	moment,
	renderMarkdown(markdown, sourcePath) {
		const el = { firstElementChild: null } as unknown as HTMLElement;
		void MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, TasksTimelineView.view!);
		return el.firstElementChild!.innerHTML;
	},
};
