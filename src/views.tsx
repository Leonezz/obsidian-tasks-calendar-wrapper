import { Model } from "backbone";
import { Editor, ItemView, moment, Notice, WorkspaceLeaf } from "obsidian";
import { ObsidianBridge } from 'Obsidian-Tasks-Timeline/src/obsidianbridge';
import { ObsidianTaskAdapter } from "Obsidian-Tasks-Timeline/src/taskadapter";
import { createRoot, Root } from 'react-dom/client';
import * as TaskMapable from 'utils/taskmapable';
import { TaskDataModel, TaskRegularExpressions, TaskStatus, TaskStatusMarkerMap } from "utils/tasks";
import { defaultUserOptions, UserOption } from "./settings";


export const CALENDAR_VIEW = "tasks_calendar_view";
export const TIMELINE_VIEW = "tasks_timeline_view";

export abstract class BaseTasksView extends ItemView {
    protected root: Root;
    //protected dataAdapter: ObsidianTaskAdapter;
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        //this.dataAdapter = new ObsidianTaskAdapter(this.app);
    }
}

export class TasksTimelineView extends BaseTasksView {
    private taskListModel = new Model({
        taskList: [] as TaskDataModel[],
    });

    private isReloading: boolean = false;
    private reloadPending: boolean = false;
    private editorReloadTimer: number | null = null;
    private allTasks: TaskDataModel[] = [];
    private userOptionModel = new Model({ ...defaultUserOptions });
    static view: TasksTimelineView | null = null;
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);

        this.parseTasks = this.parseTasks.bind(this);
        this.onReloadTasks = this.onReloadTasks.bind(this);
        this.onEditorChange = this.onEditorChange.bind(this);
        this.onUpdateOptions = this.onUpdateOptions.bind(this);
        TasksTimelineView.view = this;
        //this.userOptionModel.set({ ...defaultUserOptions });
    }

    async onOpen(): Promise<void> {

        this.registerEvent(this.app.metadataCache.on('resolved', this.onReloadTasks));
        this.registerEvent(this.app.metadataCache.on('changed', this.onReloadTasks));
        this.registerEvent(this.app.workspace.on('editor-change', this.onEditorChange));
        this.registerEvent(this.app.workspace.on("window-open", this.onReloadTasks));

        const { containerEl } = this;
        const container = containerEl.children[1];

        container.empty();
        this.root = createRoot(container);
        this.root.render(
            <ObsidianBridge plugin={this} userOptionModel={this.userOptionModel} taskListModel={this.taskListModel} />
        )

    }

    async onClose(): Promise<void> {
        if (this.editorReloadTimer !== null) window.clearTimeout(this.editorReloadTimer);
    }

    onEditorChange(editor: Editor): void {
        const activeFile = this.app.workspace.activeEditor?.file;
        const cursor = editor.getCursor();
        const statusMarker = editor.getLine(cursor.line).match(TaskRegularExpressions.taskRegex)?.[3];
        const previousTask = this.allTasks.find(task =>
            task.path === activeFile?.path && task.line === cursor.line);

        if (statusMarker === undefined || previousTask?.statusMarker === statusMarker) return;

        if (this.editorReloadTimer !== null) window.clearTimeout(this.editorReloadTimer);
        this.editorReloadTimer = window.setTimeout(() => {
            this.editorReloadTimer = null;
            this.onReloadTasks();
        }, 25);
    }

    onUpdateOptions(opt: UserOption) {
        this.userOptionModel.clear();
        this.userOptionModel.set({ ...opt });
        this.onReloadTasks();
    }

    async onReloadTasks() {
        if (this.isReloading) {
            this.reloadPending = true;
            return;
        }
        this.isReloading = true;
        const fileExcludeFilter = this.userOptionModel.get("excludePaths") || [];
        const fileIncludeFilter = this.userOptionModel.get("includePaths") || [];
        const fileIncludeTagsFilter = this.userOptionModel.get("fileIncludeTags") || [];
        const fileExcludeTagsFilter = this.userOptionModel.get("fileExcludeTags") || [];
        const adapter = new ObsidianTaskAdapter(this.app);
        try {
            await adapter.generateTasksList(fileIncludeFilter, fileExcludeFilter, fileIncludeTagsFilter, fileExcludeTagsFilter);
            this.allTasks = await this.parseTasks(adapter.getTaskList());
            const tasks = this.filterTasks(this.allTasks);
            const taskfiles = this.userOptionModel.get("taskFiles");
            this.taskListModel.set({ taskList: tasks });
            this.userOptionModel.set({ taskFiles: taskfiles || [] });
        } catch (reason) {
            new Notice("Error when refreshing task items: " + reason, 5000);
            console.error(reason);
        } finally {
            this.isReloading = false;
            if (this.reloadPending) {
                this.reloadPending = false;
                this.onReloadTasks();
            }
        }
    }

    filterTasks(taskList: TaskDataModel[]) {
        return taskList
            /**
             * Status Filters
             */
            .filter((task: TaskDataModel) => {
                if (this.userOptionModel.get("hideStatusTasks")?.length === 0) return true;
                const hideStatusTasks = this.userOptionModel.get("hideStatusTasks");
                if (hideStatusTasks?.includes(task.statusMarker)) return false;
                if (hideStatusTasks?.some(m => TaskStatusMarkerMap[m as keyof typeof TaskStatusMarkerMap] === task.status)) return false;
                return true;
            })
            /**
             * Tag Filters
             */
            .filter((task) => {
                if (!this.userOptionModel.get("useIncludeTags")) return true;
                const tagIncludes = this.userOptionModel.get("taskIncludeTags");
                if (!tagIncludes) return true;
                if (tagIncludes.length === 0) return true;
                if (tagIncludes.some(tag => task.tags.includes(tag))) return true;
                return false;
            })
            .filter((task) => {
                if (!this.userOptionModel.get("useExcludeTags")) return true;
                const tagExcludes = this.userOptionModel.get("taskExcludeTags");
                if (!tagExcludes) return true;
                if (tagExcludes.length === 0) return true;
                if (tagExcludes.every(tag => !task.tags.includes(tag))) return true;
                return false;
            })
            /**
             * Filter empty
             */
            .filter((task: TaskDataModel) => {
                if (!this.userOptionModel.get("filterEmpty")) return true;
                return task.visual && task.visual.trim() !== "";
            })

    }

    async parseTasks(taskList: TaskDataModel[]): Promise<TaskDataModel[]> {

        const stautsOrder = this.userOptionModel.get("taskStatusOrder");

        const dailyNoteFormatParser = TaskMapable.dailyNoteTaskParser(
            this.userOptionModel.get("dailyNoteFormat"));

        const forward = this.userOptionModel.get("forward");
        /**
         * initial parsers
         */
        let taskListPromise: Promise<TaskDataModel>[] = taskList.map(async item => item)
            .map(TaskMapable.tasksPluginTaskParser)
            .map(TaskMapable.dataviewTaskParser)
            .map(dailyNoteFormatParser)
            .map(TaskMapable.tagsParser)
            .map(TaskMapable.remainderParser)
            .map(TaskMapable.postProcessor)
            //.map(TaskMapable.taskLinkParser)

            /**
             * Option Forward
             * Current behavior: show unplanned and overdue tasks in today's part.
             */
            .map(async (task: Promise<TaskDataModel>): Promise<TaskDataModel> => {
                return new Promise((resolve) => {
                    task.then(t => {
                        if (!forward) {
                            resolve(t);
                            return;
                        }
                        if (t.status === TaskStatus.unplanned) t.dates.set(TaskStatus.unplanned, moment())
                        else if (t.status === TaskStatus.done && !t.completion &&
                            !t.due && !t.start && !t.scheduled && !t.created) t.dates.set("done-unplanned", moment());
                        else if (t.status === TaskStatus.overdue &&
                            !TaskMapable.filterDate(moment())(t)) t.dates.set(TaskStatus.overdue, moment())
                        resolve(t);
                    })
                })
            })
            /**
             * Post processer
             */
            .map((task: Promise<TaskDataModel>) => {
                return new Promise(resolve => {
                    task.then(t => {
                        if (!stautsOrder) {
                            resolve(t);
                            return;
                        }
                        if (!stautsOrder.includes(t.status)) return t;
                        t.order = stautsOrder.indexOf(t.status) + 1;
                        resolve(t);
                    });
                });
            });

        if (this.userOptionModel.get("convert24HourTimePrefix")) {
            taskListPromise = taskListPromise.map((task: Promise<TaskDataModel>) => {
                return new Promise(resolve => {
                    task.then(t => {
                        if (!t.visual || t.visual.length < 5) {
                            resolve(t);
                            return;
                        }
                        const timePrefix = moment(t.visual.substring(0, 5), "HH:mm", true);
                        if (!timePrefix.isValid()) {
                            resolve(t);
                            return;
                        }
                        const updatedTimePrefix = timePrefix.format("h:mm a");
                        t.visual = updatedTimePrefix + t.visual.substring(5);
                        resolve(t);
                    });
                });
            });
        }

        return Promise.all(taskListPromise);
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
