import "./setup";

import moment from "moment";

import { Link } from "../dataview-util/markdown";
import { ObsidianTaskAdapter } from "../Obsidian-Tasks-Timeline/src/taskadapter";
import * as TaskMapable from "../utils/taskmapable";
import { TaskDataModel } from "../utils/tasks";

export const FILE = "Inbox.md";

type LineParser = (
    line: string, filePath: string, parent: Link, position: unknown,
    outLinks: Link[], frontMatter: undefined, tags: string[],
) => TaskDataModel | null;

/** Builds a task the same way the adapter does when it reads a markdown line. */
export function makeTask(line: string, file: string = FILE, col = 0): TaskDataModel {
    const adapter = new ObsidianTaskAdapter({} as never);
    const fromLine = (adapter as unknown as { fromLine: LineParser }).fromLine;
    const position = { start: { line: 0, col, offset: 0 }, end: { line: 0, col: line.length, offset: line.length } };
    const task = fromLine(line, file, Link.file(file), position, [], undefined, []);
    if (!task) throw new Error(`not a task line: ${line}`);
    return task;
}

/** Runs the same parser chain as TasksTimelineView.parseTasks with the forward option on. */
export function parse(
    line: string,
    today: moment.Moment,
    options: TaskMapable.ForwardOptions = {},
    file: string = FILE,
): Promise<TaskDataModel> {
    const chain = [
        TaskMapable.commentsParser,
        TaskMapable.tasksPluginTaskParser,
        TaskMapable.dataviewTaskParser,
        TaskMapable.dailyNoteTaskParser(),
        TaskMapable.tagsParser,
        TaskMapable.remainderParser,
        TaskMapable.postProcessor,
        TaskMapable.forwardParser(today, options),
    ];
    return chain.reduce((acc, step) => step(acc), Promise.resolve(makeTask(line, file)));
}
