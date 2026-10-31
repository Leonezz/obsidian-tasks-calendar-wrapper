import type { Notice } from "obsidian";
import { parseTaskLine, recurrenceMarkers, tasksTaskLineRegex, type LineTarget } from "@tasks-calendar-wrapper/core";
import { moment } from "../../utils/moment";
import type { NoticePresenter, UndoNoticeChange } from "./notices";
import type { TaskWriter, UndoRecord, WriteResult } from "./taskwriter";

/** Reads the same task text and completed marker as core, including Tasks' extra list markers. */
function taskOf(line: string) {
	const match = tasksTaskLineRegex.exec(line);
	return parseTaskLine(match ? `- [${match[3]}] ${match[4]}` : line, { moment });
}

/** A deletion of the last line leaves an empty span to undo, although no task line was written. */
function changeOf(record: UndoRecord): UndoNoticeChange {
	const lines = record.span.expected;
	if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) return { kind: "deleted" };
	if (lines.length === 2) return { kind: "recurring-added" };
	if (taskOf(lines[0])?.completed) return { kind: "complete" };
	if (recurrenceMarkers(record.original) && !taskOf(record.original)?.completed)
		return { kind: "recurring-replaced" };
	return { kind: "uncomplete" };
}

interface UndoNoticeOptions {
	readonly onWriteResult: (target: LineTarget, result: WriteResult) => void;
	readonly setTimeout?: (run: () => void, delay: number) => number;
	readonly clearTimeout?: (timer: number) => void;
}

/** Owns only this view's notices. A hovered notice keeps its writer record until the notice actually disappears. */
export function createUndoNotices(
	writer: Pick<TaskWriter, "write" | "forgetUndo" | "onUndoGone">,
	presenter: Pick<NoticePresenter, "undo">,
	options: UndoNoticeOptions,
) {
	const notices = new Map<UndoRecord, Notice>();
	const setTimer = options.setTimeout ?? ((run, delay) => globalThis.setTimeout(run, delay) as unknown as number);
	const clearTimer = options.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
	let timer: number | undefined;
	let closed = false;
	function stopIfEmpty(): void {
		if (notices.size || timer === undefined) return;
		clearTimer(timer);
		timer = undefined;
	}
	function poll(): void {
		timer = undefined;
		for (const [record, notice] of notices) {
			if (notice.noticeEl.isConnected) continue;
			notices.delete(record);
			writer.forgetUndo(record);
		}
		if (notices.size) timer = setTimer(poll, 250);
	}
	const unsubscribe = writer.onUndoGone((record) => {
		notices.get(record)?.hide();
		notices.delete(record);
		stopIfEmpty();
	});
	return Object.freeze({
		show(result: WriteResult): void {
			if (result.kind !== "written" || !result.undo) return;
			const record = result.undo;
			if (closed) {
				writer.forgetUndo(record);
				return;
			}
			if (notices.has(record)) return;
			const task = taskOf(record.original);
			const target = { path: record.path, line: record.line, sourceLine: record.original };
			let clicked = false;
			const notice = presenter.undo(
				{ path: record.path, line: record.line, text: task?.visual || task?.text || record.original },
				changeOf(record),
				async () => {
					if (clicked || closed) return;
					clicked = true;
					const undone = await writer.write(() => target, { kind: "undo", record });
					options.onWriteResult(target, undone);
				},
			);
			notices.set(record, notice);
			if (timer === undefined) timer = setTimer(poll, 250);
		},
		close(): void {
			if (closed) return;
			closed = true;
			unsubscribe();
			for (const [record, notice] of notices) {
				notice.hide();
				writer.forgetUndo(record);
			}
			notices.clear();
			stopIfEmpty();
		},
	});
}
