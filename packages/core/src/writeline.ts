/** Task-line edits, with Tasks 8.6.0's default toggle behaviour and byte-preserving date changes. See NOTICE. */
import { dayKey, type DayKey, type MomentFactory } from "./dates";
import { parseTaskLine } from "./parse";
import { findImpossibleDate, isRealDay, recurrenceMarkers, tasksTaskLineRegex } from "./write";

export type ToggleResult =
	| { readonly kind: "lines"; readonly lines: readonly string[] }
	| { readonly kind: "refused"; readonly reason: "recurring-needs-tasks" };

export type DateField = "due" | "scheduled" | "start";
export type NewDateStyle = "emoji" | "dataview";
export type SetDateResult =
	| { readonly kind: "line"; readonly line: string }
	| { readonly kind: "unchanged" }
	| { readonly kind: "refused"; readonly reason: "date-ambiguous" | "date-unreadable" | "date-style-mixed" };

const dataviewField =
	/[[(](?:due|scheduled|start|created|completion|cancelled|done|complete|unplanned|priority|repeat|onCompletion|id|dependsOn)::/u;
const emojiField = /📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌|🔁|🏁|🆔|⛔|🔺|⏫|🔼|🔽|⏬/u;
const blockLink = / \^[a-zA-Z0-9-]+$/u;
const dateShape = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
const dateTimeShape = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?$/;
const dateSymbols = { due: "(?:📅|📆|🗓)", scheduled: "(?:⏳|⌛)", start: "🛫" };
const newDateSymbols = { due: "📅", scheduled: "⏳", start: "🛫" };

function taskParts(line: string) {
	const match = tasksTaskLineRegex.exec(line);
	if (/[\r\n]/u.test(line) || !match) throw new TypeError("Expected one task line");
	const statusStart = line.indexOf("[", match[1].length + match[2].length) + 1;
	const bodyStart = statusStart + match[3].length + 1;
	return { indentation: match[1], listMarker: match[2], status: match[3], statusStart, bodyStart };
}

/** Keeps offsets, while preventing fields on opposite sides of a comment from joining. */
function maskComments(body: string): string {
	return body.replace(/%%[\s\S]*?%%/g, (comment) => "\0".repeat(comment.length));
}

function withoutComments(body: string): string {
	return body.replace(/%%[\s\S]*?%%/g, "");
}

interface FieldSpan {
	readonly start: number;
	readonly end: number;
}

function matchesOutsideComments(body: string, regex: RegExp): readonly RegExpMatchArray[] {
	return [...maskComments(body).matchAll(regex)];
}

function removeField(body: string, span: FieldSpan, keepLeadingSpace: boolean): string {
	const before = body.slice(0, span.start);
	if (keepLeadingSpace && before.trim() === "") {
		return before + body.slice(span.end).replace(/^\s*/u, "");
	}
	return before.replace(/\s*$/u, "") + body.slice(span.end);
}

function removeFields(body: string, regex: RegExp, keepLeadingSpace: boolean): string {
	const matches = matchesOutsideComments(body, regex);
	let result = body;
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i];
		result = removeField(result, { start: match.index!, end: match.index! + match[0].length }, keepLeadingSpace);
	}
	return result;
}

function insertField(body: string, field: string): string {
	const text = body.trimEnd();
	const at = blockLink.exec(text)?.index ?? text.length;
	return body.slice(0, at) + field + body.slice(at);
}

function toggleMinimal(body: string, status: string, today: DayKey, dataview: boolean): string {
	if (dataview) {
		const cleared = removeFields(
			body,
			/\[(?:completion|cancelled)::[^\]]*\]|\((?:completion|cancelled)::[^)]*\)/gu,
			false,
		);
		return status === "x" ? insertField(cleared, `  [completion:: ${today}]`) : cleared;
	}
	return removeFields(body, /(?:✅|❌)\uFE0F? *[0-9]{4}-[0-9]{2}-[0-9]{2}/gu, true);
}

type EmojiKey =
	"priority" | "done" | "cancelled" | "due" | "scheduled" | "start" | "created" | "onCompletion" | "id" | "dependsOn";
