import { Pos, type UserEvent } from "obsidian";
import type { QuickFilter } from "@tasks-calendar-wrapper/core";
import * as React from "react";

export const UserOptionContext = React.createContext({
	taskFiles: [] as string[],
	select: "" as string,
	dateFormat: "YYYY-MM-DD" as string,
	tagPalette: {} as Record<string, string>,
	hideTags: [] as string[],
	useBuiltinStyle: true as boolean,
});

export const QuickEntryHandlerContext = React.createContext<{
	handleCreateNewTask: (filePath: string, content: string) => Promise<boolean>;
	handleFilterEnable: (startDate: string | undefined, enddate: string | undefined, priorities: string[]) => void;
	quickFilter?: QuickFilter;
}>({
	handleCreateNewTask: async (filePath: string, content: string) => false,
	handleFilterEnable: (startDate: string | undefined, enddate: string | undefined, priorities: string[]) => {},
	quickFilter: undefined,
});

export const TodayFocusEventHandlersContext = React.createContext({
	handleTodayFocusClick: () => {},
});

export const TaskItemEventHandlersContext = React.createContext({
	handleOpenFile: (filePath: string, position: Pos, evt?: UserEvent) => {},
	handleCompleteTask: (filePath: string, position: Pos) => {},
	handleTagClick: (tag: string) => {},
	handleModifyTask: undefined as ((filePath: string, position: Pos) => void) | undefined,
});
