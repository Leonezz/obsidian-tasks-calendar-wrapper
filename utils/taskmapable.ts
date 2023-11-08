import { getFileTitle } from "dataview-util/dataview";
import { Link } from "dataview-util/markdown";
import { moment } from "obsidian";
import * as TasksUtil from "./tasks";

export function filterDate(date: moment.Moment) {
    return filterByDateTime(date, "date");
}

export function filterYear(date: moment.Moment) {
    return filterByDateTime(date, "year");
}

function filterByDateTime(date: moment.Moment, by: moment.unitOfTime.StartOf) {
    return (item: TasksUtil.TaskDataModel) => {
        if (item.due && date.isSame(item.due, by)) return true;
        if (item.scheduled && date.isSame(item.scheduled, by)) return true;
        if (item.created && date.isSame(item.created, by)) return true;
        if (item.completion && date.isSame(item.completion, by)) return true;
        if (item.start && date.isSame(item.start, by)) return true;
        for (const [, d] of item.dates) {
            if (date.isSame(d, by)) {
                return true;
            }
        }
        return false;
    }
}

export function filterDateRange(from: moment.Moment, to: moment.Moment) {
    return filterByDateTimeRange(from, to, 'date');
}

function filterByDateTimeRange(from: moment.Moment, to: moment.Moment, by: moment.unitOfTime.StartOf) {
    return (item: TasksUtil.TaskDataModel) => {
        if (item.due && item.due.isBetween(from, to, by)) return true;
        if (item.scheduled && item.scheduled.isBetween(from, to, by)) return true;
        if (item.created && item.created.isBetween(from, to, by)) return true;
        if (item.completion && item.completion.isBetween(from, to, by)) return true;
        if (item.start && item.start.isBetween(from, to, by)) return true;
        for (const [, d] of item.dates) {
            if (d.isBetween(from, to, by)) return true;
        }
        return false;
    }
}

/**
 * This function is taken from TasksPlugin, it is originally named fromLine.
 * We use this function to extract information that matches the TasksPlugin format.
 * @param item 
 * @returns 
 */
