import { Plugin } from 'obsidian';

import { TasksTimelineView, TIMELINE_VIEW } from './views';

import { defaultUserOptions, TasksCalendarSettingTab, UserOption } from './settings';
// Remember to rename these classes and interfaces!


export default class TasksCalendarWrapper extends Plugin {
	userOptions: UserOption = {} as UserOption;
	private userOptionsReloading = false;
	async onload() {
		await this.loadOptions();
		this.registerView(
			TIMELINE_VIEW,
			(leaf) => {
				const view = new TasksTimelineView(leaf);
				view.onUpdateOptions({ ...this.userOptions });
				return view;
			}
		);
        if (this.userOptions.openViewOnStartup)
			this.app.workspace.onLayoutReady(
				async () => await this.activateView(TIMELINE_VIEW)
			);
		// this.app.workspace.onLayoutReady(async () => await this.initView(TIMELINE_VIEW))
		// this.app.workspace.getActiveViewOfType(TasksTimelineView)?.onUpdateOptions({ ...this.userOptions })
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
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(TIMELINE_VIEW);
	}

	private updateOptions(updatedOpts: Partial<UserOption>) {
		Object.assign(this.userOptions, { ...updatedOpts });
		console.log(this.app.workspace.getLeavesOfType(TIMELINE_VIEW))
		if (!this.userOptionsReloading) {
			this.userOptionsReloading = true;
			setTimeout(() => {
				this.app.workspace.getLeavesOfType(TIMELINE_VIEW).forEach(leaf => {
					if (leaf.view instanceof TasksTimelineView) {
						leaf.view.onUpdateOptions({ ...this.userOptions });
					}
				});
				this.userOptionsReloading = false;
			}, 5000);
		}
	}

	async loadOptions(): Promise<void> {
		this.userOptions = Object.assign({}, defaultUserOptions, await this.loadData());
		this.updateOptions(this.userOptions);
	}

	async writeOptions(
		changedOpts: Partial<UserOption>
	): Promise<void> {
		this.updateOptions(changedOpts);
		await this.saveData(Object.assign({}, this.userOptions));
	}

	async activateView(type: string) {
		if (type !== TIMELINE_VIEW) {
			return;
		}

        const leaves = this.app.workspace.getLeavesOfType(type);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}

		this.app.workspace.detachLeavesOfType(type);
		try {
			await this.app.workspace.getRightLeaf(false)?.setViewState({
				type: type,
				active: true,
			});
		} catch (e) {
			console.log(e)
		}
    }
}
