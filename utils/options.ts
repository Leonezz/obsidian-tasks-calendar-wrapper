import { moment } from "obsidian";
import { TaskDataModel } from "./tasks";

export interface __Options {
    inbox: string | undefined,
    select: string,
    taskOrder: Set<string>,
    taskFiles: Set<string>,
    globalTaskFilter: Set<string>,
    dailyNoteFolder: string,
    dailyNoteFormat: string | undefined,
    done: boolean,
    sort: (t1: TaskDataModel, t2: TaskDataModel) => number,
    css: string | undefined,
    forward: boolean,
    dateFormat: string,
    section: string,
    options: Set<string>,
}

export class TimelineSettings implements __Options{
    inbox: string | undefined = "Inbox.md";
    select: string = "Inbox.md";
    taskOrder: Set<string> = new Set(["overdue", "due", "scheduled", "start", "process", "unplanned", "done", "cancelled"]);
    taskFiles: Set<string> = new Set();
    globalTaskFilter: Set<string> = new Set();
    dailyNoteFolder: string = "";
    dailyNoteFormat: string | undefined = "YYYY-MM-DD";
    done: boolean = false;
    sort = (t1: TaskDataModel, t2: TaskDataModel) => { return t1.order - t2.order; };
    css: string | undefined = undefined;
    forward: boolean = false;
    dateFormat: string = "ddd, MMM D";
    section: string = "## Inbox";
    options: Set<string> = new Set();
    constructor(){
        this.postProcessor();
    }
    postProcessor() {
        if(this.inbox && this.inbox !== '')this.taskFiles.add(this.inbox);
        if(this.select && this.select !== '')this.taskFiles.add(this.select);
        const dailyNoteFileName = moment().format(this.dailyNoteFormat) + ".md";
        const daileNoteFolder = this.dailyNoteFolder === '' ? '' : this.dailyNoteFolder.endsWith('/') ? this.dailyNoteFolder : this.dailyNoteFolder + '/'
        if(this.dailyNoteFormat && this.dailyNoteFormat !== '')this.taskFiles.add(daileNoteFolder + dailyNoteFileName);
    };
};