export async function tasksPluginTaskParser(item: Promise<TasksUtil.TaskDataModel>): Promise<TasksUtil.TaskDataModel> {
    return new Promise((resolve, reject) => {
        item
            .then((itemValue) => {
                // Check the line to see if it is a markdown task.
                let description = itemValue.visual || "";
                // Keep matching and removing special strings from the end of the
                // description in any order. The loop should only run once if the
                // strings are in the expected order after the description.
                let matched: boolean;
                let priority: TasksUtil.PriorityLabel = "";
                let startDate: moment.Moment | undefined = undefined;
                let scheduledDate: moment.Moment | undefined = undefined;
                //const scheduledDateIsInferred = false;
                let dueDate: moment.Moment | undefined = undefined;
                let doneDate: moment.Moment | undefined = undefined;
                let recurrenceRule = '';
                //const recurrence: string | null = null;
                // Tags that are removed from the end while parsing, but we want to add them back for being part of the description.
                // In the original task description they are possibly mixed with other components
                // (e.g. #tag1 <due date> #tag2), they do not have to all trail all task components,
                // but eventually we want to paste them back to the task description at the end
                let trailingTags = '';
                // Add a "max runs" failsafe to never end in an endless loop:
                const maxRuns = 20;
                let runs = 0;
                do {
                    matched = false;
                    const priorityMatch = description.match(TasksUtil.TaskRegularExpressions.priorityRegex);
                    if (priorityMatch !== null) {
                        priority = TasksUtil.TasksPrioritySymbolToLabel[priorityMatch[1] as TasksUtil.TasksPrioritySymbol];
                        description = description.replace(TasksUtil.TaskRegularExpressions.priorityRegex, '').trim();
                        matched = true;
                    }

                    const doneDateMatch = description.match(TasksUtil.TaskRegularExpressions.doneDateRegex);
                    if (doneDateMatch !== null) {
                        doneDate = window.moment(doneDateMatch[1], TasksUtil.TaskRegularExpressions.dateFormat);
                        description = description.replace(TasksUtil.TaskRegularExpressions.doneDateRegex, '').trim();
                        matched = true;
                    }

                    const dueDateMatch = description.match(TasksUtil.TaskRegularExpressions.dueDateRegex);
                    if (dueDateMatch !== null) {
                        dueDate = window.moment(dueDateMatch[1], TasksUtil.TaskRegularExpressions.dateFormat);
                        description = description.replace(TasksUtil.TaskRegularExpressions.dueDateRegex, '').trim();
                        matched = true;
                    }

                    const scheduledDateMatch = description.match(TasksUtil.TaskRegularExpressions.scheduledDateRegex);
                    if (scheduledDateMatch !== null) {
                        scheduledDate = window.moment(scheduledDateMatch[1], TasksUtil.TaskRegularExpressions.dateFormat);
                        description = description.replace(TasksUtil.TaskRegularExpressions.scheduledDateRegex, '').trim();
                        matched = true;
                    }

                    const startDateMatch = description.match(TasksUtil.TaskRegularExpressions.startDateRegex);
                    if (startDateMatch !== null) {
                        startDate = window.moment(startDateMatch[1], TasksUtil.TaskRegularExpressions.dateFormat);
                        description = description.replace(TasksUtil.TaskRegularExpressions.startDateRegex, '').trim();
                        matched = true;
                    }

                    const recurrenceMatch = description.match(TasksUtil.TaskRegularExpressions.recurrenceRegex);
                    if (recurrenceMatch !== null) {
                        // Save the recurrence rule, but *do not parse it yet*.
                        // Creating the Recurrence object requires a reference date (e.g. a due date),
                        // and it might appear in the next (earlier in the line) tokens to parse
                        recurrenceRule = recurrenceMatch[1].trim();
                        description = description.replace(TasksUtil.TaskRegularExpressions.recurrenceRegex, '').trim();
                        matched = true;
                    }

                    // Match tags from the end to allow users to mix the various task components with
                    // tags. These tags will be added back to the description below
                    const tagsMatch = description.match(TasksUtil.TaskRegularExpressions.hashTagsFromEnd);
                    if (tagsMatch != null) {
                        description = description.replace(TasksUtil.TaskRegularExpressions.hashTagsFromEnd, '').trim();
                        matched = true;
                        const tagName = tagsMatch[0].trim();
                        // Adding to the left because the matching is done right-to-left
                        trailingTags = trailingTags.length > 0 ? [tagName, trailingTags].join(' ') : tagName;
                    }

                    runs++;
                } while (matched && runs <= maxRuns);


                // Add back any trailing tags to the description. We removed them so we can parse the rest of the
                // components but now we want them back.
                // The goal is for a task of them form 'Do something #tag1 (due) tomorrow #tag2 (start) today'
                // to actually have the description 'Do something #tag1 #tag2'
                if (trailingTags.length > 0) description += ' ' + trailingTags;

                const isTasksTask = [startDate, scheduledDate, dueDate, doneDate].some(d => !!d);

                itemValue.visual = description;
                itemValue.priority = priority;
                itemValue.recurrence = recurrenceRule;
                itemValue.isTasksTask = isTasksTask;
                itemValue.due = dueDate;
                itemValue.scheduled = scheduledDate;
                itemValue.completion = doneDate;
                itemValue.start = startDate;
                itemValue.checked = description.replace(' ', '').length !== 0;

                resolve(itemValue);
            })
            .catch(() => reject());
    });
}

