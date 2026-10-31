import { App, ItemView, MarkdownView, Notice, normalizePath, Pos, type UserEvent } from "obsidian";
import {
	createStore,
	dayKey,
	normalizeNotePath,
	pickResolveSettings,
	type DateValue,
	type LineTarget,
	type QuickFilter,
	type Store,
	type Task,
	type TaskRowModel,
} from "@tasks-calendar-wrapper/core";
import * as React from "react";
import isEqual from "underscore/modules/isEqual.js";
import { createResolveEnv } from "../../src/state/resolveenv";
import { initialTimelineState, type TimelineState } from "../../src/state/timeline";
import { UserOption } from "../../src/useroptions";
import { ConfirmModal } from "../../src/confirm-modal";
import { openNoteAt } from "../../src/open-note";
import { sameParseKey } from "../../utils/parsekey";
import { tagSearchUri, tasksPluginCommand } from "../../utils/utils";
import { appendTaskToNote } from "./appendtask";
import { changesInPlace } from "./taskactions";
import { writeFailureText } from "./notices";
import {
	createShiftLedger,
	REFUSAL_NOTICE_MS,
	type ShiftLedger,
	type TaskWriter,
	type WriteResult,
} from "./taskwriter";
import type { PendingWrites } from "./pendingwrites";
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from "./components/context";
import { recordProvider } from "./components/renderprobe";
import { TimelineView } from "./components/timelineview";

const defaultObsidianBridgeProps = {
	plugin: {} as ItemView,
	/** The view's state: the bridge renders its options, and the tasks read when the list shown last changed. */
	store: createStore<TimelineState>(initialTimelineState()) as Store<TimelineState>,
};
type ObsidianBridgeProps = Readonly<typeof defaultObsidianBridgeProps> & {
	readonly writer: Pick<TaskWriter, "insert" | "write">;
	readonly ledger?: ShiftLedger;
	readonly pendingWrites?: PendingWrites;
	readonly onWriteResult?: (target: LineTarget, result: WriteResult) => void;
	readonly resolveEnv?: ReturnType<typeof createResolveEnv>;
};
interface ObsidianBridgeState {
	readonly tasks: readonly Task[];
	readonly userOptions: UserOption;
	/** The quick entry panel's filter, kept until the user clears it or adds a task through the quick entry. */
	readonly quickFilter?: QuickFilter;
}

/**
 * The quick entry panel's filter. The priorities are copied: the panel goes on changing its own list, and the filter
 * is the one the button applied.
 */
export function quickFilterOf(
	from: string | undefined,
	to: string | undefined,
	priorities: readonly string[],
): QuickFilter {
	return Object.freeze({ from, to, priorities: Object.freeze([...priorities]) });
}

/** The bridge's state with the tasks of a new list shown, keeping the quick filter. */
export function withNewList(state: ObsidianBridgeState, tasks: readonly Task[]): ObsidianBridgeState {
	return { ...state, tasks };
}

export class ObsidianBridge extends React.Component<ObsidianBridgeProps, ObsidianBridgeState> {
	private readonly app: App;
	private readonly ledger: ShiftLedger;
	private readonly resolveEnv: ReturnType<typeof createResolveEnv>;
	private taskItemHandlers?: React.ContextType<typeof TaskItemEventHandlersContext>;
	private quickEntryHandlers?: React.ContextType<typeof QuickEntryHandlerContext>;
	/** The view's state the bridge last took its own from. */
	private seen: TimelineState;
	private unsubscribe?: () => void;
	constructor(props: ObsidianBridgeProps) {
		super(props);

		this.app = this.props.plugin.app;
		this.ledger = props.ledger ?? createShiftLedger();
		this.resolveEnv = props.resolveEnv ?? createResolveEnv();

		this.handleCreateNewTask = this.handleCreateNewTask.bind(this);
		this.handleTagClick = this.handleTagClick.bind(this);
		this.confirmCreateNote = this.confirmCreateNote.bind(this);
		this.handleOpenFile = this.handleOpenFile.bind(this);
		this.handleCompleteTask = this.handleCompleteTask.bind(this);
		this.onUpdateTasks = this.onUpdateTasks.bind(this);
		this.onStateChanged = this.onStateChanged.bind(this);
		this.handleModifyTask = this.handleModifyTask.bind(this);
		this.handleFilterEnable = this.handleFilterEnable.bind(this);

		this.seen = this.props.store.getSnapshot();
		this.state = { userOptions: this.seen.options, tasks: this.seen.tasks };
	}

