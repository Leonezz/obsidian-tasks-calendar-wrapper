import { Component, ItemView, WorkspaceLeaf } from "obsidian";
import { DataviewApi, getAPI } from 'obsidian-dataview';
import { CalendarSettings, TimelineSettings } from "settings";
import { serializeSettingToDVJS } from "settings";

export const CALENDAR_VIEW = "tasks_calendar_view";
export const TIMELINE_VIEW = "tasks_timeline_view";

const CALENDAR_VIEW_PATH = "scripts/calendar";
const TIMELINE_VIEW_PATH = "scripts/timeline";

export const DEFAULT_CALENDAR_SETTINGS : CalendarSettings = {
    viewPath: CALENDAR_VIEW_PATH,
    view: "week",
    firstDayOfWeek: "1",
    options: "style1",
    dailyNoteFolder: null,
    dailyNoteFormat: null,
    startPosition: null,
    globalTaskFilter: null,
    css: null,
    pages: "dv.pages().file.tasks.where(t => t.tags.includes(\"#TODO\"))"
};

export const  DEFAULT_TIMELINE_SETTINGS : TimelineSettings = {
    viewPath: TIMELINE_VIEW_PATH,
    options: "",
    dailyNoteFolder: null,
    dailyNoteFormat: null,
    section: null,
    sort: "t => t.order",
    forward: "true",
    select: null,
    inbox: null,
    taskFiles: "",
    globalTaskFilter: null,
    pages: "dv.pages().file.tasks.where(t => t.tags.includes(\"#TODO\"))"
}

export abstract class BaseTasksView extends ItemView {
    protected dataviewAPI: DataviewApi | undefined;
    protected setting: CalendarSettings | TimelineSettings;
    constructor(leaf: WorkspaceLeaf, setting: CalendarSettings | TimelineSettings | null){
        super(leaf);
        this.dataviewAPI = getAPI(this.app);
    }

    async onOpen(): Promise<void> {
        const queryStr = serializeSettingToDVJS(this.setting);

        console.log(queryStr)
        const container = this.containerEl.children[1];
        const ele = container.createDiv();
        this.dataviewAPI?.executeJs(queryStr, ele, this, ".");
    }
}

export class TasksCalendarView extends BaseTasksView {

    constructor(leaf: WorkspaceLeaf, setting: CalendarSettings | null) {
        super(leaf, setting);

        if(setting)this.setting = setting;
        else this.setting = DEFAULT_CALENDAR_SETTINGS;
    }

    getViewType(): string {
        return CALENDAR_VIEW;
    }

    getDisplayText(): string {
        return "Tasks Calendar";
    }

    async onClose(): Promise<void> {

    }
}

export class TasksTimelineView extends BaseTasksView {
    constructor(leaf: WorkspaceLeaf, setting: TimelineSettings | null) {
        super(leaf, setting);
        
        if(setting)this.setting = setting;
        else this.setting = DEFAULT_TIMELINE_SETTINGS;
        
    }

    getViewType(): string {
        return TIMELINE_VIEW;
    }

    getDisplayText(): string {
        return "Tasks Timeline";
    }



    async onClose(): Promise<void> {

    }
}