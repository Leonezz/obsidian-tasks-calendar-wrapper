import { App, ButtonComponent, Modal, Notice, Platform } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
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
	readonly menuFixable?: boolean;
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
export function refusalText(reason: RefuseReason, context: NoticeContext, touch = false): string {
	const text = displayTask(context.text);
	const note = noteName(context.path);
	switch (reason) {
		case "impossible-date":
			return (
				copy.notices.impossibleDate({ text, field: context.field, value: context.value }) +
				(context.menuFixable
					? copy.notices.changeDateWithMenu({
							gesture: touch ? copy.notices.touchMenu : copy.notices.rightClick,
							field: context.field,
						})
					: copy.notices.fixInNote)
			);
		case "unreadable-date": {
			const message =
				context.action === "toggle" || context.action === undefined
					? copy.notices.unreadableReturnedDate({ token: context.token, text })
					: copy.notices.unreadableChangedDate({ text, token: context.token });
			return message + (context.localDigits ? copy.notices.localDigits({ locale: context.locale }) : "");
		}
		case "recurrence-lost":
			return copy.notices.recurrenceLost({ text });
		case "recurring-needs-tasks":
			return copy.notices.recurringNeedsTasks;
		case "not-task-line":
			return copy.notices.notTaskLine({ text });
		case "ambiguous":
			return copy.notices.ambiguous({ text, note });
		case "moved-or-deleted":
			return copy.notices.movedOrDeleted({
				prefix: context.action === "undo" ? copy.notices.couldNotUndo : "",
				note,
			});
		case "not-utf8":
			return copy.notices.notUtf8({ note });
		case "queue-blocked":
			return copy.notices.queueBlocked({ note });
		case "date-ambiguous":
			return copy.notices.dateAmbiguous({ text, field: context.field, a: context.a, b: context.b });
		case "date-unreadable":
			return copy.notices.dateUnreadable({ text, field: context.field, found: context.found });
		case "date-style-mixed":
			return copy.notices.dateStyleMixed({ text, field: context.field });
		case "line-changed":
			return copy.notices.lineChanged({ text, note });
		case "not-reread":
			return copy.notices.notReread({ note, text });
		case "tasks-too-old":
			return copy.notices.tasksTooOld;
		case "tasks-error":
			return copy.notices.tasksError({ text, message: context.message });
		case "bad-output":
			return copy.notices.badOutput({ text });
		case "undo-changed":
			return copy.notices.undoChanged({ text, note });
	}
}

/** Shows the original error message without exposing a stack trace in a notice. */
export function writeFailureText(context: NoticeContext, error: unknown): string {
	return copy.notices.writeFailure({
		note: noteName(context.path),
		reason: error instanceof Error ? error.message : String(error),
	});
}

/** Explains why an interrupted write cannot safely be retried yet. */
export function mayNotSavedText(context: NoticeContext, kind: "timeout" | "editor"): string {
	const note = noteName(context.path);
	return kind === "timeout" ? copy.notices.mayNotSavedTimeout({ note }) : copy.notices.mayNotSavedEditor({ note });
}

/** Distinguishes a successful write from Obsidian finishing its metadata read. */
export function slowText(context: NoticeContext): string {
	return copy.notices.slow({ note: noteName(context.path) });
}

/** Explains why an older Tasks version opened the note instead of its edit dialog. */
export function tasksDialogTooOldText(): string {
	return copy.notices.tasksDialogTooOld;
}

/** Reports an unavailable Tasks API without treating it as a disabled plugin. */
export function tasksDialogErrorText(reason: string): string {
	return copy.notices.tasksDialogError({ reason });
}

/** Reports a dialog that could not open or finish. */
export function tasksDialogFailureText(reason: string): string {
	return copy.notices.tasksDialogFailure({ reason });
}

/** Explains why an empty dialog result cannot complete a task that deletes itself. */
export function tasksDialogDeleteText(): string {
	return copy.notices.tasksDialogDelete;
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
			return copy.notices.completed({ task, note });
		case "recurring-replaced":
			return copy.notices.recurringReplaced({ task, note });
		case "recurring-added":
			return copy.notices.recurringAdded({ task, note });
		case "deleted":
			return copy.notices.deleted({ task, note });
		case "uncomplete":
			return copy.notices.uncompleted({ task, note });
		case "date":
			return change.day === null
				? copy.notices.dateRemoved({ field: change.field, task })
				: copy.notices.dateSet({ field: change.field, task, day: change.day });
		case "cancel":
			return copy.notices.cancelled({ task, note });
		case "replace":
			return copy.notices.replaced({ task, note });
	}
}

