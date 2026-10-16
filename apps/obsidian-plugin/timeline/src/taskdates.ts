import { innerDateFormat, TaskDataModel } from "../../utils/tasks";

/**
 * Lists every task under each day it has a date on, keeping the order of the list.
 * Each date is formatted once, instead of comparing every day of the timeline against every task,
 * which froze Obsidian for seconds in large vaults (issue #63).
 */
export function groupTasksByDate(taskList: TaskDataModel[]): Map<string, TaskDataModel[]> {
    const byDate = new Map<string, TaskDataModel[]>();
    for (const task of taskList) {
        const days = new Set<string>();
        for (const date of [task.due, task.scheduled, task.created, task.start, task.completion, ...task.dates.values()]) {
            if (date) days.add(date.format(innerDateFormat));
        }
        for (const day of days) {
            const tasksOfDay = byDate.get(day);
            if (tasksOfDay) tasksOfDay.push(task);
            else byDate.set(day, [task]);
        }
    }
    return byDate;
}

/**
 * Sorts days ("YYYY-MM-DD") or years in the order the timeline shows them:
 * from the earliest, or from the latest with the newest first option (issue #54).
 */
export function inDisplayOrder<T extends string | number>(values: Iterable<T>, newestFirst: boolean): T[] {
    const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return newestFirst ? sorted.reverse() : sorted;
}
