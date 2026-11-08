/**
 * Copy style guide: use sentence case for names, buttons and titles; keep product names as written:
 * Tasks, Obsidian, Dataview, Tasks Timeline. Names have no full stop; descriptions are full sentences with one.
 * Use the fixed nouns timeline (view), note (file), task, quick entry, and Focus on today.
 * An aria-label describes the action ("Complete task", not "✓"). Use emoji only for task syntax (📅 ⏫ 🔁),
 * never as a button's only label.
 * Enforced for settings from step 14; timeline enforcement follows in step 24.
 */

/** Freeze every group, array and function once when the table loads. */
function freezeCopy<T>(value: T): T {
	if (value && (typeof value === "object" || typeof value === "function")) {
		for (const child of Object.values(value)) freezeCopy(child);
		Object.freeze(value);
	}
	return value;
}

export const copy = freezeCopy({
	counters: {
		todo: "Todo",
		todoAria: "Todo Tasks",
		overdue: "Overdue",
		overdueAria: "Overdue Tasks",
		unplanned: "Unplanned",
		unplannedAria: "Unplanned Tasks",
	},
	quickEntry: {
		newTask: "New Task",
		filter: "Filter",
		selectNoteAria: "Select a note to add a new task to",
		actionAria: "Quick entry action",
		filterTypeAria: "Add a filter",
		priorityAria: "Filter by priority",
		fromAria: "Show tasks from this date",
		toAria: "Show tasks up to this date",
		filterVisual: ["➕", "📆 date", "⏫ priority"],
		placeholder: "Enter your tasks here",
		from: "From: ",
		to: "  To: ",
		priorities: "Priorities: ",
		priorityVisual: ["➕", "High", "Medium", "None", "Low"],
		appendTaskAria: "Append new task to selected note",
		tagPlaceholder: "🏷️ Filter by tag: #home",
		tagAria: "Show only tasks with this tag",
	},
	row: {
		checkboxAria: "Complete task",
		statusAria: {
			due: "Due",
			scheduled: "Scheduled",
			start: "Started",
			done: "Done",
			unplanned: "Unplanned",
			overdue: "Overdue",
			process: "In progress",
			cancelled: "Cancelled",
		},
		summary: (p: { status: string; dates: readonly string[]; note: string }): string =>
			[p.status, ...p.dates, p.note].join(", "),
		menuAria: "Task menu",
		menuGlyph: "⋯",
		modifyAria: "Modify Task",
		modifyGlyph: "✏️",
		createdPrefix: "create at ",
		startPrefix: "start at ",
		scheduledPrefix: "scheduled to ",
		duePrefix: "due at ",
		donePrefix: "complete at ",
		recurrencePrefix: "recurrent: ",
		priorityPrefix: "priority: ",
		prioritySuffix: " Priority",
	},
	timeline: {
		displayText: "Tasks Timeline",
		focusOnToday: "Focus On Today",
		focusOnTodayAria: "Focus today",
	},
	notices: {
		impossibleDate: (p: { text: string; field: string | undefined; value: string | undefined }) =>
			`“${p.text}” has a ${p.field} date that does not exist (${p.value}). Nothing was written.`,
		changeDateWithMenu: (p: { gesture: string; field: string | undefined }) =>
			` Change it with ${p.gesture} → Pick ${p.field} date….`,
		touchMenu: "⋯",
		rightClick: "right-click",
		fixInNote: " Fix it in the note.",
		unreadableReturnedDate: (p: { token: string | undefined; text: string }) =>
			`Tasks returned a date the timeline cannot read back (“${p.token}”) for “${p.text}”. Nothing was written.`,
		unreadableChangedDate: (p: { text: string; token: string | undefined }) =>
			`“${p.text}” would get a date the timeline cannot read back (“${p.token}”). Nothing was written.`,
		localDigits: (p: { locale: string | undefined }) =>
			` Tasks wrote it in the digits of Obsidian's language (${p.locale}).`,
		recurrenceLost: (p: { text: string }) =>
			`Tasks could not read the recurrence rule in “${p.text}” and would drop it. Nothing was written. Fix the rule in the note, then try again.`,
		recurringNeedsTasks: "Recurring tasks need the Tasks plugin. Nothing was written.",
		notTaskLine: (p: { text: string }) =>
			`The timeline can't change “${p.text}” safely because it isn't a plain task line. Open the note to change it.`,
		ambiguous: (p: { text: string; note: string }) =>
			`“${p.text}” appears more than once near here in ${p.note}, and the timeline can't tell which one you clicked. Nothing was written.`,
		couldNotUndo: "Could not undo: ",
		movedOrDeleted: (p: { prefix: string; note: string }) =>
			`${p.prefix}${p.note} was moved or deleted. Nothing was written.`,
		notUtf8: (p: { note: string }) =>
			`${p.note} is not saved as UTF-8. Nothing was written: writing would replace its unreadable characters (shown as �) for good. Convert the note to UTF-8 to edit its tasks from the timeline.`,
		queueBlocked: (p: { note: string }) =>
			`${p.note} may not have been saved yet. The timeline won't change it until the note changes or two minutes pass.`,
		dateAmbiguous: (p: { text: string; field: string | undefined; a: string | undefined; b: string | undefined }) =>
			`“${p.text}” has more than one ${p.field} date (${p.a} and ${p.b}). Nothing was changed. Keep one of them in the note, then try again.`,
		dateUnreadable: (p: { text: string; field: string | undefined; found: string | undefined }) =>
			`“${p.text}” has its ${p.field} date written as ${p.found}, which the timeline cannot change. Nothing was changed. Edit it in the note.`,
		dateStyleMixed: (p: { text: string; field: string | undefined }) =>
			`“${p.text}” uses both emoji dates and [key:: value] fields, so the timeline cannot tell which style to add. Nothing was changed. Add the ${p.field} date in the note.`,
		lineChanged: (p: { text: string; note: string }) =>
			`“${p.text}” changed in ${p.note} since the timeline read it. Nothing was written. The timeline updates once Obsidian has re-read the note; then try again.`,
		notReread: (p: { note: string; text: string }) =>
			`Obsidian hasn't re-read ${p.note} yet, so the timeline can't change “${p.text}” again. Try again in a moment.`,
		tasksTooOld: "Completing from the timeline needs Tasks 7.2.0 or newer, so the note was opened at the task.",
		tasksError: (p: { text: string; message: string | undefined }) =>
			`Tasks could not change “${p.text}”: ${p.message}. Nothing was written.`,
		badOutput: (p: { text: string }) =>
			`Tasks returned something the timeline cannot write safely for “${p.text}”. Nothing was written.`,
		undoChanged: (p: { text: string; note: string }) =>
			`Could not undo: “${p.text}” in ${p.note} changed or moved after the timeline wrote it. Nothing was written.`,
		writeFailure: (p: { note: string; reason: string }) => `Could not write to ${p.note}: ${p.reason}`,
		mayNotSavedTimeout: (p: { note: string }) =>
			`${p.note} may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.`,
		mayNotSavedEditor: (p: { note: string }) =>
			`${p.note} may not have been saved: Obsidian could not save it, and the line changed in its editor afterwards. The change is still in the open note and is saved with it. Check the note before trying again.`,
		slow: (p: { note: string }) =>
			`Saved in ${p.note}. The timeline will show the change once Obsidian has re-read the note.`,
		tasksDialogTooOld: "Tasks 7.21 or later edits here",
		tasksDialogError: (p: { reason: string }) => `Could not reach the Tasks plugin: ${p.reason}`,
		tasksDialogFailure: (p: { reason: string }) => `Tasks' edit dialog failed: ${p.reason}`,
		tasksDialogDelete:
			"Nothing was written. If you completed this task in the dialog: Tasks returns nothing for a task set to delete itself, so use the checkbox to complete it.",
		completed: (p: { task: string; note: string }) => `Completed “${p.task}” in ${p.note}.`,
		recurringReplaced: (p: { task: string; note: string }) =>
			`Completed “${p.task}” in ${p.note}; it was replaced by the next occurrence.`,
		recurringAdded: (p: { task: string; note: string }) =>
			`Completed “${p.task}” in ${p.note}; the next occurrence was added.`,
		deleted: (p: { task: string; note: string }) => `Completed “${p.task}” and removed it from ${p.note}.`,
		uncompleted: (p: { task: string; note: string }) => `Marked “${p.task}” not done in ${p.note}.`,
		dateRemoved: (p: { field: string; task: string }) => `Removed the ${p.field} date from “${p.task}”.`,
		dateSet: (p: { field: string; task: string; day: string }) =>
			`Set the ${p.field} date of “${p.task}” to ${p.day}.`,
		cancelled: (p: { task: string; note: string }) => `Cancelled “${p.task}” in ${p.note}.`,
		replaced: (p: { task: string; note: string }) => `Saved your edit to “${p.task}” in ${p.note}.`,
		undoDone: (p: { task: string }) => `Undid the change to “${p.task}”.`,
		undoAlready: (p: { task: string; note: string }) => `“${p.task}” in ${p.note} is already back to how it was.`,
		undoExpired: (p: { task: string }) =>
			`Could not undo: the change to “${p.task}” was too long ago. Nothing was written.`,
		overwritten: (p: { task: string; note: string }) =>
			`“${p.task}” in ${p.note} is back to how it was before the timeline changed it (another save, a sync, or a change made in the note). Redo?`,
		overwrittenMany: (p: { count: number; note: string }) =>
			`${p.count} timeline changes in ${p.note} are back to how they were before (another save, a sync, or a change made in the note). Redo?`,
		dialogChangesNotUndone: " Changes the Tasks dialog made to other tasks are not undone.",
		copyFailure: "Couldn't copy. Select the text and copy it yourself.",
		editNotSaved: "Edit not saved",
		editChangedBack: "Edit changed back",
		copy: "Copy",
		openNote: "Open note",
		redo: "Redo",
		undo: "Undo",
		openFailure: (p: { path: string; reason: string }) => "Could not open " + p.path + ": " + p.reason,
		fileMissing: (p: { path: string }) => "No such file: " + p.path,
		reloadFailure: (p: { reason: unknown }) => "Error when generating tasks from files: " + p.reason,
		readFailures: (p: { count: number }) =>
			`Tasks Calendar Wrapper: ${p.count} file(s) could not be read, their tasks are missing. See the developer console.`,
		settingsUnreadable:
			"Tasks Calendar Wrapper: data.json changed outside Obsidian but could not be read, so the settings stay as they were; the next change of a setting saves them. See the developer console.",
		openViewFailure: "Failed to open the timeline view. See the developer console for details.",
		fileSystemTimeout: "File system operation timed out.",
		pluginUnloaded: "The plugin unloaded.",
		writeAbandoned: "The write was abandoned.",
		queuedTargetChanged: "A queued task target changed notes.",
	},
	commands: {
		openTimeline: "Open Tasks Timeline View",
		showWhatsNew: "Show what's new",
	},
	modals: {
		createNote: "Create note",
		createNoteMessage: (p: { path: string }) => "No such file: " + p.path + ". Would you like to create it?",
		create: "Create",
		removeRecurrence: "Remove recurrence?",
		removeRecurrenceMessage: (p: { expected: string }) =>
			`The edited task no longer repeats. If you cleared Recurs, save it. If you did not, Tasks could not read the rule in “${p.expected}” and dropped it.`,
		saveWithoutRecurrence: "Save without recurrence",
		cancel: "Cancel",
		whatsNewTitle: "What's new in Tasks Calendar Wrapper",
		version: (p: { version: string }) => `Version ${p.version}`,
		support: "If you find this plugin useful, a star on GitHub or your support for its development helps a lot.",
		starOnGitHub: "⭐ Star on GitHub",
		thanks: "Thanks!",
		pickDate: (p: { field: string }) => `Pick ${p.field} date`,
		clear: "Clear",
		save: "Save",
	},
	menus: {
		dueToday: "Due today",
		dueTomorrow: "Due tomorrow",
		pickDate: (p: { field: string }) => `Pick ${p.field} date…`,
		removeDate: (p: { field: string }) => `Remove ${p.field} date`,
	},
	settings: {
		groups: {
			sources: "Sources",
			display: "Display",
			newTasks: "New tasks",
			advanced: "Advanced",
		},
		openViewOnStartup: {
			name: "Open view on startup",
			desc: "Open the view on startup or not.",
		},
		showWhatsNewOnUpdate: {
			name: "Show what's new after updates",
			desc: 'Show the release notes once after the plugin is updated. They can always be opened with the "Show what\'s new" command.',
		},
		filterEmpty: {
			name: "Filter empty",
			desc: "Filter empty items out or not. If not, the raw text will be displayed.",
		},
		excludePaths: {
			name: "Exclude paths",
			desc: "Exclude tasks match specific paths (folders, files).",
			placeholder: "comma separated file paths, e.g.: path1,path2/path3,path4.md",
		},
		includePaths: {
			name: "Include paths",
			desc: "Include tasks match specific paths (folders, files).",
			placeholder: "comma separated file paths, e.g.: path1,path2/path3,path4.md",
		},
		useIncludeTags: {
			name: "Use include tags",
			desc: "Use tags filters to filter tasks without specific tags out or not.",
		},
		taskIncludeTags: {
			name: "Task include filters",
			desc: "Filter tasks with specific tags, only tasks with one or more of these tags are displayed.",
		},
		fileIncludeTags: {
			name: "File include tags",
			desc: "Filter tasks in specific files which contains one or more of these tags to be displayed.",
		},
		useExcludeTags: {
			name: "Use exclude tags",
			desc: "Use tags filters to filters tasks with specific tags out or not.",
		},
		taskExcludeTags: {
			name: "Task exclude filters",
			desc: "Filter tasks without specific tags, only tasks **without any** if these tags are displayed.",
		},
		fileExcludeTags: {
			name: "File exclude tags",
			desc: "Filter tasks in specific files which **does not** contains any of these tags to be displayed.",
		},
		excludeProperties: {
			name: "Exclude properties",
			desc: "Exclude tasks of files whose frontmatter property has one of these values. One property per line, values separated by commas.",
			placeholder: "status: archived, done",
		},
		dailyNoteFolder: {
			name: "Daily note folder",
			desc: "Specify the folder where the daily notes are saved.",
		},
		dailyNoteFormat: {
			name: "Daily note format",
			desc: "Daily note file format. The format sould be of moment format, see ",
			descAfterLink: " for more details.",
		},
		sectionForNewTasks: {
			name: "Section for new tasks",
			desc: "Specify under which section the new task items should be appended.",
		},
		hideTags: {
			name: "Hide tags",
			desc: "Specify which tags are not necessary to display with a tag badge, note that all tag texts are remove from the displayed item text by default. Also note that the tags are just hided, not removed from the item.",
		},
		forward: {
			name: "Forward tasks from past",
			desc: "Forward overdue tasks from the past and all unplanned tasks to display them on the today panel or not.",
		},
		forwardPastStartAndScheduled: {
			name: "Forward started and scheduled tasks",
			desc: "Also show tasks that have started or were scheduled before today on the today panel. They are shown there instead of on their own date.",
		},
		forwardUndatedDone: {
			name: "Forward undated done tasks",
			desc: "Show done tasks that have no date at all on the today panel. Turn it off to keep them out of the timeline.",
		},
		sort: {
			name: "Sort by",
			desc: "Specify how you would like the taks item to be sorted inside a date.",
			options: {
				statusAsc: "status (ascending)",
				statusDesc: "status (descending)",
				textAsc: "text (ascending)",
				textDesc: "text (descending)",
				startAsc: "start time (ascending)",
				startDesc: "start time (descending)",
				dueAsc: "due time (ascending)",
				dueDesc: "due time (descending)",
				priorityDesc: "priority (highest first)",
				priorityAsc: "priority (lowest first)",
				tagsAsc: "tags (ascending)",
				tagsDesc: "tags (descending)",
			},
		},
		dateFormat: {
			name: "Date format",
			desc: "Specify format you would like to use for dates. Note that the format should be of moment format. See ",
			descAfterLink: " for more details.",
			placeholder: "e.g.: YYYY-MM-DD",
		},
		inbox: {
			name: "Inbox",
			desc: "Set a file as an 'Inbox' for task items from the quick entry panel. This file will be displayed on top of the file list.",
		},
		taskFiles: {
			name: "Tasks files",
			desc: "Task Files you would like to specify explicitly for quick entry panel. make sure paths are separated by , .",
			placeholder: "comma separated file paths, e.g.: path1,path2",
		},
		tagColorPalette: {
			addTooltip: "Add a palette",
			name: "Tag and color",
			desc: "Enter tag text (# included) in the text input and select color in the color selector.",
		},
		useCounters: {
			name: "Enable counters and filters panel",
			desc: "Use counters and filters on the quick entry panel or not.",
		},
		counterBehavior: {
			name: "Behavior of counters and filters panel",
			desc: "Set the default behavior of the counter and filter buttons. Available choices are: *Filter* to filter other items out, or *Focus* to make selected items more clear.",
			options: {
				filter: "Filter",
				focus: "Focus",
			},
		},
		useQuickEntry: {
			name: "Enable quick entry panel",
			desc: "Use quick entry panel or not.",
		},
		entryPosition: {
			name: "Quick entry panel position",
			desc: "Where you like the entry panel to be, * Top means on top of the view, * Bottom means on bottom of the view, * Today means in today's view.",
			options: {
				today: "today",
				top: "top",
				bottom: "bottom",
			},
		},
		useYearHeader: {
			name: "Enable year header",
			desc: "Display the year on top of tasks of that year or not.",
		},
		newestFirst: {
			name: "Newest first",
			desc: "Show the latest dates on top instead of the earliest.",
		},
		useRelative: {
			name: "Use relative date",
			desc: "Use relative date to describe the task dates or not.",
		},
		useRecurrence: {
			name: "Use recurrence",
			desc: "Display the recurrence information of tasks or not.",
		},
		usePriority: {
			name: "Use priority",
			desc: "Display the priority information of tasks or not.",
		},
		useTags: {
			name: "Use tags",
			desc: "Display the tags of tasks or not. Color palette can be defined for tags!",
		},
		useFileBadge: {
			name: "Use filename",
			desc: "Display which file the task is from or not.",
		},
		useSection: {
			name: "Use section",
			desc: "Display which section the task is from or not.",
		},
		useModifyBadge: {
			name: "Use modify badge",
			desc: "Display the badge that opens a task in the Tasks plugin dialog or not.",
		},
		openNoteInsteadOfInPlace: {
			name: "Open the note instead of changing tasks in place",
			desc: "The checkbox and ✏️ open the note at the task instead of changing it from the timeline. While this is on, ✏️ does not open Tasks' edit dialog. While it is off, the timeline tells you when another save changes its edit back within a few seconds, but it cannot notice every such change, for example a note replaced by an old synced copy.",
		},
		newDateStyle: {
			name: "Style for new dates",
			desc: "Used when the timeline adds a date to a task line that has no task fields yet (no dates, priority, recurrence or other Tasks fields). Lines that already use one style keep it. If the Tasks plugin is set to the Dataview format, choose Dataview fields.",
			options: {
				emoji: "Emoji (📅 2026-10-25)",
				dataview: "Dataview fields ([due:: 2026-10-25])",
			},
		},
		hideStatusTasks: {
			name: "Hide tasks of specific status",
			desc: "Provide comma split status markers, e.g.,: x, - Use [ ] if you would like to hide all tasks with marker [ ] or status todo.",
			placeholder: "Status markers split by comma. e.g.,: x, -.",
		},
		hideSubTasks: {
			name: "Hide subtasks",
			desc: "Hide task items that are nested under another list item.",
		},
		defaultTodayFocus: {
			name: "Today focus on load",
			desc: "Activate today focus on load or not.",
		},
		defaultFilters: {
			name: "Activate filter on load",
			desc: "Activate a filter or not.",
			options: {
				none: "No filters",
				todo: "todo",
				overdue: "overdue",
				unplanned: "unplanned",
			},
		},
		useBuiltinStyle: {
			name: "Use builtin style",
			desc: "Use builtin styles (the marker icons for task status) or not. If disabled, styles defined by the theme you are using will be used.",
		},
		convert24HourTimePrefix: {
			name: "Convert time prefix",
			desc: "Convert 24 hour time prefix to 12 hour time with am/pm. For example, 15:30 at the beginning of a task will become 3:30 pm. This is applied after sorting, enabling a chronological ordering.",
		},
		tab: {
			addTagTooltip: "Add a tag",
			resetToDefault: "Reset to default",
			wrongType: (p: { actual: string; expected: string }) =>
				`Saved value is ${p.actual}, expected ${p.expected}. It is used as is.`,
			expectedType: {
				boolean: "true or false",
				string: "text",
				stringList: "a list of texts",
				stringMap: "a map of texts",
				stringListMap: "a map of lists of texts",
			},
			appliesWhen: {
				viewOpen: "Applies when a timeline opens.",
				pluginLoad: "Applies when Obsidian starts.",
			},
			momentPreview: (p: { sample: string }) => `Today in this format: ${p.sample}`,
			propertyRuleSkipped: (p: { line: number }) =>
				`Line ${p.line} is skipped: it needs a property, a colon and a value.`,
			deleteTooltip: "Delete",
			editTooltip: "Edit",
			pathFilterWarning:
				"NOTE that no prefix or trailing '/' needed, unless you want to filter the entire vault out.",
			momentDocsLink: "docs of moment.js",
			saveFailed: "Failed to save the timeline settings. See the developer console for details.",
			saveTooltip: "Save",
			emptyColor: "The color seems to be empty, maybe you forget to click the color picker.",
			cancelTooltip: "Cancel",
			tagModalName: "Tag",
			tagModalDesc: "Enter tag text (# included) in the text input and select color in the color selector.",
			tagExists: (p: { tag: string }) => `Tag ${p.tag} already exists.`,
			invalidTag: (p: { tag: string }) => `${p.tag} seems not a valid tag.`,
		},
	},
} as const);

type WidenCopy<T> = T extends string
	? string
	: T extends readonly string[]
		? readonly string[]
		: T extends (...args: never[]) => string
			? T
			: { readonly [K in keyof T]: WidenCopy<T[K]> };

/** The same keys and parameter types, with string leaves widened for translations. */
export type Copy = WidenCopy<typeof copy>;
