import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	copy,
	fileListCodec,
	pathListCodec,
	plainTextCodec,
	propertyRulesCodec,
	statusListCodec,
	trimmedTextCodec,
} from "@tasks-calendar-wrapper/core";
import { defaultSortKey } from "@tasks-calendar-wrapper/core";
import { TaskRegularExpressions } from "@tasks-calendar-wrapper/core";
import TasksCalendarWrapper from "./main";
import { settingsSchema } from "./settings-schema";
import { defaultUserOptions, UserOption } from "./useroptions";

export { defaultUserOptions };
export type { UserOption };

function specOf(key: keyof UserOption) {
	const spec = settingsSchema.find((spec) => spec.key === key);
	if (!spec) throw new Error(`Missing setting spec: ${key}`);
	return spec;
}

function textsOf(key: keyof UserOption) {
	const spec = specOf(key);
	if (spec.copy === undefined) throw new Error(`Missing setting copy: ${key}`);
	return copy.settings[spec.copy];
}

function optionsOf(key: keyof UserOption): Record<string, string> {
	const spec = specOf(key);
	const texts = textsOf(key);
	if (!spec.options || !("options" in texts)) throw new Error(`Missing setting options: ${key}`);
	const labels: Readonly<Record<string, string>> = texts.options;
	return Object.fromEntries(Object.entries(spec.options).map(([value, label]) => [value, labels[label]]));
}

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

		containerEl.empty();

		new Setting(containerEl).setName(copy.settings.groups.interface).setHeading();

		new Setting(containerEl)
			.setName(textsOf("openViewOnStartup").name)
			.setDesc(textsOf("openViewOnStartup").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.openViewOnStartup);
				tg.onChange(async (v) => await this.onOptionUpdate({ openViewOnStartup: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("showWhatsNewOnUpdate").name)
			.setDesc(textsOf("showWhatsNewOnUpdate").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.showWhatsNewOnUpdate);
				tg.onChange(async (v) => await this.onOptionUpdate({ showWhatsNewOnUpdate: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("useBuiltinStyle").name)
			.setDesc(textsOf("useBuiltinStyle").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useBuiltinStyle);
				tg.onChange(async (v) => await this.onOptionUpdate({ useBuiltinStyle: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("useCounters").name)
			.setDesc(textsOf("useCounters").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useCounters);
				tg.onChange(async (v) => await this.onOptionUpdate({ useCounters: v }));
			});
		new Setting(containerEl)
			.setName(textsOf("counterBehavior").name)
			.setDesc(textsOf("counterBehavior").desc)
			.addDropdown(async (d) => {
				d.addOptions(optionsOf("counterBehavior"));
				d.setValue(this.plugin.userOptions.counterBehavior);
				d.onChange(
					async (v) =>
						await this.onOptionUpdate({
							counterBehavior: v as typeof this.plugin.userOptions.counterBehavior,
						}),
				);
			});

		new Setting(containerEl)
			.setName(textsOf("useQuickEntry").name)
			.setDesc(textsOf("useQuickEntry").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useQuickEntry);
				tg.onChange(async (v) => await this.onOptionUpdate({ useQuickEntry: v }, true));
			});

		new Setting(containerEl)
			.setName(textsOf("entryPosition").name)
			.setDesc(textsOf("entryPosition").desc)
			.addDropdown(async (d) => {
				d.addOptions(optionsOf("entryPosition"));
				d.setValue(this.plugin.userOptions.entryPosition);
				d.onChange(async (v) => await this.onOptionUpdate({ entryPosition: v as "today" | "top" | "bottom" }));
			});

		if (this.plugin.userOptions.useQuickEntry) {
			new Setting(containerEl)
				.setName(textsOf("taskFiles").name)
				.setDesc(textsOf("taskFiles").desc)
				.addTextArea((ta) => {
					ta.setPlaceholder(copy.settings.taskFiles.placeholder);
					ta.setValue(fileListCodec.format(this.plugin.userOptions.taskFiles));
					ta.onChange(async (v) => await this.onOptionUpdate({ taskFiles: fileListCodec.parse(v) }));
				});
			new Setting(containerEl)
				.setName(textsOf("inbox").name)
				.setDesc(textsOf("inbox").desc)
				.addText((t) => {
					t.setValue(trimmedTextCodec.format(this.plugin.userOptions.inbox));
					t.onChange(async (v) => await this.onOptionUpdate({ inbox: trimmedTextCodec.parse(v) }));
				});

			new Setting(containerEl)
				.setName(textsOf("sectionForNewTasks").name)
				.setDesc(textsOf("sectionForNewTasks").desc)
				.addText((t) => {
					t.setValue(plainTextCodec.format(this.plugin.userOptions.sectionForNewTasks));
					t.onChange(async (v) => await this.onOptionUpdate({ sectionForNewTasks: plainTextCodec.parse(v) }));
				});
		}

		new Setting(containerEl)
			.setName(textsOf("dailyNoteFolder").name)
			.setDesc(textsOf("dailyNoteFolder").desc)
			.addText((t) => {
				t.setValue(plainTextCodec.format(this.plugin.userOptions.dailyNoteFolder));
				t.onChange(async (v) => await this.onOptionUpdate({ dailyNoteFolder: plainTextCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("dailyNoteFormat").name)
			.setDesc(
				descriptionWithMomentDocsLink(
					textsOf("dailyNoteFormat").desc,
					copy.settings.dailyNoteFormat.descAfterLink,
				),
			)
			.addMomentFormat((m) => {
				m.setValue(plainTextCodec.format(this.plugin.userOptions.dailyNoteFormat));
				m.onChange(async (v) => await this.onOptionUpdate({ dailyNoteFormat: plainTextCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("useYearHeader").name)
			.setDesc(textsOf("useYearHeader").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useYearHeader);
				tg.onChange(async (v) => await this.onOptionUpdate({ useYearHeader: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("newestFirst").name)
			.setDesc(textsOf("newestFirst").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.newestFirst);
				tg.onChange(async (v) => await this.onOptionUpdate({ newestFirst: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("hideStatusTasks").name)
			.setDesc(textsOf("hideStatusTasks").desc)
			.addText(async (t) => {
				t.setPlaceholder(copy.settings.hideStatusTasks.placeholder);
				t.setValue(statusListCodec.format(this.plugin.userOptions.hideStatusTasks));
				t.onChange(async (v) => await this.onOptionUpdate({ hideStatusTasks: statusListCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("forward").name)
			.setDesc(textsOf("forward").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.forward);
				tg.onChange(async (v) => await this.onOptionUpdate({ forward: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("forwardPastStartAndScheduled").name)
			.setDesc(textsOf("forwardPastStartAndScheduled").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.forwardPastStartAndScheduled);
				tg.onChange(async (v) => await this.onOptionUpdate({ forwardPastStartAndScheduled: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("forwardUndatedDone").name)
			.setDesc(textsOf("forwardUndatedDone").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.forwardUndatedDone);
				tg.onChange(async (v) => await this.onOptionUpdate({ forwardUndatedDone: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("hideSubTasks").name)
			.setDesc(textsOf("hideSubTasks").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.hideSubTasks);
				tg.onChange(async (v) => await this.onOptionUpdate({ hideSubTasks: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("defaultTodayFocus").name)
			.setDesc(textsOf("defaultTodayFocus").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.defaultTodayFocus);
				tg.onChange(async (v) => await this.onOptionUpdate({ defaultTodayFocus: v }));
			});
		new Setting(containerEl)
			.setName(textsOf("defaultFilters").name)
			.setDesc(textsOf("defaultFilters").desc)
			.addDropdown(async (dd) => {
				dd.addOptions(optionsOf("defaultFilters"));
				dd.setValue(this.plugin.userOptions.defaultFilters);
				dd.onChange(async (v) => await this.onOptionUpdate({ defaultFilters: v }));
			});

		new Setting(containerEl).setName(copy.settings.groups.taskItems).setHeading();

		new Setting(containerEl)
			.setName(textsOf("useRelative").name)
			.setDesc(textsOf("useRelative").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useRelative);
				tg.onChange(async (v) => await this.onOptionUpdate({ useRelative: v }));
			});
		new Setting(containerEl)
			.setName(textsOf("useRecurrence").name)
			.setDesc(textsOf("useRecurrence").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useRecurrence);
				tg.onChange(async (v) => await this.onOptionUpdate({ useRecurrence: v }));
			});
		new Setting(containerEl)
			.setName(textsOf("usePriority").name)
			.setDesc(textsOf("usePriority").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.usePriority);
				tg.onChange(async (v) => await this.onOptionUpdate({ usePriority: v }));
			});

		const tagSettings = new Setting(containerEl);
		tagSettings.controlEl.empty();
		tagSettings.controlEl.appendChild(createDiv());
		let tagBadgeSetting = new Setting(tagSettings.controlEl.firstChild as HTMLElement);
		if (this.plugin.userOptions.useTags) {
			Object.entries(this.plugin.userOptions.tagColorPalette).forEach(([tag, color], index) => {
				if (index !== 0 && !(index & 0x01))
					tagBadgeSetting = new Setting(tagSettings.controlEl.firstChild as HTMLElement);
				tagBadgeSetting.controlEl.appendChild(
					createDiv({ cls: "tag", text: tag, attr: { style: `color: ${color}` } }),
				);
				tagBadgeSetting
					.addExtraButton(async (btn) => {
						btn.setIcon("cross")
							.setTooltip(copy.settings.tab.deleteTooltip)
							.onClick(async () => {
								await this.onOptionUpdate(
									{
										tagColorPalette: withoutTag(this.plugin.userOptions.tagColorPalette, tag),
									},
									true,
								);
							});
					})
					.addExtraButton(async (btn) => {
						btn.setIcon("pencil")
							.setTooltip(copy.settings.tab.editTooltip)
							.onClick(async () => {
								const modal = new TagColorPaletteModal(this.plugin, tag, color);
								modal.onClose = () => {
									if (!modal.valid) return;
									this.saveOptionsInBackground(
										{
											tagColorPalette: {
												...withoutTag(this.plugin.userOptions.tagColorPalette, tag),
												[modal.tagText]: modal.color,
											},
										},
										true,
									);
								};
								modal.open();
							});
					});
			});

			tagSettings.addExtraButton(async (btn) => {
				btn.setIcon("plus-with-circle")
					.setTooltip(copy.settings.tagColorPalette.addTooltip)
					.onClick(async () => {
						const modal = new TagColorPaletteModal(this.plugin);
						modal.onClose = () => {
							if (!modal.valid) return;
							this.saveOptionsInBackground(
								{
									tagColorPalette: {
										...this.plugin.userOptions.tagColorPalette,
										[modal.tagText]: modal.color,
									},
								},
								true,
							);
						};
						modal.open();
					});
			});
		}

		tagSettings
			.setName(textsOf("useTags").name)
			.setDesc(textsOf("useTags").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useTags);
				tg.onChange(async (v) => {
					await this.onOptionUpdate({ useTags: v }, true);
				});
			});

		this.tagsSettingItem(
			containerEl,
			textsOf("hideTags").name,
			textsOf("hideTags").desc,
			this.plugin.userOptions.hideTags,
			(t: string) => {
				return async () => {
					await this.onOptionUpdate(
						{ hideTags: this.plugin.userOptions.hideTags.filter((tag) => tag !== t) },
						true,
					);
				};
			},
			async (t: string) => {
				if (this.plugin.userOptions.hideTags.includes(t)) {
					new Notice(copy.settings.tab.tagExists({ tag: t }), 5000);
				} else {
					await this.onOptionUpdate({ hideTags: [...this.plugin.userOptions.hideTags, t] }, true);
				}
			},
		);

		new Setting(containerEl)
			.setName(textsOf("useFileBadge").name)
			.setDesc(textsOf("useFileBadge").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useFileBadge);
				tg.onChange(async (v) => this.onOptionUpdate({ useFileBadge: v }));
			});
		new Setting(containerEl)
			.setName(textsOf("useSection").name)
			.setDesc(textsOf("useSection").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useSection);
				tg.onChange(async (v) => await this.onOptionUpdate({ useSection: v }));
			});
		new Setting(containerEl)
			.setName(textsOf("useModifyBadge").name)
			.setDesc(textsOf("useModifyBadge").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useModifyBadge);
				tg.onChange(async (v) => await this.onOptionUpdate({ useModifyBadge: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("openNoteInsteadOfInPlace").name)
			.setDesc(textsOf("openNoteInsteadOfInPlace").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.openNoteInsteadOfInPlace);
				tg.onChange(async (v) => await this.onOptionUpdate({ openNoteInsteadOfInPlace: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("newDateStyle").name)
			.setDesc(textsOf("newDateStyle").desc)
			.addDropdown((d) => {
				d.addOptions(optionsOf("newDateStyle"));
				d.setValue(this.plugin.userOptions.newDateStyle);
				d.onChange(
					async (v) =>
						await this.onOptionUpdate({ newDateStyle: v as typeof this.plugin.userOptions.newDateStyle }),
				);
			});

		new Setting(containerEl).setName(copy.settings.groups.formatsAndFilters).setHeading();
		new Setting(containerEl)
			.setName(textsOf("dateFormat").name)
			.setDesc(descriptionWithMomentDocsLink(textsOf("dateFormat").desc, copy.settings.dateFormat.descAfterLink))
			.addMomentFormat(async (m) => {
				m.setPlaceholder(copy.settings.dateFormat.placeholder);
				m.setValue(plainTextCodec.format(this.plugin.userOptions.dateFormat));
				m.onChange(async (v) => await this.onOptionUpdate({ dateFormat: plainTextCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("sort").name)
			.setDesc(textsOf("sort").desc)
			.addDropdown(async (ta) => {
				ta.addOptions(optionsOf("sort"));
				ta.setValue(this.plugin.userOptions.sort);
				ta.onChange(async (v) => {
					await this.onOptionUpdate({ sort: v });
				});
			});

		new Setting(containerEl)
			.setName(textsOf("convert24HourTimePrefix").name)
			.setDesc(textsOf("convert24HourTimePrefix").desc)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.convert24HourTimePrefix);
				tg.onChange(async (v) => await this.onOptionUpdate({ convert24HourTimePrefix: v }));
			});

		new Setting(containerEl)
			.setName(textsOf("useIncludeTags").name)
			.setDesc(textsOf("useIncludeTags").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useIncludeTags).onChange(
					async (v) => await this.onOptionUpdate({ useIncludeTags: v }, true),
				);
			});

		if (this.plugin.userOptions.useIncludeTags) {
			this.tagsSettingItem(
				containerEl,
				textsOf("taskIncludeTags").name,
				textsOf("taskIncludeTags").desc,
				this.plugin.userOptions.taskIncludeTags,
				(t: string) => {
					return async () => {
						await this.onOptionUpdate(
							{ taskIncludeTags: this.plugin.userOptions.taskIncludeTags.filter((tag) => tag !== t) },
							true,
						);
					};
				},
				async (t: string) => {
					if (this.plugin.userOptions.taskIncludeTags.contains(t)) {
						new Notice(copy.settings.tab.tagExists({ tag: t }), 5000);
					} else {
						await this.onOptionUpdate(
							{ taskIncludeTags: [...this.plugin.userOptions.taskIncludeTags, t] },
							true,
						);
					}
				},
			);

			this.tagsSettingItem(
				containerEl,
				textsOf("fileIncludeTags").name,
				textsOf("fileIncludeTags").desc,
				this.plugin.userOptions.fileIncludeTags,
				(t: string) => {
					return async () => {
						await this.onOptionUpdate(
							{ fileIncludeTags: this.plugin.userOptions.fileIncludeTags.filter((tag) => tag !== t) },
							true,
						);
					};
				},
				async (t: string) => {
					if (this.plugin.userOptions.fileIncludeTags.contains(t)) {
						new Notice(copy.settings.tab.tagExists({ tag: t }), 5000);
					} else {
						await this.onOptionUpdate(
							{ fileIncludeTags: [...this.plugin.userOptions.fileIncludeTags, t] },
							true,
						);
					}
				},
			);
		}

		new Setting(containerEl)
			.setName(textsOf("useExcludeTags").name)
			.setDesc(textsOf("useExcludeTags").desc)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useExcludeTags).onChange(
					async (v) => await this.onOptionUpdate({ useExcludeTags: v }, true),
				);
			});

		if (this.plugin.userOptions.useExcludeTags) {
			this.tagsSettingItem(
				containerEl,
				textsOf("taskExcludeTags").name,
				textsOf("taskExcludeTags").desc,
				this.plugin.userOptions.taskExcludeTags,
				(t: string) => {
					return async () => {
						await this.onOptionUpdate(
							{ taskExcludeTags: this.plugin.userOptions.taskExcludeTags.filter((tag) => tag !== t) },
							true,
						);
					};
				},
				async (t: string) => {
					if (this.plugin.userOptions.taskExcludeTags.contains(t)) {
						new Notice(copy.settings.tab.tagExists({ tag: t }), 5000);
					} else {
						await this.onOptionUpdate(
							{ taskExcludeTags: [...this.plugin.userOptions.taskExcludeTags, t] },
							true,
						);
					}
				},
			);

			this.tagsSettingItem(
				containerEl,
				textsOf("fileExcludeTags").name,
				textsOf("fileExcludeTags").desc,
				this.plugin.userOptions.fileExcludeTags,
				(t: string) => {
					return async () => {
						await this.onOptionUpdate(
							{ fileExcludeTags: this.plugin.userOptions.fileExcludeTags.filter((tag) => tag !== t) },
							true,
						);
					};
				},
				async (t: string) => {
					if (this.plugin.userOptions.fileExcludeTags.contains(t)) {
						new Notice(copy.settings.tab.tagExists({ tag: t }), 5000);
					} else {
						await this.onOptionUpdate(
							{ fileExcludeTags: [...this.plugin.userOptions.fileExcludeTags, t] },
							true,
						);
					}
				},
			);
		}

		new Setting(containerEl)
			.setName(textsOf("excludePaths").name)
			.setDesc(descriptionWithWarning(textsOf("excludePaths").desc, PATH_FILTER_WARNING))
			.addTextArea((ta) => {
				ta.setPlaceholder(copy.settings.excludePaths.placeholder);
				ta.setValue(pathListCodec.format(this.plugin.userOptions.excludePaths));
				ta.onChange(async (v) => await this.onOptionUpdate({ excludePaths: pathListCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("excludeProperties").name)
			.setDesc(textsOf("excludeProperties").desc)
			.addTextArea((ta) => {
				ta.setPlaceholder(copy.settings.excludeProperties.placeholder);
				ta.setValue(propertyRulesCodec.format(this.plugin.userOptions.excludeProperties));
				ta.onChange(async (v) => await this.onOptionUpdate({ excludeProperties: propertyRulesCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("includePaths").name)
			.setDesc(descriptionWithWarning(textsOf("includePaths").desc, PATH_FILTER_WARNING))
			.addTextArea((ta) => {
				ta.setPlaceholder(copy.settings.includePaths.placeholder);
				ta.setValue(pathListCodec.format(this.plugin.userOptions.includePaths));
				ta.onChange(async (v) => await this.onOptionUpdate({ includePaths: pathListCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName(textsOf("filterEmpty").name)
			.setDesc(textsOf("filterEmpty").desc)
			.addToggle((to) => {
				to.setValue(this.plugin.userOptions.filterEmpty);
				to.onChange(async (v) => {
					await this.onOptionUpdate({ filterEmpty: v });
				});
			});
	}

	private tagsSettingItem = (
		container: HTMLElement,
		name: string,
		desc: string,
		tags: string[],
		ondelete: (t: string) => () => Promise<void>,
		onadd: (t: string) => Promise<void>,
	) => {
		const tagsSetting = new Setting(container).setName(name).setDesc(desc);
		tagsSetting.controlEl.empty();
		tagsSetting.controlEl.appendChild(createDiv());
		let tagsSettingControlEl = new Setting(tagsSetting.controlEl.firstChild as HTMLElement);
		tags.forEach((t, i) => {
			if (i !== 0 && i % 3 === 0)
				tagsSettingControlEl = new Setting(tagsSetting.controlEl.firstChild as HTMLElement);
			tagsSettingControlEl.controlEl.appendChild(createDiv({ cls: "tag", text: t }));
			tagsSettingControlEl.addExtraButton((eb) => {
				eb.setIcon("cross").setTooltip(copy.settings.tab.deleteTooltip).onClick(ondelete(t));
			});
		});

		tagsSetting.addExtraButton((eb) => {
			eb.setIcon("plus-with-circle");
			eb.onClick(() => {
				const modal = new TagModal(this.plugin);
				modal.onClose = () => {
					if (!modal.valid) return;
					onadd(modal.tagText).catch(reportSaveError);
				};
				modal.open();
			});
		});
	};
}

const MOMENT_FORMAT_DOCS_URL = "https://momentjs.com/docs/#/displaying/format/";
const PATH_FILTER_WARNING = copy.settings.tab.pathFilterWarning;

function descriptionWithMomentDocsLink(before: string, after: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.appendText(before);
		fragment.createEl("a", { text: copy.settings.tab.momentDocsLink, href: MOMENT_FORMAT_DOCS_URL });
		fragment.appendText(after);
	});
}

function descriptionWithWarning(description: string, warning: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.appendText(description);
		fragment.createEl("p", { text: warning, cls: "tasks-calendar-wrapper-setting-warning" });
	});
}

function withoutTag(palette: Record<string, string>, tag: string): Record<string, string> {
	return Object.fromEntries(Object.entries(palette).filter(([key]) => key !== tag));
}

function reportSaveError(error: unknown) {
	console.error("Tasks Calendar Wrapper: failed to save settings", error);
	new Notice(copy.settings.tab.saveFailed, 5000);
}

class TagColorPaletteModal extends Modal {
	tagText: string;
	color: string;
	valid: boolean;
	constructor(plugin: Plugin, tag?: string, color?: string) {
		super(plugin.app);
		this.tagText = tag || "";
		this.color = color || "";
		this.valid = false;
	}
	onOpen(): void {
		this.display();
	}
	display() {
		const { contentEl } = this;
		contentEl.empty();
		const settingdiv = contentEl.createDiv();
		new Setting(settingdiv)
			.setName(textsOf("tagColorPalette").name)
			.setDesc(textsOf("tagColorPalette").desc)
			.addText((t) => {
				t.setValue(this.tagText);
				t.onChange((v) => (this.tagText = v));
			})
			.addColorPicker((cp) => {
				cp.setValue(this.color);
				cp.onChange((v) => (this.color = v));
			});
		const footer = contentEl.createDiv();
		new Setting(footer)
			.addButton((btn) => {
				btn.setIcon("checkmark");
				btn.setTooltip(copy.settings.tab.saveTooltip);
				btn.onClick(() => {
					if (!this.tagText.match(TaskRegularExpressions.hashTags)) {
						this.valid = false;
						return new Notice(copy.settings.tab.invalidTag({ tag: this.tagText }), 5000);
					}
					if (this.color === "") {
						this.valid = false;
						return new Notice(copy.settings.tab.emptyColor, 5000);
					}
					this.valid = true;
					this.close();
				});
				return btn;
			})
			.addButton((btn) => {
				btn.setIcon("cross");
				btn.setTooltip(copy.settings.tab.cancelTooltip);
				btn.onClick(() => {
					this.valid = false;
					this.close();
				});
				return btn;
			});
	}
}

class TagModal extends Modal {
	tagText: string;
	valid: boolean;
	constructor(plugin: Plugin) {
		super(plugin.app);
		this.tagText = "";
		this.valid = false;
	}
	onOpen(): void {
		this.display();
	}
	display() {
		const { contentEl } = this;
		contentEl.empty();
		const settingdiv = contentEl.createDiv();
		new Setting(settingdiv)
			.setName(copy.settings.tab.tagModalName)
			.setDesc(copy.settings.tab.tagModalDesc)
			.addText((t) => {
				t.setValue(this.tagText);
				t.onChange((v) => {
					this.tagText = v;
				});
				return t;
			});
		const footer = contentEl.createDiv();
		new Setting(footer)
			.addButton((btn) => {
				btn.setIcon("checkmark");
				btn.setTooltip(copy.settings.tab.saveTooltip);
				btn.onClick(() => {
					if (!this.tagText.match(TaskRegularExpressions.hashTags)) {
						this.valid = false;
						new Notice(copy.settings.tab.invalidTag({ tag: this.tagText }), 5000);
					} else {
						this.valid = true;
					}
					this.close();
				});
				return btn;
			})
			.addButton((btn) => {
				btn.setIcon("cross");
				btn.setTooltip(copy.settings.tab.cancelTooltip);
				btn.onClick(() => {
					this.valid = false;
					this.close();
				});
				return btn;
			});
	}
}
