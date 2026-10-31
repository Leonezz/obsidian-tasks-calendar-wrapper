import { App, ButtonComponent, Modal, Notice } from "obsidian";
import { openNoteAt } from "../../src/open-note";
import { REFUSAL_NOTICE_MS, SLOW_NOTICE_MS, UNDO_DONE_NOTICE_MS, UNDO_NOTICE_MS } from "./writerconstants";

/** Stable refusal keys let repeated warnings for the same note share one notice. */
export type RefuseReason =
	| "line-changed"
	| "ambiguous"
	| "moved-or-deleted"
	| "not-task-line"
	| "impossible-date"
	| "bad-output"
	| "unreadable-date"
	| "recurrence-lost"
	| "recurring-needs-tasks"
	| "tasks-error"
	| "tasks-too-old"
	| "not-utf8"
	| "queue-blocked"
	| "not-reread"
	| "undo-changed"
	| "date-ambiguous"
	| "date-unreadable"
	| "date-style-mixed";

/** Display text and source location, plus the details a refusal needs to explain itself. */
export interface NoticeContext {
	readonly path: string;
	readonly line: number;
	readonly text: string;
	readonly field?: string;
	readonly value?: string;
	readonly token?: string;
	readonly localDigits?: boolean;
	readonly locale?: string;
	readonly a?: string;
	readonly b?: string;
	readonly found?: string;
	readonly message?: string;
	readonly action?: "toggle" | "date" | "replace" | "undo";
}

/** Keeps a task's display text short without splitting a Unicode character. */
export function displayTask(text: string): string {
	const characters = Array.from(text);
	return characters.length > 60 ? characters.slice(0, 60).join("") + "…" : text;
}

