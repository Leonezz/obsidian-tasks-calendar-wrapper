import { Options } from "../utils/options";
import { TaskDataModel } from "../utils/tasks";

export interface CalendarSettings {
    viewPath: string,
    view: string,
    firstDayOfWeek: string,
    options: string,
    dailyNoteFolder: string | null,
    dailyNoteFormat: string | null,
    startPosition: string | null,
    globalTaskFilter: string | null,
    css: string | null,
    pages: string
};

