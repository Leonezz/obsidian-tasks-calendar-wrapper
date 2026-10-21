import { CachedMetadata, debounce, ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { createStore, resolveTasks } from "@tasks-calendar-wrapper/core";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { reportNoteReads } from "../timeline/src/taskadapter";
import { createTaskIndex, watchNotes } from "../timeline/src/taskindex";
import { createRoot, Root } from "react-dom/client";
import { moment } from "../utils/moment";
import { parseKeyOf } from "../utils/parsekey";
import { changeAffectsTasks } from "../utils/refresh";
import { heldOf, initialTimelineState, type TimelineState, withOptions, withReload } from "./state/timeline";
import { UserOption } from "./useroptions";

export const TIMELINE_VIEW = "tasks_timeline_view";

export { heldOf } from "./state/timeline";

/** Changes that arrive within this time of each other are applied in one reload. */
const RELOAD_DELAY_MS = 500;

export class TasksTimelineView extends ItemView {
	private root?: Root;
	/** The options, the tasks read last and the list shown, see TimelineState, which the bridge renders. */
	private readonly store = createStore<TimelineState>(initialTimelineState());
	/**
	 * The notes read at the last reload, so a reload reads only those that may have changed, see TaskIndex. A field,
	 * not made in onOpen, as the plugin's view factory hands the view its options, which reloads, before it opens.
	 * Obsidian's View has set this.app from the leaf by the time the fields are made.
	 */
	private readonly index = createTaskIndex({ app: this.app, moment, parseKey: () => parseKeyOf(moment) });

	private isReloading = false;
	/** A reload was asked for while one was running, so the list is loaded again when it is done. */
	private reloadAgain = false;
	/** The files that had tasks at the last reload. */
	private filesWithTasks: ReadonlySet<string> = new Set();
	private readonly requestReload = debounce(() => this.onReloadTasks(), RELOAD_DELAY_MS, true);
	static view: TasksTimelineView | null = null;
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

		TasksTimelineView.view = this;
	}

	async onOpen(): Promise<void> {
		// Every change marks its notes for the next reload to read. Only changes to files that have or had tasks
		// reload the list, see issue #63.
		for (const ref of watchNotes(this.app, this.index, (paths, cache) => this.onFileChanged(paths, cache)))
			this.registerEvent(ref);
		// The changes before the view listened went unheard, so the next reload reads every note.
		this.index.rereadAll();
		// When the view opens while Obsidian starts, the metadata of some files may not be read yet.
		const firstResolved = this.app.metadataCache.on("resolved", () => {
			this.app.metadataCache.offref(firstResolved);
			this.index.rereadAll();
			this.requestReload();
		});
		this.registerEvent(firstResolved);
		// A new window reloads at once and reads every note again, in case a change went unheard. The full read is asked
		// for before the reload starts, so that this reload is the one that does it.
		this.registerEvent(
			this.app.workspace.on("window-open", () => {
				this.index.rereadAll();
				return this.onReloadTasks();
			}),
		);

		const { containerEl } = this;
		const container = containerEl.children[1];

		container.empty();
		this.root = createRoot(container);
		this.root.render(<ObsidianBridge plugin={this} store={this.store} />);
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
		this.store.setState((state) => withOptions(state, opt));
		return this.onReloadTasks();
	}

	/**
	 * Reads the tasks of the notes that may have changed, see TaskIndex, and tells of the notes that warn or cannot be
	 * read, on every reload. Returns once this reload, and one asked for while it ran, are done.
	 */
	onReloadTasks(): Promise<void> {
		if (this.isReloading) {
			this.reloadAgain = true;
			return Promise.resolve();
		}
		this.isReloading = true;
		const { options } = this.store.getSnapshot();
		return this.index
			.update(options)
			.then(({ tasks, warnings, failures }) => {
				reportNoteReads(warnings, failures);
				this.filesWithTasks = new Set(tasks.map((task) => task.path));
				const { shown } = resolveTasks(tasks, options, { now: moment(), moment });
				this.store.setState((state) => withReload(state, tasks, shown.map(heldOf)));
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