/** Names the note without its folders or Markdown extension. */
export function noteName(path: string): string {
	return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** Builds a refusal without touching the DOM, so every caller uses the same wording. */
export function refusalText(reason: RefuseReason, context: NoticeContext): string {
	const text = displayTask(context.text);
	const note = noteName(context.path);
	switch (reason) {
		case "impossible-date":
			return `“${text}” has a ${context.field} date that does not exist (${context.value}). Nothing was written. Fix it in the note.`;
		case "unreadable-date": {
			const message =
				context.action === "toggle" || context.action === undefined
					? `Tasks returned a date the timeline cannot read back (“${context.token}”) for “${text}”. Nothing was written.`
					: `“${text}” would get a date the timeline cannot read back (“${context.token}”). Nothing was written.`;
			return (
				message +
				(context.localDigits ? ` Tasks wrote it in the digits of Obsidian's language (${context.locale}).` : "")
			);
		}
		case "recurrence-lost":
			return `Tasks could not read the recurrence rule in “${text}” and would drop it. Nothing was written. Fix the rule in the note, then try again.`;
		case "recurring-needs-tasks":
			return "Recurring tasks need the Tasks plugin. Nothing was written.";
		case "not-task-line":
			return `The timeline can't change “${text}” safely because it isn't a plain task line. Open the note to change it.`;
		case "ambiguous":
			return `“${text}” appears more than once near here in ${note}, and the timeline can't tell which one you clicked. Nothing was written.`;
		case "moved-or-deleted":
			return `${context.action === "undo" ? "Could not undo: " : ""}${note} was moved or deleted. Nothing was written.`;
		case "not-utf8":
			return `${note} is not saved as UTF-8. Nothing was written: writing would replace its unreadable characters (shown as �) for good. Convert the note to UTF-8 to edit its tasks from the timeline.`;
		case "queue-blocked":
			return `${note} may not have been saved yet. The timeline won't change it until the note changes or two minutes pass.`;
		case "date-ambiguous":
			return `“${text}” has more than one ${context.field} date (${context.a} and ${context.b}). Nothing was changed. Keep one of them in the note, then try again.`;
		case "date-unreadable":
			return `“${text}” has its ${context.field} date written as ${context.found}, which the timeline cannot change. Nothing was changed. Edit it in the note.`;
		case "date-style-mixed":
			return `“${text}” uses both emoji dates and [key:: value] fields, so the timeline cannot tell which style to add. Nothing was changed. Add the ${context.field} date in the note.`;
		case "line-changed":
			return `“${text}” changed in ${note} since the timeline read it. Nothing was written. The timeline updates once Obsidian has re-read the note; then try again.`;
		case "not-reread":
			return `Obsidian hasn't re-read ${note} yet, so the timeline can't change “${text}” again. Try again in a moment.`;
		case "tasks-too-old":
			return "Completing from the timeline needs Tasks 7.2.0 or newer, so the note was opened at the task.";
		case "tasks-error":
			return `Tasks could not change “${text}”: ${context.message}. Nothing was written.`;
		case "bad-output":
			return `Tasks returned something the timeline cannot write safely for “${text}”. Nothing was written.`;
		case "undo-changed":
			return `Could not undo: “${text}” in ${note} changed or moved after the timeline wrote it. Nothing was written.`;
	}
}

/** Shows the original error message without exposing a stack trace in a notice. */
export function writeFailureText(context: NoticeContext, error: unknown): string {
	return `Could not write to ${noteName(context.path)}: ${error instanceof Error ? error.message : String(error)}`;
}

/** Explains why an interrupted write cannot safely be retried yet. */
export function mayNotSavedText(context: NoticeContext, kind: "timeout" | "editor"): string {
	const note = noteName(context.path);
	return kind === "timeout"
		? `${note} may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.`
		: `${note} may not have been saved: Obsidian could not save it, and the line changed in its editor afterwards. The change is still in the open note and is saved with it. Check the note before trying again.`;
}

/** Distinguishes a successful write from Obsidian finishing its metadata read. */
export function slowText(context: NoticeContext): string {
	return `Saved in ${noteName(context.path)}. The timeline will show the change once Obsidian has re-read the note.`;
}

/** Explains why an older Tasks version opened the note instead of its edit dialog. */
export function tasksDialogTooOldText(): string {
	return "Tasks 7.21 or later edits here";
}

/** Reports an unavailable Tasks API without treating it as a disabled plugin. */
export function tasksDialogErrorText(reason: string): string {
	return `Could not reach the Tasks plugin: ${reason}`;
}

/** Reports a dialog that could not open or finish. */
export function tasksDialogFailureText(reason: string): string {
	return `Tasks' edit dialog failed: ${reason}`;
}

/** Explains why an empty dialog result cannot complete a task that deletes itself. */
export function tasksDialogDeleteText(): string {
	return "Nothing was written. If you completed this task in the dialog: Tasks returns nothing for a task set to delete itself, so use the checkbox to complete it.";
}

/** The completed action selects the undo notice; it does not execute an undo. */
export type UndoNoticeChange =
	| {
			readonly kind:
				"complete" | "recurring-replaced" | "recurring-added" | "deleted" | "uncomplete" | "cancel" | "replace";
	  }
	| { readonly kind: "date"; readonly field: string; readonly day: string | null };

/** Describes the write beside the view's eventual Undo button. */
export function undoNoticeText(context: NoticeContext, change: UndoNoticeChange): string {
	const task = displayTask(context.text);
	const note = noteName(context.path);
	switch (change.kind) {
		case "complete":
			return `Completed “${task}” in ${note}.`;
		case "recurring-replaced":
			return `Completed “${task}” in ${note}; it was replaced by the next occurrence.`;
		case "recurring-added":
			return `Completed “${task}” in ${note}; the next occurrence was added.`;
		case "deleted":
			return `Completed “${task}” and removed it from ${note}.`;
		case "uncomplete":
			return `Marked “${task}” not done in ${note}.`;
		case "date":
			return change.day === null
				? `Removed the ${change.field} date from “${task}”.`
				: `Set the ${change.field} date of “${task}” to ${change.day}.`;
		case "cancel":
			return `Cancelled “${task}” in ${note}.`;
		case "replace":
			return `Saved your edit to “${task}” in ${note}.`;
	}
}

/** Confirms the one line restored by an undo, including a dialog edit's limits. */
export function undoDoneText(context: NoticeContext, dialogEdit = false): string {
	return (
		`Undid the change to “${displayTask(context.text)}”.` +
		(dialogEdit ? " Changes the Tasks dialog made to other tasks are not undone." : "")
	);
}

/** Explains why an undo that is already present needs no write. */
export function undoAlreadyText(context: NoticeContext): string {
	return `“${displayTask(context.text)}” in ${noteName(context.path)} is already back to how it was.`;
}

/** Refuses an undo whose retained record is gone. */
export function undoExpiredText(context: NoticeContext): string {
	return `Could not undo: the change to “${displayTask(context.text)}” was too long ago. Nothing was written.`;
}

/** Supplies the later revert check's single-write and grouped wording. */
export function overwrittenText(context: NoticeContext, count: number): string {
	return count === 1
		? `“${displayTask(context.text)}” in ${noteName(context.path)} is back to how it was before the timeline changed it (another save, a sync, or a change made in the note). Redo?`
		: `${count} timeline changes in ${noteName(context.path)} are back to how they were before (another save, a sync, or a change made in the note). Redo?`;
}

/** The recovery dialog leaves its selectable text in place after a clipboard failure. */
export const COPY_FAILURE_TEXT = "Couldn't copy. Select the text and copy it yourself.";

/** Optional browser dependencies keep notice and clipboard tests independent of Obsidian. */
export interface NoticePresenterOptions {
	readonly document?: Document;
	readonly clipboard?: Pick<Clipboard, "writeText">;
	readonly openNote?: (path: string, line: number) => Promise<unknown>;
}

/** Keeps an unsaved dialog result available to copy without putting the line in a toast. */
export class EditRecoveryModal extends Modal {
	constructor(
		app: App,
		private readonly title: "Edit not saved" | "Edit changed back",
		private readonly context: NoticeContext,
		private readonly editedLine: string,
		private readonly options: NoticePresenterOptions = {},
	) {
		super(app);
	}

	/** Copy runs in the button handler so the browser retains the user's gesture. */
	onOpen(): void {
		this.setTitle(this.title);
		const text = this.contentEl.createEl("textarea");
		text.value = this.editedLine;
		text.readOnly = true;
		const failure = this.contentEl.createEl("p");
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(buttons).setButtonText("Copy").onClick(async () => {
			try {
				await (this.options.clipboard ?? navigator.clipboard).writeText(this.editedLine);
			} catch {
				failure.setText(COPY_FAILURE_TEXT);
			}
		});
		new ButtonComponent(buttons).setButtonText("Open note").onClick(() => {
			const open = this.options.openNote ?? ((path, line) => openNoteAt(this.app, path, line));
			void open(this.context.path, this.context.line);
		});
	}
}

/** The writer presents outcomes through this port; views can later present their own undo notices. */
export interface NoticePresenter {
	refuse(reason: RefuseReason, context: NoticeContext): string;
	tasksDialog(kind: "too-old" | "error" | "failed" | "delete", context: NoticeContext, reason?: string): string;
	failed(context: NoticeContext, error: unknown): void;
	mayNotSaved(context: NoticeContext, kind: "timeout" | "editor"): void;
	slow(context: NoticeContext): void;
	editNotSaved(context: NoticeContext, editedLine: string): void;
	editChangedBack(context: NoticeContext, editedLine: string): void;
	overwritten(context: NoticeContext, count: number, redo?: () => Promise<void>): void;
	undo(context: NoticeContext, change: UndoNoticeChange, undo: () => unknown): Notice;
	undoDone(context: NoticeContext, dialogEdit?: boolean): void;
	undoAlready(context: NoticeContext): void;
	undoExpired(context: NoticeContext): string;
	dispose(): void;
}

/** Presents notices once per reason and note while they remain visible, including while hovered. */
export function createNoticePresenter(app: App, options: NoticePresenterOptions = {}): NoticePresenter {
	const refusals = new Map<string, Notice>();
	const slow = new Map<string, Notice>();
	const notices = new Set<Notice>();
	const modals = new Set<EditRecoveryModal>();
	const open = options.openNote ?? ((path, line) => openNoteAt(app, path, line));

	function fragment(message: string, buttons: readonly { text: string; run: () => unknown }[]): DocumentFragment {
		const doc = options.document ?? document;
		const result = doc.createDocumentFragment();
		result.appendChild(doc.createTextNode(message));
		for (const button of buttons) {
			result.appendChild(doc.createTextNode(" "));
			const element = doc.createElement("button");
			element.textContent = button.text;
			element.addEventListener("click", button.run);
			result.appendChild(element);
		}
		return result;
	}

	function openButton(context: NoticeContext): { text: string; run: () => unknown } {
		return { text: "Open note", run: () => open(context.path, context.line) };
	}

	function show(message: string | DocumentFragment, duration: number): Notice {
		for (const notice of notices) if (!notice.noticeEl.isConnected) notices.delete(notice);
		const notice = new Notice(message, duration);
		notices.add(notice);
		return notice;
	}

	function merged(map: Map<string, Notice>, key: string, message: string | DocumentFragment, duration: number): void {
		for (const [oldKey, notice] of map) if (!notice.noticeEl.isConnected) map.delete(oldKey);
		const existing = map.get(key);
		if (existing?.noticeEl.isConnected) existing.setMessage(message);
		else map.set(key, show(message, duration));
	}

	function recovery(title: "Edit not saved" | "Edit changed back", context: NoticeContext, editedLine: string): void {
		const modal = new EditRecoveryModal(app, title, context, editedLine, options);
		modals.add(modal);
		modal.setCloseCallback(() => modals.delete(modal));
		modal.open();
	}

	return Object.freeze({
		tasksDialog(kind: "too-old" | "error" | "failed" | "delete", context: NoticeContext, reason = ""): string {
			const message = {
				"too-old": tasksDialogTooOldText(),
				error: tasksDialogErrorText(reason),
				failed: tasksDialogFailureText(reason),
				delete: tasksDialogDeleteText(),
			}[kind];
			merged(refusals, JSON.stringify([context.path, "tasks-dialog", kind]), message, REFUSAL_NOTICE_MS);
			return message;
		},
		refuse(reason: RefuseReason, context: NoticeContext): string {
			const message = refusalText(reason, context);
			merged(
				refusals,
				JSON.stringify([context.path, reason]),
				reason === "not-utf8" ? message : fragment(message, [openButton(context)]),
				REFUSAL_NOTICE_MS,
			);
			return message;
		},
		failed(context: NoticeContext, error: unknown): void {
			show(writeFailureText(context, error), REFUSAL_NOTICE_MS);
		},
		mayNotSaved(context: NoticeContext, kind: "timeout" | "editor"): void {
			show(mayNotSavedText(context, kind), REFUSAL_NOTICE_MS);
		},
		slow(context: NoticeContext): void {
			merged(slow, context.path, slowText(context), SLOW_NOTICE_MS);
		},
		editNotSaved(context: NoticeContext, editedLine: string): void {
			recovery("Edit not saved", context, editedLine);
		},
		editChangedBack(context: NoticeContext, editedLine: string): void {
			recovery("Edit changed back", context, editedLine);
		},
		overwritten(context: NoticeContext, count: number, redo?: () => Promise<void>): void {
			show(
				fragment(overwrittenText(context, count), [
					...(redo ? [{ text: "Redo", run: redo }] : []),
					openButton(context),
				]),
				0,
			);
		},
		undo(context: NoticeContext, change: UndoNoticeChange, undo: () => unknown): Notice {
			return show(
				fragment(undoNoticeText(context, change), [{ text: "Undo", run: undo }, openButton(context)]),
				UNDO_NOTICE_MS,
			);
		},
		undoDone(context: NoticeContext, dialogEdit = false): void {
			show(undoDoneText(context, dialogEdit), UNDO_DONE_NOTICE_MS);
		},
		undoAlready(context: NoticeContext): void {
			show(undoAlreadyText(context), UNDO_DONE_NOTICE_MS);
		},
		undoExpired(context: NoticeContext): string {
			const message = undoExpiredText(context);
			merged(
				refusals,
				JSON.stringify([context.path, "undo-expired"]),
				fragment(message, [openButton(context)]),
				REFUSAL_NOTICE_MS,
			);
			return message;
		},
		dispose(): void {
			for (const notice of notices) notice.hide();
			for (const modal of modals) modal.close();
			notices.clear();
			modals.clear();
			refusals.clear();
			slow.clear();
		},
	});
}
