import { dayKey, type DayKey } from "@tasks-calendar-wrapper/core";
import { Pos } from "obsidian";
import { moment } from "../../../utils/moment";
import * as React from "react";
import { TaskDataModel } from "../../../utils/tasks";
import { CounterProps } from "./dateview";

export const TaskListContext = React.createContext({
	taskList: [] as TaskDataModel[],
	/** The day the entry (focus toggle, counters, quick entry) sits on. */
	entryOnDate: dayKey(moment()) as DayKey,
});

export const UserOptionContext = React.createContext({
	taskFiles: [] as string[],
	select: "" as string,
	counters: [] as CounterProps[],
	dateFormat: "YYYY-MM-DD" as string,
	tagPalette: {} as Record<string, string>,
	hideTags: [] as string[],
	forward: false as boolean,
	useBuiltinStyle: true as boolean,
});

export const QuickEntryHandlerContext = React.createContext({
	handleCreateNewTask: (filePath: string, content: string) => {},
	handleFilterEnable: (startDate: string, enddate: string, priorities: string[]) => {},
});

export const TodayFocusEventHandlersContext = React.createContext({
	handleTodayFocusClick: () => {},
});

export const TaskItemEventHandlersContext = React.createContext({
	handleOpenFile: (filePath: string, position: Pos) => {},
	handleCompleteTask: (filePath: string, position: Pos) => {},
	handleTagClick: (tag: string) => {},
	handleModifyTask: undefined as ((filePath: string, position: Pos) => void) | undefined,
});
