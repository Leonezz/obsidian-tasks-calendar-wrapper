import { Pos, type UserEvent } from "obsidian";
import type { QuickFilter, TaskRowModel } from "@tasks-calendar-wrapper/core";
import * as React from "react";
import { createPendingWrites } from "../pendingwrites";
import type { ListChangeClock } from "./clickguard";

export const RowWriteContext = React.createContext({
	pendingWrites: createPendingWrites(),
	clock: { lastListChangeAt: -Infinity } as ListChangeClock,
});

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
	handleCompleteTask: (model: TaskRowModel, evt: MouseEvent) => {},
	handleTagClick: (tag: string) => {},
	/** Returning true stops the click from also opening the note through the row. */
	handleModifyTask: undefined as ((model: TaskRowModel, evt: MouseEvent) => boolean | void) | undefined,
});
