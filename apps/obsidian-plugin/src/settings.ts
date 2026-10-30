import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	fileListCodec,
	pathListCodec,
	plainTextCodec,
	propertyRulesCodec,
	statusListCodec,
	trimmedTextCodec,
} from "@tasks-calendar-wrapper/core";
import { defaultSortKey, sortOptionLabels } from "@tasks-calendar-wrapper/core";
import { TaskRegularExpressions } from "@tasks-calendar-wrapper/core";
import TasksCalendarWrapper from "./main";
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

		containerEl.empty();

		new Setting(containerEl).setName("Interface").setHeading();

		new Setting(containerEl)
			.setName("Open View On Startup")
			.setDesc("Open the view on startup or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.openViewOnStartup);
				tg.onChange(async (v) => await this.onOptionUpdate({ openViewOnStartup: v }));
			});

		new Setting(containerEl)
			.setName("Show What's New After Updates")
			.setDesc(
				'Show the release notes once after the plugin is updated. They can always be opened with the "Show what\'s new" command.',
			)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.showWhatsNewOnUpdate);
				tg.onChange(async (v) => await this.onOptionUpdate({ showWhatsNewOnUpdate: v }));
			});

		new Setting(containerEl)
			.setName("Use Builtin Style")
			.setDesc(
				"Use builtin styles (the marker icons for task status) or not.\n\
                If disabled, styles defined by the theme you are using will be used.",
			)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useBuiltinStyle);
				tg.onChange(async (v) => await this.onOptionUpdate({ useBuiltinStyle: v }));
			});

		new Setting(containerEl)
			.setName("Enable Counters and Filters Panel")
			.setDesc("Use counters and filters on the quick entry panel or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useCounters);
				tg.onChange(async (v) => await this.onOptionUpdate({ useCounters: v }));
			});
		new Setting(containerEl)
			.setName("Behavior of Counters and Filters Panel")
			.setDesc(
				"Set the default behavior of the counter and filter buttons.\
                Available choices are: *Filter* to filter other items out,\
                or *Focus* to make selected items more clear.",
			)
			.addDropdown(async (d) => {
				d.addOptions({
					Filter: "Filter",
					Focus: "Focus",
				});
				d.setValue(this.plugin.userOptions.counterBehavior);
				d.onChange(
					async (v) =>
						await this.onOptionUpdate({
							counterBehavior: v as typeof this.plugin.userOptions.counterBehavior,
						}),
				);
			});

		new Setting(containerEl)
			.setName("Enable Quick Entry Panel")
			.setDesc("Use quick entry panel or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useQuickEntry);
				tg.onChange(async (v) => await this.onOptionUpdate({ useQuickEntry: v }, true));
			});

		new Setting(containerEl)
			.setName("Quick Entry Panel Position")
			.setDesc(
				"Where you like the entry panel to be,\
                * Top means on top of the view,\
                * Bottom means on bottom of the view,\
                * Today means in today's view.",
			)
			.addDropdown(async (d) => {
				d.addOptions({
					today: "today",
					top: "top",
					bottom: "bottom",
				});
				d.setValue(this.plugin.userOptions.entryPosition);
				d.onChange(async (v) => await this.onOptionUpdate({ entryPosition: v as "today" | "top" | "bottom" }));
			});

		if (this.plugin.userOptions.useQuickEntry) {
			new Setting(containerEl)
				.setName("Tasks Files")
				.setDesc(
					"Task Files you would like to specify explicitly for quick entry panel.\
                    make sure paths are separated by , .",
				)
				.addTextArea((ta) => {
					ta.setPlaceholder("comma separated file paths, e.g.: path1,path2");
					ta.setValue(fileListCodec.format(this.plugin.userOptions.taskFiles));
					ta.onChange(async (v) => await this.onOptionUpdate({ taskFiles: fileListCodec.parse(v) }));
				});
			new Setting(containerEl)
				.setName("Inbox")
				.setDesc(
					"Set a file as an 'Inbox' for task items from the quick entry panel.\
                    This file will be displayed on top of the file list.",
				)
				.addText((t) => {
					t.setValue(trimmedTextCodec.format(this.plugin.userOptions.inbox));
					t.onChange(async (v) => await this.onOptionUpdate({ inbox: trimmedTextCodec.parse(v) }));
				});

			new Setting(containerEl)
				.setName("Section For New Tasks")
				.setDesc("Specify under which section the new task items should be appended.")
				.addText((t) => {
					t.setValue(plainTextCodec.format(this.plugin.userOptions.sectionForNewTasks));
					t.onChange(async (v) => await this.onOptionUpdate({ sectionForNewTasks: plainTextCodec.parse(v) }));
				});
		}

		new Setting(containerEl)
			.setName("Daily Note Folder")
			.setDesc("Specify the folder where the daily notes are saved.")
			.addText((t) => {
				t.setValue(plainTextCodec.format(this.plugin.userOptions.dailyNoteFolder));
				t.onChange(async (v) => await this.onOptionUpdate({ dailyNoteFolder: plainTextCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Daily Note Format")
			.setDesc(
				descriptionWithMomentDocsLink(
					"Daily note file format. The format sould be of moment format, see ",
					" for more details.",
				),
			)
			.addMomentFormat((m) => {
				m.setValue(plainTextCodec.format(this.plugin.userOptions.dailyNoteFormat));
				m.onChange(async (v) => await this.onOptionUpdate({ dailyNoteFormat: plainTextCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Enable Year Header")
			.setDesc("Display the year on top of tasks of that year or not.")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useYearHeader);
				tg.onChange(async (v) => await this.onOptionUpdate({ useYearHeader: v }));
			});

		new Setting(containerEl)
			.setName("Newest First")
			.setDesc("Show the latest dates on top instead of the earliest.")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.newestFirst);
				tg.onChange(async (v) => await this.onOptionUpdate({ newestFirst: v }));
			});

		new Setting(containerEl)
			.setName("Hide tasks of specific status.")
			.setDesc(
				"Provide comma split status markers, e.g.,: x, - \n\
                Use [ ] if you would like to hide all tasks with marker [ ] or status todo.",
			)
			.addText(async (t) => {
				t.setPlaceholder("Status markers split by comma. e.g.,: x, -.");
				t.setValue(statusListCodec.format(this.plugin.userOptions.hideStatusTasks));
				t.onChange(async (v) => await this.onOptionUpdate({ hideStatusTasks: statusListCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Forward Tasks From Past")
			.setDesc(
				"Forward overdue tasks from the past and all unplanned tasks to display them on the today panel or not.",
			)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.forward);
				tg.onChange(async (v) => await this.onOptionUpdate({ forward: v }));
			});

		new Setting(containerEl)
			.setName("Forward Started And Scheduled Tasks")
			.setDesc(
				"Also show tasks that have started or were scheduled before today on the today panel. They are shown there instead of on their own date.",
			)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.forwardPastStartAndScheduled);
				tg.onChange(async (v) => await this.onOptionUpdate({ forwardPastStartAndScheduled: v }));
			});

		new Setting(containerEl)
			.setName("Forward Undated Done Tasks")
			.setDesc(
				"Show done tasks that have no date at all on the today panel. Turn it off to keep them out of the timeline.",
			)
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.forwardUndatedDone);
				tg.onChange(async (v) => await this.onOptionUpdate({ forwardUndatedDone: v }));
			});

		new Setting(containerEl)
			.setName("Hide Subtasks")
			.setDesc("Hide task items that are nested under another list item.")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.hideSubTasks);
				tg.onChange(async (v) => await this.onOptionUpdate({ hideSubTasks: v }));
			});

		new Setting(containerEl)
			.setName("Today Focus On Load")
			.setDesc("Activate today focus on load or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.defaultTodayFocus);
				tg.onChange(async (v) => await this.onOptionUpdate({ defaultTodayFocus: v }));
			});
		new Setting(containerEl)
			.setName("Activate Filter On Load")
			.setDesc("Activate a filter or not")
			.addDropdown(async (dd) => {
				dd.addOptions({
					"": "No filters",
					todoFilter: "todo",
					overdueFilter: "overdue",
					unplannedFilter: "unplanned",
				});
				dd.setValue(this.plugin.userOptions.defaultFilters);
				dd.onChange(async (v) => await this.onOptionUpdate({ defaultFilters: v }));
			});

		new Setting(containerEl).setName("Task items").setHeading();

		new Setting(containerEl)
			.setName("Use Relative Date")
			.setDesc("Use relative date to describe the task dates or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useRelative);
				tg.onChange(async (v) => await this.onOptionUpdate({ useRelative: v }));
			});
		new Setting(containerEl)
			.setName("Use Recurrence")
			.setDesc("Display the recurrence information of tasks or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useRecurrence);
				tg.onChange(async (v) => await this.onOptionUpdate({ useRecurrence: v }));
			});
		new Setting(containerEl)
			.setName("Use Priority")
			.setDesc("Display the priority information of tasks or not.")
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
							.setTooltip("Delete")
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
							.setTooltip("Edit")
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
					.setTooltip("Add a palette")
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
			.setName("Use Tags")
			.setDesc("Display the tags of tasks or not. Color palette can be defined for tags!")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useTags);
				tg.onChange(async (v) => {
					await this.onOptionUpdate({ useTags: v }, true);
				});
			});

		this.tagsSettingItem(
			containerEl,
			"Hide Tags",
			"Specify which tags are not necessary to display with a tag badge,\
            note that all tag texts are remove from the displayed item text by default.\
            Also note that the tags are just hided, not removed from the item.",
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
					new Notice(`Tag ${t} already exists.`, 5000);
				} else {
					await this.onOptionUpdate({ hideTags: [...this.plugin.userOptions.hideTags, t] }, true);
				}
			},
		);

		new Setting(containerEl)
			.setName("Use Filename")
			.setDesc("Display which file the task is from or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useFileBadge);
				tg.onChange(async (v) => this.onOptionUpdate({ useFileBadge: v }));
			});
		new Setting(containerEl)
			.setName("Use Section")
			.setDesc("Display which section the task is from or not.")
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.useSection);
				tg.onChange(async (v) => await this.onOptionUpdate({ useSection: v }));
			});
		new Setting(containerEl)
			.setName("Use Modify Badge")
			.setDesc("Display the badge that opens a task in the Tasks plugin dialog or not.")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useModifyBadge);
				tg.onChange(async (v) => await this.onOptionUpdate({ useModifyBadge: v }));
			});

		new Setting(containerEl).setName("Formats and filters").setHeading();
		new Setting(containerEl)
			.setName("Date Format")
			.setDesc(
				descriptionWithMomentDocsLink(
					"Specify format you would like to use for dates. Note that the format should be of moment format. See ",
					" for more details.",
				),
			)
			.addMomentFormat(async (m) => {
				m.setPlaceholder("e.g.: YYYY-MM-DD");
				m.setValue(plainTextCodec.format(this.plugin.userOptions.dateFormat));
				m.onChange(async (v) => await this.onOptionUpdate({ dateFormat: plainTextCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Sort By")
			.setDesc("Specify how you would like the taks item to be sorted inside a date.")
			.addDropdown(async (ta) => {
				ta.addOptions(sortOptionLabels);
				ta.setValue(this.plugin.userOptions.sort);
				ta.onChange(async (v) => {
					await this.onOptionUpdate({ sort: v });
				});
			});

		new Setting(containerEl)
			.setName("Convert Time Prefix")
			.setDesc(
				"Convert 24 hour time prefix to 12 hour time with am/pm. \n\
			    For example, 15:30 at the beginning of a task will become 3:30 pm.\n\
			    This is applied after sorting, enabling a chronological ordering.",
			)
			.addToggle(async (tg) => {
				tg.setValue(this.plugin.userOptions.convert24HourTimePrefix);
				tg.onChange(async (v) => await this.onOptionUpdate({ convert24HourTimePrefix: v }));
			});

		new Setting(containerEl)
			.setName("Use Include Tags")
			.setDesc("Use tags filters to filter tasks without specific tags out or not.")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useIncludeTags).onChange(
					async (v) => await this.onOptionUpdate({ useIncludeTags: v }, true),
				);
			});

		if (this.plugin.userOptions.useIncludeTags) {
			this.tagsSettingItem(
				containerEl,
				"Task Include Filters",
				"Filter tasks with specific tags, only tasks with one or more of these tags are displayed.",
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
						new Notice(`Tag ${t} already exists.`, 5000);
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
				"File Include Tags",
				"Filter tasks in specific files which contains one or more of these tags to be displayed.",
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
						new Notice(`Tag ${t} already exists.`, 5000);
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
			.setName("Use Exclude Tags")
			.setDesc("Use tags filters to filters tasks with specific tags out or not.")
			.addToggle((tg) => {
				tg.setValue(this.plugin.userOptions.useExcludeTags).onChange(
					async (v) => await this.onOptionUpdate({ useExcludeTags: v }, true),
				);
			});

		if (this.plugin.userOptions.useExcludeTags) {
			this.tagsSettingItem(
				containerEl,
				"Task Exclude Filters",
				"Filter tasks without specific tags, only tasks **without any** if these tags are displayed.",
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
						new Notice(`Tag ${t} already exists.`, 5000);
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
				"File Exclude Tags",
				"Filter tasks in specific files which **does not** contains any of these tags to be displayed.",
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
						new Notice(`Tag ${t} already exists.`, 5000);
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
			.setName("Exclude Paths")
			.setDesc(
				descriptionWithWarning("Exclude tasks match specific paths (folders, files).", PATH_FILTER_WARNING),
			)
			.addTextArea((ta) => {
				ta.setPlaceholder("comma separated file paths, e.g.: path1,path2/path3,path4.md");
				ta.setValue(pathListCodec.format(this.plugin.userOptions.excludePaths));
				ta.onChange(async (v) => await this.onOptionUpdate({ excludePaths: pathListCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Exclude Properties")
			.setDesc(
				"Exclude tasks of files whose frontmatter property has one of these values. " +
					"One property per line, values separated by commas.",
			)
			.addTextArea((ta) => {
				ta.setPlaceholder("status: archived, done");
				ta.setValue(propertyRulesCodec.format(this.plugin.userOptions.excludeProperties));
				ta.onChange(async (v) => await this.onOptionUpdate({ excludeProperties: propertyRulesCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Include Paths")
			.setDesc(
				descriptionWithWarning("Include tasks match specific paths (folders, files).", PATH_FILTER_WARNING),
			)
			.addTextArea((ta) => {
				ta.setPlaceholder("comma separated file paths, e.g.: path1,path2/path3,path4.md");
				ta.setValue(pathListCodec.format(this.plugin.userOptions.includePaths));
				ta.onChange(async (v) => await this.onOptionUpdate({ includePaths: pathListCodec.parse(v) }));
			});

		new Setting(containerEl)
			.setName("Filter Empty")
			.setDesc("Filter empty items out or not. If not, the raw text will be displayed.")
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
				eb.setIcon("cross").setTooltip("Delete").onClick(ondelete(t));
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
const PATH_FILTER_WARNING =
	"NOTE that no prefix or trailing '/' needed, unless you want to filter the entire vault out.";

function descriptionWithMomentDocsLink(before: string, after: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.appendText(before);
		fragment.createEl("a", { text: "docs of moment.js", href: MOMENT_FORMAT_DOCS_URL });
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
	new Notice("Failed to save the timeline settings. See the developer console for details.", 5000);
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
			.setName("Tag and color")
			.setDesc("Enter tag text (# included) in the text input and select color in the color selector.")
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
				btn.setTooltip("Save");
				btn.onClick(() => {
					if (!this.tagText.match(TaskRegularExpressions.hashTags)) {
						this.valid = false;
						return new Notice(`${this.tagText} seems not a valid tag.`, 5000);
					}
					if (this.color === "") {
						this.valid = false;
						return new Notice(
							"The color seems to be empty, maybe you forget to click the color picker.",
							5000,
						);
					}
					this.valid = true;
					this.close();
				});
				return btn;
			})
			.addButton((btn) => {
				btn.setIcon("cross");
				btn.setTooltip("Cancel");
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
			.setName("Tag")
			.setDesc("Enter tag text (# included) in the text input and select color in the color selector.")
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
				btn.setTooltip("Save");
				btn.onClick(() => {
					if (!this.tagText.match(TaskRegularExpressions.hashTags)) {
						this.valid = false;
						new Notice(`${this.tagText} seems not a valid tag.`, 5000);
					} else {
						this.valid = true;
					}
					this.close();
				});
				return btn;
			})
			.addButton((btn) => {
				btn.setIcon("cross");
				btn.setTooltip("Cancel");
				btn.onClick(() => {
					this.valid = false;
					this.close();
				});
				return btn;
			});
	}
}
