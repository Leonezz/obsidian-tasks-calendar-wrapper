import { Notice, Plugin } from "obsidian";

import { TasksTimelineView, TIMELINE_VIEW } from "./views";

import { copyJsonValue, notesSince, shouldShowWhatsNew } from "@tasks-calendar-wrapper/core";
import { RELEASE_NOTES, SUPPORT_LINKS } from "../utils/whatsnew";
import { WhatsNewModal } from "./whatsnew-modal";
import { TasksCalendarSettingTab, UserOption } from "./settings";
import { createSettingsStore, loadedSettings, type Settings, withChanges } from "./state/settings";
import { debounceOptionUpdates } from "../utils/refresh";

export default class TasksCalendarWrapper extends Plugin {
	private readonly settingsStore = createSettingsStore();
	private readonly pushOptionsToViews = debounceOptionUpdates(() => {
		this.app.workspace.getLeavesOfType(TIMELINE_VIEW).forEach((leaf) => {
			if (leaf.view instanceof TasksTimelineView) {
				leaf.view.onUpdateOptions(this.userOptions);
			}
		});
	});

	/** The options, frozen; every load and every change replaces them, see state/settings.ts. */
	get userOptions(): Settings {
		return this.settingsStore.getSnapshot();
	}

	async onload() {
		this.register(() => this.pushOptionsToViews.cancel());
		await this.loadOptions();
		this.registerView(TIMELINE_VIEW, (leaf) => {
			const view = new TasksTimelineView(leaf);
			view.onUpdateOptions(this.userOptions);
			return view;
		});
		if (this.userOptions.openViewOnStartup)
			this.app.workspace.onLayoutReady(() => {
				this.activateView(TIMELINE_VIEW).catch(reportError);
			});

		this.addCommand({
			id: "open-tasks-timeline-view",
			name: "Open Tasks Timeline View",
			callback: () => {
				this.activateView(TIMELINE_VIEW).catch(reportError);
			},
		});

		this.addCommand({
			id: "show-whats-new",
			name: "Show what's new",
			callback: () => {
				new WhatsNewModal(this.app, notesSince(RELEASE_NOTES, "", this.manifest.version), SUPPORT_LINKS).open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TasksCalendarSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.showWhatsNewAfterUpdate().catch((error) => {
				console.error("Tasks Calendar Wrapper: showing what's new failed", error);
			});
		});
	}

	/** Shows the release notes once after an update, and remembers the version they were shown for. */
	private async showWhatsNewAfterUpdate(): Promise<void> {
		const currentVersion = this.manifest.version;
		const lastSeenVersion = this.userOptions.lastSeenVersion;
		const notes = notesSince(RELEASE_NOTES, lastSeenVersion, currentVersion);
		const show = shouldShowWhatsNew({
			lastSeenVersion,
			currentVersion,
			enabled: this.userOptions.showWhatsNewOnUpdate,
		});
		if (show && notes.length > 0) new WhatsNewModal(this.app, notes, SUPPORT_LINKS).open();
		if (lastSeenVersion !== currentVersion) await this.writeOptions({ lastSeenVersion: currentVersion });
	}

	async loadOptions(): Promise<void> {
		const savedOptions = (await this.loadData()) as Partial<UserOption> | null;
		this.settingsStore.setState(loadedSettings(savedOptions));
		this.pushOptionsToViews();
	}

	/**
	 * Obsidian calls this when data.json changes on disk while the plugin runs (Sync, git, a hand edit).
	 * Without reloading, the next save wrote the old settings back over the change, see issue #187.
	 */
	async onExternalSettingsChange(): Promise<void> {
		await this.loadOptions();
	}

	async writeOptions(changedOpts: Partial<UserOption>): Promise<void> {
		this.settingsStore.setState((settings) => withChanges(settings, changedOpts));
		this.pushOptionsToViews();
		// Saved as a copy made by assignment, as before. Assignment drops a "__proto__" key a hand-edited data.json may
		// hold, and a copy that is not frozen keeps the keys after one from failing to be assigned.
		await this.saveData(Object.assign({}, copyJsonValue(this.userOptions)));
	}

	async activateView(type: string) {
		if (type !== TIMELINE_VIEW) {
			return;
		}

		const leaves = this.app.workspace.getLeavesOfType(type);
		if (leaves.length > 0) {
			await this.app.workspace.revealLeaf(leaves[0]);
			return;
		}

		this.app.workspace.detachLeavesOfType(type);
		await this.app.workspace.getRightLeaf(false)?.setViewState({
			type: type,
			active: true,
		});
	}
}

function reportError(error: unknown) {
	console.error("Tasks Calendar Wrapper: failed to open the timeline view", error);
	new Notice("Failed to open the timeline view. See the developer console for details.", 5000);
}
