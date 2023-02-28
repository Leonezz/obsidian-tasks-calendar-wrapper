import type { Moment } from 'moment';
import { Link, STask } from '../dataview-util/markdown';
import { getFileTitle } from '../dataview-util/dataview';
import moment from 'moment';
import { momentToRegex } from './utils';

/**
 * When sorting, make sure low always comes after none. This way any tasks with low will be below any exiting
 * tasks that have no priority which would be the default.
 *
 * @export
 * @enum {number}
 */
export enum Priority {
    High = '1',
    Medium = '2',
    None = '3',
    Low = '4',
}

export const prioritySymbols = {
    High: '⏫',
    Medium: '🔼',
    Low: '🔽',
    None: '',
};

export const recurrenceSymbol = '🔁';
export const startDateSymbol = '🛫';
export const scheduledDateSymbol = '⏳';
export const dueDateSymbol = '📅';
export const doneDateSymbol = '✅';

export const innerDateFormat = "YYYY-MM-DD";

//["overdue", "due", "scheduled", "start", "process", "unplanned","done","cancelled"]
export type TaskStatusType =
    | "due"
    | "overdue"
    | "scheduled"
    | "start"
    | "done"
    | "unplanned"
    | "process"
    | "cancelled"

export const enum TaskStatus {
    due = 'due',// to-do type
    scheduled = 'scheduled', // to-do type
    start = 'start', //to-do type
    done = 'done',
    unplanned = 'unplanned',
    overdue = 'overdue',
    process = 'process',// to-do type
    cancelled = 'cancelled',
}

const TaskStatusCollection: string[] = [TaskStatus.due, TaskStatus.scheduled, TaskStatus.start, TaskStatus.done, TaskStatus.unplanned];

export class TaskRegularExpressions {
    public static readonly dateFormat = 'YYYY-MM-DD';

    // Matches indentation before a list marker (including > for potentially nested blockquotes or Obsidian callouts)
    public static readonly indentationRegex = /^([\s\t>]*)/;

    // Matches - or * list markers, or numbered list markers (eg 1.)
    public static readonly listMarkerRegex = /([-*]|[0-9]+\.)/;

    // Matches a checkbox and saves the status character inside
    public static readonly checkboxRegex = /\[(.)\]/u;

    // Matches the rest of the task after the checkbox.
    public static readonly afterCheckboxRegex = / *(.*)/u;

    // Main regex for parsing a line. It matches the following:
    // - Indentation
    // - List marker
    // - Status character
    // - Rest of task after checkbox markdown
    public static readonly taskRegex = new RegExp(
        TaskRegularExpressions.indentationRegex.source +
        TaskRegularExpressions.listMarkerRegex.source +
        ' +' +
        TaskRegularExpressions.checkboxRegex.source +
        TaskRegularExpressions.afterCheckboxRegex.source,
        'u',
    );

    // Used with the "Create or Edit Task" command to parse indentation and status if present
    public static readonly nonTaskRegex = new RegExp(
        TaskRegularExpressions.indentationRegex.source +
        TaskRegularExpressions.listMarkerRegex.source +
        '? *(' +
        TaskRegularExpressions.checkboxRegex.source +
        ')?' +
        TaskRegularExpressions.afterCheckboxRegex.source,
        'u',
    );

    // Used with "Toggle Done" command to detect a list item that can get a checkbox added to it.
    public static readonly listItemRegex = new RegExp(
        TaskRegularExpressions.indentationRegex.source + TaskRegularExpressions.listMarkerRegex.source,
    );

    // Match on block link at end.
    public static readonly blockLinkRegex = / \^[a-zA-Z0-9-]+/u;

    // The following regex's end with `$` because they will be matched and
    // removed from the end until none are left.
    public static readonly priorityRegex = /([⏫🔼🔽])$/u;
    public static readonly startDateRegex = /🛫 *(\d{4}-\d{2}-\d{2})/u;
    public static readonly scheduledDateRegex = /[⏳⌛] *(\d{4}-\d{2}-\d{2})/u;
    public static readonly dueDateRegex = /[📅📆🗓] *(\d{4}-\d{2}-\d{2})/u;
    public static readonly doneDateRegex = /✅ *(\d{4}-\d{2}-\d{2})/u;
    public static readonly recurrenceRegex = /🔁 ?([a-zA-Z0-9, !]+)/iu;

