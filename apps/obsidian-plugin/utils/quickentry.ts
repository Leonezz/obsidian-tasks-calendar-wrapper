/**
 * Helpers for the quick entry panel, which appends new tasks to a note.
 */
import { dayKey } from "@tasks-calendar-wrapper/core";
import type { Moment, unitOfTime } from "moment";
import { doneDateSymbol, dueDateSymbol, recurrenceSymbol, scheduledDateSymbol, startDateSymbol } from "./tasks";

// The other quick entry helpers moved to packages/core; re-exported for the modules that import them from here.
export {
	insertTaskUnderSection,
	normalizeNotePath,
	parentFolder,
	quickEntryTargets,
} from "@tasks-calendar-wrapper/core";

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
	if (newTask.includes("due ")) {
		expanded = newTask.replace("due", dueDateSymbol);
	}
	if (newTask.includes("start ")) {
		expanded = newTask.replace("start", startDateSymbol);
	}
	if (newTask.includes("scheduled ")) {
		expanded = newTask.replace("scheduled", scheduledDateSymbol);
	}
	if (newTask.includes("done ")) {
		expanded = newTask.replace("done", doneDateSymbol);
	}
	if (newTask.includes("repeat ")) {
		expanded = newTask.replace("repeat", recurrenceSymbol);
	}
	if (newTask.includes("recurring ")) {
		expanded = newTask.replace("recurring", recurrenceSymbol);
	}

	// Dates
	if (newTask.includes("today ")) {
		expanded = newTask.replace("today", dayKey(today));
	}
	if (newTask.includes("tomorrow ")) {
		expanded = newTask.replace("tomorrow", dayKey(today.clone().add(1, "days")));
	}
	if (newTask.includes("yesterday ")) {
		expanded = newTask.replace("yesterday", dayKey(today.clone().subtract(1, "days")));
	}

	// In X days/weeks/month/years
	const futureDate = newTask.match(/(in)\W(\d{1,3})\W(days|day|weeks|week|month|years|year) /);
	if (futureDate && futureDate.length > 3) {
		const value: number = parseInt(futureDate[2]);
		const unit = futureDate[3] as unitOfTime.Base;
		const date = dayKey(today.clone().add(value, unit)) + " ";
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
			expanded = newTask.replace(weekday[1], dayKey(today.clone().add(1, "weeks").isoWeekday(dayINeed)));
		}
	}
	return expanded;
}
