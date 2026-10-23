import { App, Notice, TFile } from "obsidian";
import { hasTaskItems, noteVisible, parseNote } from "@tasks-calendar-wrapper/core";
import type { MomentFactory, NoteFilterSettings, ParseWarning, Task } from "@tasks-calendar-wrapper/core";

/** A note that could not be read or parsed. Only `reason` is logged; `path` is for the index's callers and tests. */
export interface NoteReadFailure {
	readonly path: string;
	readonly reason: unknown;
}

/** The console line of a warning. */
export const warningLine = (warning: ParseWarning): string =>
	`Tasks Calendar Wrapper: ${warning.path}, line ${warning.line + 1}: ${warning.message}`;

/** Each failure's reason on the console; then, with `notice` and some failures, one Notice with their count. */
export function tellFailures(failures: readonly NoteReadFailure[], notice: boolean): void {
	failures.forEach((failure) => console.error("Tasks Calendar Wrapper: reading a file failed", failure.reason));
	if (!notice || failures.length === 0) return;
	new Notice(
		`Tasks Calendar Wrapper: ${failures.length} file(s) could not be read, their tasks are missing. See the developer console.`,
		5000,
	);
}

/**
 * Tells the user what reading the notes ran into, as readTasks always has: each warning on the console, in the order
 * given; then, if notes failed, each reason on the console and one Notice with their count. A timeline tells less,
 * see readreporter.ts.
 */
export function reportNoteReads(warnings: readonly ParseWarning[], failures: readonly NoteReadFailure[]): void {
	for (const warning of warnings) console.warn(warningLine(warning));
	tellFailures(failures, true);
}

/**
 * Reads and parses the notes with packages/core: notes the note filters leave out, and notes whose metadata has no task
 * item, are not read, the tasks come in path order, and each note is read and parsed in its own callback, so a note
 * that cannot be read or parsed drops only its own tasks, with a Notice. A note Obsidian has given no metadata yet is
 * read. The task index is tested against it, see tests/taskindex-differential.test.ts.
 */
export async function readTasks(app: App, settings: NoteFilterSettings, moment: MomentFactory): Promise<Task[]> {
	const visible = app.vault.getMarkdownFiles().filter((file) => {
		const cache = app.metadataCache.getFileCache(file);
		return (
			noteVisible(
				{ path: file.path, tags: cache?.tags?.map((t) => t.tag) ?? [], frontmatter: cache?.frontmatter },
				settings,
			) &&
			(cache === null || hasTaskItems(cache))
		);
	});
	const inPathOrder = [...visible].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const paths = inPathOrder.map((file) => file.path);
	const reads = await Promise.allSettled(
		inPathOrder.map(async (file: TFile) => {
			const content = await app.vault.cachedRead(file);
			return parseNote({ path: file.path, content, metadata: app.metadataCache.getFileCache(file) }, moment);
		}),
	);

	const tasks: Task[] = [];
	const failures: NoteReadFailure[] = [];
	reads.forEach((read, i) => {
		if (read.status === "fulfilled") {
			tasks.push(...read.value.tasks);
			// Each note's warnings right after its tasks, as before: when a later note has too many tasks to spread, the
			// warnings of the notes before it are told all the same.
			reportNoteReads(read.value.warnings, []);
		} else failures.push({ path: paths[i], reason: read.reason });
	});
	reportNoteReads([], failures);
	return tasks;
}
