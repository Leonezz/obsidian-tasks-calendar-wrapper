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
