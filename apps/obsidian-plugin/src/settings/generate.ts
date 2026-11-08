import { Setting } from "obsidian";
import { copy, settingIssues } from "@tasks-calendar-wrapper/core";
import type TasksCalendarWrapper from "../main";
import { defaultUserOptions, type UserOption } from "../useroptions";
import { settingsSchema } from "../settings-schema";
import { renderers } from "./controls";
import { renderTagPalette } from "./controls/tagPalette";
import { rowDescription, settingRows, type RowMessages, type SettingRow, type SettingRowOf } from "./rows";
import { reportSaveError } from "./save";

/** The tab's live options and existing save paths, shared by its controls. */
export interface SettingsTabActions {
	readonly plugin: TasksCalendarWrapper;
	options(): UserOption;
	isShown(): boolean;
	save(update: Partial<UserOption>, redraw: boolean): Promise<void>;
	saveInBackground(update: Partial<UserOption>, redraw: boolean): void;
}

/** A control can update its row's feedback without replacing the input. */
export interface SettingsControlActions extends SettingsTabActions {
	setMessages(messages: RowMessages): void;
}

interface DrawnRow {
	row: SettingRowOf<"setting">;
	readonly setting: Setting;
	drawn: boolean;
	messages: RowMessages;
	resets: { key: string; element: HTMLElement }[];
	showPalette?: (shown: boolean) => void;
}

/** Draws all rows, creating hidden controls on first show and refreshing changed rows in place. */
export function renderSettings(containerEl: HTMLElement, rows: readonly SettingRow[], tab: SettingsTabActions): void {
	const drawn = new Map<keyof UserOption, DrawnRow>();
	const save = async (update: Partial<UserOption>, resetRow?: keyof UserOption) => {
		await tab.save(update, false);
		if (!tab.isShown()) return;
		const options = tab.options();
		for (const row of settingRows(settingsSchema, options, settingIssues(options, settingsSchema))) {
			if (row.kind === "heading") continue;
			const state = drawn.get(row.key);
			if (!state) continue;
			state.row = row;
			state.setting.settingEl.hidden = !row.shown;
			const changed = Object.prototype.hasOwnProperty.call(update, row.key);
			const paletteChanged = row.palette && Object.prototype.hasOwnProperty.call(update, row.palette.key);
			if (resetRow === row.key || (changed && row.control === "tagList") || paletteChanged) {
				state.setting.controlEl.empty();
				state.setting.components = [];
				state.drawn = false;
				state.messages = {};
				state.showPalette = undefined;
				state.resets = [];
				drawIssues(state);
			}
			for (const reset of state.resets)
				reset.element.hidden = ![row.issue, row.palette?.issue].some((issue) => issue?.key === reset.key);
			state.setting.setDesc(rowDescription(row, state.messages));
			if (row.shown && !state.drawn) drawControl(state);
			if (row.palette) state.showPalette?.(row.palette.shown);
		}
	};
	const drawIssues = (state: DrawnRow) => {
		state.setting.setName(state.row.texts.name).setDesc(rowDescription(state.row, state.messages));
		for (const issue of [state.row.issue, state.row.palette?.issue]) {
			if (!issue) continue;
			const key = issue.key as keyof UserOption;
			state.setting.addExtraButton((button) => {
				button
					.setIcon("reset")
					.setTooltip(copy.settings.tab.resetToDefault)
					.onClick(() => {
						save({ [key]: defaultUserOptions[key] }, state.row.key).catch(reportSaveError);
					});
			});
			state.resets.push({
				key,
				element: state.setting.controlEl.children[state.setting.controlEl.children.length - 1] as HTMLElement,
			});
		}
	};
	const drawControl = (state: DrawnRow) => {
		state.drawn = true;
		const actions: SettingsControlActions = {
			...tab,
			save: async (update) => await save(update),
			saveInBackground: (update) => {
				save(update).catch(reportSaveError);
			},
			setMessages: (messages) => {
				state.messages = messages;
				state.setting.setDesc(rowDescription(state.row, messages));
			},
		};
		if (state.row.palette) state.showPalette = renderTagPalette(state.setting, state.row.palette, actions);
		renderers[state.row.control](state.setting, state.row, actions);
	};
	for (const row of rows) {
		if (row.kind === "heading") {
			new Setting(containerEl).setName(row.name).setHeading();
		} else {
			const setting = new Setting(containerEl);
			const state: DrawnRow = { row, setting, drawn: false, messages: {}, resets: [] };
			drawn.set(row.key, state);
			setting.settingEl.hidden = !row.shown;
			drawIssues(state);
			if (row.shown) drawControl(state);
		}
	}
}
