/**
 * Copy style guide: use sentence case for names, buttons and titles; keep product names as written:
 * Tasks, Obsidian, Dataview, Tasks Timeline. Names have no full stop; descriptions are full sentences with one.
 * Use the fixed nouns timeline (view), note (file), task, quick entry, and Focus on today.
 * An aria-label describes the action ("Complete task", not "✓"). Use emoji only for task syntax (📅 ⏫ 🔁),
 * never as a button's only label.
 * Enforced from step 24 (timeline) and step 14 (settings); step 11 only moves text byte for byte.
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
