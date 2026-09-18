import { Model } from "backbone";
import { ItemView, moment, Notice, WorkspaceLeaf } from "obsidian";
import { ObsidianBridge } from 'Obsidian-Tasks-Timeline/src/obsidianbridge';
import { ObsidianTaskAdapter } from "Obsidian-Tasks-Timeline/src/taskadapter";
import { createRoot, Root } from 'react-dom/client';
import * as TaskMapable from 'utils/taskmapable';
import { TaskDataModel, TaskStatusMarkerMap } from "utils/tasks";
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
    private userOptionModel = new Model({ ...defaultUserOptions });
    static view: TasksTimelineView | null = null;
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);

        TasksTimelineView.view = this;
        //this.userOptionModel.set({ ...defaultUserOptions });
    }

    async onOpen(): Promise<void> {

        this.registerEvent(this.app.metadataCache.on('resolved', () => this.onReloadTasks()));
        this.registerEvent(this.app.workspace.on("window-open", () => this.onReloadTasks()));

        const { containerEl } = this;
        const container = containerEl.children[1];

        container.empty();
        this.root = createRoot(container);
        this.root.render(
            <ObsidianBridge plugin={this} userOptionModel={this.userOptionModel} taskListModel={this.taskListModel} />
        )

    }

    async onClose(): Promise<void> {
        // this.app.metadataCache.off('resolved', this.onReloadTasks);
    }

    onUpdateOptions(opt: UserOption) {
        this.userOptionModel.clear();
        this.userOptionModel.set({ ...opt });
        this.onReloadTasks();
    }

    onReloadTasks(): void {
        if (this.isReloading) {
            return;
        }
        this.isReloading = true;
        const fileExcludeFilter = this.userOptionModel.get("excludePaths") || [];
        const fileIncludeFilter = this.userOptionModel.get("includePaths") || [];
        const fileIncludeTagsFilter = this.userOptionModel.get("fileIncludeTags") || [];
        const fileExcludeTagsFilter = this.userOptionModel.get("fileExcludeTags") || [];
        const adapter = new ObsidianTaskAdapter(this.app);
        adapter.generateTasksList(fileIncludeFilter, fileExcludeFilter, fileIncludeTagsFilter, fileExcludeTagsFilter)
            .then(() => {
                const taskList = adapter.getTaskList();
                const taskListPromise = this.parseTasks(taskList)
                taskListPromise.then(tasks => {
                    tasks = this.filterTasks(tasks);
                    const taskfiles = this.userOptionModel.get("taskFiles");
                    /*tasks.forEach(t => {
                        if (taskfiles?.contains(t.path)) return;
                        taskfiles?.push(t.path);
                    })*/
                    this.taskListModel.set({ taskList: tasks });
                    this.userOptionModel.set({ taskFiles: taskfiles || [] });
                }).catch(reason => { new Notice("Error when parsing task items: " + reason, 5000); throw reason; });
            })
            .catch(reason => { new Notice("Error when generating tasks from files: " + reason, 5000); throw reason; })
            .finally(() => this.isReloading = false);
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
                if (hideStatusTasks?.some(m => task.status === TaskStatusMarkerMap[m as keyof typeof TaskStatusMarkerMap] as string)) return false;
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
        const forwardToToday = TaskMapable.forwardParser(moment());
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
            .map(task => forward ? forwardToToday(task) : task)
            /**
             * Post processer
             */
            .map(async (task: Promise<TaskDataModel>) => {
                const t = await task;
                if (stautsOrder?.includes(t.status)) t.order = stautsOrder.indexOf(t.status) + 1;
                return t;
            });

        if (this.userOptionModel.get("convert24HourTimePrefix")) {
            taskListPromise = taskListPromise.map(async (task: Promise<TaskDataModel>) => {
                const t = await task;
                if (!t.visual || t.visual.length < 5) return t;
                const timePrefix = moment(t.visual.substring(0, 5), "HH:mm", true);
                if (!timePrefix.isValid()) return t;
                t.visual = timePrefix.format("h:mm a") + t.visual.substring(5);
                return t;
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
