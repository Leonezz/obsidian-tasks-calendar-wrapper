/**
 * Pure functions behind the timeline's writes: no obsidian and no clock (today is passed in).
 * The adapter in apps/obsidian-plugin reads and writes the files in a later step.
 */

// Obsidian (Electron and mobile WebViews) provides TextDecoder.
declare const TextDecoder: new (
	label: string,
	options: { fatal: boolean; ignoreBOM: boolean },
) => { decode(bytes: Uint8Array): string };

/** Where a write goes: the note, the 0-based line and the text the timeline read there (its first line). */
export interface LineTarget {
	readonly path: string;
	readonly line: number;
	readonly sourceLine: string;
}

/** Lines expected at `line`; `above`/`below` (when present) must be the lines right before/after the span, null = note start/end. */
export interface Span {
	readonly line: number;
	readonly expected: readonly string[];
	readonly above?: string | null;
	readonly below?: string | null;
	/** Line ending put after each inserted line when `expected` is empty. */
	readonly eol?: string;
}

export type SpanMismatch = "out-of-range" | "line-changed" | "neighbour-changed";
export type ReplaceResult =
	| { readonly kind: "replaced"; readonly content: string; readonly delta: number }
	| { readonly kind: "mismatch"; readonly reason: SpanMismatch };

/** What undoing a write needs: the span the write left in the note and the original line to put back. */
export interface UndoSpan {
	readonly span: Span;
	readonly original: string;
}

function withoutBOM(text: string): string {
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function withoutCR(text: string): string {
	return text.endsWith("\r") ? text.slice(0, -1) : text;
}

/** Reads just one LF-delimited line, keeping a BOM and stripping one trailing CR. */
export function lineOfText(text: string, line: number): string | null {
	if (!Number.isInteger(line) || line < 0) return null;
	let start = 0;
	for (let i = 0; i < line; i++) {
		const newline = text.indexOf("\n", start);
		if (newline < 0) return null;
		start = newline + 1;
	}
	const newline = text.indexOf("\n", start);
	return withoutCR(text.slice(start, newline < 0 ? text.length : newline));
}

/** The Tasks 8.6.0 task-line syntax, including plus and numbered list markers. */
export const tasksTaskLineRegex = /^([\s\t>]*)([-*+]|[0-9]+[.)]) +\[(.)\] *(.*)/u;

/** Checks whether a line follows Tasks' task syntax. */
export function isTaskLine(line: string): boolean {
	return tasksTaskLineRegex.test(line);
}

interface TextLine {
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly eol: string;
}

function textLines(text: string): readonly TextLine[] {
	const lines: TextLine[] = [];
	let start = 0;
	while (true) {
		const newline = text.indexOf("\n", start);
		const raw = text.slice(start, newline < 0 ? text.length : newline);
		lines.push({
			start,
			end: newline < 0 ? text.length : newline + 1,
			text: withoutCR(raw),
			eol: newline < 0 ? "" : raw.endsWith("\r") ? "\r\n" : "\n",
		});
		if (newline < 0) return lines;
		start = newline + 1;
	}
}

/** Replaces only a still-matching span, preserving the BOM and all bytes outside it. */
export function replaceSpan(content: string, span: Span, lines: readonly string[]): ReplaceResult {
	const result = replaceSpanIn(content, withoutBOM(content), span, lines);
	// Deleting a first line can leave a U+FEFF that began the next line at the start of the note. Putting the line back
	// before that line, as recorded with its U+FEFF in `below`, must put it before that U+FEFF too.
	const ownsBOM =
		result.kind === "mismatch" &&
		span.expected.length === 0 &&
		span.line === 0 &&
		content.startsWith("﻿") &&
		span.below === lineOfText(content, 0);
	return ownsBOM ? replaceSpanIn(content, content, span, lines) : result;
}

