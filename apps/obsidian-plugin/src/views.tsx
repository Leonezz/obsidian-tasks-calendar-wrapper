import { Model } from "backbone";
import { CachedMetadata, debounce, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { resolveTasks, type ResolvedTask, type Task } from "@tasks-calendar-wrapper/core";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { readTasks } from "../timeline/src/taskadapter";
import { createRoot, Root } from "react-dom/client";
import { moment } from "../utils/moment";
import { changeAffectsTasks } from "../utils/refresh";
import { defaultUserOptions, UserOption } from "./useroptions";

export const TIMELINE_VIEW = "tasks_timeline_view";

/**
 * What the old view's list held of a task it showed. Backbone compared that list to decide whether the timeline had
 * changed, and replacing it cleared the quick filter. It kept a task's forwarded and other dates in a Map, which
 * Backbone's comparison does not look into, and it had neither the note's tags nor what comes before the list marker.
 */
export function heldOf(resolved: ResolvedTask) {
	const { task } = resolved;
	return {
		id: task.id,
		position: task.position,
		lineCount: task.lineCount,
		text: task.text,
		symbol: task.symbol,
		statusMarker: task.statusMarker,
		completed: task.completed,
		fullyCompleted: task.fullyCompleted,
		checked: task.checked,
		isTasksTask: task.isTasksTask,
		priority: task.priority,
		recurrence: task.recurrence,
		tags: task.tags,
		section: task.section,
		outlinks: task.outlinks,
		frontmatter: task.note.frontmatter,
		status: resolved.status,
		order: resolved.order,
		dailyNote: resolved.dailyNote,
		dates: resolved.dates,
		visual: resolved.visual,
	};
}

/** Changes that arrive within this time of each other are applied in one reload. */
const RELOAD_DELAY_MS = 500;

export class TasksTimelineView extends ItemView {
	private root?: Root;
	/**
	 * The tasks read at the last reload, and what the old view's list held of the ones shown then, see heldOf. The
	 * bridge renders again when either changes, and clears the quick filter when the list shown changes, as before.
	 */
	private taskListModel = new Model({
		tasks: [] as readonly Task[],
		shown: [] as ReturnType<typeof heldOf>[],
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

	/** Reloads the tasks with the options. Returns once the reload is done. */
	onUpdateOptions(opt: UserOption): Promise<void> {
		this.userOptionModel.clear();
		this.userOptionModel.set({ ...opt });
		return this.onReloadTasks();
	}

	/** Reads the tasks of the notes again. Returns once this reload, and one asked for while it ran, are done. */
	onReloadTasks(): Promise<void> {
		if (this.isReloading) {
			this.reloadAgain = true;
			return Promise.resolve();
		}
		this.isReloading = true;
		const options = this.userOptionModel.toJSON();
		return readTasks(this.app, options, moment)
			.then((tasks) => {
				this.filesWithTasks = new Set(tasks.map((task) => task.path));
				const taskfiles = this.userOptionModel.get("taskFiles");
				const { shown } = resolveTasks(tasks, options, { now: moment(), moment });
				this.taskListModel.set({ tasks, shown: shown.map(heldOf) });
				this.userOptionModel.set({ taskFiles: taskfiles || [] });
			})
			.catch((reason) => {
				new Notice("Error when generating tasks from files: " + reason, 5000);
				console.error("Tasks Calendar Wrapper: reloading tasks failed", reason);
			})
			.finally(() => {
				this.isReloading = false;
				if (this.reloadAgain) {
					this.reloadAgain = false;
					return this.onReloadTasks();
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
