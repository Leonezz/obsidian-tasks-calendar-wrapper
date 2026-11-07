import * as React from "react";
export {
	QuickEntryHandlerContext,
	RowWriteContext,
	TaskItemEventHandlersContext,
} from "@tasks-calendar-wrapper/ui/src/contexts";

export const UserOptionContext = React.createContext({
	taskFiles: [] as string[],
	select: "" as string,
	dateFormat: "YYYY-MM-DD" as string,
	tagPalette: {} as Record<string, string>,
	hideTags: [] as string[],
	useBuiltinStyle: true as boolean,
});
