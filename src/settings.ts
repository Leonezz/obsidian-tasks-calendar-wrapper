import { App, PluginSettingTab, Setting } from "obsidian";
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
    sort: ((t: TaskDataModel) => t.order) as ((t: TaskDataModel) => number),
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
    tagColorPalette: [] as string[],
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
    display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h1", { text: 'Timeline Settings' });
        containerEl.createEl("h2", { text: "UI Settings" });

        new Setting(containerEl)
            .setName("Enable Counters and Filters Panel")
            .setDesc("Use counters and filters on the today panel or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useCounters);
                tg.onChange(v => this.plugin.writeOptions({ useCounters: v }))
            })

        new Setting(containerEl)
            .setName("Enable Quick Entry Panel")
            .setDesc("Use quick entry panel or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useQuickEntry);
                tg.onChange(v => this.plugin.writeOptions({ useQuickEntry: v }));
            })

        new Setting(containerEl)
            .setName("Enable Year Header")
            .setDesc("Display the year on top of tasks of that year or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useYearHeader);
                tg.onChange(v => this.plugin.writeOptions({ useYearHeader: v }));
            })

        new Setting(containerEl)
            .setName("Display Completed Tasks")
            .setDesc("Display completed task or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useCompletedTasks);
                tg.onChange(v => this.plugin.writeOptions({ useCompletedTasks: v }));
            })
        new Setting(containerEl)
            .setName("Today Focus On Load")
            .setDesc("Activate today focus on load or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.defaultTodayFocus);
                tg.onChange(v => this.plugin.writeOptions({ defaultTodayFocus: v }));
            })
        new Setting(containerEl)
            .setName("Activate Filter On Load")
            .setDesc("Activate a filter or not")
            .addDropdown(dd => {
                dd.addOptions({
                    "": "No filters",
                    "todoFilter": "todo",
                    "overdueFilter": "overdue",
                    "unplannedFilter": "unplanned",
                });
                dd.setValue(this.plugin.userOptions.defaultFilters);
                dd.onChange(v => this.plugin.writeOptions({ defaultFilters: v }));
            })


        containerEl.createEl("h2", { text: "Task Item Visualization Settings" });

        new Setting(containerEl)
            .setName("Use Relative Date")
            .setDesc("Use relative date to describe the task dates or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useRelative);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(v => this.plugin.writeOptions({ useInfo: { ...useinfo, useRelative: v } }));
            })
        new Setting(containerEl)
            .setName("Use Recurrence")
            .setDesc("Display the recurrence information of tasks or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useRecurrence);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(v => this.plugin.writeOptions({ useInfo: { ...useinfo, useRecurrence: v } }));
            })
        new Setting(containerEl)
            .setName("Use Priority")
            .setDesc("Display the priority information of tasks or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.usePriority);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(v => this.plugin.writeOptions({ useInfo: { ...useinfo, usePriority: v } }));
            })
        new Setting(containerEl)
            .setName("Use Tags")
            .setDesc("Display the tags of tasks or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useTags);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(v => this.plugin.writeOptions({ useInfo: { ...useinfo, useTags: v } }));
            })
        new Setting(containerEl)
            .setName("Use Filename")
            .setDesc("Display which file the task is from or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useFileBadge);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(v => this.plugin.writeOptions({ useInfo: { ...useinfo, useFileBadge: v } }));
            })
        new Setting(containerEl)
            .setName("Use Section")
            .setDesc("Display which section the task is from or not.")
            .addToggle(tg => {
                tg.setValue(this.plugin.userOptions.useInfo.useSection);
                const useinfo = this.plugin.userOptions.useInfo;
                tg.onChange(v => this.plugin.writeOptions({ useInfo: { ...useinfo, useSection: v } }));
            })
    }
}
