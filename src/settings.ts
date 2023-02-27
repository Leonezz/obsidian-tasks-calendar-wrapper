import { App, PluginSettingTab } from "obsidian";
import { TaskDataModel } from "utils/tasks";
import TasksCalendarWrapper from "./main";

const defaultUserOptions = {
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
};

export class TasksCalendarSettingTab extends PluginSettingTab {
	plugin: TasksCalendarWrapper;
	constructor(app: App, plugin: TasksCalendarWrapper) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display() {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h3", { text: 'Still working on re-designing the original user option system' });
		containerEl.createEl("h4", { text: "hopfully it will be released in the next version." });
	}
}