    // regex from @702573N
    public static readonly hexColorRegex = /([a-fA-F0-9]{6}|[a-fA-F0-9]{3})\/(.*)/;
    public static readonly TasksPluginDateRegex = /[🛫|⏳|📅|✅] *(\d{4}-\d{2}-\d{2})/;

    // [[a::b]] => a, b
    public static readonly keyValueRegex = /\[+([^\]]+)\:\:([^\]]+)\]/g;

    // [a](b) => a, b (a could be empty)
    public static readonly outerLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;

    public static readonly innerLinkRegex = /\[\[([^\]]+)\]\]/g;
    public static readonly highlightRegex = /\=\=([^\]]+)\=\=/g;
    public static readonly remainderRegex =
        /⏰ *(\d{4}-\d{2}-\d{2}) *(\d{2}\:\d{2})|⏰ *(\d{4}-\d{2}-\d{2})|(\(\@(\d{4}-\d{2}-\d{2}) *(\d{2}\:\d{2})\))|(\(\@(\d{4}-\d{2}-\d{2})\))/;
    // Regex to match all hash tags, basically hash followed by anything but the characters in the negation.
    // To ensure URLs are not caught it is looking of beginning of string tag and any
    // tag that has a space in front of it. Any # that has a character in front
    // of it will be ignored.
    // EXAMPLE:
    // description: '#dog #car http://www/ddd#ere #house'
    // matches: #dog, #car, #house
    public static readonly hashTags = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]*/g;
    public static readonly hashTagsFromEnd = new RegExp(this.hashTags.source + '$');
}

/**
 * Task encapsulates the properties of the MarkDown task along with
 * the extensions provided by this plugin. This is used to parse and
 * generate the markdown task for all updates and replacements.
 *
 * @export
 * @class Task
 */

const defaultSort = (t1: TaskDataModel, t2: TaskDataModel) => { return t1.order - t2.order; };
export interface TaskDataModel extends STask {
    // 
    dailyNote: boolean,
    //
    order: number,
    //
    priority: Priority,
    //
    priorityLabel: string,
    //
    //happens: Map<string, string>,
    //
    recurrence: string,
    //
    fontMatter: Record<string, string>,
    //
    isTasksTask: boolean,
    dates: Map<string, Moment>;
};

export namespace TaskMapable {

    export function filterDate(date: Moment) {
        return filterByDateTime(date, "date");
    }

    export function filterYear(date: Moment) {
        return filterByDateTime(date, "year");
    }

    function filterByDateTime(date: Moment, by: moment.unitOfTime.StartOf) {
        return (item: TaskDataModel) => {
            if (item.due && date.isSame(item.due, by)) return true;
            if (item.scheduled && date.isSame(item.scheduled, by)) return true;
            if (item.created && date.isSame(item.created, by)) return true;
            if (item.completion && date.isSame(item.completion, by)) return true;
            if (item.start && date.isSame(item.start, by)) return true;
            let dates = false;
            item.dates.forEach(d => {
                if(date.isSame(d, by)){
                    dates = true;
                    return true;
                }
            });
            return dates;
        }
    }

