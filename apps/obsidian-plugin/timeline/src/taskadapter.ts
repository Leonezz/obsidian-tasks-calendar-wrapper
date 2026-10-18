import { App, Notice, TFile } from "obsidian";
import { noteVisible, parseNote } from "@tasks-calendar-wrapper/core";
import type { MomentFactory, NoteFilterSettings, Task } from "@tasks-calendar-wrapper/core";

/**
 * Reads and parses the notes with packages/core: notes the note filters leave out are not read, the tasks come in
 * path order, and each note is read and parsed in its own callback, so a note that cannot be read or parsed drops only
 * its own tasks, with a Notice.
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
	const reads = await Promise.allSettled(
		inPathOrder.map(async (file: TFile) => {
			const content = await app.vault.cachedRead(file);
			return parseNote({ path: file.path, content, metadata: app.metadataCache.getFileCache(file) }, moment);
		}),
	);

	const tasks: Task[] = [];
	for (const read of reads) {
		if (read.status !== "fulfilled") continue;
		tasks.push(...read.value.tasks);
		for (const warning of read.value.warnings) {
			console.warn(`Tasks Calendar Wrapper: ${warning.path}, line ${warning.line + 1}: ${warning.message}`);
		}
	}
	const failed = reads.filter((read): read is PromiseRejectedResult => read.status === "rejected");
	if (failed.length > 0) {
		failed.forEach((read) => console.error("Tasks Calendar Wrapper: reading a file failed", read.reason));
		new Notice(
			`Tasks Calendar Wrapper: ${failed.length} file(s) could not be read, their tasks are missing. See the developer console.`,
			5000,
		);
	}
	return tasks;
}
