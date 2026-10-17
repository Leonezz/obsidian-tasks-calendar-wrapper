import type { PriorityLabel } from "@tasks-calendar-wrapper/core";
import { STask } from '../dataview-util/markdown';

// The task syntax and the statuses moved to packages/core; re-exported for the modules that import them from here.
export {
    doneDateSymbol,
    dueDateSymbol,
    innerDateFormat,
    recurrenceSymbol,
    scheduledDateSymbol,
    startDateSymbol,
    TaskRegularExpressions,
    TasksPriorityNameToLabel,
    TasksPriorityRank,
    TasksPrioritySymbolToLabel,
    TaskStatus,
    TaskStatusMarkerMap,
} from "@tasks-calendar-wrapper/core";
export type { PriorityLabel, TasksPrioritySymbol } from "@tasks-calendar-wrapper/core";

/**
 * Task encapsulates the properties of the MarkDown task along with
 * the extensions provided by this plugin. This is used to parse and
 * generate the markdown task for all updates and replacements.
 *
 * @export
 * @class Task
 */
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


