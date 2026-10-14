import { Model } from "backbone";
import { CachedMetadata, debounce, ItemView, moment, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { ObsidianBridge } from '../timeline/src/obsidianbridge';
import { ObsidianTaskAdapter } from "../timeline/src/taskadapter";
import { createRoot, Root } from 'react-dom/client';
import { changeAffectsTasks } from '../utils/refresh';
import { getSortComparator } from '../utils/sort';
import * as TaskMapable from '../utils/taskmapable';
import { TaskDataModel, TaskStatusMarkerMap } from "../utils/tasks";
import { defaultUserOptions, UserOption } from "./settings";


export const CALENDAR_VIEW = "tasks_calendar_view";
export const TIMELINE_VIEW = "tasks_timeline_view";

/** Changes that arrive within this time of each other are applied in one reload. */
const RELOAD_DELAY_MS = 500;

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
        //this.userOptionModel.set({ ...defaultUserOptions });
    }

    async onOpen(): Promise<void> {

        // Only changes to files that have or had tasks reload the list, see issue #63.
        this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => this.onFileChanged([file.path], cache)));
        this.registerEvent(this.app.metadataCache.on('deleted', (file, prevCache) => this.onFileChanged([file.path], prevCache)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) this.onFileChanged([file.path, oldPath], this.app.metadataCache.getFileCache(file));
        }));
        // When the view opens while Obsidian starts, the metadata of some files may not be read yet.
        const firstResolved = this.app.metadataCache.on('resolved', () => {
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
            <ObsidianBridge plugin={this} userOptionModel={this.userOptionModel} taskListModel={this.taskListModel} />
        )

    }

    async onClose(): Promise<void> {
        this.requestReload.cancel();
        // Runs the components' cleanup, so a reload that finishes after closing renders nothing.
        this.root?.unmount();
        // Task rows render their markdown with this static view as the owner. Hand it to another open
        // timeline, so a closed view and its whole task list are not kept in memory.
        if (TasksTimelineView.view === this) {
            TasksTimelineView.view = this.app.workspace.getLeavesOfType(TIMELINE_VIEW)
                .map(leaf => leaf.view)
                .find((view): view is TasksTimelineView => view instanceof TasksTimelineView && view !== this) ?? null;
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
        const adapter = new ObsidianTaskAdapter(this.app);
        adapter.generateTasksList(fileIncludeFilter, fileExcludeFilter, fileIncludeTagsFilter, fileExcludeTagsFilter)
            .catch(reason => { new Notice("Error when generating tasks from files: " + reason, 5000); throw reason; })
            .then(() => {
                const taskList = adapter.getTaskList();
                this.filesWithTasks = new Set(taskList.map(task => task.path));
                // Returned, so the reload counts as running until the parsed list is shown.
                return this.parseTasks(taskList)
                    .catch(reason => { new Notice("Error when parsing task items: " + reason, 5000); throw reason; });
            })
            .then(tasks => {
                tasks = this.filterTasks(tasks);
                const taskfiles = this.userOptionModel.get("taskFiles");
                this.taskListModel.set({ taskList: tasks });
                this.userOptionModel.set({ taskFiles: taskfiles || [] });
            })
            .catch(reason => console.error("Tasks Calendar Wrapper: reloading tasks failed", reason))
            .finally(() => {
                this.isReloading = false;
                if (this.reloadAgain) {
                    this.reloadAgain = false;
                    this.onReloadTasks();
                }
            });
    }

    filterTasks(taskList: TaskDataModel[]) {
        return taskList
            /**
             * Subtask Filter
             */
            .filter(TaskMapable.filterSubTasks(!!this.userOptionModel.get("hideSubTasks")))
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
        const forwardToToday = TaskMapable.forwardParser(moment(), {
            pastStartAndScheduled: this.userOptionModel.get("forwardPastStartAndScheduled"),
        });
        /**
         * initial parsers
         */
        let taskListPromise: Promise<TaskDataModel>[] = taskList.map(async item => item)
            .map(TaskMapable.commentsParser)
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

        const parsedTasks = await Promise.all(taskListPromise);
        /**
         * Sorting is applied to the whole list here. The views only filter it afterwards,
         * which keeps this order inside every date section.
         */
        return parsedTasks.sort(getSortComparator(this.userOptionModel.get("sort") ?? ""));
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