	componentDidMount(): void {
		this.unsubscribe = this.props.store.subscribe(this.onStateChanged);
		// A change between reading the state and subscribing would not be heard of otherwise.
		this.onStateChanged();
	}

	componentWillUnmount(): void {
		this.unsubscribe?.();
	}

	/**
	 * After the view's state changed. New options and a changed list render again. A writer recheck also hands over
	 * the latest source lines when the visible list stays equal. Ordinary reloads keep the previous tasks until the
	 * list changes or quick entry brings them along. Reloads and option changes keep the quick filter.
	 */
	onStateChanged() {
		const next = this.props.store.getSnapshot();
		const before = this.seen;
		this.seen = next;
		if (next.options !== before.options) this.setState({ userOptions: next.options });
		// The tasks are read when React applies the change, as the old view's model was, so a reload that ends before
		// then with the same list shown brings its tasks along.
		if (next.shown !== before.shown || next.taskRevision !== before.taskRevision)
			this.setState((state) => withNewList(state, this.props.store.getSnapshot().tasks));
	}

	/** Shows the tasks read last, without the quick filter, as adding a task through the quick entry always did. */
	onUpdateTasks() {
		this.setState(() => ({ tasks: this.props.store.getSnapshot().tasks, quickFilter: undefined }));
	}

	/** The quick entry panel's filter, which core applies, see QuickFilter. */
	handleFilterEnable(startDate: string | undefined, endDate: string | undefined, priorities: string[]) {
		const quickFilter =
			!startDate && !endDate && priorities.length === 0
				? undefined
				: quickFilterOf(startDate, endDate, priorities);
		this.setState((state) => ({
			quickFilter: isEqual(state.quickFilter, quickFilter) ? state.quickFilter : quickFilter,
		}));
	}

	async handleCreateNewTask(path: string, append: string): Promise<boolean> {
		const notePath = normalizePath(normalizeNotePath(path));
		try {
			const added = await appendTaskToNote(
				this.app.vault,
				{
					insert: async (path, edit) => {
						const result = await this.props.writer.insert(path, edit);
						this.props.onWriteResult?.({ path, line: 0, sourceLine: "" }, result);
						return result;
					},
				},
				notePath,
				this.state.userOptions.sectionForNewTasks,
				"- [ ] " + append,
				this.confirmCreateNote,
			);
			if (added) this.onUpdateTasks();
			return added;
		} catch (reason) {
			console.error("Tasks Calendar Wrapper: adding a task failed", reason);
			new Notice(writeFailureText({ path: notePath, line: 0, text: append }, reason), REFUSAL_NOTICE_MS);
			return false;
		}
	}

	private confirmCreateNote(path: string): Promise<boolean> {
		return new ConfirmModal(this.app, {
			title: "Create note",
			message: "No such file: " + path + ". Would you like to create it?",
			confirmText: "Create",
		}).ask();
	}

	/** Searches for the tag through the documented obsidian://search URI, not the private API of the search plugin. */
	handleTagClick(tag: string) {
		window.open(tagSearchUri(this.app.vault.getName(), tag));
	}

	handleOpenFile(path: string, position: Pos, evt?: UserEvent) {
		openNoteAt(this.app, path, position.start.line, evt).catch((reason) => {
			console.error("Tasks Calendar Wrapper: opening a note failed", reason);
			new Notice(
				"Could not open " + path + ": " + (reason instanceof Error ? reason.message : String(reason)),
				5000,
			);
		});
	}

