import { App, CachedMetadata, debounce, ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { createStore, dayKey, pickResolveSettings, resolveTasks } from "@tasks-calendar-wrapper/core";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { createReadReporter } from "../timeline/src/readreporter";
import { createSharedTaskIndex, type ReaderSource, type SharedTaskIndex } from "../timeline/src/sharedindex";
import { watchChanges, type TaskIndexReader } from "../timeline/src/taskindex";
import { createRoot, Root } from "react-dom/client";
import { moment } from "../utils/moment";
import { parseKeyOf } from "../utils/parsekey";
import { changeAffectsTasks } from "../utils/refresh";
import { createResolveEnv } from "./state/resolveenv";
import { heldOf, initialTimelineState, type TimelineState, withOptions, withReload } from "./state/timeline";
import { UserOption } from "./useroptions";

export const TIMELINE_VIEW = "tasks_timeline_view";

export { heldOf } from "./state/timeline";

/** Changes that arrive within this time of each other are applied in one reload. */
const RELOAD_DELAY_MS = 500;

/** The plugin's shared task index, read with Obsidian's moment under the key of its locale and time zone. */
export function timelineTaskIndex(app: App): SharedTaskIndex {
	return createSharedTaskIndex({ app, moment, parseKey: () => parseKeyOf(moment) });
}

export class TasksTimelineView extends ItemView {
	private root?: Root;
	/** The options, the tasks read last and the list shown, see TimelineState, which the bridge renders. */
	private readonly store = createStore<TimelineState>(initialTimelineState());
	private readonly resolveEnv = createResolveEnv();
	/**
	 * This view's reader of the task index the plugin's timelines share, so a reload reads only the notes that may have
	 * changed, see TaskIndex. Opened in the constructor, not in onOpen, as the plugin's view factory hands the view its
	 * options, which reloads, before it opens; closed once the view is closed and its reloads are done.
	 */
	private readonly reader: TaskIndexReader;
	/** Set in onClose. The reader is closed then, or by the reload running then, once it and its follow-up are done. */
	private closed = false;
	/** What this timeline told of its reloads' warnings and failures, so it does not tell the same on each. */
	private readonly reporter = createReadReporter();

	private isReloading = false;
	/** A reload was asked for while one was running, so the list is loaded again when it is done. */
	private reloadAgain = false;
	/** The files that had tasks at the last reload. */
	private filesWithTasks: ReadonlySet<string> = new Set();
	private readonly requestReload = debounce(() => this.onReloadTasks(), RELOAD_DELAY_MS, true);
	static view: TasksTimelineView | null = null;
	constructor(leaf: WorkspaceLeaf, notes: ReaderSource) {
		super(leaf);
		this.reader = notes.openReader();

		TasksTimelineView.view = this;
	}

	async onOpen(): Promise<void> {
		// The shared index marks every change for the next reload to read, see watchNotes. Only changes to files that
		// have or had tasks reload the list, see issue #63.
		for (const ref of watchChanges(this.app, (paths, cache) => this.onFileChanged(paths, cache)))
			this.registerEvent(ref);
		// The next reload reads every note, as it always has. The shared index has heard every change since the view
		// was made, so this is now only a defence, in case one went unheard.
		this.reader.rereadAll();
		// When the view opens while Obsidian starts, the metadata of some files may not be read yet.
		const firstResolved = this.app.metadataCache.on("resolved", () => {
			this.app.metadataCache.offref(firstResolved);
			this.reader.rereadAll();
			this.requestReload();
		});
		this.registerEvent(firstResolved);
		// A new window reloads at once and reads every note again, in case a change went unheard. The full read is asked
		// for before the reload starts, so that this reload is the one that does it.
		this.registerEvent(
			this.app.workspace.on("window-open", () => {
				this.reader.rereadAll();
				return this.onReloadTasks();
			}),
		);

		const { containerEl } = this;
		const container = containerEl.children[1];

		container.empty();
		this.root = createRoot(container);
		this.root.render(<ObsidianBridge plugin={this} store={this.store} resolveEnv={this.resolveEnv} />);
	}

	async onClose(): Promise<void> {
		this.requestReload.cancel();
		// A reload that runs or waits goes on, and so does the one asked for while it ran; the last of them closes the
		// reader, so the notes this view shows stay for them, and they read the changes the index marks until then.
		// The last reader closed drops the shared index.
		this.closed = true;
		if (!this.isReloading) this.reader.close();
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
	 * read what it has not told yet, see ReadReporter. Returns once this reload, and one asked for while it ran, are
	 * done.
	 */
	onReloadTasks(): Promise<void> {
		if (this.isReloading) {
			this.reloadAgain = true;
			return Promise.resolve();
		}
		this.isReloading = true;
		const { options } = this.store.getSnapshot();
		return this.reader
			.update(options)
			.then(({ tasks, warned, failures }) => {
				this.reporter.report({ warned, failures });
				this.filesWithTasks = new Set(tasks.map((task) => task.path));
				const { env, parseKey } = this.resolveEnv(moment());
				const resolved = resolveTasks(tasks, options, env);
				this.store.setState((state) =>
					withReload(state, tasks, resolved.shown.map(heldOf), {
						shown: resolved,
						under: { settings: pickResolveSettings(options), day: dayKey(env.now), parseKey },
					}),
				);
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
				if (this.closed) this.reader.close();
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