export async function dataviewTaskParser(item: Promise<TasksUtil.TaskDataModel>): Promise<TasksUtil.TaskDataModel> {
    return new Promise((resolve, reject) => {
        item
            .then((itemValue) => {
                let itemText = itemValue.visual || "";
                const inlineFields = itemText.match(TasksUtil.TaskRegularExpressions.keyValueRegex);
                if (!inlineFields) {
                    resolve(itemValue);
                    return;
                }
                for (const inlineField of inlineFields) {
                    // this is necessary since every time RegEx.exec,
                    // the lastIndex changed like an internal state.
                    TasksUtil.TaskRegularExpressions.keyValueRegex.lastIndex = 0;
                    const tkv = TasksUtil.TaskRegularExpressions.keyValueRegex.exec(inlineField)!;
                    const [text, key, value] = [tkv[0], tkv[1], tkv[2]];
                    itemText = itemText.replace(text, '');

                    if (!TasksUtil.TaskStatusCollection.includes(key)) continue;
                    const fieldDate = moment(value);
                    if (!fieldDate.isValid()) {
                        console.warn("Parse date for item failed, item: ")
                        console.warn(inlineFields)
                        continue;
                    }
                    switch (key) {
                        case "due":
                            itemValue.due = fieldDate; break;
                        case "scheduled":
                            itemValue.scheduled = fieldDate; break;
                        case "complete":
                        case "completion":
                        case "done":
                            itemValue.completion = fieldDate; break;
                        case "created":
                            itemValue.start = fieldDate; break;
                        default:
                            itemValue.dates.set(key, fieldDate); break;
                    }
                }
                itemValue.visual = itemText;
                resolve(itemValue);
            })
            .catch(() => reject());
    });
}

export function dailyNoteTaskParser(dailyNoteFormat: string = TasksUtil.innerDateFormat) {
    return async (item: Promise<TasksUtil.TaskDataModel>): Promise<TasksUtil.TaskDataModel> => {
        return new Promise((resolve, reject) => {
            item
                .then((itemValue) => {
                    const taskFile: string = getFileTitle(itemValue.path);
                    const dailyNoteDate = moment(taskFile, dailyNoteFormat, true);
                    itemValue.dailyNote = dailyNoteDate.isValid();
                    if (!itemValue.dailyNote) {
                        resolve(itemValue);
                        return;
                    }
                    if (!itemValue.start) itemValue.start = dailyNoteDate;
                    if (!itemValue.scheduled) itemValue.scheduled = dailyNoteDate;
                    if (!itemValue.created) itemValue.created = dailyNoteDate;

                    resolve(itemValue);
                })
                .catch(() => reject());
        })
    }
}
/**
 * !! NEED improvement
 * @param item 
 * @returns 
 */
export function taskLinkParser(item: TasksUtil.TaskDataModel) {

    item.outlinks = [];

    let outerLinkMatch = TasksUtil.TaskRegularExpressions.outerLinkRegex.exec(item.visual!);
    let innerLinkMatch = TasksUtil.TaskRegularExpressions.innerLinkRegex.exec(item.visual!);
    let dataviewDateMatch = TasksUtil.TaskRegularExpressions.keyValueRegex.exec(item.visual!);

    const buildLink = (text: string, display: string, path: string, index: number, inner: boolean) => {
        item.visual = item.visual!.replace(text, display);

        if (item.outlinks.some(l => l.path === path)) return;

        const link = Link.file(path, inner, display);
        link.subpath = index.toString();
        item.outlinks.push(link);
    };

    while (!!outerLinkMatch || (!!innerLinkMatch && !dataviewDateMatch)) {
        if (!!outerLinkMatch && (!!innerLinkMatch && !dataviewDateMatch)) {
            if (outerLinkMatch.index < innerLinkMatch.index) {
                buildLink(outerLinkMatch[0], outerLinkMatch[1], outerLinkMatch[2], outerLinkMatch.index, false);
                innerLinkMatch = TasksUtil.TaskRegularExpressions.innerLinkRegex.exec(item.visual!);
                dataviewDateMatch = TasksUtil.TaskRegularExpressions.keyValueRegex.exec(item.visual!);
                (!!innerLinkMatch && !dataviewDateMatch) &&
                    buildLink(innerLinkMatch[0], innerLinkMatch[1], innerLinkMatch[1], innerLinkMatch.index, true);
            } else {
                buildLink(innerLinkMatch[0], innerLinkMatch[1], innerLinkMatch[1], innerLinkMatch.index, true);
                outerLinkMatch = TasksUtil.TaskRegularExpressions.outerLinkRegex.exec(item.visual!);
                (!!outerLinkMatch) &&
                    buildLink(outerLinkMatch[0], outerLinkMatch[1], outerLinkMatch[2], outerLinkMatch.index, false);
            }
            innerLinkMatch = TasksUtil.TaskRegularExpressions.innerLinkRegex.exec(item.visual!);
            dataviewDateMatch = TasksUtil.TaskRegularExpressions.keyValueRegex.exec(item.visual!);
            outerLinkMatch = TasksUtil.TaskRegularExpressions.outerLinkRegex.exec(item.visual!);
        } else if (outerLinkMatch) {
            buildLink(outerLinkMatch[0], outerLinkMatch[1], outerLinkMatch[2], outerLinkMatch.index, false);
            outerLinkMatch = TasksUtil.TaskRegularExpressions.outerLinkRegex.exec(item.visual!);
        } else if (!!innerLinkMatch && !dataviewDateMatch) {
            buildLink(innerLinkMatch[0], innerLinkMatch[1], innerLinkMatch[1], innerLinkMatch.index, true);
            innerLinkMatch = TasksUtil.TaskRegularExpressions.innerLinkRegex.exec(item.visual!);
            dataviewDateMatch = TasksUtil.TaskRegularExpressions.keyValueRegex.exec(item.visual!);
        }
    }

    return item;
}