	handleModifyTask(model: TaskRowModel, evt: MouseEvent) {
		const { path, position } = model;
		if (!changesInPlace(this.state.userOptions)) {
			this.handleOpenFile(path, position, evt);
			return true;
		}
		openNoteAt(this.app, path, position.start.line)
			.then((leaf) => {
				if (leaf && leaf.view instanceof MarkdownView) {
					tasksPluginCommand(
						// @ts-expect-error commands is not part of the public API
						this.app.commands.commands,
						"obsidian-tasks-plugin:edit-task",
					).editorCheckCallback(false, leaf.view.editor, leaf.view);
				}
			})
			.catch((reason) => {
				console.error("Tasks Calendar Wrapper: opening a note failed", reason);
				new Notice(
					"Could not open " + path + ": " + (reason instanceof Error ? reason.message : String(reason)),
					5000,
				);
			});
	}

	/** Reads the row's target again when its turn in the note's write queue starts. */
	async handleCompleteTask(model: TaskRowModel, evt: MouseEvent): Promise<WriteResult | void> {
		if (!changesInPlace(this.state.userOptions)) {
			this.handleOpenFile(model.path, model.position, evt);
			return;
		}
		const { path } = model;
		let target: LineTarget = model;
		const result = await this.props.writer.write(
			() => (target = { path, line: this.ledger.shift(path, model.line), sourceLine: model.sourceLine }),
			{ kind: "toggle" },
		);
		this.props.onWriteResult?.(target, result);
		return result;
	}

	/**
	 * The same object on every render while the handlers stay the same, so task rows that did not
	 * change can skip rendering (issue #63). Modifying a task needs the Tasks plugin.
	 */
	getTaskItemHandlers(): React.ContextType<typeof TaskItemEventHandlersContext> {
		const handleModifyTask =
			// @ts-expect-error plugins is not part of the public API
			this.app.plugins.plugins["obsidian-tasks-plugin"] === undefined ? undefined : this.handleModifyTask;
		if (!this.taskItemHandlers || this.taskItemHandlers.handleModifyTask !== handleModifyTask) {
			this.taskItemHandlers = {
				handleOpenFile: this.handleOpenFile,
				handleCompleteTask: this.handleCompleteTask,
				handleTagClick: this.handleTagClick,
				handleModifyTask,
			};
		}
		return this.taskItemHandlers;
	}

	private getQuickEntryHandlers(): React.ContextType<typeof QuickEntryHandlerContext> {
		if (!this.quickEntryHandlers || this.quickEntryHandlers.quickFilter !== this.state.quickFilter) {
			this.quickEntryHandlers = {
				handleCreateNewTask: this.handleCreateNewTask,
				handleFilterEnable: this.handleFilterEnable,
				quickFilter: this.state.quickFilter,
			};
		}
		return this.quickEntryHandlers;
	}

	/** Checked on every timeline render, including its own counter clicks after midnight or a parse change. */
	private queryEnvFor(now: DateValue, tasks: readonly Task[], options: UserOption) {
		const { env, parseKey } = this.resolveEnv(now);
		const snapshot = this.props.store.getSnapshot();
		const { resolved } = snapshot;
		const prepared =
			resolved &&
			snapshot.tasks === tasks &&
			isEqual(resolved.under.settings, pickResolveSettings(options)) &&
			resolved.under.day === dayKey(now) &&
			sameParseKey(resolved.under.parseKey, parseKey)
				? resolved.shown
				: undefined;
		return { env, prepared };
	}

	render(): React.ReactNode {
		const { tasks, userOptions } = this.state;
		const quickEntryHandlers = this.getQuickEntryHandlers();
		process.env.NODE_ENV !== "production" && recordProvider("QuickEntryHandlerContext", quickEntryHandlers);
		return (
			<QuickEntryHandlerContext.Provider value={quickEntryHandlers}>
				<TaskItemEventHandlersContext.Provider value={this.getTaskItemHandlers()}>
					<TimelineView
						userOptions={userOptions}
						tasks={tasks}
						pendingWrites={this.props.pendingWrites}
						quickFilter={this.state.quickFilter}
						queryEnv={(now) => this.queryEnvFor(now, tasks, userOptions)}
					/>
				</TaskItemEventHandlersContext.Provider>
			</QuickEntryHandlerContext.Provider>
		);
	}
}