    /**
     * This function is taken from TasksPlugin, it is originally named fromLine.
     * We use this function to extract information that matches the TasksPlugin format.
     * @param item 
     * @returns 
     */
    export function tasksPluginTaskParser(item: TaskDataModel) {
        // Check the line to see if it is a markdown task.
        var description = item.visual || item.text;
        // Keep matching and removing special strings from the end of the
        // description in any order. The loop should only run once if the
        // strings are in the expected order after the description.
        let matched: boolean;
        let priority: Priority = Priority.None;
        let startDate: Moment | undefined = undefined;
        let scheduledDate: Moment | undefined = undefined;
        let scheduledDateIsInferred = false;
        let dueDate: Moment | undefined = undefined;
        let doneDate: Moment | undefined = undefined;
        let recurrenceRule: string = '';
        let recurrence: string | null = null;
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
            const priorityMatch = description.match(TaskRegularExpressions.priorityRegex);
            if (priorityMatch !== null) {
                switch (priorityMatch[1]) {
                    case prioritySymbols.Low:
                        priority = Priority.Low;
                        break;
                    case prioritySymbols.Medium:
                        priority = Priority.Medium;
                        break;
                    case prioritySymbols.High:
                        priority = Priority.High;
                        break;
                }

                description = description.replace(TaskRegularExpressions.priorityRegex, '').trim();
                matched = true;
            }

            const doneDateMatch = description.match(TaskRegularExpressions.doneDateRegex);
            if (doneDateMatch !== null) {
                doneDate = window.moment(doneDateMatch[1], TaskRegularExpressions.dateFormat);
                description = description.replace(TaskRegularExpressions.doneDateRegex, '').trim();
                matched = true;
            }

            const dueDateMatch = description.match(TaskRegularExpressions.dueDateRegex);
            if (dueDateMatch !== null) {
                dueDate = window.moment(dueDateMatch[1], TaskRegularExpressions.dateFormat);
                description = description.replace(TaskRegularExpressions.dueDateRegex, '').trim();
                matched = true;
            }

            const scheduledDateMatch = description.match(TaskRegularExpressions.scheduledDateRegex);
            if (scheduledDateMatch !== null) {
                scheduledDate = window.moment(scheduledDateMatch[1], TaskRegularExpressions.dateFormat);
                description = description.replace(TaskRegularExpressions.scheduledDateRegex, '').trim();
                matched = true;
            }

            const startDateMatch = description.match(TaskRegularExpressions.startDateRegex);
            if (startDateMatch !== null) {
                startDate = window.moment(startDateMatch[1], TaskRegularExpressions.dateFormat);
                description = description.replace(TaskRegularExpressions.startDateRegex, '').trim();
                matched = true;
            }

            const recurrenceMatch = description.match(TaskRegularExpressions.recurrenceRegex);
            if (recurrenceMatch !== null) {
                // Save the recurrence rule, but *do not parse it yet*.
                // Creating the Recurrence object requires a reference date (e.g. a due date),
                // and it might appear in the next (earlier in the line) tokens to parse
                recurrenceRule = recurrenceMatch[1].trim();
                description = description.replace(TaskRegularExpressions.recurrenceRegex, '').trim();
                matched = true;
            }

            // Match tags from the end to allow users to mix the various task components with
            // tags. These tags will be added back to the description below
            const tagsMatch = description.match(TaskRegularExpressions.hashTagsFromEnd);
            if (tagsMatch != null) {
                description = description.replace(TaskRegularExpressions.hashTagsFromEnd, '').trim();
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

        let isTasksTask = [startDate, scheduledDate, dueDate, doneDate].some(d => !!d);


        const priorityLabel = priority === Priority.High ? "High" :
            priority === Priority.Low ? "Low" : priority === Priority.Medium ? "Medium" : "No" + " priority";

        item.visual = description;
        item.priority = priority;
        item.priorityLabel = priorityLabel;
        item.recurrence = recurrenceRule;
        item.isTasksTask = isTasksTask;
        item.due = dueDate;
        item.scheduled = scheduledDate;
        item.completion = doneDate;
        item.start = startDate;
        item.checked = description.replace(' ', '').length !== 0;

        return item;
    }

    export function dataviewTaskParser(item: TaskDataModel) {
        var inlineFields = TaskRegularExpressions.keyValueRegex.exec(item.text);
        while (!!inlineFields) {
            const inlineField: string = inlineFields[0];
            const fieldKey = inlineFields[1].toLowerCase();
            const fieldValue: string = inlineFields[2];
            item.text = item.text.replace(inlineField, "");
            inlineFields = TaskRegularExpressions.keyValueRegex.exec(item.text);

            if (!(TaskStatusCollection.includes(fieldKey))) continue;
            const fieldDateMoment: moment.Moment = moment(fieldValue);
            if (!fieldDateMoment.isValid()) continue;
            //
            switch (fieldKey) {
                case "due":
                    item.due = fieldDateMoment; break;
                case "scheduled":
                    item.scheduled = fieldDateMoment; break;
                case "complete":
                case "completion":
                case "done":
                    item.completion = fieldDateMoment; break;
                case "created":
                    item.created = fieldDateMoment; break;
                case "start":
                    item.start = fieldDateMoment; break;
                default:
                    item.dates.set(fieldKey, fieldDateMoment);
            }
        }
        return item;
    }

    export function dailyNoteTaskParser(dailyNoteFormat: string = innerDateFormat) {
        return (item: TaskDataModel) => {
            const taskFile: string = getFileTitle(item.path);
            const dailyNoteRegEx = momentToRegex(dailyNoteFormat)
            const dailyNoteMatch = taskFile.match(dailyNoteRegEx);

            item.dailyNote = !!dailyNoteMatch;
            if (!item.dailyNote) return item;

            const dailyNoteDate = moment(dailyNoteMatch![1], dailyNoteFormat);
            if (!item.start) item.start = dailyNoteDate;
            if (!item.scheduled) item.scheduled = dailyNoteDate;
            if (!item.created) item.created = dailyNoteDate;

            return item;
        }
    }

    export function taskLinkParser(item: TaskDataModel) {
        var outerLinkMatch = TaskRegularExpressions.outerLinkRegex.exec(item.text);

        const buildLink = (text: string, display: string, path: string) => {
            item.text = item.text.replace(text, "");
            outerLinkMatch = TaskRegularExpressions.outerLinkRegex.exec(item.text);

            if (item.outlinks.some(l => l.path === path)) return;

            const link = Link.file(path, false, display);
            item.outlinks.push(link);
        };

        while (!!outerLinkMatch) {
            buildLink(outerLinkMatch[0], outerLinkMatch[1], outerLinkMatch[2]);
            outerLinkMatch = TaskRegularExpressions.outerLinkRegex.exec(item.text);
        }

        var innerLinkMatch = TaskRegularExpressions.innerLinkRegex.exec(item.text);
        var dataviewDateMatch = TaskRegularExpressions.keyValueRegex.exec(item.text);
        while (!!innerLinkMatch && !dataviewDateMatch) {
            buildLink(innerLinkMatch[0], innerLinkMatch[1], innerLinkMatch[2]);
            innerLinkMatch = TaskRegularExpressions.innerLinkRegex.exec(item.text);
            dataviewDateMatch = TaskRegularExpressions.keyValueRegex.exec(item.text);
        }

        return item;
    }

    export function remainderParser(item: TaskDataModel) {
        var match = item.text.match(TaskRegularExpressions.remainderRegex);
        if (!match) return item;
        item.text = item.text.replace(match[0], "");
        return item;
    }

    export function tagsParser(item: TaskDataModel) {
        var match = TaskRegularExpressions.hashTags.exec(item.visual!);
        while(match){
            const tag = match[0];
            item.visual = item.visual?.replace(tag, "");
            item.tags.push(tag.trim());
            match = TaskRegularExpressions.hashTags.exec(item.visual!);
        }
        return item;
    }

    export function postProcessor(item: TaskDataModel) {
        //["overdue", "due", "scheduled", "start", "process", "unplanned","done","cancelled"]

        //create ------------ scheduled ------- start --------- due --------- (done)
        //        scheduled              start         process       overdue
        if (!item.due && !item.scheduled &&
            !item.start && !item.completion && item.dates.size === 0) {
            item.status = TaskStatus.unplanned;
            if (item.completed) item.status = TaskStatus.done;
            return item;
        }

        if (item.completed && (item.scheduled && item.scheduled.isAfter() ||
            item.start && item.start.isAfter())) {
            item.status = TaskStatus.cancelled;
            return item;
        }

        if (item.completed) {
            item.status = TaskStatus.done;
            return item;
        }

        const today = moment();
        if (item.due && item.due.isBefore(today, 'date')) {
            item.status = TaskStatus.overdue;
            return item;
        }

        if (item.due && item.due.isSame(today, 'date')) {
            item.status = TaskStatus.due;
            return item;
        }

        if (item.start && item.start.isBefore(today, 'date')) {
            item.status = TaskStatus.process;
            return item;
        }

        if (item.scheduled && item.scheduled.isBefore(today, 'date')) {
            item.status = TaskStatus.start;
            return item;
        }

        item.status = TaskStatus.scheduled;
        return item;
    }
}
