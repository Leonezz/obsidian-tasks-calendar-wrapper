import { Setting } from "obsidian";
import type TasksCalendarWrapper from "../main";
import type { UserOption } from "../useroptions";
import { renderers } from "./controls";
import type { SettingRow } from "./rows";

/** The tab's live options and existing save paths, shared by its controls. */
export interface SettingsTabActions {
	readonly plugin: TasksCalendarWrapper;
	options(): UserOption;
	save(update: Partial<UserOption>, redraw: boolean): Promise<void>;
	saveInBackground(update: Partial<UserOption>, redraw: boolean): void;
}

/** Draw the old layout, leaving hidden rows absent and the palette before its parent's toggle. */
export function renderSettings(containerEl: HTMLElement, rows: readonly SettingRow[], tab: SettingsTabActions): void {
	for (const row of rows) {
		if (row.kind === "heading") {
			new Setting(containerEl).setName(row.name).setHeading();
		} else if (row.shown) {
			const setting = new Setting(containerEl);
			if (row.palette) renderers.tagPalette(setting, row.palette, tab);
			renderers[row.control](setting, row, tab);
		}
	}
}
