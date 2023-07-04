import { STask } from '../dataview-util/markdown';

enum TasksPriorityLabel {
    Highest = 'Highest',
    High = 'High',
    Medium = 'Medium',
    None = 'No',
    Low = 'Low',
    Lowest = 'Lowest',
}

export const TasksPrioritySymbolToLabel = {
    '🔺': TasksPriorityLabel.Highest,
    '⏫': TasksPriorityLabel.High,
    '🔼': TasksPriorityLabel.Medium,
    '🔽': TasksPriorityLabel.Low,
    '': TasksPriorityLabel.None,
    '⏬': TasksPriorityLabel.Lowest
};

export type TasksPrioritySymbol = keyof (typeof TasksPrioritySymbolToLabel);
export type PriorityLabel = string;

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

export const TaskStatusCollection: string[] = [TaskStatus.due, TaskStatus.scheduled, TaskStatus.start, TaskStatus.done, TaskStatus.unplanned];
export const TaskStatusMarkerMap = {
    '>': TaskStatus.overdue,
    '<': TaskStatus.scheduled,
    'x': TaskStatus.done,
    '/': TaskStatus.process,
    '-': TaskStatus.cancelled
};

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
    public static readonly priorityRegex = RegExp("([" +
        Object.keys(TasksPrioritySymbolToLabel).filter(s => s.length > 0).join('') +
        "])$", "u");

    public static readonly startDateRegex = /🛫 *(\d{4}-\d{2}-\d{2})/u;
    public static readonly scheduledDateRegex = /[⏳⌛] *(\d{4}-\d{2}-\d{2})/u;
    public static readonly dueDateRegex = /[📅📆🗓] *(\d{4}-\d{2}-\d{2})/u;
    public static readonly doneDateRegex = /✅ *(\d{4}-\d{2}-\d{2})/u;
    public static readonly recurrenceRegex = /🔁 ?([a-zA-Z0-9, !]+)/iu;

    // regex from @702573N
    public static readonly hexColorRegex = /([a-fA-F0-9]{6}|[a-fA-F0-9]{3})\/(.*)/;
    public static readonly TasksPluginDateRegex = /[🛫|⏳|📅|✅] *(\d{4}-\d{2}-\d{2})/u;

    // [[a::b]] => a, b
    public static readonly keyValueRegex = /\[+([^\]]+)::([^\]]+)\]/g;

    /**
     * [a](b) => a, b (a could be empty)
     * #1: [a](b)
     * #2: a
     * #3: b
     */
    public static readonly outerLinkRegex =
        /\[((?:\[[^\]]*\]|[^[\]])*)\]\([ \t]*<?((?:\([^)]*\)|[^()\s])*?)>?[ \t]*((['"])(.*?)\6[ \t]*)?\)/g

    public static readonly innerLinkRegex = /\[\[([^\]]+)\]\]/g;
    public static readonly highlightRegex = /==([^\]]+)==/g;
    public static readonly remainderRegex =
        /⏰ *(\d{4}-\d{2}-\d{2}) *(\d{2}:\d{2})|⏰ *(\d{4}-\d{2}-\d{2})|(\(@(\d{4}-\d{2}-\d{2}) *(\d{2}:\d{2})\))|(\(@(\d{4}-\d{2}-\d{2})\))/;
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

//const defaultSort = (t1: TaskDataModel, t2: TaskDataModel) => { return t1.order - t2.order; };
export interface TaskDataModel extends STask {
    // 
    dailyNote: boolean,
    //
    order: number,
    //
    priority: PriorityLabel,
    //
    //happens: Map<string, string>,
    //
    recurrence: string,
    //
    fontMatter: Record<string, string>,
    //
    isTasksTask: boolean,
    statusMarker: string,
    dates: Map<string, moment.Moment>;
}


