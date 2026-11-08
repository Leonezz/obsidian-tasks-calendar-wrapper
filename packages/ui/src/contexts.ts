import * as React from "react";
import type { DateField, QuickFilter, TaskRowModel, TextRange } from "@tasks-calendar-wrapper/core";
import type { ListChangeClock } from "./clickguard";
import type { UiHost } from "./host";

export const HostContext = React.createContext<UiHost | null>(null);
HostContext.displayName = "HostContext";

/** The app supplies the timeline's host; rendering outside its provider is a wiring error. */
export function useHost(): UiHost {
	const host = React.useContext(HostContext);
	if (host === null) throw new Error("useHost needs a HostContext provider around the timeline");
	return host;
}

export const TodayFocusEventHandlersContext = React.createContext({
	handleTodayFocusClick: () => {},
});

export const RowDayKeyContext = React.createContext("");

export const rowInstanceKey = (dayKey: string, taskId: string): string =>
	`${encodeURIComponent(dayKey)}-${encodeURIComponent(taskId)}`;

export interface RowOverlay {
	readonly dimmed: boolean;
	readonly marker?: string;
	readonly status?: string;
}

export interface RowOverlayStore {
	getSnapshot(id: string): RowOverlay | undefined;
	subscribe(id: string, listener: () => void): () => void;
}

export const RowWriteContext = React.createContext<{
	readonly pendingWrites: RowOverlayStore;
	readonly clock: ListChangeClock;
	readonly prefix: string;
	readonly focusRow: (id: string) => void;
	readonly moveFocus: (id: string, key: string) => void;
}>({
	pendingWrites: { getSnapshot: () => undefined, subscribe: () => () => {} },
	clock: { lastListChangeAt: -Infinity },
	prefix: "tcw-row-",
	focusRow: () => {},
	moveFocus: () => {},
});

export const TaskItemEventHandlersContext = React.createContext({
	handleOpenFile: (filePath: string, position: TextRange, evt?: MouseEvent | KeyboardEvent) => {},
	handleCompleteTask: (model: TaskRowModel, evt: MouseEvent | KeyboardEvent) => {},
	handleTagClick: (tag: string) => {},
	handleModifyTask: undefined as ((model: TaskRowModel, evt: MouseEvent | KeyboardEvent) => void) | undefined,
	handleRowMenu: undefined as ((model: TaskRowModel, evt: MouseEvent) => void) | undefined,
	handleDateBadge: undefined as ((model: TaskRowModel, field: DateField) => void) | undefined,
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

export const UserOptionContext = React.createContext({
	taskFiles: [] as string[],
	select: "" as string,
	dateFormat: "YYYY-MM-DD" as string,
	tagPalette: {} as Record<string, string>,
	hideTags: [] as string[],
	useBuiltinStyle: true as boolean,
});
