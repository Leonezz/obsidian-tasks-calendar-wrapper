import { ButtonComponent, Setting } from "obsidian";
import { copy, settingIssues } from "@tasks-calendar-wrapper/core";
import type TasksCalendarWrapper from "../main";
import { defaultUserOptions, type UserOption } from "../useroptions";
import { settingsSchema } from "../settings-schema";
import { renderers } from "./controls";
import { renderTagPalette } from "./controls/tagPalette";
import { rowDescription, settingRows, type RowMessages, type SettingRow, type SettingRowOf } from "./rows";
import { reportSaveError } from "./save";
import { moment } from "../../utils/moment";

/** The tab's live options and existing save paths, shared by its controls. */
export interface SettingsTabActions {
	readonly plugin: TasksCalendarWrapper;
	options(): UserOption;
	isShown(): boolean;
	registerCleanup?(cleanup: () => void): void;
	save(update: Partial<UserOption>, redraw: boolean): Promise<void>;
	saveInBackground(update: Partial<UserOption>, redraw: boolean): void;
}

/** A control can update its row's feedback without replacing the input. */
export interface SettingsControlActions extends SettingsTabActions {
	setMessages(messages: RowMessages): void;
	registerRefresh?(refresh: () => void): void;
}

interface DrawnRow {
	row: SettingRowOf<"setting">;
	readonly setting: Setting;
	drawn: boolean;
	messages: RowMessages;
	resets: { key: string; element: HTMLElement }[];
	showPalette?: (shown: boolean, refresh?: boolean) => void;
	refresh?: () => void;
}

/** Draws all rows, creating hidden controls on first show and refreshing changed rows in place. */
export function renderSettings(containerEl: HTMLElement, rows: readonly SettingRow[], tab: SettingsTabActions): void {
	const drawn = new Map<keyof UserOption, DrawnRow>();
	const navigation = containerEl.createEl("nav", {
		cls: "tcw-settings-nav",
		attr: { "aria-label": copy.settings.tab.navigationAria },
	});
	const headings = new Map<string, HTMLElement>();
	for (const row of rows) {
		if (row.kind !== "heading") continue;
		new ButtonComponent(navigation).setButtonText(row.name).onClick(() => {
			const heading = headings.get(row.group);
			heading?.scrollIntoView({ block: "start" });
			heading?.focus({ preventScroll: true });
		});
	}
	const feedback = containerEl.createDiv("tcw-settings-save-status");
	const status = feedback.createEl("span", {
		text: copy.settings.tab.autosaveHint,
		attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
	});
	const retry = new ButtonComponent(feedback).setButtonText(copy.settings.tab.retry).onClick(() => {
		return save(failed?.update ?? {}, failed?.resetRow).catch(reportSaveError);
	});
	retry.buttonEl.hidden = true;
	let sequence = 0;
	let failed: { update: Partial<UserOption>; resetRow?: keyof UserOption } | undefined;
	let preview: HTMLElement | undefined;
	const showStatus = (text: string, failed = false) => {
		status.setText(text);
		retry.buttonEl.hidden = !failed;
		feedback.setAttribute("data-failed", String(failed));
	};
	const save = async (update: Partial<UserOption>, resetRow?: keyof UserOption) => {
		const current = ++sequence;
		showStatus(copy.settings.tab.saving);
		try {
			await tab.save(update, false);
		} catch (error) {
			if (tab.isShown() && current === sequence) {
				failed = { update, resetRow };
				showStatus(copy.settings.tab.unsaved, true);
			}
			throw error;
		}
		if (!tab.isShown()) return;
		if (current === sequence) {
			failed = undefined;
			showStatus(copy.settings.tab.saved);
		}
		const options = tab.options();
		if (preview) drawPreview(preview, options);
		for (const row of settingRows(settingsSchema, options, settingIssues(options, settingsSchema))) {
			if (row.kind === "heading") continue;
			const state = drawn.get(row.key);
			if (!state) continue;
			state.row = row;
			state.setting.settingEl.hidden = !row.shown;
			const paletteChanged = row.palette && Object.prototype.hasOwnProperty.call(update, row.palette.key);
			if (Object.prototype.hasOwnProperty.call(update, row.key)) state.refresh?.();
			if (resetRow === row.key) {
				state.setting.controlEl.empty();
				state.setting.components = [];
				state.drawn = false;
				state.messages = {};
				state.showPalette = undefined;
				state.refresh = undefined;
				state.resets = [];
				drawIssues(state);
			}
			for (const reset of state.resets)
				reset.element.hidden = ![row.issue, row.palette?.issue].some((issue) => issue?.key === reset.key);
			state.setting.setDesc(rowDescription(row, state.messages));
			if (row.shown && !state.drawn) drawControl(state);
			if (row.palette) state.showPalette?.(row.palette.shown, paletteChanged);
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
			registerRefresh: (refresh) => {
				state.refresh = refresh;
			},
		};
		if (state.row.palette) state.showPalette = renderTagPalette(state.setting, state.row.palette, actions);
		renderers[state.row.control](state.setting, state.row, actions);
	};
	const sectionLabels = {
		dates: copy.settings.tab.sections.dates,
		information: copy.settings.tab.sections.information,
		filters: copy.settings.tab.sections.filters,
		today: copy.settings.tab.sections.today,
		quickEntry: copy.settings.tab.sections.quickEntry,
		dailyNotes: copy.settings.tab.sections.dailyNotes,
	};
	const sections = new Set<string>();
	for (const row of rows) {
		if (row.kind === "heading") {
			const heading = new Setting(containerEl).setName(row.name).setHeading().settingEl;
			heading.tabIndex = -1;
			heading.addClass("tcw-settings-heading");
			headings.set(row.group, heading);
			if (row.group === "display") {
				preview = containerEl.createDiv("tcw-settings-preview");
				drawPreview(preview, tab.options());
			}
		} else {
			const section = row.spec.section;
			if (section && !sections.has(section)) {
				sections.add(section);
				containerEl.createEl("h4", {
					text: sectionLabels[section],
					cls: "tcw-settings-subheading",
				});
			}
			const setting = new Setting(containerEl);
			const state: DrawnRow = { row, setting, drawn: false, messages: {}, resets: [] };
			drawn.set(row.key, state);
			setting.settingEl.hidden = !row.shown;
			drawIssues(state);
			if (row.shown) drawControl(state);
		}
	}
}

