import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
	TasksCalendarView, CALENDAR_VIEW, TasksTimelineView,
	TIMELINE_VIEW, DEFAULT_CALENDAR_SETTINGS, DEFAULT_TIMELINE_SETTINGS
} from './views';
import { CalendarSettings, TimelineSettings } from './settings';

// Remember to rename these classes and interfaces!

interface TasksCalendarWrapperSettings {
	viewPath: string,
	calendarSettings: CalendarSettings,
	timelineSettings: TimelineSettings,
}

const DEFAULT_SETTINGS: TasksCalendarWrapperSettings = {
	viewPath: "scripts/",
	calendarSettings: DEFAULT_CALENDAR_SETTINGS,
	timelineSettings: DEFAULT_TIMELINE_SETTINGS
};

export default class TasksCalendarWrapper extends Plugin {
	settings: TasksCalendarWrapperSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			CALENDAR_VIEW,
			(leaf) => new TasksCalendarView(leaf, this.settings.calendarSettings)
		);

		this.registerView(
			TIMELINE_VIEW,
			(leaf) => new TasksTimelineView(leaf, this.settings.timelineSettings)
		);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-tasks-calendar-view',
			name: 'Open Tasks Calendar View',
			callback: () => {
				this.activateView(CALENDAR_VIEW);
			}
		});

		this.addCommand({
			id: 'open-tasks-timeline-view',
			name: 'Open Tasks Timeline View',
			callback: () => {
				this.activateView(TIMELINE_VIEW);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TasksCalendarSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(CALENDAR_VIEW);
		this.app.workspace.detachLeavesOfType(TIMELINE_VIEW);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		console.log(`Loaded: ${this.settings}`);
	}

	reload() {
		this.onunload();
		//this.load();
		this.loadSettings();
		this.activateView(CALENDAR_VIEW);
		this.activateView(TIMELINE_VIEW);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView(type: string) {
		if (type != CALENDAR_VIEW && type != TIMELINE_VIEW) {
			return;
		}
		this.app.workspace.detachLeavesOfType(type);

		await this.app.workspace.getLeaf(false).setViewState({
			type: type,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(type)[0]
		);
	}
}

class TasksCalendarSettingTab extends PluginSettingTab {
	plugin: TasksCalendarWrapper;
	oldViewPath: string;
	constructor(app: App, plugin: TasksCalendarWrapper) {
		super(app, plugin);
		this.plugin = plugin;
		this.oldViewPath = this.plugin.settings.viewPath;
	}

	refreshFiles(): void {

		if(this.oldViewPath === this.plugin.settings.viewPath)return;

		var fs = require('fs');
		var path = require('path');
		const root: string = this.app.vault.getRoot().vault.adapter.basePath;

		const folder: string = path.normalize(path.join(root, this.plugin.settings.viewPath));
		const oldFolderPath = path.normalize(path.join(root, this.oldViewPath));
		
		if(fs.existsSync(folder)){
			// #TODO: Need an error dialog
		}

		//this.plugin.settings.calendarSettings.viewPath = path.normalize(path.join(this.plugin.settings.viewPath, "calendar"));
		//this.plugin.settings.timelineSettings.viewPath = path.normalize(path.join(this.plugin.settings.viewPath, "timeline"));
		
		console.log(this.plugin.settings)

		const calendarViewPath = path.normalize(path.join(root, this.plugin.settings.viewPath, "calendar"));
		const timelineViewPath = path.normalize(path.join(root, this.plugin.settings.viewPath, "timeline"));

		function FileErrorHandle(err: Error) {
			new Notice(err.name + ": " + err.message, 5000);
			throw err;
		}

		fs.mkdir(calendarViewPath, { recursive: true }, FileErrorHandle);
		fs.mkdir(timelineViewPath, { recursive: true }, FileErrorHandle);

		const configFolder = this.app.vault.getRoot().vault.configDir;
		const sourcePath = path.normalize(path.join(root, configFolder, "plugins/obsidian-tasks-calendar-wrapper"));

		fs.copyFileSync(
			path.normalize(path.join(sourcePath, "Obsidian-Tasks-Calendar/tasksCalendar/view.css")),
			path.normalize(path.join(calendarViewPath, "view.css")));
		fs.copyFileSync(
			path.normalize(path.join(sourcePath, "Obsidian-Tasks-Calendar/tasksCalendar/view.js")),
			path.normalize(path.join(calendarViewPath, "view.js")));
		fs.copyFileSync(
			path.normalize(path.join(sourcePath, "Obsidian-Tasks-Timeline/Taskido/view.css")),
			path.normalize(path.join(timelineViewPath, "view.css")));
		fs.copyFileSync(
			path.normalize(path.join(sourcePath, "Obsidian-Tasks-Timeline/Taskido/view.js")),
			path.normalize(path.join(timelineViewPath, "view.js")));

		this.plugin.settings.viewPath = this.plugin.settings.viewPath.split(path.sep).join("/");
		this.plugin.settings.calendarSettings.viewPath = path.normalize(path.join(this.plugin.settings.viewPath, 'calendar'));
		this.plugin.settings.calendarSettings.viewPath = this.plugin.settings.calendarSettings.viewPath.split(path.sep).join("/");
		this.plugin.settings.timelineSettings.viewPath = path.normalize(path.join(this.plugin.settings.viewPath, 'timeline'));
		this.plugin.settings.timelineSettings.viewPath = this.plugin.settings.timelineSettings.viewPath.split(path.sep).join("/");

		this.plugin.saveSettings();
		this.plugin.reload();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h3", { text: 'Settings for Tasks View Wrapper.' });
		containerEl.createEl("h4", { text: "General" });

		var path = require('path')
		new Setting(containerEl)
			.setName("Script Path")
			.setDesc("Specify where to save the view scripts.\
				Leave empty if default path (scripts/) is good enough.\
				Note that folders start with . are not allowed.\
				If changed, you need to delete the original folder manually for data safety.")
			.addText((text) => {
				text.inputEl.type = "text";
				text.setPlaceholder("e.g.: folder1/folder2");
				if(this.plugin.settings.viewPath != ""){
					text.setValue(this.plugin.settings.viewPath);
				}
				text.onChange(async (value) => {
					const reg = /^(\/|(\/[\w\-\.]{1,20})+\/?)$/;
					if(!reg.test(value)){
						// #TODO: Need an error dialog
					}
					if(value != this.plugin.settings.viewPath){
						const root: string = await this.app.vault.getRoot().vault.adapter.basePath;
						
						if(path.isAbsolute(value)){
							this.plugin.settings.viewPath = path.relative(root, value);
						}else{
							this.plugin.settings.viewPath = value;	
						}
						//this.plugin.settings.viewPath = this.plugin.settings.viewPath.replace("\\", "/");
					}
				})
			})
			.addButton((button) => {
				button.setButtonText("Confirm");
				button.onClick((evt: MouseEvent) => {
					this.refreshFiles();
				})
			})

		this.makeCalendarSettingPage();
		this.makeTimelineSettingPage();

	}
	makeCalendarSettingPage(): void {
		this.containerEl.createEl("h4", { text: "Settings for Tasks Calendar View." });
		new Setting(this.containerEl)
			.setName("View Mode")
			.setDesc("Chose which mode do you like for calendar.")
			.addDropdown((dropdown) => {
				dropdown.addOption("list", "List view");
				dropdown.addOption("week", "Week view");
				dropdown.addOption("month", "Month view");
				dropdown.setValue(this.plugin.settings.calendarSettings.view);
				dropdown.onChange(async (value) => {
					this.plugin.settings.calendarSettings.view = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("First day of week")
			.setDesc("Start a week with Monday or Sunday.")
			.addDropdown((dropdown) => {
				dropdown.addOption("0", "Sunday");
				dropdown.addOption("1", "Monday");
				dropdown.setValue(this.plugin.settings.calendarSettings.firstDayOfWeek);
				dropdown.onChange(async (value) => {
					this.plugin.settings.calendarSettings.firstDayOfWeek = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("First page of calendar")
			.setDesc("Set the first month or week of this year.\
					The format is YYYY-MM in month view mode and\
					YYYY-WW in week view mode, where YYYY represents the year number,\
					MM and WW represent the month number and the week number respectively.\
					You can also leave it empty if it is not important to you.")
			.addText((text) => {
				text.setPlaceholder("YYYY-MM or YYYY-WW");
				if (null != this.plugin.settings.calendarSettings.startPosition)
					text.setValue(this.plugin.settings.calendarSettings.startPosition);
				text.onChange(async (value) => {
					this.plugin.settings.calendarSettings.startPosition = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Daily note path")
			.setDesc("Specify where the daily note (auto created when click\
					the days on the calendar) should be saved.\
					You can also leave it empty if the default path is good enough.")
			.addText((text) => {
				if (null !== this.plugin.settings.calendarSettings.dailyNoteFolder) {
					text.setValue(this.plugin.settings.calendarSettings.dailyNoteFolder)
				}
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.calendarSettings.dailyNoteFolder = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Daily note format")
			.setDesc("Specify how the daily note (auto created when click\
					the days on the calendar) should be named.\
					You can only specify the format with a limited set of characters:\
					Y M D [W] ww d . , - : (SPACE) \
					You can also leave it empty if the default path is good enough.")
			.addText((text) => {
				if (null !== this.plugin.settings.calendarSettings.dailyNoteFormat) {
					text.setValue(this.plugin.settings.calendarSettings.dailyNoteFormat)
				}
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.calendarSettings.dailyNoteFormat = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Filter")
			.setDesc("Specify how do you like to filter the vault if not all \"task items (i.e. - [ ] items \"\
					should be shown in the calendar. Please make sure the filtering expression is a valid dataviewjs query expression.\
					See https://blacksmithgu.github.io/obsidian-dataview/api/code-reference/ for more information.\
					If the filter code contains quotation marks (i.e. \" or \'), please add a backslash (i.e. \\) before.\
					You can also leave it default (leaving it empty is typically not valid) if all items are suited for the calendar.")
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.calendarSettings.pages)
				text.onChange(async (value) => {
					this.plugin.settings.calendarSettings.pages = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Hide tag texts from items")
			.setDesc("If you are using tags on task item so that they can be filtered,\
					now you can hide texts of the tags with this option.\
					By filling the text below, tag texts of the items shown in the calendar will be hidden,\
					and by leaving it empty, tags will also be shown in the calendar.")
			.addText((text) => {
				if (null !== this.plugin.settings.calendarSettings.globalTaskFilter)
					text.setValue(this.plugin.settings.calendarSettings.globalTaskFilter)
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.calendarSettings.globalTaskFilter = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Custom CSS")
			.setDesc("You can write custom css rules through this option.\
					Please use the developer console to identify the elements classes!\
					Each style string should start with .tasksCalendar to avoid css conflicts!")
			.addTextArea((text) => {
				text.setPlaceholder("CSS snippet here");
				if (null != this.plugin.settings.calendarSettings.css)
					text.setValue(this.plugin.settings.calendarSettings.css)
				text.onChange(async (value) => {
					this.plugin.settings.calendarSettings.css = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Other Customizable Options")
			.setDesc("You can customize styles, calendar behaviors and etc. with this option,\
					refer to https://github.com/702573N/Obsidian-Tasks-Calendar for more details.")
			.addTextArea((text) => {
				text.setPlaceholder("space splited sub-options, e.g.: style1 noProcess");
				if (null != this.plugin.settings.calendarSettings.options)
					text.setValue(this.plugin.settings.calendarSettings.options)
				text.onChange(async (value) => {
					console.log(value)
					this.plugin.settings.calendarSettings.options = value;
					this.plugin.saveSettings();
				})
			})
	}

	makeTimelineSettingPage(): void {
		this.containerEl.createEl("h4", { text: "Settings for Tasks Timeline View." });

		new Setting(this.containerEl)
			.setName("Daily note path")
			.setDesc("Specify where the daily note (auto created when click\
					the days on the calendar) should be saved.\
					You can also leave it empty if the default path is good enough.")
			.addText((text) => {
				if (null !== this.plugin.settings.timelineSettings.dailyNoteFolder) {
					text.setValue(this.plugin.settings.timelineSettings.dailyNoteFolder)
				}
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.dailyNoteFolder = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Daily note format")
			.setDesc("Specify how the daily note (auto created when click\
					the days on the calendar) should be named.\
					You can only specify the format with a limited set of characters:\
					Y M D [W] ww d . , - : (SPACE) \
					You can also leave it empty if the default path is good enough.")
			.addText((text) => {
				if (null !== this.plugin.settings.timelineSettings.dailyNoteFormat) {
					text.setValue(this.plugin.settings.timelineSettings.dailyNoteFormat)
				}
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.dailyNoteFormat = value;
					this.plugin.saveSettings();
				})
			})

			new Setting(this.containerEl)
			.setName("Select")
			.setDesc("Select the default file selection for the quick entry panel.\
				By default the daily note from today is selected, even it does not exist.\
				By pushing a new task into it, the selected note will be created automatically.")
			.addText((text) => {
				if (null != this.plugin.settings.timelineSettings.select)
					text.setValue(this.plugin.settings.timelineSettings.select)
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.select = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Inbox")
			.setDesc("With this parameter you can set a custom file as your Inbox to scratch tasks\
				first before moving them into the correct note file (GTD).\
				All tasks from within this file are listed on today,\
				even if the tasks have not yet been assigned a date at all.\
				In this way, tasks can be recorded quickly without having to be fully formulated.\
				So you can return to your actual activities and complete the follow-up of the tasks\
				at a later and more appropriate time.")
			.addText((text) => {
				if (null != this.plugin.settings.timelineSettings.inbox)
					text.setValue(this.plugin.settings.timelineSettings.inbox)
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.inbox = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Task File")
			.setDesc("With this parameter you can select files to show up inside quick entry select box.\
				You can specify this option with:\
				1. Specific tags.\
				2. Specific folders.\
				3. Combination.")
			.addText((text) => {
				if (null != this.plugin.settings.timelineSettings.taskFiles)
					text.setValue(this.plugin.settings.timelineSettings.taskFiles)
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.taskFiles = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Section")
			.setDesc("Set a section of a file where new tasks will be added below.\
				For example, if you set this option to \"## Tasks\", new tasks will be added below the section \"Tasks\".")
			.addText((text) => {
				text.setPlaceholder("Specify which section for new tasks. e.g.: ## Tasks")
				if (null !== this.plugin.settings.timelineSettings.section) {
					text.setValue(this.plugin.settings.timelineSettings.section);
				}
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.section = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Sort")
			.setDesc("Set the way you want the task items to be sorted with a lambda.\
				Please make sure the lambda is valid for dataview task values.")
			.addText((text) => {
				text.setPlaceholder("e.g.: t => t.order")
				if (null !== this.plugin.settings.timelineSettings.sort) {
					text.setValue(this.plugin.settings.timelineSettings.sort);
				}
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.sort = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Forward")
			.setDesc("Show uncompleted tasks from past on current date or not.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.timelineSettings.forward === "true");
				toggle.onChange(async (value) => {
					if (value) this.plugin.settings.timelineSettings.forward = "true";
					else this.plugin.settings.timelineSettings.forward = "false";
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Filter")
			.setDesc("Specify how do you like to filter the vault if not all \"task items (i.e. - [ ] items \"\
					should be shown in the calendar. Please make sure the filtering expression is a valid dataviewjs query expression.\
					See https://blacksmithgu.github.io/obsidian-dataview/api/code-reference/ for more information.\
					You can also leave it default (leaving it empty is typically not valid) if all items are suited for the calendar.")
			.addText((text) => {
				text.setValue(this.plugin.settings.timelineSettings.pages)
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.pages = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Hide tag texts from items")
			.setDesc("If you are using tags on task item so that they can be filtered,\
					now you can hide texts of the tags with this option.\
					By filling the text below, tag texts of the items shown in the timeline will be hidden,\
					and by leaving it empty, tags will also be shown in the timeline.")
			.addText((text) => {
				if (null !== this.plugin.settings.timelineSettings.globalTaskFilter)
					text.setValue(this.plugin.settings.timelineSettings.globalTaskFilter)
				text.inputEl.type = "text"
				text.onChange(async (value) => {
					this.plugin.settings.timelineSettings.globalTaskFilter = value;
					this.plugin.saveSettings();
				})
			})

		new Setting(this.containerEl)
			.setName("Other Customizable Options")
			.setDesc("You can customize styles, timeline behaviors and etc. with this option,\
					refer to https://github.com/702573N/Obsidian-Tasks-Calendar for more details.")
			.addTextArea((text) => {
				text.setPlaceholder("space splited sub-options, e.g.: style1 noProcess");
				if (null != this.plugin.settings.timelineSettings.options)
					text.setValue(this.plugin.settings.timelineSettings.options)
				text.onChange(async (value) => {
					console.log(value)
					this.plugin.settings.timelineSettings.options = value;
					this.plugin.saveSettings();
				})
			})
	}
}
