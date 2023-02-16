import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';
import { TasksCalendarView, CALENDAR_VIEW, TasksTimelineView, TIMELINE_VIEW, DEFAULT_CALENDAR_SETTINGS, DEFAULT_TIMELINE_SETTINGS } from './views';
import { CalendarSettings, TimelineSettings } from 'settings';
// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	calendarSettings: CalendarSettings,
	timelineSettings: TimelineSettings,

}

const DEFAULT_SETTINGS: MyPluginSettings = {
	calendarSettings: DEFAULT_CALENDAR_SETTINGS,
	timelineSettings: DEFAULT_TIMELINE_SETTINGS
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			CALENDAR_VIEW,
			(leaf) => new TasksCalendarView(leaf, null)
		);
		
		this.registerView(
			TIMELINE_VIEW,
			(leaf) => new TasksTimelineView(leaf, null)
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
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(CALENDAR_VIEW);
		this.app.workspace.detachLeavesOfType(TIMELINE_VIEW);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView(type: string) {
		if(type != CALENDAR_VIEW && type != TIMELINE_VIEW){
			return;
		}
		this.app.workspace.detachLeavesOfType(type);
		
		await this.app.workspace.getRightLeaf(false).setViewState({
			type: type,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(type)[0]
		);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h1', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