type EmojiValues = Record<EmojiKey, string>;

function tailField(symbol: string, value: string): RegExp {
	return new RegExp(symbol + "\uFE0F?" + (value ? " *" + value : "") + "$");
}

const emojiReaders: readonly (readonly [EmojiKey | "tags", RegExp])[] = [
	["priority", tailField("(🔺|⏫|🔼|🔽|⏬)", "")],
	["done", tailField("✅", "(" + dateShape + ")")],
	["cancelled", tailField("❌", "(" + dateShape + ")")],
	["due", tailField(dateSymbols.due, "(" + dateShape + ")")],
	["scheduled", tailField(dateSymbols.scheduled, "(" + dateShape + ")")],
	["start", tailField("🛫", "(" + dateShape + ")")],
	["created", tailField("➕", "(" + dateShape + ")")],
	["onCompletion", tailField("🏁", "([a-zA-Z]+)")],
	["tags", /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+$/],
	["id", tailField("🆔", "([a-zA-Z0-9-_]+)")],
	["dependsOn", tailField("⛔", "([a-zA-Z0-9-_]+( *, *[a-zA-Z0-9-_]+ *)*)")],
];

/** Reads from the end in Tasks' order; an earlier duplicate replaces the value read to its right. */
function readEmojiTail(body: string) {
	const values: EmojiValues = {
		priority: "",
		done: "",
		cancelled: "",
		due: "",
		scheduled: "",
		start: "",
		created: "",
		onCompletion: "",
		id: "",
		dependsOn: "",
	};
	let description = body;
	let tags = "";
	for (let run = 0; run < 21; run++) {
		let matched = false;
		for (const [key, regex] of emojiReaders) {
			const match = regex.exec(description);
			if (!match) continue;
			if (key === "tags") tags = match[0].trim() + (tags ? " " + tags : "");
			else values[key] = match[1];
			description = description.slice(0, match.index).trim();
			matched = true;
		}
		if (!matched) break;
	}
	if (tags) description += (description ? " " : "") + tags;
	const action = values.onCompletion.toLowerCase();
	return {
		...values,
		description,
		onCompletion: action === "keep" || action === "delete" ? action : "",
		dependsOn: values.dependsOn.replace(/ /g, ""),
	};
}

function emojiValue(symbol: string, value: string): string {
	return value ? ` ${symbol} ${value}` : "";
}

function toggleEmoji(line: string, body: string, status: string, today: DayKey): ToggleResult {
	const text = body.trim();
	const link = blockLink.exec(text)?.[0] ?? "";
	const fields = readEmojiTail((link ? text.slice(0, -link.length) : text).trim());
	if (status === "x" && fields.onCompletion === "delete") return { kind: "lines", lines: [] };
	const serialized =
		fields.description +
		emojiValue("🆔", fields.id) +
		emojiValue("⛔", fields.dependsOn) +
		(fields.priority ? " " + fields.priority : "") +
		emojiValue("🏁", fields.onCompletion) +
		emojiValue("➕", fields.created) +
		emojiValue("🛫", fields.start) +
		emojiValue("⏳", fields.scheduled) +
		emojiValue("📅", fields.due) +
		emojiValue("✅", status === "x" ? today : "") +
		link;
	const { indentation, listMarker } = taskParts(line);
	const hardBreak = / {2,}$/.exec(line)?.[0] ?? "";
	return { kind: "lines", lines: [`${indentation}${listMarker} [${status}] ${serialized}${hardBreak}`] };
}

/** Toggles without Tasks enabled; completing a recurrence needs Tasks to create its next occurrence. */
export function toggleTaskLine(line: string, today: DayKey): ToggleResult {
	const parts = taskParts(line);
	if (!isRealDay(today) || findImpossibleDate(line)) throw new RangeError("Expected real ASCII dates");
	const status = parts.status === "x" || parts.status === "-" ? " " : "x";
	const recurring = recurrenceMarkers(line) > 0;
	if (recurring && status === "x") return { kind: "refused", reason: "recurring-needs-tasks" };
	const body = line.slice(parts.bodyStart);
	const dataview = dataviewField.test(withoutComments(body));
	if (!recurring && !dataview) return toggleEmoji(line, body, status, today);
	const prefix = line.slice(0, parts.statusStart) + status + "]";
	return { kind: "lines", lines: [prefix + toggleMinimal(body, status, today, dataview)] };
}

