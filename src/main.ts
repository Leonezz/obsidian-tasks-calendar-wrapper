import { App, Plugin, PluginSettingTab } from 'obsidian';

import { TasksTimelineView, TIMELINE_VIEW } from './views';

import { TimelineSettings } from '../utils/options';
import { TasksCalendarSettingTab } from './settings'
// Remember to rename these classes and interfaces!


export default class TasksCalendarWrapper extends Plugin {
	settings: TimelineSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			TIMELINE_VIEW,
			(leaf) => new TasksTimelineView(leaf, null)
		);

		// This adds a simple command that can be triggered anywhere
		
		this.addCommand({
			id: 'open-tasks-timeline-view',
			name: 'Open Tasks Timeline View',
			callback: () => {
				this.activateView(TIMELINE_VIEW);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TasksCalendarSettingTab(this.app, this));

		this.activateView(TIMELINE_VIEW)
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(TIMELINE_VIEW);
	}

	async loadSettings() {
		this.settings = Object.assign({}, {}, await this.loadData());
		console.log(`Loaded: ${this.settings}`);
	}

	reload() {
		this.onunload();
		//this.load();
		this.loadSettings();
		this.activateView(TIMELINE_VIEW);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView(type: string) {
		if (type != TIMELINE_VIEW) {
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
