import { App, Keymap, MarkdownView, type UserEvent, type WorkspaceLeaf } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { reportNotice } from "../timeline/src/notices";
import { ERROR_NOTICE_MS } from "../timeline/src/writerconstants";

/** Opens a note once at its zero-based line, leaving the view mode to Obsidian. */
export async function openNoteAt(
	app: App,
	path: string,
	line: number,
	evt?: UserEvent | null,
): Promise<WorkspaceLeaf | null> {
	const file = app.vault.getFileByPath(path);
	if (!file) {
		reportNotice(copy.notices.fileMissing({ path }), ERROR_NOTICE_MS);
		return null;
	}
	const leaf = app.workspace.getLeaf(Keymap.isModEvent(evt));
	await leaf.openFile(file, { active: true, eState: { line } });
	if (leaf.view instanceof MarkdownView) leaf.view.editor.setCursor({ line, ch: 0 });
	return leaf;
}