interface DateCandidate extends FieldSpan {
	readonly valueStart: number;
	readonly day: string | null;
}

function squareDateCandidates(body: string, field: DateField): readonly DateCandidate[] {
	const candidates: DateCandidate[] = [];
	for (const match of matchesOutsideComments(body, /(\[+)([^[\]]+)::([^\]]*)\]/g)) {
		if (match[2].trim() !== field) continue;
		const value = match[3].trim();
		const valueStart =
			match.index! + match[1].length + match[2].length + 2 + match[3].length - match[3].trimStart().length;
		let end = match.index! + match[0].length;
		for (let extra = 1; extra < match[1].length && body[end] === "]"; extra++) end++;
		candidates.push({ start: match.index!, end, valueStart, day: dateTimeShape.exec(value)?.[1] ?? null });
	}
	return candidates;
}

function dateCandidates(body: string, field: DateField): readonly DateCandidate[] {
	const emoji = matchesOutsideComments(body, new RegExp(dateSymbols[field] + "\\uFE0F? *(" + dateShape + ")", "gu"));
	const parentheses = matchesOutsideComments(body, new RegExp("\\(\\s*" + field + "\\s*::[^)]*\\)", "gu"));
	return [
		...emoji.map((match) => ({
			start: match.index!,
			end: match.index! + match[0].length,
			valueStart: match.index! + match[0].length - 10,
			day: match[1],
		})),
		...squareDateCandidates(body, field),
		...parentheses.map((match) => ({
			start: match.index!,
			end: match.index! + match[0].length,
			valueStart: match.index!,
			day: null,
		})),
	];
}

function insertedDate(body: string, field: DateField, day: DayKey, newFieldStyle: NewDateStyle): string | null {
	const visible = withoutComments(body);
	const dataview = dataviewField.test(visible);
	const emoji = emojiField.test(visible);
	if (dataview && emoji) return null;
	const style = dataview ? "dataview" : emoji ? "emoji" : newFieldStyle;
	return insertField(body, style === "dataview" ? `  [${field}:: ${day}]` : ` ${newDateSymbols[field]} ${day}`);
}

/** Changes only one date field, retaining the line's spelling, layout, comments and other fields. */
export function setTaskDate(
	line: string,
	field: DateField,
	day: DayKey | null,
	options: { readonly newFieldStyle: NewDateStyle; readonly moment: MomentFactory },
): SetDateResult {
	const { bodyStart } = taskParts(line);
	if (day !== null && !isRealDay(day)) throw new RangeError("Expected a real ASCII day");
	const body = line.slice(bodyStart);
	const candidates = dateCandidates(body, field);
	if (candidates.length > 1) return { kind: "refused", reason: "date-ambiguous" };
	const candidate = candidates[0];
	if (candidate?.day === null) return { kind: "refused", reason: "date-unreadable" };
	if (candidate ? candidate.day === day : day === null) return { kind: "unchanged" };
	let changed: string | null;
	if (candidate) {
		changed =
			day === null
				? removeField(body, candidate, true)
				: body.slice(0, candidate.valueStart) + day + body.slice(candidate.valueStart + 10);
	} else {
		changed = insertedDate(body, field, day!, options.newFieldStyle);
		if (changed === null) return { kind: "refused", reason: "date-style-mixed" };
		// Core can reveal a date by first removing an intervening priority symbol. Do not add a second one.
		if (parseTaskLine(line, options)?.dates[field]) return { kind: "refused", reason: "date-unreadable" };
	}
	const result = line.slice(0, bodyStart) + changed;
	const parsed = parseTaskLine(result, options);
	const actual = parsed?.dates[field];
	if (!parsed || (actual ? dayKey(actual) : null) !== day) return { kind: "refused", reason: "date-unreadable" };
	return { kind: "line", line: result };
}
