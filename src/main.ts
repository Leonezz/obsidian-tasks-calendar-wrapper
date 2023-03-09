import { Plugin } from 'obsidian';

import { TasksTimelineView, TIMELINE_VIEW } from './views';

import { defaultUserOptions, TasksCalendarSettingTab, UserOption } from './settings';
// Remember to rename these classes and interfaces!


export default class TasksCalendarWrapper extends Plugin {
	userOptions: UserOption = {} as UserOption;
	private timelineView: TasksTimelineView;
	async onload() {

		await this.loadOptions();

		this.registerView(
			TIMELINE_VIEW,
			(leaf) => {
				this.timelineView = new TasksTimelineView(leaf);
				this.timelineView.onUpdateOptions({ ...this.userOptions });
				return this.timelineView;
			}
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

		this.activateView(TIMELINE_VIEW);
	}

	onunload() {
		// this.app.workspace.detachLeavesOfType(TIMELINE_VIEW);
	}

	private updateOptions(updatedOpts: Partial<UserOption>) {
		Object.assign(this.userOptions, { ...updatedOpts });
		if (this.timelineView) this.timelineView.onUpdateOptions({ ...updatedOpts });
	}

	async loadOptions(): Promise<void> {
		this.updateOptions(defaultUserOptions);
		const options = await this.loadData();
		if (!!options) {
			this.updateOptions(options);
			await this.saveData(this.userOptions);
		}
	}

	async writeOptions(
		changedOpts: Partial<UserOption>
	): Promise<void> {
		this.updateOptions(changedOpts);
		await this.saveData(Object.assign({}, this.userOptions));
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
