// The sort options moved to packages/core; re-exported for the modules that import them from here.
export { defaultSortKey, getSortComparator, migrateSortOption, sortOptionLabels } from "@tasks-calendar-wrapper/core";
export type { SortableTask, TaskComparator } from "@tasks-calendar-wrapper/core";
