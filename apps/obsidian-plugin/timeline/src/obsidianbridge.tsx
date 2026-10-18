import { Model } from "backbone";
import { App, ItemView, Notice, normalizePath, Pos } from "obsidian";
import type { QuickFilter, Task } from "@tasks-calendar-wrapper/core";
import * as React from "react";
import { UserOption, defaultUserOptions } from "../../src/useroptions";
import { ConfirmModal } from "../../src/confirm-modal";
import { normalizeNotePath } from "../../utils/quickentry";
import { tagSearchUri, tasksPluginCommand } from "../../utils/utils";
import { appendTaskToNote } from "./appendtask";
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from "./components/context";
import { TimelineView } from "./components/timelineview";

const defaultObsidianBridgeProps = {
	plugin: {} as ItemView,
	userOptionModel: new Model({ ...defaultUserOptions }) as Model,
	taskListModel: new Model({ tasks: [] as readonly Task[], shown: [] }) as Model,
};
type ObsidianBridgeProps = Readonly<typeof defaultObsidianBridgeProps>;
interface ObsidianBridgeState {
	readonly tasks: readonly Task[];
	readonly userOptions: UserOption;
	/** The quick entry panel's filter, applied to the tasks until the list shown changes. */
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

/** The bridge's state with the tasks of a new list shown. The quick filter goes with the old list, as it did. */
export function withNewList(state: ObsidianBridgeState, tasks: readonly Task[]): ObsidianBridgeState {
	return { ...state, tasks, quickFilter: undefined };
}

export class ObsidianBridge extends React.Component<ObsidianBridgeProps, ObsidianBridgeState> {
	//private readonly adapter: ObsidianTaskAdapter;
	private readonly app: App;
	private taskItemHandlers?: React.ContextType<typeof TaskItemEventHandlersContext>;
	constructor(props: ObsidianBridgeProps) {
		super(props);

		this.app = this.props.plugin.app;

		this.handleCreateNewTask = this.handleCreateNewTask.bind(this);
		this.handleTagClick = this.handleTagClick.bind(this);
		this.confirmCreateNote = this.confirmCreateNote.bind(this);
		this.handleOpenFile = this.handleOpenFile.bind(this);
		this.handleCompleteTask = this.handleCompleteTask.bind(this);
		this.onUpdateTasks = this.onUpdateTasks.bind(this);
		this.onTasksChanged = this.onTasksChanged.bind(this);
		this.onUpdateUserOption = this.onUpdateUserOption.bind(this);
		this.handleModifyTask = this.handleModifyTask.bind(this);
		this.handleFilterEnable = this.handleFilterEnable.bind(this);

		this.state = {
			userOptions: { ...(this.props.userOptionModel.pick(this.props.userOptionModel.keys()) as UserOption) },
			tasks: this.props.taskListModel.get("tasks"),
		};
	}

	componentDidMount(): void {
		this.props.taskListModel.on("change", this.onTasksChanged);
		this.props.userOptionModel.on("change", this.onUpdateUserOption);
	}

	componentWillUnmount(): void {
		this.props.taskListModel.off("change", this.onTasksChanged);
		this.props.userOptionModel.off("change", this.onUpdateUserOption);
	}

	onUpdateUserOption() {
		this.setState({
			userOptions: { ...(this.props.userOptionModel.pick(this.props.userOptionModel.keys()) as UserOption) },
		});
	}

	/**
	 * After a reload that changed the model. Only a change in the list shown renders the timeline again, as only a
	 * changed list did before: the other tasks are hidden, and the next change or the quick entry brings them along.
	 */
	onTasksChanged() {
		const model = this.props.taskListModel;
		if (!model.hasChanged("shown")) return;
		this.setState((state) => withNewList(state, model.get("tasks")));
	}

	/** Shows the tasks read last, without the quick filter, as adding a task through the quick entry always did. */
	onUpdateTasks() {
		this.setState((state) => withNewList(state, this.props.taskListModel.get("tasks")));
	}

	/** The quick entry panel's filter, which core applies, see QuickFilter. */
	handleFilterEnable(startDate: string | undefined, endDate: string | undefined, priorities: string[]) {
		this.setState({ quickFilter: quickFilterOf(startDate, endDate, priorities) });
	}

