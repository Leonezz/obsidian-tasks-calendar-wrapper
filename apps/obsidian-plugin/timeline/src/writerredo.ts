import { MarkdownView } from "obsidian";
import type { LineTarget } from "@tasks-calendar-wrapper/core";
import type { TaskEdit, TaskWriterDeps, WriteResult } from "./taskwriter";
import type { WriteRecord } from "./writerholds";
import { normalized } from "./writerchecks";

/** Replays actions through the writer, carrying the actual output into the next edit of that same line. */
export async function redoWrites(
	deps: TaskWriterDeps,
	records: readonly WriteRecord[],
	write: (target: () => LineTarget, edit: TaskEdit) => Promise<WriteResult>,
): Promise<void> {
	const rewritten = new Map<string, string>();
	for (const record of records) {
		if (record.edit.kind === "undo" || record.edit.kind === "replace" || record.edit.kind === "insert") return;
		const path = record.target.path;
		const file = deps.app.vault.getFileByPath(path);
		if (!file) {
			deps.notices.refuse("moved-or-deleted", record.context);
			return;
		}
		const source = deps.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find(
				(view): view is MarkdownView =>
					view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source",
			);
		const current = source ? source.editor.getValue() : await deps.app.vault.cachedRead(file);
		const sourceLine = rewritten.get(record.target.sourceLine) ?? record.target.sourceLine;
		const matches = normalized(current)
			.split("\n")
			.flatMap((line, i) => (line === sourceLine ? [i] : []));
		if (matches.length !== 1) {
			deps.notices.refuse("ambiguous", record.context);
			return;
		}
		const result = await write(() => ({ path, line: matches[0], sourceLine }), record.edit);
		if (result.kind !== "written" && result.kind !== "unchanged") return;
		if (result.kind === "written" && result.undo)
			for (let i = 0; i < record.lines.length; i++) {
				const line = result.undo.span.expected[i];
				if (line !== undefined) rewritten.set(record.lines[i], line);
			}
	}
}
