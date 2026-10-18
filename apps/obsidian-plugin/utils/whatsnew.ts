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
