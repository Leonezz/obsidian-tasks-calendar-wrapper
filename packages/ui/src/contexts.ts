import * as React from "react";
import type { DateField, TaskRowModel, TextRange } from "@tasks-calendar-wrapper/core";
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
}>({
	pendingWrites: { getSnapshot: () => undefined, subscribe: () => () => {} },
	clock: { lastListChangeAt: -Infinity },
});

export const TaskItemEventHandlersContext = React.createContext({
	handleOpenFile: (filePath: string, position: TextRange, evt?: MouseEvent) => {},
	handleCompleteTask: (model: TaskRowModel, evt: MouseEvent) => {},
	handleTagClick: (tag: string) => {},
	handleModifyTask: undefined as ((model: TaskRowModel, evt: MouseEvent) => void) | undefined,
	handleRowMenu: undefined as ((model: TaskRowModel, evt: MouseEvent) => void) | undefined,
	handleDateBadge: undefined as ((model: TaskRowModel, field: DateField) => void) | undefined,
});
