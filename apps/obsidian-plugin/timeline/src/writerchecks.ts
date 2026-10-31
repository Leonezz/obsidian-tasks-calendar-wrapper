import {
	checkReplacement,
	dateTokens,
	findImpossibleDate,
	isTaskLine,
	lineOfText,
	parseTaskLine,
	setTaskDate,
	tasksTaskLineRegex,
	toggleTaskLine,
} from "@tasks-calendar-wrapper/core";
import type { NoticeContext, RefuseReason } from "./notices";
import type { TaskEdit, TaskWriterDeps } from "./taskwriter";

/** Removes only the note's encoding marker, never an embedded U+FEFF. */
export function withoutBOM(text: string): string {
	return text.replace(/^\uFEFF/u, "");
}

/** The common representation for content ids, editor comparisons and verified UTF-8. */
export function normalized(text: string): string {
	return withoutBOM(text).replace(/\r\n/g, "\n");
}

/** Reads a source line with Obsidian's BOM and CRLF conventions. */
export function sourceAt(text: string, line: number): string | null {
	const value = lineOfText(text, line);
	return value !== null && line === 0 ? withoutBOM(value) : value;
}

const fields: Readonly<Record<string, string>> = {
	"📅": "due",
	"📆": "due",
	"🗓": "due",
	"⏳": "scheduled",
	"⌛": "scheduled",
	"🛫": "start",
	"➕": "created",
	"✅": "completion",
	"❌": "cancelled",
};

/** What the timeline displays, also for Tasks list markers that its note parser does not support. */
export function displayText(source: string, deps: TaskWriterDeps): string {
	const match = tasksTaskLineRegex.exec(source);
	const parsed = parseTaskLine(match ? `- [${match[3]}] ${match[4]}` : source, { moment: deps.moment });
	return parsed?.visual || parsed?.text || match?.[4] || source;
}

/** A synchronous preflight result, computed before entering Obsidian's file-system queue. */
export type PreparedEdit =
	| { readonly kind: "lines"; readonly lines: readonly string[]; readonly unchanged: boolean }
	| { readonly kind: "refused"; readonly reason: RefuseReason; readonly details?: Partial<NoticeContext> };

/** Checks the input and Tasks' output without saving a view or holding the index. */
export function prepareEdit(source: string, path: string, edit: TaskEdit, deps: TaskWriterDeps): PreparedEdit {
	if (!isTaskLine(source)) return { kind: "refused", reason: "not-task-line" };
	if (edit.kind === "toggle") {
		const impossible = findImpossibleDate(source);
		if (impossible)
			return {
				kind: "refused",
				reason: "impossible-date",
				details: { field: fields[impossible.field] ?? impossible.field, value: impossible.value },
			};
	}
	let lines: readonly string[];
	if (edit.kind === "replace") lines = [...edit.lines];
	else if (edit.kind === "date") {
		const result = setTaskDate(source, edit.field, edit.day, {
			newFieldStyle: deps.newDateStyle(),
			moment: deps.moment,
		});
		if (result.kind === "refused") {
			const visible = source.replace(/%%[\s\S]*?%%/g, (comment) => " ".repeat(comment.length));
			const candidates = dateTokens(visible).filter(
				(token) =>
					(fields[token.symbol] ?? token.symbol) === edit.field &&
					(!(token.symbol in fields) || /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(token.value)),
			);
			const parentheses = new RegExp("\\(\\s*" + edit.field + "\\s*::[^)]*\\)", "u").exec(visible)?.[0];
			return {
				kind: "refused",
				reason: result.reason,
				details: {
					field: edit.field,
					a: candidates[0]?.value,
					b: candidates[1]?.value,
					found: parentheses ?? candidates[0]?.value ?? source,
				},
			};
		}
		lines = [result.kind === "unchanged" ? source : result.line];
	} else {
		try {
			const tasks = deps.tasks();
			if (tasks.kind === "error")
				return { kind: "refused", reason: "tasks-error", details: { message: errorMessage(tasks.error) } };
			if (tasks.kind === "too-old") return { kind: "refused", reason: "tasks-too-old" };
			if (tasks.kind === "toggle") {
				const output: unknown = tasks.toggle(source, path);
				if (typeof output !== "string") return { kind: "refused", reason: "bad-output" };
				lines = output === "" ? [] : output.split("\n");
			} else {
				const result = toggleTaskLine(source, deps.today());
				if (result.kind === "refused") return result;
				lines = result.lines;
			}
		} catch (error) {
			return { kind: "refused", reason: "tasks-error", details: { message: errorMessage(error) } };
		}
	}
	const checked = checkReplacement(source, lines, edit.kind === "replace" ? "edit" : "inplace");
	if (!checked.ok)
		return {
			kind: "refused",
			reason: checked.reason,
			details:
				checked.reason === "unreadable-date"
					? {
							token: checked.token,
							localDigits: checked.localDigits,
							locale: deps.locale?.() ?? deps.moment.locale(),
						}
					: undefined,
		};
	return Object.freeze({ kind: "lines", lines: Object.freeze([...lines]), unchanged: checked.unchanged });
}

/** Keeps thrown strings and Error messages readable without assuming a particular Tasks error type. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
