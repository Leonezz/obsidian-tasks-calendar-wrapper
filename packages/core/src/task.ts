/**
 * What a task in a note is, once parsed. A Task depends only on its note's content and metadata: nothing in it comes
 * from the clock or a setting, so it can be kept until the note changes. Everything that does, such as the status or
 * the daily note's date, is worked out by resolveTasks. Tasks are frozen; their dates are DateValue, read-only.
 */
import type { DateEntries, DateValue } from "./dates";
import type { PriorityLabel } from "./syntax";

/** A place in a note, as Obsidian's metadata gives it. */
export interface TextPoint {
    readonly line: number;
    readonly col: number;
    readonly offset: number;
}

/** A range in a note, the same shape as Obsidian's Pos. */
export interface TextRange {
    readonly start: TextPoint;
    readonly end: TextPoint;
}

/** A link to a note, a heading in it or a block, the same fields as Dataview's Link.toObject(). */
export interface LinkRef {
    readonly path: string;
    readonly type: "file" | "header" | "block";
    readonly subpath?: string;
    readonly display?: string;
    readonly embed: boolean;
}

/** One per note, shared by its tasks. Copies of what Obsidian's metadata holds, never Obsidian's own objects. */
export interface NoteInfo {
    readonly path: string;
    /** The note's frontmatter, or an empty object. */
    readonly frontmatter: Readonly<Record<string, unknown>>;
    /** The tags in the body of the note, which the note filters look at. */
    readonly tags: readonly string[];
}

/** The dates written on a task's line. */
export interface TaskDates {
    readonly due?: DateValue;
    readonly scheduled?: DateValue;
    readonly start?: DateValue;
    readonly completion?: DateValue;
    /** Never set by parsing, which drops ➕ and [created:: ]; the daily note's date can fill it in, see resolveTasks. */
    readonly created?: DateValue;
}

export interface Task {
    /** `${path}:${line}`. */
    readonly id: string;
    readonly note: NoteInfo;
    readonly path: string;
    /** The line the task starts on. */
    readonly line: number;
    readonly lineCount: number;
    /** Where Obsidian's metadata places the task. start.col is where the list marker starts. */
    readonly position: TextRange;
    /** The whole first line, indentation and "> " included, without its line ending. */
    readonly sourceLine: string;
    /** The task's text in the note, with its first ⏰ reminder taken out. */
    readonly text: string;
    /** The list marker: "-", "*" or "1.". */
    readonly symbol: string;
    /** The character between the brackets, case kept. */
    readonly statusMarker: string;
    /** The marker is "x"; "X" is not. */
    readonly completed: boolean;
    /** The marker is not a space. */
    readonly fullyCompleted: boolean;
    readonly checked: boolean;
    /** The line has a start, scheduled, due or done date written with the Tasks plugin's emoji. */
    readonly isTasksTask: boolean;
    /** The text shown: the line without comments, dates, fields, priority, recurrence and hashtags. */
    readonly visual: string;
    readonly priority: PriorityLabel;
    readonly recurrence: string;
    /** The tags of the line and of the note's frontmatter, then the hashtags in the text. */
    readonly tags: readonly string[];
    readonly dates: TaskDates;
    /** Other dates written on the line, such as [unplanned:: ], in the order they first appear. */
    readonly extraDates: DateEntries;
    /** The section the task is in: its heading, list or block, or the note. */
    readonly section: LinkRef;
    /** The links on the task's first line. */
    readonly outlinks: readonly LinkRef[];
}

// What parsing reads: structural subsets of Obsidian's CachedMetadata, so a cache entry is passed as it is.

export interface ListItemInfo {
    readonly parent: number;
    readonly task?: string;
    readonly position: TextRange;
}

export interface SectionInfo {
    readonly type: string;
    readonly id?: string;
    readonly position: TextRange;
}

export interface LinkInfo {
    readonly link: string;
    readonly displayText?: string;
    readonly position: TextRange;
}

export interface TagInfo {
    readonly tag: string;
    readonly position: TextRange;
}

export interface NoteMetadata {
    readonly listItems?: readonly ListItemInfo[];
    readonly sections?: readonly SectionInfo[];
    readonly links?: readonly LinkInfo[];
    readonly tags?: readonly TagInfo[];
    readonly frontmatter?: Readonly<Record<string, unknown>>;
}

/** A note as read: its path, its content and the metadata Obsidian computed for that content. */
export interface NoteSnapshot {
    readonly path: string;
    readonly content: string;
    readonly metadata: NoteMetadata | null | undefined;
}

/** Something on a task line that could not be read, such as an inline date moment does not understand. */
export interface ParseWarning {
    readonly path: string;
    readonly line: number;
    readonly message: string;
}

export interface ParsedNote {
    readonly note: NoteInfo;
    readonly tasks: readonly Task[];
    readonly warnings: readonly ParseWarning[];
}