/** Confirms the one line restored by an undo, including a dialog edit's limits. */
export function undoDoneText(context: NoticeContext, dialogEdit = false): string {
	return (
		copy.notices.undoDone({ task: displayTask(context.text) }) +
		(dialogEdit ? copy.notices.dialogChangesNotUndone : "")
	);
}

/** Explains why an undo that is already present needs no write. */
export function undoAlreadyText(context: NoticeContext): string {
	return copy.notices.undoAlready({ task: displayTask(context.text), note: noteName(context.path) });
}

/** Refuses an undo whose retained record is gone. */
export function undoExpiredText(context: NoticeContext): string {
	return copy.notices.undoExpired({ task: displayTask(context.text) });
}

/** Supplies the later revert check's single-write and grouped wording. */
export function overwrittenText(context: NoticeContext, count: number): string {
	return count === 1
		? copy.notices.overwritten({ task: displayTask(context.text), note: noteName(context.path) })
		: copy.notices.overwrittenMany({ count, note: noteName(context.path) });
}

/** The recovery dialog leaves its selectable text in place after a clipboard failure. */
export const COPY_FAILURE_TEXT = copy.notices.copyFailure;

/** Optional browser dependencies keep notice and clipboard tests independent of Obsidian. */
export interface NoticePresenterOptions {
	readonly document?: Document;
	readonly clipboard?: Pick<Clipboard, "writeText">;
	readonly openNote?: (path: string, line: number) => Promise<unknown>;
	readonly touch?: () => boolean;
}

/** Keeps an unsaved dialog result available to copy without putting the line in a toast. */
export class EditRecoveryModal extends Modal {
	constructor(
		app: App,
		private readonly title: typeof copy.notices.editNotSaved | typeof copy.notices.editChangedBack,
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
		new ButtonComponent(buttons).setButtonText(copy.notices.copy).onClick(async () => {
			try {
				await (this.options.clipboard ?? navigator.clipboard).writeText(this.editedLine);
			} catch {
				failure.setText(COPY_FAILURE_TEXT);
			}
		});
		new ButtonComponent(buttons).setButtonText(copy.notices.openNote).onClick(() => {
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

/** Reports a notice without changing its text, duration, or merging rules. */
export function reportNotice(message: string | DocumentFragment, duration: number): Notice {
	return new Notice(message, duration);
}

/** Presents notices once per reason and note while they remain visible, including while hovered. */
export function createNoticePresenter(app: App, options: NoticePresenterOptions = {}): NoticePresenter {
	const refusals = new Map<string, Notice>();
	const slow = new Map<string, Notice>();
	const notices = new Set<Notice>();
	const modals = new Set<EditRecoveryModal>();
	const open = options.openNote ?? ((path, line) => openNoteAt(app, path, line));
	const touch = options.touch ?? (() => Platform.isMobile);

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
		return { text: copy.notices.openNote, run: () => open(context.path, context.line) };
	}

	function show(message: string | DocumentFragment, duration: number): Notice {
		for (const notice of notices) if (!notice.noticeEl.isConnected) notices.delete(notice);
		const notice = reportNotice(message, duration);
		notices.add(notice);
		return notice;
	}

	function merged(map: Map<string, Notice>, key: string, message: string | DocumentFragment, duration: number): void {
		for (const [oldKey, notice] of map) if (!notice.noticeEl.isConnected) map.delete(oldKey);
		const existing = map.get(key);
		if (existing?.noticeEl.isConnected) existing.setMessage(message);
		else map.set(key, show(message, duration));
	}

	function recovery(
		title: typeof copy.notices.editNotSaved | typeof copy.notices.editChangedBack,
		context: NoticeContext,
		editedLine: string,
	): void {
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
			const message = refusalText(reason, context, touch());
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
			recovery(copy.notices.editNotSaved, context, editedLine);
		},
		editChangedBack(context: NoticeContext, editedLine: string): void {
			recovery(copy.notices.editChangedBack, context, editedLine);
		},
		overwritten(context: NoticeContext, count: number, redo?: () => Promise<void>): void {
			show(
				fragment(overwrittenText(context, count), [
					...(redo ? [{ text: copy.notices.redo, run: redo }] : []),
					openButton(context),
				]),
				0,
			);
		},
		undo(context: NoticeContext, change: UndoNoticeChange, undo: () => unknown): Notice {
			return show(
				fragment(undoNoticeText(context, change), [
					{ text: copy.notices.undo, run: undo },
					openButton(context),
				]),
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
