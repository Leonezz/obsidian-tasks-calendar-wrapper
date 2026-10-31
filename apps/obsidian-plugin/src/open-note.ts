import { App, Keymap, MarkdownView, Notice, type UserEvent, type WorkspaceLeaf } from "obsidian";

/** Opens a note once at its zero-based line, leaving the view mode to Obsidian. */
export async function openNoteAt(
	app: App,
	path: string,
	line: number,
	evt?: UserEvent | null,
): Promise<WorkspaceLeaf | null> {
	const file = app.vault.getFileByPath(path);
	if (!file) {
		new Notice("No such file: " + path, 5000);
		return null;
	}
	const leaf = app.workspace.getLeaf(Keymap.isModEvent(evt));
	await leaf.openFile(file, { active: true, eState: { line } });
	if (leaf.view instanceof MarkdownView) leaf.view.editor.setCursor({ line, ch: 0 });
	return leaf;
}
