import { moment } from "obsidian";
import { PriorityLabel, TaskDataModel, TasksPriorityRank } from "./tasks";

export type TaskComparator = (t1: TaskDataModel, t2: TaskDataModel) => number;

const text = (task: TaskDataModel) => (task.visual ?? "").trim();
const time = (date: moment.Moment | undefined) => (date ? date.valueOf() : undefined);

/** Undated tasks sort last, whichever direction the dates are sorted in. */
const byDate = (pick: (task: TaskDataModel) => moment.Moment | undefined, descending: boolean): TaskComparator =>
    (t1, t2) => {
        const [a, b] = [time(pick(t1)), time(pick(t2))];
        if (a === undefined && b === undefined) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        return descending ? b - a : a - b;
    };

const priorityRank = (priority: PriorityLabel) => TasksPriorityRank[priority] ?? TasksPriorityRank[""];

const comparators: Record<string, TaskComparator> = {
    "status-asc": (t1, t2) => t1.order - t2.order,
    "status-desc": (t1, t2) => t2.order - t1.order,
    "text-asc": (t1, t2) => text(t1).localeCompare(text(t2)),
    "text-desc": (t1, t2) => text(t2).localeCompare(text(t1)),
    "start-asc": byDate(t => t.start, false),
    "start-desc": byDate(t => t.start, true),
    "due-asc": byDate(t => t.due, false),
    "due-desc": byDate(t => t.due, true),
    "priority-desc": (t1, t2) => priorityRank(t1.priority) - priorityRank(t2.priority),
    "priority-asc": (t1, t2) => priorityRank(t2.priority) - priorityRank(t1.priority),
    "tags-asc": (t1, t2) => t1.tags.join(",").localeCompare(t2.tags.join(",")),
    "tags-desc": (t1, t2) => t2.tags.join(",").localeCompare(t1.tags.join(",")),
};

/** Labels for the "Sort By" dropdown, keyed by the value stored in the settings. */
export const sortOptionLabels: Record<string, string> = {
    "status-asc": "status (ascending)",
    "status-desc": "status (descending)",
    "text-asc": "text (ascending)",
    "text-desc": "text (descending)",
    "start-asc": "start time (ascending)",
    "start-desc": "start time (descending)",
    "due-asc": "due time (ascending)",
    "due-desc": "due time (descending)",
    "priority-desc": "priority (highest first)",
    "priority-asc": "priority (lowest first)",
    "tags-asc": "tags (ascending)",
    "tags-desc": "tags (descending)",
};

export const defaultSortKey = "status-asc";

const isKnown = (options: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(options, key);

export function getSortComparator(key: string): TaskComparator {
    return isKnown(comparators, key) ? comparators[key] : comparators[defaultSortKey];
}

/**
 * Before 0.3.4 the sort setting held a lambda as a string, which was evaluated at runtime.
 * Saved settings are mapped onto the new keys so the choice is not silently lost.
 */
const legacySortOptions: Record<string, string> = {
    "(t1, t2) => t1.order <= t2.order ? -1 : 1": "status-asc",
    "(t1, t2) => t1.order >= t2.order ? -1 : 1": "status-desc",
    "(t1, t2) => t1.visual.trim() <= t2.visual.trim() ? -1 : 1": "text-asc",
    "(t1, t2) => t1.visual.trim() >= t2.visual.trim() ? -1 : 1": "text-desc",
    "(t1, t2) => t1.start <= t2.start ? -1 : 1": "start-asc",
    "(t1, t2) => t1.start >= t2.start ? -1 : 1": "start-desc",
    "(t1, t2) => t1.due <= t2.due ? -1 : 1": "due-asc",
    "(t1, t2) => t1.due >= t2.due ? -1 : 1": "due-desc",
    "(t1, t2) => t1.tags <= t2.tags ? -1 : 1": "tags-asc",
    "(t1, t2) => t1.tags >= t2.tags ? -1 : 1": "tags-desc",
};

export function migrateSortOption(saved: string | undefined): string {
    if (!saved) return defaultSortKey;
    if (isKnown(comparators, saved)) return saved;
    return isKnown(legacySortOptions, saved) ? legacySortOptions[saved] : defaultSortKey;
}
