/**
 * Helpers for the quick entry panel, which appends new tasks to a note.
 */
import { dayKey } from "@tasks-calendar-wrapper/core";
import type { Moment, unitOfTime } from "moment";
import { doneDateSymbol, dueDateSymbol, recurrenceSymbol, scheduledDateSymbol, startDateSymbol } from "./tasks";

/**
 * Replaces the words typed into the quick entry box with task symbols and dates, e.g. "due " with
 * "📅 " and "tomorrow " with tomorrow's date. A word is replaced once a space follows it. Every rule
 * starts again from the text as typed, so when several words match at once only the last rule's
 * replacement is kept. Text with nothing to replace is returned as is.
 *
 * Dates are written with dayKey(), in ASCII digits. format() writes the locale's own digits in Arabic,
 * Persian, Hindi and other languages, which neither this plugin nor the Tasks plugin reads as a date.
 */
export function expandShortcuts(newTask: string, today: Moment): string {
    let expanded = newTask;
    // Icons
    if (newTask.includes("due ")) { expanded = newTask.replace("due", dueDateSymbol) }
    if (newTask.includes("start ")) { expanded = newTask.replace("start", startDateSymbol) }
    if (newTask.includes("scheduled ")) { expanded = newTask.replace("scheduled", scheduledDateSymbol) }
    if (newTask.includes("done ")) { expanded = newTask.replace("done", doneDateSymbol) }
    if (newTask.includes("repeat ")) { expanded = newTask.replace("repeat", recurrenceSymbol) }
    if (newTask.includes("recurring ")) { expanded = newTask.replace("recurring", recurrenceSymbol) }

    // Dates
    if (newTask.includes("today ")) { expanded = newTask.replace("today", dayKey(today)) }
    if (newTask.includes("tomorrow ")) { expanded = newTask.replace("tomorrow", dayKey(today.clone().add(1, "days"))) }
    if (newTask.includes("yesterday ")) { expanded = newTask.replace("yesterday", dayKey(today.clone().subtract(1, "days"))) }

    // In X days/weeks/month/years
    const futureDate = newTask.match(/(in)\W(\d{1,3})\W(days|day|weeks|week|month|years|year) /);
    if (futureDate && futureDate.length > 3) {
        const value: number = parseInt(futureDate[2]);
        const unit = futureDate[3] as unitOfTime.Base;
        const date = dayKey(today.clone().add(value, unit)) + " "
        expanded = newTask.replace(futureDate[0], date);
    }

    // Next Weekday
    const weekday = newTask.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday) /);
    if (weekday) {
        const weekdays = ["", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        const dayINeed = weekdays.indexOf(weekday[1]);
        if (today.isoWeekday() < dayINeed) {
            expanded = newTask.replace(weekday[1], dayKey(today.clone().isoWeekday(dayINeed)));
        } else {
            expanded = newTask.replace(weekday[1], dayKey(today.clone().add(1, 'weeks').isoWeekday(dayINeed)));
        }
    }
    return expanded;
}

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
    const headingIndex = heading === "" ? -1 : lines.findIndex(line => line.trim() === heading);

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
