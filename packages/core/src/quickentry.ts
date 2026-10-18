/**
 * Helpers for the quick entry panel, which appends new tasks to a note.
 */
import type { DateValue } from "./dates";

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