export async function remainderParser(item: Promise<TasksUtil.TaskDataModel>): Promise<TasksUtil.TaskDataModel> {
    return new Promise((resolve, reject) => {
        item
            .then((itemValue) => {
                const match = itemValue.text.match(TasksUtil.TaskRegularExpressions.remainderRegex);
                if (!match) { resolve(itemValue); return; }
                itemValue.text = itemValue.text.replace(match[0], "");
                resolve(itemValue);
            })
            .catch(() => reject());
    });
}

export async function tagsParser(item: Promise<TasksUtil.TaskDataModel>): Promise<TasksUtil.TaskDataModel> {
    return new Promise((resolve, reject) => {
        item
            .then((itemValue) => {
                const match = itemValue.visual?.match(TasksUtil.TaskRegularExpressions.hashTags);
                if (!match) {
                    resolve(itemValue);
                    return;
                }
                for (const m of match) {
                    itemValue.visual = itemValue.visual?.replace(m, "");
                    const tag = m.trim();
                    itemValue.tags.push(tag);
                }
                resolve(itemValue);
            })
            .catch(() => reject());
    })

}

function dateBasedStatusParser(item: TasksUtil.TaskDataModel) {
    if (!item.due && !item.scheduled &&
        !item.start && !item.completion && item.dates.size === 0) {
        item.status = TasksUtil.TaskStatus.unplanned;
        if (item.completed) item.status = TasksUtil.TaskStatus.done;
        return item;
    }

    if (item.completed && (item.scheduled && item.scheduled.isAfter() ||
        item.start && item.start.isAfter())) {
        item.status = TasksUtil.TaskStatus.cancelled;
        return item;
    }

    if (item.completed) {
        item.status = TasksUtil.TaskStatus.done;
        return item;
    }

    const today = moment();
    if (item.due && item.due.isBefore(today, 'date')) {
        item.status = TasksUtil.TaskStatus.overdue;
        return item;
    }

    if (item.due && item.due.isSame(today, 'date')) {
        item.status = TasksUtil.TaskStatus.due;
        return item;
    }

    if (item.start && item.start.isBefore(today, 'date')) {
        item.status = TasksUtil.TaskStatus.process;
        return item;
    }

    if (item.scheduled && item.scheduled.isBefore(today, 'date')) {
        item.status = TasksUtil.TaskStatus.start;
        return item;
    }

    item.status = TasksUtil.TaskStatus.scheduled;
    return item;
}

function markerBasedStatusParser(item: TasksUtil.TaskDataModel) {
    if (!Object.keys(TasksUtil.TaskStatusMarkerMap).contains(item.status)) return dateBasedStatusParser(item);
    item.status = (TasksUtil.TaskStatusMarkerMap as any)[item.status];
    return item;
}

export async function postProcessor(item: Promise<TasksUtil.TaskDataModel>): Promise<TasksUtil.TaskDataModel> {
    //["overdue", "due", "scheduled", "start", "process", "unplanned","done","cancelled"]

    //create ------------ scheduled ------- start --------- due --------- (done)
    //        scheduled              start         process       overdue
    return new Promise((resolve, reject) => {
        item
            .then((itemValue) => {
                resolve(markerBasedStatusParser(itemValue));
            })
            .catch(() => reject());
    });
}