/** A read-only example: no sample task is written to the vault. */
function drawPreview(container: HTMLElement, options: UserOption): void {
	container.empty();
	container.createEl("div", { text: copy.settings.tab.preview, cls: "tcw-settings-preview-title" });
	const dateFormat = typeof options.dateFormat === "string" ? options.dateFormat : "YYYY-MM-DD";
	container.createEl("div", {
		text: moment().format(dateFormat),
		cls: "tcw-settings-preview-date",
	});
	const task = container.createDiv("tcw-settings-preview-task");
	if (options.useBuiltinStyle)
		task.createEl("span", { text: copy.settings.tab.previewCheckboxGlyph, attr: { "aria-hidden": "true" } });
	else task.createEl("input", { attr: { type: "checkbox", disabled: true, "aria-hidden": "true" } });
	task.createEl("span", { text: copy.settings.tab.previewTask });
	const metadata = container.createDiv("tcw-settings-preview-metadata");
	if (options.useRelative) metadata.createEl("span", { text: copy.settings.tab.previewRelative });
	if (options.usePriority) metadata.createEl("span", { text: copy.settings.tab.previewPriority });
	if (options.useRecurrence) metadata.createEl("span", { text: copy.settings.tab.previewRecurrence });
	if (options.useFileBadge) metadata.createEl("span", { text: copy.settings.tab.previewNote });
	if (options.useSection) metadata.createEl("span", { text: copy.settings.tab.previewSection });
	if (options.useTags) {
		const palette = options.tagColorPalette;
		const tag = Object.keys(palette ?? {})[0] ?? copy.settings.tab.previewTag;
		if (!Array.isArray(options.hideTags) || !options.hideTags.includes(tag)) {
			const badge = metadata.createEl("span", { text: tag, cls: "tag" });
			if (palette && typeof palette[tag] === "string") badge.style.color = palette[tag];
		}
	}
	container.createEl("small", { text: copy.settings.tab.previewHint });
}
