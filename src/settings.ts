import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingTab } from "obsidian";
import { TaskDataModel } from "utils/tasks";
import TasksCalendarWrapper from "./main";

export const defaultUserOptions = {
    /**
     * filter specific files and tasks only from these files are rendered */
    fileFilter: "" as string,
    /**
     * optional options to customize the look */
    styles: ['style1'] as string[],
    /**
     * specify the folder where the daily notes are saved */
    dailyNoteFolder: '' as string,
    /**
     * daily note file format */
    dailyNoteFormat: 'YYYY, MMMM DD - dddd' as string,
    /**
     * specify under which section the new task items should be appended.  */
    sectionForNewTasks: "## Tasks" as string,
    /**
     * specify which tags are not necessary to display with a tag badge,
     * note that all tag texts are remove from the displayed item text by default. */
    hideTags: [] as string[],
    /**
     * Forward tasks from the past and display them on the today panel or not
     */
    forward: true as boolean,
    /**
     * Specify how do you like the task item to be sorted, it must be a valid lambda
     */
    sort: "(t: TaskDataModel) => t.order",
    /**
     * Specify in what format do you like the dates to be displayed.
     */
    dateFormat: "dddd, MMM, D" as string,
    /**
     * Specify in which file do you like to append new task items to by default.
     * Tasks from this file will be displayed under today panel and labeled inbox by default.
     */
    inbox: "Inbox.md" as string,
    /**
     * Specify which files do you like to be displayed in the file select by default.
     * If left blank, all files where there are task items will be displayed. 
     */
    taskFiles: [] as string[],
    /**
     * Specify a color palette for tags.
     * Note that this will override other color setting for tags.
     */
    tagColorPalette: { "#TODO": "#339988", "#TEST": "#998877" } as any,
    /**
     * Use counters on the today panel or not
     */
    useCounters: true as boolean,
    /**
     * Use quick entry panel on the today panel or not
     */
    useQuickEntry: true as boolean,
    /**
     * Display which year it is or not.
     */
    useYearHeader: true as boolean,

    /**
     * Enable the whole info panel or not.
     */
    useInfo: {
        /**
        * Use relative dates to describe the task dates or not.
        */
        useRelative: true as boolean,
        /**
         * Display recurrence information of tasks or not.
         */
        useRecurrence: true as boolean,
        /**
         * Display priority information of tasks or not.
         */
        usePriority: true as boolean,
        /**
         * Display tags of tasks or not.
         */
        useTags: true as boolean,
        /**
         * Display which file the task is from or not.
         */
        useFileBadge: true as boolean,
        /** 
         * Display which section the task is from or not.
         */
        useSection: true as boolean,
    },
    /**
     * Display completed task or not.
     */
    useCompletedTasks: true as boolean,
    /**
     * Activate today focus on load or not.
     */
    defaultTodayFocus: false as boolean,
    /**
     * Activate a filter or not.
     */
    defaultFilters: "" as string,


};
export type UserOption = typeof defaultUserOptions;

export class TasksCalendarSettingTab extends PluginSettingTab {
    plugin: TasksCalendarWrapper;
    constructor(app: App, plugin: TasksCalendarWrapper) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private static createFragmentWithHTML = (html: string) =>
        createFragment((documentFragment) => (documentFragment.createDiv().innerHTML = html));

    async onOptionUpdate(updatePart: Partial<UserOption>, refreashSettingPage: boolean = false) {
        await this.plugin.writeOptions(updatePart);
        if (refreashSettingPage) {
            this.display();
        }
    }

    async display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h1", { text: 'Timeline Settings' });
        containerEl.createEl("h2", { text: "UI Settings" });