function replaceSpanIn(content: string, text: string, span: Span, lines: readonly string[]): ReplaceResult {
	const original = textLines(text);
	const { line, expected } = span;
	if (!Number.isInteger(line) || line < 0 || line >= original.length || line + expected.length > original.length) {
		return { kind: "mismatch", reason: "out-of-range" };
	}
	if (expected.some((value, i) => original[line + i].text !== (line + i === 0 ? withoutBOM(value) : value))) {
		return { kind: "mismatch", reason: "line-changed" };
	}
	const above = line === 0 ? null : original[line - 1].text;
	const below = original[line + expected.length]?.text ?? null;
	if ((span.above !== undefined && span.above !== above) || (span.below !== undefined && span.below !== below)) {
		return { kind: "mismatch", reason: "neighbour-changed" };
	}

	const first = original[line];
	const last = expected.length === 0 ? undefined : original[line + expected.length - 1];
	const end = last?.end ?? first.start;
	const ending = last ? last.eol || original[line - 1]?.eol || "\n" : (span.eol ?? (first.eol || "\n"));
	const replacement = lines.map((value, i) => value + (last && i === lines.length - 1 ? last.eol : ending)).join("");
	const result =
		content.slice(0, content.length - text.length) + text.slice(0, first.start) + replacement + text.slice(end);
	const delta = lines.length - expected.length;
	const emptyLastLine = lines.length === 0 && last?.eol === "";
	if (result.split("\n").length !== original.length + delta + (emptyLastLine ? 1 : 0)) {
		throw new Error("Replacing a span changed an unexpected number of lines");
	}
	return { kind: "replaced", content: result, delta };
}

/** Replaces a task only when its first line still matches what the timeline read. */
export function replaceTaskLine(
	content: string,
	target: Pick<LineTarget, "line" | "sourceLine">,
	lines: readonly string[],
): ReplaceResult {
	return replaceSpan(content, { line: target.line, expected: [target.sourceLine] }, lines);
}

/** Captures the original line and, for deletions, neighbours needed to put it back safely. */
export function undoSpanFor(before: string, line: number, written: readonly string[]): UndoSpan {
	const lines = textLines(withoutBOM(before));
	if (!Number.isInteger(line) || line < 0 || line >= lines.length) throw new RangeError("No line at this index");
	const original = lines[line];
	if (written.length > 0) return { span: { line, expected: [...written] }, original: original.text };
	return {
		span: {
			line,
			expected: original.eol === "" ? [""] : [],
			above: lines[line - 1]?.text ?? null,
			below: lines[line + 1]?.text ?? null,
			eol: original.eol,
		},
		original: original.text,
	};
}

/** Validates an ASCII Gregorian day without a date library or the clock. */
export function isRealDay(value: string): boolean {
	if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	const day = Number(value.slice(8, 10));
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export interface DateToken {
	readonly symbol: string;
	readonly value: string;
	readonly start: number;
	readonly end: number;
}

const dateKeys = new Set(["created", "start", "scheduled", "due", "completion", "cancelled"]);
const dateTimeShape = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?)?$/;

/** Reads date field values and their UTF-16 offsets, including unreadable values for write checks. */
export function dateTokens(line: string): readonly DateToken[] {
	const tokens: DateToken[] = [];
	for (const match of line.matchAll(/(➕|🛫|⏳|⌛|📅|📆|🗓|✅|❌)️? */gu)) {
		const start = match.index + match[0].length;
		// A value stops at the next date or recurrence emoji, so a date emoji ending the description reads no value.
		const word = /^(?:(?!➕|🛫|⏳|⌛|📅|📆|🗓|✅|❌|🔁)\S)*/u.exec(line.slice(start))![0];
		const time = /^ [0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?=\s|$)/u.exec(line.slice(start + word.length))?.[0] ?? "";
		const value = word + time;
		tokens.push({ symbol: match[1], value, start, end: start + value.length });
	}
	const fields = [/\[([^[\]]*?)::([^\]]*)\]/gu, /\(([^()]*?)::([^)]*)\)/gu];
	for (const pattern of fields) {
		for (const match of line.matchAll(pattern)) {
			const symbol = match[1].trim();
			if (!dateKeys.has(symbol)) continue;
			const raw = match[2];
			const value = raw.trim();
			const start = match.index + 1 + match[1].length + 2 + raw.length - raw.trimStart().length;
			tokens.push({ symbol, value, start, end: start + value.length });
		}
	}
	return tokens.sort((a, b) => a.start - b.start);
}

