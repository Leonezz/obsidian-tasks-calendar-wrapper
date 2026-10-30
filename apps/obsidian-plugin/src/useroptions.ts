import type { PropertyRules } from "@tasks-calendar-wrapper/core";
import { defaultSortKey } from "@tasks-calendar-wrapper/core";

/*
 * The plugin's settings and their defaults, as saved in data.json. Kept apart from the settings page,
 * which needs Obsidian, so that code and tests running without Obsidian can read them.
 */
export const defaultUserOptions = {
	/**
	 * Open the view on startup or not
	 */
	openViewOnStartup: false as boolean,
	/**
	 * Show the release notes once after the plugin is updated.
	 */
	showWhatsNewOnUpdate: true as boolean,
	/**
	 * The version the release notes were last shown for. Managed by the plugin.
	 */
	lastSeenVersion: "" as string,
	/**
	 * filter empty items out or not, if not, the raw text of empty items will be displayed
	 */
	filterEmpty: true as boolean,
	/**
	 * Exclude tasks match specific paths (folders, files)
	 */
	excludePaths: [] as string[],
	/**
	 * filter specific files and tasks only from these files are rendered */
	includePaths: [] as string[],
	/**
	 * Use tags filters to filter tasks without specific tags out or not.
	 */
	useIncludeTags: false as boolean,
	/**
	 * Filter tasks with specific tags, only tasks with one or more of these tags are displayed.
	 */
	taskIncludeTags: [] as string[],
	/**
	 * Filter tasks in specific files which contains one or more of these tags to be displayed.
	 */
	fileIncludeTags: [] as string[],
	/**
	 * Use tags filters to filters tasks with specific tags out or not.
	 */
	useExcludeTags: false as boolean,
	/**
	 * Filter tasks without specific tags, only tasks **without any** if these tags are displayed.
	 */
	taskExcludeTags: [] as string[],
	/**
	 * Filter tasks in specific files which **does not** contains any of these tags to be displayed.
	 */
	fileExcludeTags: [] as string[],
	/**
	 * Exclude tasks of files whose frontmatter property has one of these values,
	 * e.g. { status: ["archived"] } hides the tasks of notes with `status: archived`.
	 */
	excludeProperties: {} as PropertyRules,
	/**
	 * optional options to customize the look */
	styles: ["style1"] as string[],
	/**
	 * specify the folder where the daily notes are saved */
	dailyNoteFolder: "" as string,
	/**
	 * daily note file format */
	dailyNoteFormat: "YYYY, MMMM DD - dddd" as string,
	/**
	 * specify under which section the new task items should be appended.  */
	sectionForNewTasks: "## Tasks" as string,
	/**
	 * specify which tags are not necessary to display with a tag badge,
	 * note that all tag texts are remove from the displayed item text by default. */
	hideTags: [] as string[],
	/**
	 * Forward tasks from the past and display them on the today panel or not
	 */
	forward: true as boolean,
	/**
	 * Also show tasks whose start or scheduled date has passed on the today panel.
	 */
	forwardPastStartAndScheduled: false as boolean,
	/**
	 * Show done tasks that have no date at all on the today panel. They have no other day to be shown on.
	 */
	forwardUndatedDone: true as boolean,
	/**
	 * Specify how do you like the task items to be sorted, see sortOptionLabels in packages/core/src/sort.ts.
	 */
	sort: defaultSortKey as string,
	/**
	 * Specify task status order
	 * TODO
	 */
	taskStatusOrder: ["overdue", "due", "scheduled", "start", "process", "unplanned", "done", "cancelled"],
	/**
	 * Specify in what format do you like the dates to be displayed.
	 */
	dateFormat: "dddd, MMM, D" as string,
	/**
	 * Specify in which file do you like to append new task items to by default.
	 * Tasks from this file will be displayed under today panel and labeled inbox by default.
	 */
	inbox: "Inbox.md" as string,
	/**
	 * Specify which files do you like to be displayed in the file select by default.
	 * If left blank, all files where there are task items will be displayed.
	 */
	taskFiles: [] as string[],
	/**
	 * Specify a color palette for tags.
	 * Note that this will override other color setting for tags.
	 */
	tagColorPalette: { "#TODO": "#339988", "#TEST": "#998877" } as Record<string, string>,
	/**
	 * Use counters on the today panel or not
	 */
	useCounters: true as boolean,
	/**
	 * Default behavior for filter buttons,
	 * Focus to make items more clear or
	 * Filter others out.
	 */
	counterBehavior: "Filter" as "Filter" | "Focus",
	/**
	 * Use quick entry panel on the today panel or not
	 */

	useQuickEntry: true as boolean,
	/**
	 * Where to put the entry panel,
	 * Top means on top of the view,
	 * Bottom means on bottom of the view,
	 * Today means in today's view.
	 */
	entryPosition: "today" as "today" | "top" | "bottom",
	/**
	 * Display which year it is or not.
	 */
	useYearHeader: true as boolean,
	/**
	 * Show the latest dates on top instead of the earliest.
	 */
	newestFirst: false as boolean,

	/**
	 * USE INFO BEGIN
	 */
	/**
	 * Use relative dates to describe the task dates or not.
	 */
	useRelative: true as boolean,
	/**
	 * Display recurrence information of tasks or not.
	 */
	useRecurrence: true as boolean,
	/**
	 * Display priority information of tasks or not.
	 */
	usePriority: true as boolean,
	/**
	 * Display tags of tasks or not.
	 */
	useTags: true as boolean,
	/**
	 * Display which file the task is from or not.
	 */
	useFileBadge: true as boolean,
	/**
	 * Display which section the task is from or not.
	 */
	useSection: true as boolean,
	/**
	 * Display the badge that opens the task in the Tasks plugin dialog or not.
	 */
	useModifyBadge: true as boolean,
	/**
	 * USE INFO END
	 */
	/**
	 * hide specific status of tasks.
	 */
	hideStatusTasks: ["x", "-"] as string[],
	/**
	 * Hide task items that are nested under another list item.
	 */
	hideSubTasks: false as boolean,
	/**
	 * Activate today focus on load or not.
	 */
	defaultTodayFocus: false as boolean,
	/**
	 * Activate a filter or not.
	 */
	defaultFilters: "" as string,
	/**
	 * Use builtin style (status icons) or not.
	 * If disabled, icons defined by the theme will be used.
	 */
	useBuiltinStyle: true as boolean,
	/**
	 * Convert a 24 hour time prefix in task description (15:30) to 12 hour time with am/pm (3:30 pm)
	 */
	convert24HourTimePrefix: false as boolean,
};
export type UserOption = typeof defaultUserOptions;