	handleCreateNewTask(path: string, append: string) {
		const notePath = normalizePath(normalizeNotePath(path));
		appendTaskToNote(
			this.app.vault,
			notePath,
			this.state.userOptions.sectionForNewTasks,
			"- [ ] " + append,
			this.confirmCreateNote,
		)
			.then((added) => {
				if (added) this.onUpdateTasks();
			})
			.catch((reason) => {
				console.error("Tasks Calendar Wrapper: adding a task failed", reason);
				new Notice("Could not add the task to " + notePath + ": " + reason, 5000);
			});
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

	handleOpenFile(path: string, position: Pos, openTaskEdit = false) {
		this.app.vault.adapter
			.exists(path)
			.then((exist) => {
				if (!exist) {
					new Notice("No such file: " + path, 5000);
					return;
				}
				this.app.workspace.openLinkText("", path).then(() => {
					try {
						const file = this.app.workspace.getActiveFile();
						file && this.app.workspace.getLeaf().openFile(file, { state: { mode: "source" } });
						this.app.workspace.activeEditor?.editor?.setSelection(
							{ line: position.start.line, ch: position.start.col },
							{ line: position.start.line, ch: position.end.col },
						);
						if (!this.app.workspace.activeEditor?.editor?.hasFocus()) {
							this.app.workspace.activeEditor?.editor?.focus();
						}
						if (openTaskEdit) {
							const editor = this.app.workspace.activeEditor?.editor;
							if (editor) {
								const view = this.app.workspace.getLeaf().view;
								tasksPluginCommand(
									// @ts-expect-error commands is not part of the public API
									this.app.commands.commands,
									"obsidian-tasks-plugin:edit-task",
								).editorCheckCallback(false, editor, view);
							}
						}
					} catch (err) {
						new Notice("Error when trying open file: " + err, 5000);
					}
				});
			})
			.catch((reason) => {
				new Notice("Something went wrong: " + reason, 5000);
			});
	}

	handleModifyTask(path: string, position: Pos) {
		this.handleOpenFile(path, position, true);
	}

	handleCompleteTask(path: string, position: Pos) {
		this.app.workspace
			.openLinkText("", path)
			.then(() => {
				const file = this.app.workspace.getActiveFile();
				if (!file) throw new Error("No such file: " + path);
				this.app.workspace.getLeaf().openFile(file, { state: { mode: "source" } });
				this.app.workspace.activeEditor?.editor?.setSelection(
					{ line: position.start.line, ch: position.start.col },
					{ line: position.end.line, ch: position.end.col },
				);
				if (!this.app.workspace.activeEditor?.editor?.hasFocus())
					this.app.workspace.activeEditor?.editor?.focus();
				const editor = this.app.workspace.activeEditor?.editor;
				if (editor) {
					const view = this.app.workspace.getLeaf().view;
					tasksPluginCommand(
						// @ts-expect-error commands is not part of the public API
						this.app.commands.commands,
						"obsidian-tasks-plugin:toggle-done",
					).editorCheckCallback(false, editor, view);
				}
			})
			.catch((reason) => {
				// This used to be an uncaught error, so nothing happened and nothing was shown.
				console.error("Tasks Calendar Wrapper: toggling a task failed", reason);
				new Notice(
					"Could not toggle the task in " +
						path +
						": " +
						(reason instanceof Error ? reason.message : String(reason)),
					5000,
				);
			});
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

	render(): React.ReactNode {
		return (
			<QuickEntryHandlerContext.Provider
				value={{
					handleCreateNewTask: this.handleCreateNewTask,
					handleFilterEnable: this.handleFilterEnable,
				}}
			>
				<TaskItemEventHandlersContext.Provider value={this.getTaskItemHandlers()}>
					<TimelineView
						userOptions={this.state.userOptions}
						tasks={this.state.tasks}
						quickFilter={this.state.quickFilter}
					/>
				</TaskItemEventHandlersContext.Provider>
			</QuickEntryHandlerContext.Provider>
		);
	}
}
