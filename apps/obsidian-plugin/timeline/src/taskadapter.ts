import { App, Notice, TFile } from "obsidian";
import { noteVisible, parseNote } from "@tasks-calendar-wrapper/core";
import type { MomentFactory, NoteFilterSettings, ParseWarning, Task } from "@tasks-calendar-wrapper/core";

/** A note that could not be read or parsed. Only `reason` is logged; `path` is for the index's callers and tests. */
export interface NoteReadFailure {
	readonly path: string;
	readonly reason: unknown;
}

/**
 * Tells the user what reading the notes ran into, as readTasks always has: each warning on the console, in the order
 * given; then, if notes failed, each reason on the console and one Notice with their count.
 */
export function reportNoteReads(warnings: readonly ParseWarning[], failures: readonly NoteReadFailure[]): void {
	for (const warning of warnings) {
		console.warn(`Tasks Calendar Wrapper: ${warning.path}, line ${warning.line + 1}: ${warning.message}`);
	}
	if (failures.length === 0) return;
	failures.forEach((failure) => console.error("Tasks Calendar Wrapper: reading a file failed", failure.reason));
	new Notice(
		`Tasks Calendar Wrapper: ${failures.length} file(s) could not be read, their tasks are missing. See the developer console.`,
		5000,
	);
}

/**
 * Reads and parses the notes with packages/core: notes the note filters leave out are not read, the tasks come in
 * path order, and each note is read and parsed in its own callback, so a note that cannot be read or parsed drops only
 * its own tasks, with a Notice. The task index is tested against it, see tests/taskindex-differential.test.ts.
 */
export async function readTasks(app: App, settings: NoteFilterSettings, moment: MomentFactory): Promise<Task[]> {
	const visible = app.vault.getMarkdownFiles().filter((file) => {
		const cache = app.metadataCache.getFileCache(file);
		return noteVisible(
			{ path: file.path, tags: cache?.tags?.map((t) => t.tag) ?? [], frontmatter: cache?.frontmatter },
			settings,
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
	const warnings: ParseWarning[] = [];
	const failures: NoteReadFailure[] = [];
	reads.forEach((read, i) => {
		if (read.status === "fulfilled") {
			tasks.push(...read.value.tasks);
			// One at a time, as they were logged before: a spread could exceed the argument limit where that did not.
			for (const warning of read.value.warnings) warnings.push(warning);
		} else failures.push({ path: paths[i], reason: read.reason });
	});
	reportNoteReads(warnings, failures);
	return tasks;
}
