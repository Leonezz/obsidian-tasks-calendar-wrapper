import { App, CachedMetadata, debounce, ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { createStore, dayKey, pickResolveSettings, resolveTasks, type LineTarget } from "@tasks-calendar-wrapper/core";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { createReadReporter } from "../timeline/src/readreporter";
import { createSharedTaskIndex, type ReaderSource, type SharedTaskIndex } from "../timeline/src/sharedindex";
import { watchChanges, type TaskIndexReader } from "../timeline/src/taskindex";
import { createShiftLedger, type TaskWriter, type WriteEvent, type WriteResult } from "../timeline/src/taskwriter";
import { createPendingWrites } from "../timeline/src/pendingwrites";
import { createUndoNotices } from "../timeline/src/undonotices";
import type { NoticePresenter } from "../timeline/src/notices";
import { flushSync } from "react-dom";
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
	/** Tasks belonging to the committed list, which can lag behind the store during a transition. */
	private shownTasks = this.store.getSnapshot().tasks;
	/** A concurrent mount can commit an older snapshot after pre-mount reloads already cleared. */
	private readonly mountingTasks = new Map<number, TimelineState["tasks"]>([[0, this.shownTasks]]);
	/** Reload clears wait in order until their list has committed. */
	private readonly uncommittedClears: {
		readonly reloadId: number;
		readonly releaseSeq: number;
		readonly kept: ReadonlySet<string>;
		readonly tasks: TimelineState["tasks"];
	}[] = [];
	/** Zero is the bridge's mount before any reload; real reload ids start at one. */
	private reloadId = 0;
	/** The latest reload reported by the bridge's commit. */
	private committedReloadId = 0;
	/** The latest reload that changed the list or handed over refreshed source lines. */
	private lastListReloadId = 0;
	/** Until the bridge mounts, there is no displayed list whose overlays must wait. */
	private bridgeCommitted = false;
	private readonly resolveEnv = createResolveEnv();
	readonly pendingWrites = createPendingWrites();
	readonly ledger = createShiftLedger();
	readonly viewWriter: Pick<TaskWriter, "write" | "insert" | "editInTasksDialog" | "refuseIfNotReread">;
	private readonly undoNotices: ReturnType<typeof createUndoNotices>;
	private readonly stopWrites: () => void;
	/** Events can release before the initiating call receives its result. */
	private readonly writes = new Map<number, WriteEvent>();
	private readonly releases = new Map<number, number>();
	/**
	 * The writes in flight per note, from pending until released or ended, and the held notes that changed meanwhile. A
	 * reload during a hold reads the pinned entry and clears nothing, so their reload waits for the last release.
	 */
	private readonly heldWrites = new Map<string, Set<number>>();
	private readonly changedWhileHeld = new Set<string>();
	/** A renamed or deleted note may release while the applied write is still awaiting its save. */
	private readonly renderedPending = new Set<number>();
	private refreshTasks = false;
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
	/** Quick entries indexed in the same tick reload once, see reloadWhenIndexed. */
	private earlyReloadScheduled = false;
	/** The files that had tasks at the last reload. */
	private filesWithTasks: ReadonlySet<string> = new Set();
	private readonly requestReload = debounce(() => this.onReloadTasks(), RELOAD_DELAY_MS, true);
	static view: TasksTimelineView | null = null;
	constructor(
		leaf: WorkspaceLeaf,
		notes: ReaderSource,
		private readonly writer: TaskWriter,
		notices: Pick<NoticePresenter, "undo">,
	) {
		super(leaf);
		this.reader = notes.openReader();
		this.undoNotices = createUndoNotices(writer, notices, { onWriteResult: this.onWriteResult });
		this.stopWrites = writer.onWrite((event) => this.onWrite(event));
		this.viewWriter = writer;

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
		this.root.render(
			<ObsidianBridge
				plugin={this}
				store={this.store}
				resolveEnv={this.resolveEnv}
				writer={this.viewWriter}
				ledger={this.ledger}
				pendingWrites={this.pendingWrites}
				onWriteResult={this.onWriteResult}
				onQuickEntryWritten={this.reloadWhenIndexed}
				onListCommitted={this.onListCommitted}
			/>,
		);
	}

	async onClose(): Promise<void> {
		this.requestReload.cancel();
		this.stopWrites();
		this.undoNotices.close();
		this.writes.clear();
		this.releases.clear();
		this.heldWrites.clear();
		this.changedWhileHeld.clear();
		this.renderedPending.clear();
		this.uncommittedClears.length = 0;
		this.mountingTasks.clear();
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

	/** Only this view's own successful writes shift the targets it has already rendered. */
	readonly onWriteResult = (target: LineTarget, result: WriteResult): void => {
		if (result.kind !== "written") return;
		if (!this.closed) this.recordShift(result);
		this.undoNotices.show(result);
	};

	/** Reloads after this view's quick entry is indexed, unless another write still holds the note. */
	readonly reloadWhenIndexed = (path: string, indexed: Promise<void>): void => {
		void indexed.then(() => {
			if (this.closed || this.heldWrites.has(path) || this.earlyReloadScheduled) return;
			this.earlyReloadScheduled = true;
			queueMicrotask(() => {
				this.earlyReloadScheduled = false;
				if (this.closed) return;
				// Cancelling drops other notes' armed requests too; this reload reads every dirty note
				// and consumes refreshTasks, so none of their changes are lost.
				this.requestReload.cancel();
				void this.onReloadTasks();
			});
		});
	};

	private recordShift(result: Extract<WriteResult, { kind: "written" }>): void {
		const event = this.writes.get(result.id);
		// A reload may have committed this release before the caller received its result.
		if (!event || event.kind === "overwritten") return;
		this.ledger.recordWrite(result.id, event.path, event.line, result.delta, event.insertBefore);
		const seq = this.releases.get(result.id);
		if (seq !== undefined) this.ledger.releaseWrite(result.id, seq);
	}

	private onWrite(event: WriteEvent): void {
		if (event.kind === "pending") {
			const held = this.heldWrites.get(event.path) ?? new Set<number>();
			held.add(event.id);
			this.heldWrites.set(event.path, held);
		} else if (["released", "refused", "failed", "unchanged", "overwritten"].includes(event.kind)) {
			const held = this.heldWrites.get(event.path);
			if (held?.delete(event.id) && held.size === 0) {
				this.heldWrites.delete(event.path);
				if (this.changedWhileHeld.delete(event.path)) this.requestReload();
			}
		}
		const { options } = this.store.getSnapshot();
		this.pendingWrites.apply(event, this.shownTasks, options, this.resolveEnv(moment()).env);
		const alreadyRendered = event.kind === "written" && this.renderedPending.delete(event.id);
		if (
			!alreadyRendered &&
			(event.kind === "pending" ||
				event.kind === "written" ||
				(event.kind === "overwritten" && this.writes.has(event.id)))
		)
			this.writes.set(event.id, event);
		if (["refused", "failed", "unchanged"].includes(event.kind)) {
			this.writes.delete(event.id);
			this.releases.delete(event.id);
			this.renderedPending.delete(event.id);
		}
		if (event.kind === "released" && event.releaseSeq !== undefined && this.writes.has(event.id)) {
			this.releases.set(event.id, event.releaseSeq);
			this.ledger.releaseWrite(event.id, event.releaseSeq);
		}
		if (["refused", "failed", "unchanged", "overwritten"].includes(event.kind)) this.ledger.clearWrite(event.id);
		if (event.kind === "recheck" || event.kind === "overwritten") {
			this.refreshTasks = true;
			this.requestReload();
		}
	}

	private onFileChanged(paths: string[], cache: CachedMetadata | null): void {
		if (!changeAffectsTasks(paths, cache, this.filesWithTasks)) return;
		// A reload cannot show a held note's changes or clear its overlays until its last write releases.
		if (paths.every((path) => this.heldWrites.has(path))) {
			for (const path of paths) this.changedWhileHeld.add(path);
			return;
		}
		this.requestReload();
	}

	/** Reloads the tasks with the options. Returns once the reload is done. */
	onUpdateOptions(opt: UserOption): Promise<void> {
		this.store.setState((state) => withOptions(state, opt));
		return this.onReloadTasks();
	}

	/** Clears releases in the layout phase of the commit that shows their reload's tasks. */
	readonly onListCommitted = (reloadId: number): void => {
		if (this.closed) return;
		this.bridgeCommitted = true;
		this.clearReloadsThrough(reloadId);
		const mounted = this.mountingTasks.get(reloadId);
		if (mounted) this.shownTasks = mounted;
		for (const id of this.mountingTasks.keys()) if (id <= reloadId) this.mountingTasks.delete(id);
		// A synchronous subscriber can commit before onReloadTasks has appended its clear.
		const snapshot = this.store.getSnapshot();
		if (snapshot.reloadId === reloadId) this.shownTasks = snapshot.tasks;
		this.committedReloadId = reloadId;
		if (reloadId >= this.lastListReloadId) {
			this.clearReloadsThrough(Infinity);
			this.shownTasks = snapshot.tasks;
			this.mountingTasks.clear();
		}
	};

	private clearReloadsThrough(reloadId: number): void {
		while (this.uncommittedClears.length && this.uncommittedClears[0].reloadId <= reloadId) {
			const { releaseSeq, kept, tasks } = this.uncommittedClears.shift()!;
			this.shownTasks = tasks;
			this.pendingWrites.clearThrough(releaseSeq, kept);
			this.ledger.clearThrough(releaseSeq, kept);
			for (const [id, event] of this.writes) {
				const seq = this.releases.get(id);
				if (seq !== undefined && seq <= releaseSeq && !kept.has(event.path)) {
					if (event.kind === "pending") this.renderedPending.add(id);
					this.writes.delete(id);
					this.releases.delete(id);
				}
			}
		}
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
		const releaseSeq = this.writer.releaseSeq();
		const refreshTasks = this.refreshTasks;
		this.refreshTasks = false;
		return this.reader
			.update(options)
			.then(({ tasks, warned, failures, pinned }) => {
				this.reporter.report({ warned, failures });
				this.filesWithTasks = new Set(tasks.map((task) => task.path));
				const { env, parseKey } = this.resolveEnv(moment());
				const resolved = resolveTasks(tasks, options, env);
				const kept = new Set(pinned);
				const before = this.store.getSnapshot();
				const reloadId = ++this.reloadId;
				this.store.setState((state) =>
					withReload(
						state,
						tasks,
						resolved.shown.map(heldOf),
						{
							shown: resolved,
							under: { settings: pickResolveSettings(options), day: dayKey(env.now), parseKey },
						},
						refreshTasks,
						reloadId,
					),
				);
				if (this.closed) return;
				const after = this.store.getSnapshot();
				if (after.shown !== before.shown || after.taskRevision !== before.taskRevision)
					this.lastListReloadId = reloadId;
				if (!this.bridgeCommitted) this.mountingTasks.set(reloadId, after.tasks);
				this.uncommittedClears.push({ reloadId, releaseSeq, kept, tasks: after.tasks });
				if (!this.bridgeCommitted || this.committedReloadId >= this.lastListReloadId)
					flushSync(() => this.clearReloadsThrough(reloadId));
			})
			.catch((reason) => {
				this.refreshTasks ||= refreshTasks;
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
