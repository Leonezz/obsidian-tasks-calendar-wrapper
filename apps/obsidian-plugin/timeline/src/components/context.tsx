import { Pos, type UserEvent } from "obsidian";
import type { DateField, QuickFilter, TaskRowModel } from "@tasks-calendar-wrapper/core";
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
	handleFilterEnable: (
		startDate: string | undefined,
		enddate: string | undefined,
		priorities: string[],
		tags?: string[],
	) => void;
	quickFilter?: QuickFilter;
	/** Suggests the tags under the tag filter's input; returns what stops it. */
	suggestTags?: (input: HTMLInputElement, tags: () => readonly string[], pick: (tag: string) => void) => () => void;
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
	handleModifyTask: undefined as ((model: TaskRowModel, evt: MouseEvent) => void) | undefined,
	handleRowMenu: undefined as ((model: TaskRowModel, evt: MouseEvent) => void) | undefined,
	handleDateBadge: undefined as ((model: TaskRowModel, field: DateField) => void) | undefined,
});
