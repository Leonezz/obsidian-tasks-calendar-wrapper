import type { TAbstractFile, Vault } from "obsidian";
import { insertTaskUnderSection, parentFolder } from "@tasks-calendar-wrapper/core";
import type { TaskWriter } from "./taskwriter";

/** The part of the vault that adding a task uses. */
export type TaskNoteVault = Pick<
	Vault,
	"getFileByPath" | "getFolderByPath" | "getMarkdownFiles" | "getAllFolders" | "create" | "createFolder"
>;

/**
 * Adds a task line under the section of a note, through the writer for existing notes. A missing note, and
 * its folder, is only created once confirmCreate resolves to true. Resolves to true only when added; a declined
 * creation or a refused or failed write returns false. Note-creation failures reject for the caller to report.
 */
export async function appendTaskToNote(
	vault: TaskNoteVault,
	writer: Pick<TaskWriter, "insert">,
	path: string,
	section: string,
	taskLine: string,
	confirmCreate: (path: string) => Promise<boolean>,
): Promise<boolean> {
	const file = vault.getFileByPath(path) ?? findIgnoringCase(vault.getMarkdownFiles(), path);
	if (file) {
		const result = await writer.insert(file.path, (content) => insertTaskUnderSection(content, section, taskLine));
		return result.kind === "written";
	}
	if (!(await confirmCreate(path))) return false;
	await vault.create(await pathInExistingFolder(vault, path), insertTaskUnderSection("", section, taskLine));
	return true;
}

/** Where to create a new note: in its folder as the vault spells it, after creating the folder if there is none. */
async function pathInExistingFolder(vault: TaskNoteVault, path: string): Promise<string> {
	const folderPath = parentFolder(path);
	if (folderPath === "") return path;
	const folder = vault.getFolderByPath(folderPath) ?? findIgnoringCase(vault.getAllFolders(), folderPath);
	if (folder) return folder.path + path.substring(folderPath.length);
	await vault.createFolder(folderPath);
	return path;
}

/**
 * The vault looks paths up by exact letter case, but on macOS and Windows a path in another case names the same
 * file on disk, so creating it fails with "already exists". The old adapter.exists check matched those too.
 */
function findIgnoringCase<T extends TAbstractFile>(files: T[], path: string): T | undefined {
	const wanted = path.toLowerCase();
	return files.find((file) => file.path.toLowerCase() === wanted);
}