function readableDate(value: string): boolean {
	const match = dateTimeShape.exec(value);
	return (
		match !== null &&
		isRealDay(match[1]) &&
		(match[2] === undefined || (Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4] ?? 0) < 60))
	);
}

/** Names the first date-shaped value whose day cannot exist, so a refusal can explain it. */
export function findImpossibleDate(line: string): { readonly field: string; readonly value: string } | null {
	for (const token of dateTokens(line)) {
		const match = dateTimeShape.exec(token.value);
		if (match && !isRealDay(match[1])) return { field: token.symbol, value: token.value };
	}
	return null;
}

/** Counts every emoji or dataview recurrence marker, including duplicates. */
export function recurrenceMarkers(line: string): number {
	return (line.match(/🔁/gu)?.length ?? 0) + (line.match(/repeat::/gi)?.length ?? 0);
}

export type ReplacementCheck =
	| { readonly ok: true; readonly unchanged: boolean; readonly recurrenceRemoved: boolean }
	| { readonly ok: false; readonly reason: "bad-output" }
	| { readonly ok: false; readonly reason: "unreadable-date"; readonly token: string; readonly localDigits: boolean }
	| { readonly ok: false; readonly reason: "recurrence-lost" };

/** Checks structure, newly unreadable dates and recurrence loss before accepting Tasks' output. */
export function checkReplacement(
	sourceLine: string,
	lines: readonly string[],
	origin: "inplace" | "edit",
): ReplacementCheck {
	const indentation = /^[\s\t>]*/u.exec(sourceLine)![0];
	if (
		lines.length > 2 ||
		lines.some((line) => /[\r\n]/u.test(line) || !isTaskLine(line) || !line.startsWith(indentation))
	) {
		return { ok: false, reason: "bad-output" };
	}
	const sourceCounts = new Map<string, number>();
	for (const { value } of dateTokens(sourceLine)) sourceCounts.set(value, (sourceCounts.get(value) ?? 0) + 1);
	for (const line of lines) {
		const outputCounts = new Map<string, number>();
		for (const { value } of dateTokens(line)) {
			const count = (outputCounts.get(value) ?? 0) + 1;
			outputCounts.set(value, count);
			if (!readableDate(value) && count > (sourceCounts.get(value) ?? 0)) {
				return {
					ok: false,
					reason: "unreadable-date",
					token: value,
					localDigits: /\p{Nd}/u.test(value.replace(/[0-9]/g, "")),
				};
			}
		}
	}
	const markers = recurrenceMarkers(sourceLine);
	const recurrenceRemoved = lines.some((line) => recurrenceMarkers(line) < markers);
	if (recurrenceRemoved && origin === "inplace") return { ok: false, reason: "recurrence-lost" };
	return { ok: true, unchanged: lines.length === 1 && lines[0] === sourceLine, recurrenceRemoved };
}

export type LineCounts = ReadonlyMap<string, number>;

function normalizedText(text: string): string {
	return withoutBOM(text).replace(/\r\n/g, "\n");
}