        new Setting(containerEl)
            .setName("Enable Counters and Filters Panel")
            .setDesc("Use counters and filters on the today panel or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useCounters);
                tg.onChange(async v => await this.onOptionUpdate({ useCounters: v }));
            })

        new Setting(containerEl)
            .setName("Enable Quick Entry Panel")
            .setDesc("Use quick entry panel or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useQuickEntry);
                tg.onChange(async v => await this.onOptionUpdate({ useQuickEntry: v }, true));
            })

        if (this.plugin.userOptions.useQuickEntry) {
            new Setting(containerEl)
                .setName("Tasks Files")
                .setDesc("Task Files you would like to specify explicitly for quick entry panel.\
                    make sure paths are separated by , .")
                .addTextArea(ta => {
                    ta.setPlaceholder("comma separated file paths, e.g.: path1,path2");
                    ta.setValue(this.plugin.userOptions.taskFiles.join(","));
                    ta.onChange(async v => {
                        const values = v.split(',');
                        const valuesTrimed = values.map(p => p.trim());
                        await this.onOptionUpdate({ taskFiles: valuesTrimed });
                    })
                })
            new Setting(containerEl)
                .setName("Inbox")
                .setDesc("Set a file as an 'Inbox' for task items from the quick entry panel.\
                    This file will be displayed on top of the file list.")
                .addText(t => {
                    t.setValue(this.plugin.userOptions.inbox);
                    t.onChange(async v => await this.onOptionUpdate({ inbox: v.trim() }));
                })

            new Setting(containerEl)
                .setName("Section For New Tasks")
                .setDesc("Specify under which section the new task items should be appended.")
                .addText(t => {
                    t.setValue(this.plugin.userOptions.sectionForNewTasks);
                    t.onChange(async v => await this.onOptionUpdate({ sectionForNewTasks: v }));
                })
        }

        new Setting(containerEl)
            .setName("Daily Note Folder")
            .setDesc("Specify the folder where the daily notes are saved.")
            .addText(t => {
                t.setValue(this.plugin.userOptions.dailyNoteFolder);
                t.onChange(async v => await this.onOptionUpdate({ dailyNoteFolder: v }));
            })

        new Setting(containerEl)
            .setName("Daily Note Format")
            .setDesc(
                TasksCalendarSettingTab.createFragmentWithHTML(
                    "Daily note file format.\
                    The format sould be of moment format,\
                    see <a href=https://momentjs.com/docs/#/displaying/format/>docs of moment.js</a>\
                    for more details."))
            .addMomentFormat(m => {
                m.setValue(this.plugin.userOptions.dailyNoteFormat);
                m.onChange(async v => await this.onOptionUpdate({ dailyNoteFormat: v }));
            })

        new Setting(containerEl)
            .setName("Enable Year Header")
            .setDesc("Display the year on top of tasks of that year or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useYearHeader);
                tg.onChange(async v => await this.onOptionUpdate({ useYearHeader: v }));
            })

        new Setting(containerEl)
            .setName("Display Completed Tasks")
            .setDesc("Display completed task or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useCompletedTasks);
                tg.onChange(async v => await this.onOptionUpdate({ useCompletedTasks: v }));
            })

        new Setting(containerEl)
            .setName("Forward Tasks From Past")
            .setDesc("Forward tasks from the past and display them on the today panel or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.forward);
                tg.onChange(async v => await this.onOptionUpdate({ forward: v }));
            })

        new Setting(containerEl)
            .setName("Today Focus On Load")
            .setDesc("Activate today focus on load or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.defaultTodayFocus);
                tg.onChange(async v => await this.onOptionUpdate({ defaultTodayFocus: v }));
            })
        new Setting(containerEl)
            .setName("Activate Filter On Load")
            .setDesc("Activate a filter or not")
            .addDropdown(async dd => {
                dd.addOptions({
                    "": "No filters",
                    "todoFilter": "todo",
                    "overdueFilter": "overdue",
                    "unplannedFilter": "unplanned",
                });
                dd.setValue(this.plugin.userOptions.defaultFilters);
                dd.onChange(async v => await this.onOptionUpdate({ defaultFilters: v }));
            })


        containerEl.createEl("h2", { text: "Task Item Visualization Settings" });

        new Setting(containerEl)
            .setName("Use Relative Date")
            .setDesc("Use relative date to describe the task dates or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useRelative);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(async v => await this.onOptionUpdate({ useInfo: { ...useinfo, useRelative: v } }));
            })
        new Setting(containerEl)
            .setName("Use Recurrence")
            .setDesc("Display the recurrence information of tasks or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useRecurrence);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(async v => await this.onOptionUpdate({ useInfo: { ...useinfo, useRecurrence: v } }));
            })
        new Setting(containerEl)
            .setName("Use Priority")
            .setDesc("Display the priority information of tasks or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useInfo.usePriority);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(async v => await this.onOptionUpdate({ useInfo: { ...useinfo, usePriority: v } }));
            })

        const tagSettings = new Setting(containerEl);
        tagSettings.controlEl.empty();
        tagSettings.controlEl.appendChild(createEl('div'));
        var tagBadgeSetting = new Setting(tagSettings.controlEl.firstChild as HTMLElement);
        if (this.plugin.userOptions.useInfo.useTags) {
            Object.entries(this.plugin.userOptions.tagColorPalette).forEach(([tag, color], index) => {
                if (index !== 0 && !(index & 0x01))
                    tagBadgeSetting = new Setting(tagSettings.controlEl.firstChild as HTMLElement);
                tagBadgeSetting.controlEl.appendChild(createEl('div', { cls: "tag", text: `${tag}`, attr: { style: `color: ${color}` } }));
                tagBadgeSetting
                    .addExtraButton(async btn => {
                        btn.setIcon("cross")
                            .setTooltip("Delete")
                            .onClick(async () => {
                                delete this.plugin.userOptions.tagColorPalette[tag]

                                await this.onOptionUpdate({}, true);
                            })

                    })
                    .addExtraButton(async btn => {
                        btn.setIcon("pencil")
                            .setTooltip("Edit")
                            .onClick(async () => {
                                const modal = new TagColorPaletteModal(this.plugin, tag, color as string);
                                modal.onClose = async () => {
                                    if (!modal.valid) return;
                                    this.plugin.userOptions.tagColorPalette[modal.tagText] = modal.color;

                                    await this.onOptionUpdate({}, true);
                                }
                                modal.open();
                            })
                    })
            })

            tagSettings
                .addExtraButton(async btn => {
                    btn.setIcon("plus-with-circle")
                        .setTooltip("Add a palette")
                        .onClick(async () => {
                            const modal = new TagColorPaletteModal(this.plugin)
                            modal.onClose = async () => {
                                if (!modal.valid) return;
                                this.plugin.userOptions.tagColorPalette[modal.tagText] = modal.color;

                                await this.onOptionUpdate({}, true);
                            }
                            modal.open();
                        })
                })
        }

        tagSettings
            .setName("Use Tags")
            .setDesc("Display the tags of tasks or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useTags);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(async v => {
                    await this.onOptionUpdate({ useInfo: { ...useinfo, useTags: v } }, true)
                });
            })

        const tagsHide = new Setting(containerEl)
            .setName("Hide Tags")
            .setDesc("specify which tags are not necessary to display with a tag badge,\
                note that all tag texts are remove from the displayed item text by default.")
        tagsHide.controlEl.empty();
        tagsHide.controlEl.appendChild(createDiv());
        var tagsHideControl = new Setting(tagsHide.controlEl.firstChild as HTMLElement);
        this.plugin.userOptions.hideTags.forEach((t, i) => {
            if (i !== 0 && i % 3 === 0) tagsHideControl = new Setting(tagsHide.controlEl.firstChild as HTMLElement);
            tagsHideControl.controlEl.appendChild(createEl('div', { cls: "tag", text: t }));
            tagsHideControl.addExtraButton(eb => {
                eb.setIcon("cross");
                eb.onClick(async () => {
                    this.plugin.userOptions.hideTags.remove(t);
                    await this.onOptionUpdate({}, true);
                })
            })
        })

        tagsHide.addExtraButton(eb => {
            eb.setIcon("plus-with-circle");
            eb.onClick(() => {
                const modal = new TagModal(this.plugin);
                modal.onClose = async () => {
                    if (!modal.valid) return;
                    if (this.plugin.userOptions.hideTags.contains(modal.tagText)) {
                        return new Notice(`Tag ${modal.tagText} already exists.`, 5000);
                    }
                    this.plugin.userOptions.hideTags.push(modal.tagText);
                    await this.onOptionUpdate({}, true);
                };
                modal.open();
            })
        })

        new Setting(containerEl)
            .setName("Use Filename")
            .setDesc("Display which file the task is from or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useFileBadge);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(async v => this.onOptionUpdate({ useInfo: { ...useinfo, useFileBadge: v } }));
            })
        new Setting(containerEl)
            .setName("Use Section")
            .setDesc("Display which section the task is from or not.")
            .addToggle(async tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useSection);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(async v => await this.onOptionUpdate({ useInfo: { ...useinfo, useSection: v } }));
            })

        containerEl.createEl("h2", { text: "Other Settings" })
        new Setting(containerEl)
            .setName("Date Format")
            .setDesc(TasksCalendarSettingTab.createFragmentWithHTML(
                "Specify format you would like to use for dates.\
                Note that the format should be of moment format.\
                See <a href=https://momentjs.com/docs/#/displaying/format/>docs of moment.js</a> for more details."
            ))
            .addMomentFormat(async m => {
                m.setPlaceholder("e.g.: YYYY-MM-DD");
                m.setValue(this.plugin.userOptions.dateFormat);
                m.onChange(async v => await this.onOptionUpdate({ dateFormat: v }));
            })

        new Setting(containerEl)
            .setName("Sort By")
            .setDesc(TasksCalendarSettingTab.createFragmentWithHTML(
                "Specify a callable (a lambda, a funcion and etc.) for sorting task items.\
                Note that the input must be a valid javascript callable definition of type: \
                (arg1: TaskDataModel, arg2: TaskDataModel) => number.\
                <p style='color: red'>Please do pay more attention on security when modifying this,\
                because the input string here is going to evaluate in javascript no matter what it is.</p>"))
            .addTextArea(async ta => {
                ta.setPlaceholder("e.g.: (t1) => t1.order or (t1, t2) => t1.order - t2.order");
                ta.setValue(this.plugin.userOptions.sort);
                ta.onChange(async v => {
                    const callable = eval(v);
                    if (typeof (callable) === typeof ((t1: TaskDataModel, t2: TaskDataModel) => 1)) {
                        await this.onOptionUpdate({ sort: v });
                        return;
                    }
                    new Notice(`type ${typeof callable} is not a valid callable, please check your input again.`, 5000);
                })
            })


    }
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
            .addText(t => {
                t.setValue(this.tagText);
                t.onChange(v => this.tagText = v);
                return t;
            })
            .addColorPicker(cp => {
                cp.setValue(this.color);
                cp.onChange(v => this.color = v);
                return cp;
            })
        const footer = contentEl.createDiv();
        new Setting(footer)
            .addButton(btn => {
                btn.setIcon("checkmark");
                btn.setTooltip("Save");
                btn.onClick(() => {
                    this.valid = (this.tagText !== "" && this.color !== "");
                    this.close();
                });
                return btn;
            })
            .addButton(btn => {
                btn.setIcon("cross");
                btn.setTooltip("Cancel");
                btn.onClick(() => {
                    this.valid = false;
                    this.close();
                });
                return btn;
            })
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
            .setName("Tag and color")
            .setDesc("Enter tag text (# included) in the text input and select color in the color selector.")
            .addText(t => {
                t.setValue(this.tagText);
                t.onChange(v => this.tagText = v);
                return t;
            })
        const footer = contentEl.createDiv();
        new Setting(footer)
            .addButton(btn => {
                btn.setIcon("checkmark");
                btn.setTooltip("Save");
                btn.onClick(() => {
                    this.valid = (this.tagText !== "");
                    this.close();
                });
                return btn;
            })
            .addButton(btn => {
                btn.setIcon("cross");
                btn.setTooltip("Cancel");
                btn.onClick(() => {
                    this.valid = false;
                    this.close();
                });
                return btn;
            })
    }
}