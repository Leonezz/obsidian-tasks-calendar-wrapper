import { Notice, Plugin, requireApiVersion } from "obsidian";

import { TasksTimelineView, TIMELINE_VIEW, timelineTaskIndex } from "./views";

import { dayKey, notesSince, shouldShowWhatsNew } from "@tasks-calendar-wrapper/core";
import { createNoticePresenter } from "../timeline/src/notices";
import { getTasksDialog, getTasksToggle } from "../timeline/src/tasksplugin";
import { createTaskWriter } from "../timeline/src/taskwriter";
import { moment } from "../utils/moment";
import { RELEASE_NOTES, SUPPORT_LINKS } from "../utils/whatsnew";
import { WhatsNewModal } from "./whatsnew-modal";
import { ConfirmModal } from "./confirm-modal";
import { TasksCalendarSettingTab, UserOption } from "./settings";
import {
	changedState,
	createSettingsStore,
	loadedState,
	savedForm,
	type Settings,
	settingWarnings,
} from "./state/settings";
import { debounceOptionUpdates } from "../utils/refresh";

export default class TasksCalendarWrapper extends Plugin {
	private readonly settingsStore = createSettingsStore();
	/** The notes the timelines read, shared, see SharedTaskIndex: made with the first timeline, gone after the last. */
	private readonly taskIndex = timelineTaskIndex(this.app);
	private readonly writerNotices = createNoticePresenter(this.app);
	/** Every timeline hands its writes to this queue; its holds and timers belong to the plugin. */
	private readonly writer = createTaskWriter({
		app: this.app,
		index: this.taskIndex,
		tasks: () => getTasksToggle(this.app, moment),
		tasksDialog: () => getTasksDialog(this.app),
		confirm: (options) => new ConfirmModal(this.app, options).ask(),
		notices: this.writerNotices,
		moment,
		today: () => dayKey(moment()),
		now: () => Date.now(),
		setTimeout: (run, delay) => window.setTimeout(run, delay),
		clearTimeout: (timer) => window.clearTimeout(timer),
		newDateStyle: () => this.userOptions.newDateStyle,
		logger: console,
	});
	/** The settings tab, made in onload. */
	private settingsTab: TasksCalendarSettingTab | null = null;
	private readonly pushOptionsToViews = debounceOptionUpdates(() => {
		this.app.workspace.getLeavesOfType(TIMELINE_VIEW).forEach((leaf) => {
			if (leaf.view instanceof TasksTimelineView) {
				leaf.view.onUpdateOptions(this.userOptions);
			}
		});
	});

	/** The options, frozen; every load and every change replaces them, see state/settings.ts. */
	get userOptions(): Settings {
		return this.settingsStore.getSnapshot().options;
	}

	async onload() {
		this.register(() => this.pushOptionsToViews.cancel());
		// Registered before the view type, so it runs after the timelines closed: whatever is left, nothing is watched.
		this.register(() => this.taskIndex.dispose());
		this.register(() => {
			this.writer.dispose();
			this.writerNotices.dispose();
		});
		await this.loadOptions();
		this.registerView(TIMELINE_VIEW, (leaf) => {
			const view = new TasksTimelineView(leaf, this.taskIndex, this.writer, this.writerNotices);
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
		this.settingsTab = new TasksCalendarSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

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
		this.useSavedOptions((await this.loadData()) as Partial<UserOption> | null | undefined);
	}

	/** The options of data.json as loadData gave them: null when there is none, undefined when it could not be read. */
	private useSavedOptions(savedOptions: Partial<UserOption> | null | undefined): void {
		const state = loadedState(savedOptions);
		for (const warning of settingWarnings(savedOptions, state.options)) console.warn(warning);
		this.settingsStore.setState(state);
		this.pushOptionsToViews();
	}

	/**
	 * Obsidian calls this when data.json changes on disk while the plugin runs (Sync, git, a hand edit).
	 * Without reloading, the next save wrote the old settings back over the change, see issue #187.
	 * A data.json that cannot be read, as a half-written Sync file, keeps the settings, and the next save writes them
	 * back; Obsidian gives undefined for it and logs why. One that holds null gives the defaults, as at start. Obsidian
	 * does not call this for a removed one, as its modified time is then 0: the settings stay, and the next save writes
	 * the file again.
	 */
	async onExternalSettingsChange(): Promise<void> {
		let savedOptions: Partial<UserOption> | null | undefined;
		try {
			savedOptions = (await this.loadData()) as Partial<UserOption> | null | undefined;
		} catch (error) {
			console.error("Tasks Calendar Wrapper: reading data.json failed", error);
			savedOptions = undefined;
		}
		if (savedOptions === undefined) {
			new Notice(
				"Tasks Calendar Wrapper: data.json changed outside Obsidian but could not be read, so the settings stay as they were; the next change of a setting saves them. See the developer console.",
				10000,
			);
			return;
		}
		this.useSavedOptions(savedOptions);
		// From 1.13 Obsidian draws the settings tab again itself when it is open, see SettingTab.update.
		if (!requireApiVersion("1.13.0")) this.settingsTab?.redrawIfShown();
	}

	async writeOptions(changedOpts: Partial<UserOption>): Promise<void> {
		this.settingsStore.setState((state) => changedState(state, changedOpts));
		this.pushOptionsToViews();
		await this.saveData(savedForm(this.settingsStore.getSnapshot()));
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
