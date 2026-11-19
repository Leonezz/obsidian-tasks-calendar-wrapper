/**
 * Release notes shown once after the plugin is updated, and the links shown with them.
 * When releasing a version, add its entry at the top of RELEASE_NOTES. A test checks that the
 * version in manifest.json has one, so the release workflow stops if it is missing.
 * A pre-release such as 0.4.0-beta.1 gets its own entry for testers, but users of 0.4.0 only see the
 * 0.4.0 entry, so that entry has to cover everything its betas changed.
 */

import type { ReleaseNote } from "@tasks-calendar-wrapper/core";

export interface SupportLink {
	label: string;
	url: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
	{
		version: "0.4.0-beta.6",
		items: [
			"Settings add section shortcuts, smaller option groups and contextual controls. Navigation scrolls with the page instead of covering the settings below it.",
			"Add files and folders as removable chips, with vault search suggestions or a path you enter yourself. Paste several comma-separated or newline-separated paths at once.",
			"Add tags inline with vault suggestions or paste several at once. Invalid tag drafts stay in the editor, and renaming a tag color cannot overwrite another tag's color.",
			"Use aligned To-do, Done and Cancelled presets when choosing which task statuses to hide, or keep your own checkbox markers.",
			"Open the display preview to see the same task appearance as the timeline, including date formatting, checkbox style, visible details and tag colors. The sample is read-only and creates no note.",
			"Settings show saving and saved feedback, with Retry if a save fails. Saving keeps the focused input and preserves newer drafts while earlier changes are being saved.",
		],
	},
	{
		version: "0.4.0-beta.5",
		items: [
			"Date, tag and priority filters now sit above quick entry, under the status cards. Date ranges can be used independently of Focus on today.",
			"Focus quick entry to see its note, due date and priority options. Moving outside the entry area hides them.",
			"Choose Today, Tomorrow or a custom due date for a new task, or use No date to remove a due date already in its text. New date and priority values follow your Emoji or Dataview setting.",
			"Draft text and options survive filter changes. Adding a task keeps your filters, and edits made while an earlier task is being saved are kept.",
			"Filter by several tags at once: tasks matching any selected tag are shown. Suggestions keep earlier tags and replace only the tag at the cursor.",
			"The priority menu marks selected levels, stays within the pane and can be closed with Escape.",
			"Quick entry options and the priority menu open and close smoothly, following your device's setting to reduce motion.",
		],
	},
	{
		version: "0.4.0-beta.4",
		items: [
			"Settings are grouped into Sources, Display, New tasks and Advanced. Live settings update open timelines after a short typing pause; settings used only when opening a timeline or starting Obsidian say so.",
			"Saved settings with a value of the wrong type show an explanation and a Reset to default button beside the setting. Invalid and duplicate tags are reported inline.",
			"Use Tab to reach timeline controls, Up/Down and Home/End to move between tasks, Enter to open a task's note, and Space to activate its status control. Shift+F10 opens the date menu when in-place editing is enabled. Keys inside inputs and task controls keep that control's usual behavior.",
			"On mobile, built-in styles give task controls, badges and quick entry larger touch targets. Hover effects are limited to devices that support hovering.",
			"Each open timeline keeps its own counter, Focus on today and quick filter. Closing and reopening a timeline during the same plugin session restores its counter and Focus on today; quick filters are cleared.",
			"With Focus on today, dates outside the focused view are no longer kept as hidden page elements. Custom CSS that depends on those elements may need updating.",
			"Large timelines render nearby rows as you scroll instead of keeping every task row on the page.",
			"The quick priority filter now matches all six priority levels. None includes tasks without a priority and Dataview none. Date ranges include both the From and To days.",
		],
	},
	{
		version: "0.4.0-beta.3",
		items: [
			'The timeline now writes to your notes. Clicking a task\'s checkbox completes it, or marks it not done, right in the note without opening it, and every open timeline shows the change at once. Each change shows a notice with "Undo", which puts the note back exactly as it was, and "Open note". To get the old behaviour back, turn on "Open the note instead of changing tasks in place".',
			"Clicking ✏️ opens Tasks' edit dialog over the timeline and saves your edit in the note, with Undo. This needs Tasks 7.21.0 or later; with an older Tasks, ✏️ opens the note at the task and says so.",
			'Change a task\'s due, scheduled or start date from the timeline: right-click a task (on phones and tablets, tap ⋯) for "Due today", "Due tomorrow", a date picker or removing a date, or click a date badge to pick a new date. Only the date in the line changes.',
			'New option "Style for new dates" chooses how a date is written on a task line that has no Tasks fields yet: emoji (📅 2026-10-25) or Dataview fields ([due:: 2026-10-25]). If the Tasks plugin is set to the Dataview format, choose Dataview fields.',
			"When the Tasks plugin is enabled, completing a task from the timeline goes through Tasks, so a recurring task gets its next occurrence. This needs Tasks 7.2.0 or later; with an older Tasks, the checkbox opens the note at the task instead. Without Tasks, the checkbox still works, except on recurring tasks.",
			"When the timeline cannot change a task safely, for example because the line changed meanwhile or the note is not saved as UTF-8, it writes nothing and tells you why. If another save, a sync or an edit in the note changes a task back within a few seconds, the timeline tells you and offers to redo the change.",
			"The timeline is faster in large vaults: after a save, it reads only the notes that changed and redraws only the rows that changed, and in a vault with 40,000 tasks, showing a saved change takes about a quarter less time. The plugin file is about two thirds smaller, and clicks and scrolling stay responsive while a big timeline redraws.",
			"A task added with quick entry shows up in the timeline you typed it into almost at once, instead of after about half a second. If the add fails, the text stays in the input.",
			"Changed settings take effect at once instead of after 5 seconds.",
			'New option "Forward Undated Done Tasks", on by default: turn it off to keep done tasks that have no date at all out of the timeline. Like the other forward options, it only matters while "Forward Tasks From Past" is on.',
			"Clicking a task opens its note once, at the task's line, and keeps the view mode of a note that is already open. Cmd/Ctrl-click opens it in a new tab.",
			"The quick filter now stays applied when notes are saved or settings change, and its inputs show the filter in use.",
			'The "file(s) could not be read" notice is shown when the set of unreadable notes changes instead of on every reload, warnings about a task line in the developer console are logged once, and a note without tasks that cannot be read no longer causes that notice.',
			"A date written after an emoji such as 🗓️ is now read, as Tasks reads it.",
			"When the week start or time zone changes, tasks in daily notes named by week move to the right day at once, instead of staying a day off until Obsidian restarts.",
			"This version needs Obsidian 1.11.4 or later.",
		],
	},
	{
		version: "0.4.0-beta.2",
		items: [
			"The timeline is no longer empty when Obsidian is set to a language that writes numbers in its own digits, such as Arabic or Persian.",
			'In those languages, quick entry words such as "tomorrow" or "in 3 days" now give the new task a date that this plugin and Tasks can read, instead of leaving it unplanned.',
			"The plugin loads again on iPhones and iPads with iOS 15 or 16, on older Android devices and with older Obsidian desktop installers. 0.4.0-beta.1 failed to load there.",
			'New option "Newest First" shows the latest dates at the top of the timeline.',
			'New option "Exclude Properties" hides the tasks of notes whose frontmatter has a value you list, for example a "status" of "archived" or "done".',
			"Settings changed outside the settings tab, for example by Obsidian Sync or a git pull, now take effect right away. Before, the timeline kept the old settings, and the next change in the settings tab overwrote the new ones.",
			"Quick entry asks in an Obsidian dialog, instead of the browser's, before it creates a missing note, and adding a task no longer loses an edit made to the note at the same moment. On Linux, a note path that differs from an existing note only in letter case now adds the task to that note instead of creating a second one.",
			"Clicking a tag opens the search through Obsidian's search link instead of an internal call that could fail. On Obsidian 1.13.0 to 1.13.5, Obsidian asks before opening it.",
		],
	},
	{
		version: "0.4.0-beta.1",
		items: [
			'With the "Focus" counter behaviour, a counter, whether clicked or turned on by "Activate Filter On Load", now highlights its tasks and keeps the rest of the timeline visible, instead of hiding them like "Filter".',
			"This version needs Obsidian 1.11.0 or later.",
			"This beta rebuilds the plugin with newer tools, as groundwork for 0.4. Nothing else should look or work differently; if something does, please open an issue on GitHub.",
		],
	},
	{
		version: "0.3.7",
		items: [
			"The timeline no longer freezes Obsidian while you type. Saving a note without tasks no longer reloads it, and in a vault with 4,000 tasks the pause after saving a note with tasks went from about 2.5 seconds to about 0.3 seconds.",
			"Memory use no longer grows with every save, and closing the timeline frees its memory.",
			"Open tasks are no longer shown with a ticked checkbox, and clicking a task's checkbox toggles that task instead of the first one on the page.",
		],
	},
	{
		version: "0.3.6",
		items: [
			'This dialog: after each update it shows what changed, with links to star the plugin and to support its development. Turn it off in the settings, or reopen it any time with the "Show what\'s new" command.',
			"Daily notes whose format has folders, such as YYYY/MMM/Wo/ddd, are recognised, so their tasks get the note's date.",
		],
	},
	{
		version: "0.3.5",
		items: [
			"Tasks in large notes, or in notes another plugin makes slow to read, no longer go missing.",
			"New options: hide subtasks, hide the modify badge, and show tasks that have started or were scheduled before today on today.",
			"Hiding a tag now also hides its subtags.",
			"A task in a daily note is no longer shown on several days at once.",
			"Dataview style [start:: ] and [completion:: ] dates are read.",
			"Quick entry adds tasks to a note the timeline can read, and never above the frontmatter.",
			"A missing Tasks plugin is reported instead of clicks doing nothing.",
		],
	},
];

/** Shown under the release notes. Keep in sync with fundingUrl in manifest.json; a test checks it. */
export const SUPPORT_LINKS: SupportLink[] = [
	{ label: "Buy Me a Coffee", url: "https://buymeacoffee.com/zhuwenqa" },
	{ label: "Ko-fi", url: "https://ko-fi.com/zhuwenqa" },
	{ label: "Patreon", url: "https://patreon.com/zhuwenq" },
	{ label: "PayPal", url: "https://www.paypal.com/paypalme/zhuwenq" },
];

/** Where the star button leads. */
export const REPOSITORY_URL = "https://github.com/Leonezz/obsidian-tasks-calendar-wrapper";
