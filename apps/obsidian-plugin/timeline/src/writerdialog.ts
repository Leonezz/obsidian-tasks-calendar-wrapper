import type { App } from "obsidian";
import { isTaskLine, type LineTarget } from "@tasks-calendar-wrapper/core";
import { openNoteAt } from "../../src/open-note";
import type { NoticeContext, RefuseReason } from "./notices";
import type { TaskWriter, TaskWriterDeps, WriteResult } from "./taskwriter";
import { displayText, errorMessage, prepareEdit, withoutBOM } from "./writerchecks";
import { DEPENDENCY_QUIET_MS, DEPENDENCY_WAIT_MAX_MS } from "./writerconstants";
import type { createWriteTracking } from "./writerholds";

function visible(text: string): string {
	return text.replace(/%%[\s\S]*?%%/g, (comment) => " ".repeat(comment.length));
}

function deletesOnCompletion(line: string): boolean {
	return /🏁\uFE0F?\s*delete\b|\[\s*onCompletion\s*::\s*delete\s*\]|\(\s*onCompletion\s*::\s*delete\s*\)/iu.test(
		visible(line),
	);
}

function dependencies(lines: readonly string[]): string {
	const ids: string[] = [];
	const blockedBy: string[] = [];
	for (const line of lines) {
		const text = visible(line);
		for (const match of text.matchAll(/🆔\uFE0F?\s*([a-zA-Z0-9_-]+)/gu)) ids.push(match[1]);
		for (const match of text.matchAll(/⛔\uFE0F?\s*([a-zA-Z0-9_-]+(?:\s*,\s*[a-zA-Z0-9_-]+)*)/gu))
			blockedBy.push(...match[1].split(/\s*,\s*/u));
		for (const match of text.matchAll(
			/\[\s*(id|dependsOn)\s*::\s*([^\]]*)\]|\(\s*(id|dependsOn)\s*::\s*([^)]*)\)/giu,
		)) {
			const key = (match[1] ?? match[3]).toLowerCase();
			const value = (match[2] ?? match[4]).trim();
			if (value) (key === "id" ? ids : blockedBy).push(...value.split(/\s*,\s*/u));
		}
	}
	// Formatting and list order do not change dependency values; duplicate values still count.
	return JSON.stringify([ids.sort(), blockedBy.sort()]);
}

function unloaded(): WriteResult {
	return Object.freeze({ kind: "failed", unknownOutcome: false, error: new Error("The plugin unloaded.") });
}

/** Keeps dialog input and dependency waits outside the writer's queue and index holds. */
export function createWriterDialog(
	deps: TaskWriterDeps,
	tracking: Pick<ReturnType<typeof createWriteTracking>, "blocked" | "notReread">,
	enqueue: TaskWriter["write"],
	isDisposed: () => boolean,
) {
	const waits = new Set<() => void>();

	function quiet(path: string): Promise<void> {
		return new Promise((resolve) => {
			let done = false;
			let timer: number;
			const ref = deps.app.vault.on("modify", (file) => {
				if (file.path !== path) return;
				deps.clearTimeout(timer);
				timer = deps.setTimeout(finish, DEPENDENCY_QUIET_MS);
			});
			const cap = deps.setTimeout(finish, DEPENDENCY_WAIT_MAX_MS);
			timer = deps.setTimeout(finish, DEPENDENCY_QUIET_MS);
			function finish(): void {
				if (done) return;
				done = true;
				deps.clearTimeout(timer);
				deps.clearTimeout(cap);
				deps.app.vault.offref(ref);
				waits.delete(finish);
				resolve();
			}
			waits.add(finish);
		});
	}

	async function edit(target: () => LineTarget): Promise<WriteResult> {
		if (isDisposed()) return unloaded();
		const dialog = deps.tasksDialog?.() ?? { kind: "none" };
		const at = Object.freeze({ ...target() });
		const expected = at.line === 0 ? withoutBOM(at.sourceLine) : at.sourceLine;
		const snapshot = Object.freeze({ ...at, sourceLine: expected });
		const context: NoticeContext = {
			path: at.path,
			line: at.line,
			text: displayText(expected, deps),
			action: "replace",
		};
		function refused(reason: RefuseReason, details?: Partial<NoticeContext>): WriteResult {
			return Object.freeze({
				kind: "refused",
				reason,
				message: deps.notices.refuse(reason, { ...context, ...details }),
			});
		}
		if (dialog.kind === "none" || dialog.kind === "too-old") {
			try {
				if (deps.openNote) await deps.openNote(at.path, at.line);
				else await openNoteAt(deps.app as App, at.path, at.line);
			} catch (error) {
				deps.logger.error("Tasks Calendar Wrapper: could not write", at.path, error);
				deps.notices.failed(context, error);
				return Object.freeze({ kind: "failed", unknownOutcome: false, error });
			}
			if (isDisposed()) return unloaded();
			return dialog.kind === "none"
				? Object.freeze({ kind: "cancelled" })
				: Object.freeze({
						kind: "refused",
						reason: "tasks-too-old",
						message: deps.notices.tasksDialog("too-old", context),
					});
		}
		if (dialog.kind === "error") {
			deps.logger.error("Tasks Calendar Wrapper: could not reach Tasks", dialog.error);
			return Object.freeze({
				kind: "refused",
				reason: "tasks-error",
				message: deps.notices.tasksDialog("error", context, errorMessage(dialog.error)),
			});
		}
		if (tracking.blocked(at.path)) return refused("queue-blocked");
		if (tracking.notReread(snapshot)) return refused("not-reread");
		if (!deps.app.vault.getFileByPath(at.path)) return refused("moved-or-deleted");
		if (!isTaskLine(expected)) return refused("not-task-line");

		let output: unknown;
		try {
			output = await dialog.edit(expected);
		} catch (error) {
			if (isDisposed()) return unloaded();
			deps.logger.error("Tasks Calendar Wrapper: edit dialog failed", error);
			deps.notices.tasksDialog("failed", context, errorMessage(error));
			return Object.freeze({ kind: "failed", unknownOutcome: false, error });
		}
		if (isDisposed()) return unloaded();
		if (output === "") {
			if (deletesOnCompletion(expected)) deps.notices.tasksDialog("delete", context);
			return Object.freeze({ kind: "cancelled" });
		}
		if (typeof output !== "string") {
			const result = refused("bad-output");
			deps.notices.editNotSaved(context, String(output));
			return result;
		}
		const replacement = Object.freeze({
			kind: "replace" as const,
			expected,
			lines: Object.freeze(output.split("\n")),
		});
		const prepared = prepareEdit(expected, at.path, replacement, deps);
		if (prepared.kind === "refused") {
			const result = refused(prepared.reason, prepared.details);
			deps.notices.editNotSaved({ ...context, ...prepared.details }, output);
			return result;
		}
		if (prepared.recurrenceRemoved) {
			const confirmed = await deps.confirm?.({
				title: "Remove recurrence?",
				message: `The edited task no longer repeats. If you cleared Recurs, save it. If you did not, Tasks could not read the rule in “${expected}” and dropped it.`,
				confirmText: "Save without recurrence",
				focusCancel: true,
			});
			if (isDisposed()) return unloaded();
			if (!confirmed) {
				deps.notices.editNotSaved(context, output);
				return Object.freeze({ kind: "cancelled" });
			}
		}
		if (dependencies([expected]) !== dependencies(replacement.lines)) await quiet(at.path);
		if (isDisposed()) return unloaded();
		return enqueue(target, replacement);
	}

	return Object.freeze({
		edit,
		dispose(): void {
			for (const finish of waits) finish();
		},
	});
}
