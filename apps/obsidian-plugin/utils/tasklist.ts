import { convert24HourPrefix } from "@tasks-calendar-wrapper/core";
import type { Moment } from "moment";
import { moment } from "./moment";
import { getSortComparator } from "./sort";
import * as TaskMapable from "./taskmapable";
import { TaskDataModel, TaskStatusMarkerMap } from "./tasks";

/**
 * The settings that decide how the tasks read from the vault are parsed, sorted and filtered.
 * The plugin passes its user options; tests pass only what they need.
 */
export interface TaskListOptions {
    taskStatusOrder?: string[];
    dailyNoteFormat?: string;
    forward?: boolean;
    forwardPastStartAndScheduled?: boolean;
    convert24HourTimePrefix?: boolean;
    sort?: string;
    hideSubTasks?: boolean;
    hideStatusTasks?: string[];
    useIncludeTags?: boolean;
    taskIncludeTags?: string[];
    useExcludeTags?: boolean;
    taskExcludeTags?: string[];
    filterEmpty?: boolean;
}

/** Runs the parser chain over the tasks read from the vault and sorts the whole list. */
export async function parseTasks(taskList: TaskDataModel[], options: TaskListOptions, now: Moment = moment()): Promise<TaskDataModel[]> {

    const stautsOrder = options.taskStatusOrder;

    const dailyNoteFormatParser = TaskMapable.dailyNoteTaskParser(options.dailyNoteFormat);

    const forward = options.forward;
    const forwardToToday = TaskMapable.forwardParser(now, {
        pastStartAndScheduled: options.forwardPastStartAndScheduled,
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

    if (options.convert24HourTimePrefix) {
        taskListPromise = taskListPromise.map(async (task: Promise<TaskDataModel>) => {
            const t = await task;
            if (t.visual) t.visual = convert24HourPrefix(moment, t.visual);
            return t;
        });
    }

    const parsedTasks = await Promise.all(taskListPromise);
    /**
     * Sorting is applied to the whole list here. The views only filter it afterwards,
     * which keeps this order inside every date section.
     */
    return parsedTasks.sort(getSortComparator(options.sort ?? ""));
}

/** Leaves out subtasks, hidden statuses, tasks without or with the chosen tags, and empty tasks, as the options say. */
export function filterTasks(taskList: TaskDataModel[], options: TaskListOptions) {
    return taskList
        /**
         * Subtask Filter
         */
        .filter(TaskMapable.filterSubTasks(!!options.hideSubTasks))
        /**
         * Status Filters
         */
        .filter((task: TaskDataModel) => {
            if (options.hideStatusTasks?.length === 0) return true;
            const hideStatusTasks = options.hideStatusTasks;
            if (hideStatusTasks?.includes(task.statusMarker)) return false;
            if (hideStatusTasks?.some(m => task.status === TaskStatusMarkerMap[m as keyof typeof TaskStatusMarkerMap] as string)) return false;
            return true;
        })
        /**
         * Tag Filters
         */
        .filter((task) => {
            if (!options.useIncludeTags) return true;
            const tagIncludes = options.taskIncludeTags;
            if (!tagIncludes) return true;
            if (tagIncludes.length === 0) return true;
            if (tagIncludes.some(tag => task.tags.includes(tag))) return true;
            return false;
        })
        .filter((task) => {
            if (!options.useExcludeTags) return true;
            const tagExcludes = options.taskExcludeTags;
            if (!tagExcludes) return true;
            if (tagExcludes.length === 0) return true;
            if (tagExcludes.every(tag => !task.tags.includes(tag))) return true;
            return false;
        })
        /**
         * Filter empty
         */
        .filter((task: TaskDataModel) => {
            if (!options.filterEmpty) return true;
            return task.visual && task.visual.trim() !== "";
        });
}