/** Counts all lines, wherever they moved; optional keys retain zero counts for absent lines. */
export function taskLineCounts(text: string, keys?: readonly string[]): LineCounts {
	const counts = new Map<string, number>();
	for (const line of normalizedText(text).split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
	return keys === undefined ? counts : new Map(keys.map((key) => [key, counts.get(key) ?? 0]));
}

/** Projects a full table onto a group's current keys, treating absent lines as zero. */
export function countsOn(table: LineCounts, keys: readonly string[]): readonly number[] {
	return keys.map((key) => table.get(key) ?? 0);
}

/** Compares count projections in the same key order. */
export function equalCounts(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((count, i) => count === right[i]);
}

export interface Neighbours {
	readonly above: string | null;
	readonly below: string | null;
}

// Uses textLines' model, where the empty segment after a final newline is a line, as undoSpanFor records neighbours.
function adjacent(text: string, neighbours: Neighbours): boolean {
	const lines = normalizedText(text).split("\n");
	for (let i = 0; i <= lines.length; i++) {
		if ((lines[i - 1] ?? null) !== neighbours.above) continue;
		const below = lines[i] ?? null;
		if (below === neighbours.below) return true;
		// A deleted last line without an EOL leaves the [""] span, whose neighbours are recorded around that empty line.
		if (neighbours.below === null && below === "" && i === lines.length - 1) return true;
	}
	return false;
}

/** Finds the latest reverted snapshot unless the current counts are already expected. */
export function findRevert(
	current: string,
	expected: readonly LineCounts[],
	snapshots: readonly LineCounts[],
	keys: readonly string[],
	adjacency: ReadonlyMap<number, Neighbours>,
): number | null {
	const currentCounts = countsOn(taskLineCounts(current), keys);
	if (expected.some((table) => equalCounts(countsOn(table, keys), currentCounts))) return null;
	for (let j = snapshots.length - 1; j >= 0; j--) {
		const neighbours = adjacency.get(j);
		if (equalCounts(countsOn(snapshots[j], keys), currentCounts) && (!neighbours || adjacent(current, neighbours)))
			return j;
	}
	return null;
}

export interface WriteCounts {
	readonly id: number;
	/** P_j and T_j as full tables, see taskLineCounts. */
	readonly before: LineCounts;
	readonly after: LineCounts;
	/** The id of the write this one undid, when it is an Undo (also for an already-undone result). */
	readonly undoOf?: number;
	readonly outcome: "written" | "unknown" | "unchanged" | "already-undone";
	readonly reported: boolean;
}

/** Removes own Undo pairs and returning runs before selecting lost writes that can be reported. */
export function lostWrites(writes: readonly WriteCounts[], j: number, keys: readonly string[]): readonly WriteCounts[] {
	const candidates = writes.slice(Math.ceil(j / 2));
	const ids = new Set(candidates.map((write) => write.id));
	const removed = new Set<number>();
	for (const write of candidates) {
		if (
			write.undoOf !== undefined &&
			ids.has(write.undoOf) &&
			!removed.has(write.undoOf) &&
			!removed.has(write.id)
		) {
			removed.add(write.id);
			removed.add(write.undoOf);
		}
	}
	const remaining = candidates.filter((write) => !removed.has(write.id));
	const lost: WriteCounts[] = [];
	let i = 0;
	while (i < remaining.length) {
		const before = countsOn(remaining[i].before, keys);
		let best = -1;
		for (let m = remaining.length - 1; m >= i; m--) {
			if (equalCounts(countsOn(remaining[m].after, keys), before)) {
				best = m;
				break;
			}
		}
		if (best < 0) lost.push(remaining[i++]);
		else i = best + 1;
	}
	return lost.filter((write) => !write.reported && write.outcome !== "unknown");
}

export type EncodingCheck = { readonly kind: "ok" } | { readonly kind: "verify-bytes" } | { readonly kind: "changed" };

/** Requests a byte check for replacement characters, then guards against a changed decoded note. */
export function checkEncoding(content: string, verified: string | null): EncodingCheck {
	if (verified === null) return { kind: content.includes("\uFFFD") ? "verify-bytes" : "ok" };
	return { kind: normalizedText(content) === normalizedText(verified) ? "ok" : "changed" };
}

/** Refuses invalid UTF-8 instead of silently writing replacement characters back to the file. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return null;
	}
}
