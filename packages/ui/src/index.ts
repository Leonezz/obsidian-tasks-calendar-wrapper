/**
 * The timeline components move here from apps/obsidian-plugin/timeline in phase 4 of the
 * restructuring. This package may depend on @tasks-calendar-wrapper/core, never on obsidian.
 * The plugin imports ui only through this public entry.
 */
export type { UiHost, TimelineHandle, TimelineWindowHost, TimelineWindowingInfo } from "./host";
export { WINDOW_MIN_ROWS, WINDOW_RELEASE_ROWS } from "@tasks-calendar-wrapper/core";
export {
	HostContext,
	QuickEntryHandlerContext,
	RowWriteContext,
	TaskItemEventHandlersContext,
	ViewActionsContext,
	useHost,
	type ViewState,
	type ViewActions,
	type CounterId,
	type RowOverlay,
	type RowOverlayStore,
} from "./contexts";
export { useStore } from "./hooks/useStore";
export { useTransitionedStore } from "./hooks/useTransitionedStore";
export { Timeline, type TimelineProps, type TimelineOptions } from "./timeline/Timeline";
export { YearHeader } from "./timeline/YearHeader";
export { DayHeader } from "./timeline/DayHeader";
export { Year } from "./timeline/Year";
export { DayContent } from "./timeline/DayContent";
export { Content, sameContentProps, type ContentProps } from "./row/Content";
export { TaskRow, sameRowModelProps } from "./row/TaskRow";
export { StatusMarker } from "./row/StatusMarker";
export { TagBadge, FileBadge, DateStatusBadge, ModifyBadge } from "./row/Badges";
export { Counters, CounterItem } from "./entry/Counters";
export { QuickEntry } from "./entry/QuickEntry";
export { MultiSelect } from "./entry/MultiSelect";
export { TodayFocus } from "./entry/TodayFocus";
export { getTaskStatusIcon } from "./icons";
export { clickTime, clickIsGuarded, type ListChangeClock } from "./clickguard";
export { sameJsonValue } from "./sameJsonValue";
export {
	recordProvider,
	providerValues,
	rendersOf,
	renderedDays,
	resetRenderCounts,
	onTimelineRender,
} from "./renderprobe";
