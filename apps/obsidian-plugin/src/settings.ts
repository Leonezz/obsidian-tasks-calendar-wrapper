import { App, PluginSettingTab } from "obsidian";
import { settingIssues } from "@tasks-calendar-wrapper/core";
import TasksCalendarWrapper from "./main";
import { settingsSchema } from "./settings-schema";
import { renderSettings } from "./settings/generate";
import { settingRows } from "./settings/rows";
import { reportSaveError } from "./settings/save";
import { defaultUserOptions, UserOption } from "./useroptions";

export { defaultUserOptions };
export type { UserOption };

export class TasksCalendarSettingTab extends PluginSettingTab {
	plugin: TasksCalendarWrapper;
	/** The settings show this tab: from Obsidian's display() until its hide(). */
	private shown = false;
	constructor(app: App, plugin: TasksCalendarWrapper) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Draws the tab again with the options now, if the settings show it. */
	redrawIfShown(): void {
		if (this.shown) this.display();
	}

	hide(): void {
		this.shown = false;
	}

	async onOptionUpdate(updatePart: Partial<UserOption>, refreashSettingPage = false) {
		await this.plugin.writeOptions(updatePart);
		// The settings may have closed while it saved.
		if (refreashSettingPage) this.redrawIfShown();
	}

	/** Saves options from a callback that cannot wait for the result, reporting failures to the user. */
	private saveOptionsInBackground(updatePart: Partial<UserOption>, refreashSettingPage = false) {
		this.onOptionUpdate(updatePart, refreashSettingPage).catch(reportSaveError);
	}

	display(): void {
		this.shown = true;
		const { containerEl } = this;

		containerEl.addClass("tasks-calendar-wrapper-settings");
		containerEl.empty();
		const options = this.plugin.userOptions;
		renderSettings(containerEl, settingRows(settingsSchema, options, settingIssues(options, settingsSchema)), {
			plugin: this.plugin,
			options: () => this.plugin.userOptions,
			isShown: () => this.shown,
			save: (update, redraw) => this.onOptionUpdate(update, redraw),
			saveInBackground: (update, redraw) => this.saveOptionsInBackground(update, redraw),
		});
	}
}
