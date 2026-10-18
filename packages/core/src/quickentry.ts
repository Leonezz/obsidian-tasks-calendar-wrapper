/**
 * Helpers for the quick entry panel, which appends new tasks to a note.
 */
import { dayKey, dayKeyAfter, dayKeyOfWeekday, isoWeekday, type CountUnit, type DateValue } from "./dates";
import { doneDateSymbol, dueDateSymbol, recurrenceSymbol, scheduledDateSymbol, startDateSymbol } from "./syntax";

/**
 * Turns a user supplied note path into the path of a markdown file in the vault.
 * Without the extension a new file was created that the timeline never reads, see issue #48.
 */
export function normalizeNotePath(path: string): string {
	const trimmed = path.trim().replace(/^\/+/, "");
	return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** The folder a note path is in, or "" for a note at the top of the vault. */
export function parentFolder(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.substring(0, slash);
}

/**
 * Inserts a task line right below the section heading. When the heading is missing it is added
 * at the end of the note, rather than the task landing above the frontmatter. The note keeps
 * the line endings it already uses.
 */
export function insertTaskUnderSection(content: string, section: string, taskLine: string): string {
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const endsWithEol = content.length === 0 || content.endsWith(eol);
	const lines = content.length === 0 ? [] : content.split(eol);
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

	const heading = section.trim();
	const headingIndex = heading === "" ? -1 : lines.findIndex((line) => line.trim() === heading);

	let result: string[];
	if (headingIndex >= 0) {
		result = [...lines.slice(0, headingIndex + 1), taskLine, ...lines.slice(headingIndex + 1)];
	} else if (heading === "") {
		result = [...lines, taskLine];
	} else {
		const separator = lines.length > 0 && lines[lines.length - 1].trim() !== "" ? [""] : [];
		result = [...lines, ...separator, heading, taskLine];
	}
	return result.join(eol) + (endsWithEol ? eol : "");
}

/** The settings that decide which notes quick entry offers. */
export interface QuickEntryTargetOptions {
	readonly taskFiles: readonly string[];
	readonly inbox: string;
	readonly dailyNoteFormat: string;
	readonly dailyNoteFolder: string;
}

/** The notes quick entry can add a task to: the task files, the inbox, and today's daily note. */
export function quickEntryTargets(options: QuickEntryTargetOptions, now: DateValue): string[] {
	const targets = new Set(options.taskFiles);
	if (options.inbox && options.inbox !== "") targets.add(options.inbox);
	const dailyNoteFileName = now.format(options.dailyNoteFormat) + ".md";
	const dailyNoteFolder =
		options.dailyNoteFolder === ""
			? ""
			: options.dailyNoteFolder.endsWith("/")
				? options.dailyNoteFolder
				: options.dailyNoteFolder + "/";
	if (options.dailyNoteFormat && options.dailyNoteFormat !== "") targets.add(dailyNoteFolder + dailyNoteFileName);
	return [...targets];
}

/**
 * Replaces the words typed into the quick entry box with task symbols and dates, e.g. "due " with "📅 " and
 * "tomorrow " with tomorrow's date. A word is replaced once a space follows it. Every rule starts again from the text
 * as typed, so when several words match at once only the last rule's replacement is kept. Text with nothing to replace
 * is returned as is. Moved from the plugin's utils/quickentry.ts with its rules as they were.
 *
 * Dates are written with dayKey(), in ASCII digits. format() writes the locale's own digits in Arabic, Persian, Hindi
 * and other languages, which neither this plugin nor the Tasks plugin reads as a date.
 */
export function expandShortcuts(newTask: string, today: DateValue): string {
	let expanded = newTask;
	// Symbols
	if (newTask.includes("due ")) expanded = newTask.replace("due", dueDateSymbol);
	if (newTask.includes("start ")) expanded = newTask.replace("start", startDateSymbol);
	if (newTask.includes("scheduled ")) expanded = newTask.replace("scheduled", scheduledDateSymbol);
	if (newTask.includes("done ")) expanded = newTask.replace("done", doneDateSymbol);
	if (newTask.includes("repeat ")) expanded = newTask.replace("repeat", recurrenceSymbol);
	if (newTask.includes("recurring ")) expanded = newTask.replace("recurring", recurrenceSymbol);

	// Dates
	if (newTask.includes("today ")) expanded = newTask.replace("today", dayKey(today));
	if (newTask.includes("tomorrow ")) expanded = newTask.replace("tomorrow", dayKeyAfter(today, 1, "days"));
	if (newTask.includes("yesterday ")) expanded = newTask.replace("yesterday", dayKeyAfter(today, -1, "days"));

	// In 3 days, 2 weeks, 1 month or 1 year
	const futureDate = newTask.match(/(in)\W(\d{1,3})\W(days|day|weeks|week|month|years|year) /);
	if (futureDate) {
		const date = dayKeyAfter(today, parseInt(futureDate[2]), futureDate[3] as CountUnit) + " ";
		expanded = newTask.replace(futureDate[0], date);
	}

	// The next weekday of that name: this week's, or next week's when it is today or has passed
	const weekday = newTask.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday) /);
	if (weekday) {
		const weekdays = ["", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
		const wanted = weekdays.indexOf(weekday[1]);
		const weeksLater = isoWeekday(today) < wanted ? 0 : 1;
		expanded = newTask.replace(weekday[1], dayKeyOfWeekday(today, wanted, weeksLater));
	}
	return expanded;
}
