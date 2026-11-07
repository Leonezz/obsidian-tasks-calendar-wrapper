import type { QuickFilter } from "@tasks-calendar-wrapper/core";
import * as React from "react";
export { RowWriteContext, TaskItemEventHandlersContext } from "@tasks-calendar-wrapper/ui/src/contexts";

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
