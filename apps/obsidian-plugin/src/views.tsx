import { Model } from "backbone";
import { CachedMetadata, debounce, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { ObsidianTaskAdapter } from "../timeline/src/taskadapter";
import { createRoot, Root } from "react-dom/client";
import { changeAffectsTasks } from "../utils/refresh";
import { filterTasks, parseTasks } from "../utils/tasklist";
import { TaskDataModel } from "../utils/tasks";
import { defaultUserOptions, UserOption } from "./settings";

export const TIMELINE_VIEW = "tasks_timeline_view";

/** Changes that arrive within this time of each other are applied in one reload. */
const RELOAD_DELAY_MS = 500;

export class TasksTimelineView extends ItemView {
	private root?: Root;
	private taskListModel = new Model({
		taskList: [] as TaskDataModel[],
	});

	private isReloading = false;
	/** A reload was asked for while one was running, so the list is loaded again when it is done. */
	private reloadAgain = false;
	/** The files that had tasks at the last reload. */
	private filesWithTasks: ReadonlySet<string> = new Set();
	private readonly requestReload = debounce(() => this.onReloadTasks(), RELOAD_DELAY_MS, true);
	private userOptionModel = new Model({ ...defaultUserOptions });
	static view: TasksTimelineView | null = null;
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

		TasksTimelineView.view = this;
	}

	async onOpen(): Promise<void> {
		// Only changes to files that have or had tasks reload the list, see issue #63.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file, _data, cache) => this.onFileChanged([file.path], cache)),
		);
		this.registerEvent(
			this.app.metadataCache.on("deleted", (file, prevCache) => this.onFileChanged([file.path], prevCache)),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile)
					this.onFileChanged([file.path, oldPath], this.app.metadataCache.getFileCache(file));
			}),
		);
		// When the view opens while Obsidian starts, the metadata of some files may not be read yet.
		const firstResolved = this.app.metadataCache.on("resolved", () => {
			this.app.metadataCache.offref(firstResolved);
			this.requestReload();
		});
		this.registerEvent(firstResolved);
		this.registerEvent(this.app.workspace.on("window-open", () => this.onReloadTasks()));

		const { containerEl } = this;
		const container = containerEl.children[1];

		container.empty();
		this.root = createRoot(container);
		this.root.render(
			<ObsidianBridge plugin={this} userOptionModel={this.userOptionModel} taskListModel={this.taskListModel} />,
		);
	}

	async onClose(): Promise<void> {
		this.requestReload.cancel();
		// Runs the components' cleanup, so a reload that finishes after closing renders nothing.
		this.root?.unmount();
		// Task rows render their markdown with this static view as the owner. Hand it to another open
		// timeline, so a closed view and its whole task list are not kept in memory.
		if (TasksTimelineView.view === this) {
			TasksTimelineView.view =
				this.app.workspace
					.getLeavesOfType(TIMELINE_VIEW)
					.map((leaf) => leaf.view)
					.find((view): view is TasksTimelineView => view instanceof TasksTimelineView && view !== this) ??
				null;
		}
	}

	private onFileChanged(paths: string[], cache: CachedMetadata | null): void {
		if (changeAffectsTasks(paths, cache, this.filesWithTasks)) this.requestReload();
	}

	onUpdateOptions(opt: UserOption) {
		this.userOptionModel.clear();
		this.userOptionModel.set({ ...opt });
		this.onReloadTasks();
	}

	onReloadTasks(): void {
		if (this.isReloading) {
			this.reloadAgain = true;
			return;
		}
		this.isReloading = true;
		const fileExcludeFilter = this.userOptionModel.get("excludePaths") || [];
		const fileIncludeFilter = this.userOptionModel.get("includePaths") || [];
		const fileIncludeTagsFilter = this.userOptionModel.get("fileIncludeTags") || [];
		const fileExcludeTagsFilter = this.userOptionModel.get("fileExcludeTags") || [];
		const excludeProperties = this.userOptionModel.get("excludeProperties") || {};
		const adapter = new ObsidianTaskAdapter(this.app);
		adapter
			.generateTasksList(
				fileIncludeFilter,
				fileExcludeFilter,
				fileIncludeTagsFilter,
				fileExcludeTagsFilter,
				excludeProperties,
			)
			.catch((reason) => {
				new Notice("Error when generating tasks from files: " + reason, 5000);
				throw reason;
			})
			.then(() => {
				const taskList = adapter.getTaskList();
				this.filesWithTasks = new Set(taskList.map((task) => task.path));
				// Returned, so the reload counts as running until the parsed list is shown.
				return parseTasks(taskList, this.userOptionModel.toJSON()).catch((reason) => {
					new Notice("Error when parsing task items: " + reason, 5000);
					throw reason;
				});
			})
			.then((tasks) => {
				tasks = filterTasks(tasks, this.userOptionModel.toJSON());
				const taskfiles = this.userOptionModel.get("taskFiles");
				this.taskListModel.set({ taskList: tasks });
				this.userOptionModel.set({ taskFiles: taskfiles || [] });
			})
			.catch((reason) => console.error("Tasks Calendar Wrapper: reloading tasks failed", reason))
			.finally(() => {
				this.isReloading = false;
				if (this.reloadAgain) {
					this.reloadAgain = false;
					this.onReloadTasks();
				}
			});
	}

	getViewType(): string {
		return TIMELINE_VIEW;
	}

	getDisplayText(): string {
		return "Tasks Timeline";
	}

	getIcon(): string {
		return "calendar-clock";
	}
}
