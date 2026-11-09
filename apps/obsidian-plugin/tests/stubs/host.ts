import { Component, MarkdownRenderer, Platform } from "obsidian";
import type { UiHost } from "@tasks-calendar-wrapper/ui";
import { moment } from "../../utils/moment";

const testOwner = new Component();

/** Uncached markdown and the test's existing clock, including tests without a DOM. */
export const testHost: UiHost = {
	get isMobile() {
		return Platform.isMobile;
	},
	now: () => moment(),
	moment,
	renderMarkdown(markdown, sourcePath) {
		const el = { firstElementChild: null } as unknown as HTMLElement;
		void MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, testOwner);
		return el.firstElementChild!.innerHTML;
	},
};
