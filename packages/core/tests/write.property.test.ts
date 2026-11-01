import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import {
	checkEncoding,
	decodeUtf8Strict,
	isTaskLine,
	lineOfText,
	replaceSpan,
	replaceTaskLine,
	undoSpanFor,
} from "../src/write";
import { setTaskDate, toggleTaskLine, type DateField, type NewDateStyle } from "../src/writeline";
import { dayKey } from "../src/dates";
import { parseTaskLine } from "../src/parse";
import { mulberry32 } from "./support/random";
import { integer, noteFor, pick } from "./support/notes";
import { readTasksLine, type TasksFormat } from "./support/tasksreader";
import { loadTasksToggleFixtures, TASKS_TOGGLE_GROUPS } from "./support/tasksfixtures";

const REPLACEMENT_CASES = 10_000;
const ENCODING_CASES = 10_000;
const REPLACEMENT_SEED = 0x51a7c0de;
const ENCODING_SEED = 0x8badf00d;

test("replaceTaskLine property: only the target line changes, or nothing does", () => {
	const random = mulberry32(REPLACEMENT_SEED);
	for (let index = 0; index < REPLACEMENT_CASES; index++) {
		const before = noteFor(random, index);
		const bom = before.startsWith("\ufeff") ? "\ufeff" : "";
		const raw = before.slice(bom.length).split("\n");
		const originalLine = integer(random, raw.length);
		let line = originalLine;
		let sourceLine = raw[originalLine].replace(/\r$/, "");
		if (originalLine === 0 && bom && random() < 0.5) sourceLine = bom + sourceLine;
		switch (index % 5) {
			case 1:
				sourceLine += " stale";
				break;
			case 2:
				line = (originalLine + 1) % raw.length;
				break;
			case 3:
				line = [-1, raw.length, raw.length + 5, 1.5][integer(random, 4)];
				break;
		}
		const lines = Object.freeze(
			Array.from({ length: index % 3 }, (_, i) => `- [${i === 0 ? "x" : " "}] output ${index}:${i}`),
		);
		const target = Object.freeze({ line, sourceLine });
		const result = replaceTaskLine(before, target, lines);
		const message = `seed ${REPLACEMENT_SEED}, case ${index}: ${JSON.stringify({ before, target, lines })}`;
		const validIndex = Number.isInteger(line) && line >= 0 && line < raw.length;
		const read = lineOfText(before, line);
		assert.equal(read, validIndex ? (line === 0 ? bom : "") + raw[line].replace(/\r$/, "") : null, message);
		const normalizedSource = line === 0 ? sourceLine.replace(/^\ufeff/, "") : sourceLine;
		const matches = read !== null && (line === 0 ? read.replace(/^\ufeff/, "") : read) === normalizedSource;
		if (!matches) {
			assert.deepEqual(
				result,
				{ kind: "mismatch", reason: validIndex ? "line-changed" : "out-of-range" },
				message,
			);
			continue;
		}

		// Reconstruct from split pieces, preserving every byte outside the selected line.
		const endingAt = (i: number) => (i < raw.length - 1 ? (raw[i].endsWith("\r") ? "\r\n" : "\n") : "");
		const ownEnding = endingAt(line);
		const between = ownEnding || (line > 0 ? endingAt(line - 1) : "\n");
		const prefix = raw
			.slice(0, line)
			.map((part) => part + "\n")
			.join("");
		const suffix = raw.slice(line + 1).join("\n");
		const inserted = lines.map((part, i) => part + (i === lines.length - 1 ? ownEnding : between)).join("");
		const expected = bom + prefix + inserted + suffix;
		assert.deepEqual(result, { kind: "replaced", content: expected, delta: lines.length - 1 }, message);
		assert.equal(
			expected.split("\n").length,
			raw.length + lines.length - 1 + (lines.length === 0 && line === raw.length - 1 ? 1 : 0),
			message,
		);
	}
});

test("encoding property: strict decoding and round trips", () => {
	const random = mulberry32(ENCODING_SEED);
	const encoder = new TextEncoder();
	const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
	for (let index = 0; index < ENCODING_CASES; index++) {
		let bytes: Uint8Array;
		if (index % 2 === 0) {
			bytes = Uint8Array.from({ length: integer(random, 65) }, () => integer(random, 256));
		} else {
			const text = Array.from({ length: integer(random, 33) }, () => {
				const special = [0, 0x7f, 0x80, 0x7ff, 0x800, 0xfeff, 0xfffd, 0x10000, 0x10ffff];
				let point = random() < 0.25 ? special[integer(random, special.length)] : integer(random, 0x110000);
				if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
				return String.fromCodePoint(point);
			}).join("");
			bytes = encoder.encode(text);
		}
		if (random() < 0.25) bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]);
		const lossy = decoder.decode(bytes);
		const strict = decodeUtf8Strict(bytes);
		const message = `seed ${ENCODING_SEED}, case ${index}: ${Array.from(bytes).join(",")}`;
		if (checkEncoding(lossy, null).kind === "ok") {
			assert.deepEqual(encoder.encode(lossy), bytes, message);
		}
		if (strict === null) {
			assert.ok(lossy.includes("\ufffd"), message);
		} else {
			assert.equal(strict, lossy, message);
			assert.deepEqual(encoder.encode(strict), bytes, message);
		}
	}
});

const DATE_CASES = 20_000;
const UNDO_CASES = 10_000;
const DATE_SEED = 0xc01da7e5;
const UNDO_SEED = 0x6e7d0a11;
const DATE_FIELDS: readonly DateField[] = ["due", "scheduled", "start"];
const FIELD_SYMBOLS = { due: ["📅", "📆", "🗓"], scheduled: ["⏳", "⌛"], start: ["🛫"] } as const;
const REAL_DAYS = ["2026-10-26", "2024-02-29", "2000-01-01", "2027-12-31"];

interface Candidate {
	readonly start: number;
	readonly end: number;
	readonly value: string | null;
	readonly format: TasksFormat;
}

// This scanner deliberately uses separate comment ranges and bracket walks rather than the writer's helpers.
function candidatesOf(line: string, field: DateField): Candidate[] {
	const bodyStart = line.indexOf("]") + 1;
	const comments = [...line.matchAll(/%%.*?%%/g)].map((match) => [match.index, match.index + match[0].length]);
	const visible = (offset: number) => !comments.some(([start, end]) => offset >= start && offset < end);
	const candidates: Candidate[] = [];
	const emoji = new RegExp(`(${FIELD_SYMBOLS[field].join("|")})️? *([0-9]{4}-[0-9]{2}-[0-9]{2})`, "gu");
	for (const match of line.matchAll(emoji)) {
		if (match.index >= bodyStart && visible(match.index))
			candidates.push({
				start: match.index,
				end: match.index + match[0].length,
				value: match[2],
				format: "emoji",
			});
	}
	for (let start = bodyStart; start < line.length; start++) {
		if (!visible(start) || (line[start] !== "[" && line[start] !== "(")) continue;
		const opening = line[start];
		let keyStart = start + 1;
		if (opening === "[") while (line[keyStart] === "[") keyStart++;
		const end = line.indexOf(opening === "[" ? "]" : ")", keyStart);
		if (end < 0) continue;
		const contents = line.slice(keyStart, end);
		if (contents.includes("[")) continue;
		const separator = contents.indexOf("::");
		if (separator < 0 || contents.slice(0, separator).trim() !== field) continue;
		const value = contents.slice(separator + 2).trim();
		let extendedEnd = end + 1;
		for (let n = 1; n < keyStart - start && line[extendedEnd] === "]"; n++) extendedEnd++;
		candidates.push({
			start,
			end: extendedEnd,
			value:
				opening === "[" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?$/.test(value)
					? value
					: null,
			format: "dataview",
		});
		start = end;
	}
	return candidates.sort((a, b) => a.start - b.start);
}

function fieldText(random: () => number, field: DateField, format: TasksFormat, value: string): string {
	if (format === "emoji")
		return `${pick(random, FIELD_SYMBOLS[field])}${random() < 0.5 ? "️" : ""}${" ".repeat(integer(random, 4))}${value}`;
	const doubled = random() < 0.2;
	return `${doubled ? "[[" : "["}${field}:: ${value}${random() < 0.3 ? pick(random, ["T14:30", " 09:05:20"]) : ""}${doubled ? "]]" : "]"}`;
}

function dateCase(random: () => number, index: number) {
	const field = DATE_FIELDS[index % DATE_FIELDS.length];
	const format: TasksFormat = random() < 0.5 ? "emoji" : "dataview";
	const newFieldStyle: NewDateStyle = index % 2 ? "emoji" : "dataview";
	const oldDay = pick(random, REAL_DAYS);
	let day: string | null =
		index % 5 === 0
			? null
			: pick(
					random,
					REAL_DAYS.filter((value) => value !== oldDay),
				);
	const mode = index % 20;
	if (mode === 2) day = oldDay;
	const marker = pick(random, [
		"-",
		"-",
		"-",
		"-",
		"-",
		"-",
		"-",
		"-",
		"-",
		"-",
		"*",
		"*",
		"*",
		"*",
		"3.",
		"3.",
		"42.",
		"42.",
		"+",
		"7)",
	]);
	const prefix = `${pick(random, ["", "  ", "\t", "> ", ">   > "])}${marker} [${pick(random, [" ", "x", "/", "-", "X", "?"])}] `;
	let description = pick(random, [
		"Pay invoice",
		"call bob #home",
		"read [[Note]]",
		"follow [docs](https://example.test)",
		"中文 task",
		"a %% hidden 📅 2025-01-01 %%",
	]);
	const others = DATE_FIELDS.filter((key) => key !== field)
		.filter(() => random() < 0.55)
		.map((key) => fieldText(random, key, format, pick(random, REAL_DAYS)));
	const extras =
		format === "emoji"
			? [
					pick(random, ["", "⏫", "🔺️", "🔽", "⏬️", "🔼"]),
					random() < 0.25 ? "✅ 2025-10-01" : "",
					random() < 0.25 ? "➕ 2025-09-01" : "",
					random() < 0.2 ? "🔁 every day" : "",
				]
			: [
					random() < 0.4 ? "[priority:: high]" : "",
					random() < 0.25 ? "[created:: 2025-01-01]" : "",
					random() < 0.2 ? "[repeat:: every day]" : "",
				];
	let target = fieldText(random, field, format, mode === 17 ? "2026-02-31" : oldDay);
	if (target.startsWith("[[") && day === null) description = "Pay invoice";
	let tail = random() < 0.4 || target.startsWith("[[") || /T| [0-9]{2}:/.test(target) ? "call later" : "";
	if (mode === 11 || mode === 12 || mode === 16 || mode === 19) target = "";
	if (mode === 12) day = null;
	if (mode === 13) target += ` [${field}:: 2026-01-02]`;
	if (mode === 14) target = `(${field}:: 2026-10-25)`;
	if (mode === 15) target = `[${field}:: someday]`;
	if (mode === 16) {
		others.push("➕ 2025-01-01", "[priority:: high]");
		day = "2026-10-26";
	}
	if (mode === 17) day = "2026-03-01";
	if (mode === 18) {
		target = random() < 0.5 ? `see [ note [${field}:: 2026-10-25]` : `${FIELD_SYMBOLS[field][0]} ⏫ 2026-10-25`;
		day = "2026-10-26";
	}
	if (mode === 19) {
		tail = `%% ${FIELD_SYMBOLS[field][0]} 2025-01-01 %%`;
		day = "2026-10-26";
	}
	if (format === "emoji" && random() < 0.1) others.push("see [ note");
	const chunks =
		day === null && target.startsWith("[[")
			? [description, target, tail, ...others, ...extras]
			: random() < 0.5
				? [description, ...others, ...extras, target, tail]
				: [description, target, tail, ...others, ...extras];
	// Keep recurrence at the end: free prose after it becomes part of core's rule text.
	const ordered = [
		...chunks.filter((chunk) => !chunk.startsWith("🔁")),
		...chunks.filter((chunk) => chunk.startsWith("🔁")),
	];
	const line =
		prefix +
		ordered.filter(Boolean).join(" ") +
		(random() < 0.3 ? " ^block-1" : "") +
		pick(random, ["", " ", "  ", "   "]);
	return { line, field, day, newFieldStyle };
}

function proposedDateLine(
	line: string,
	field: DateField,
	day: string | null,
	style: NewDateStyle,
	candidate: Candidate | undefined,
): string {
	if (candidate) {
		if (day !== null) {
			const dateOffset = line.indexOf(candidate.value!, candidate.start);
			return line.slice(0, dateOffset) + day + line.slice(dateOffset + 10);
		}
		const bodyStart = line.indexOf("]") + 1;
		const leading = line.slice(bodyStart, candidate.start);
		if (leading.trim() === "") return line.slice(0, candidate.start) + line.slice(candidate.end).trimStart();
		return line.slice(0, candidate.start).trimEnd() + line.slice(candidate.end);
	}
	if (day === null) return line;
	const visible = line.replace(/%%.*?%%/g, "");
	const dataview =
		/[[(](?:due|scheduled|start|created|completion|cancelled|done|complete|unplanned|priority|repeat|onCompletion|id|dependsOn)::/u.test(
			visible,
		);
	const emoji = /📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌|🔁|🏁|🆔|⛔|🔺|⏫|🔼|🔽|⏬/u.test(visible);
	const format = dataview ? "dataview" : emoji ? "emoji" : style;
	const trimmed = line.trimEnd();
	const trailing = line.slice(trimmed.length);
	const block = / \^[a-zA-Z0-9-]+$/.exec(trimmed)?.[0] ?? "";
	const text = format === "dataview" ? `  [${field}:: ${day}]` : ` ${FIELD_SYMBOLS[field][0]} ${day}`;
	return trimmed.slice(0, trimmed.length - block.length) + text + block + trailing;
}

const collapsed = (value: string) => value.replace(/\s+/g, " ").trim();

function changedRegion(before: string, after: string) {
	const left = Array.from(before);
	const right = Array.from(after);
	let prefix = 0;
	while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < left.length - prefix &&
		suffix < right.length - prefix &&
		left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
	)
		suffix++;
	return [left.slice(prefix, left.length - suffix).join(""), right.slice(prefix, right.length - suffix).join("")];
}

function withoutTarget(text: string, field: DateField): string {
	const emoji = new RegExp(`(?:${FIELD_SYMBOLS[field].join("|")})️? *[0-9]{4}-[0-9]{2}-[0-9]{2}`, "gu");
	const inline = new RegExp(`\\[+\\s*${field}\\s*::[^\\]]*\\]+`, "g");
	return collapsed(text.replace(emoji, "").replace(inline, ""));
}

test("setTaskDate property: one contiguous change, every other field unchanged", (context) => {
	const random = mulberry32(DATE_SEED);
	const counts = { line: 0, unchanged: 0, refused: 0 };
	for (let index = 0; index < DATE_CASES; index++) {
		const { line, field, day, newFieldStyle } = dateCase(random, index);
		const message = `seed ${DATE_SEED}, case ${index}: ${JSON.stringify({ line, field, day, newFieldStyle })}`;
		const candidates = candidatesOf(line, field);
		const result = setTaskDate(line, field, day, Object.freeze({ newFieldStyle, moment }));
		counts[result.kind]++;
		if (result.kind === "unchanged") {
			assert.ok(
				(day === null && candidates.length === 0) ||
					(candidates.length === 1 && candidates[0].value?.slice(0, 10) === day),
				message,
			);
			continue;
		}
		if (result.kind === "refused") {
			if (candidates.length >= 2) assert.equal(result.reason, "date-ambiguous", message);
			else if (result.reason === "date-style-mixed") {
				assert.equal(candidates.length, 0, message);
				assert.notEqual(day, null, message);
				const visible = line.replace(/%%.*?%%/g, "");
				assert.match(
					visible,
					/[[(](?:due|scheduled|start|created|completion|cancelled|done|complete|unplanned|priority|repeat|onCompletion|id|dependsOn)::/u,
					message,
				);
				assert.match(visible, /📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌|🔁|🏁|🆔|⛔|🔺|⏫|🔼|🔽|⏬/u, message);
			} else {
				assert.equal(result.reason, "date-unreadable", message);
				if (candidates[0]?.value !== null) {
					const prospective = proposedDateLine(line, field, day, newFieldStyle, candidates[0]);
					const parsed = parseTaskLine(prospective, { moment });
					const original = parseTaskLine(line, { moment });
					const read = parsed?.dates[field];
					assert.ok(
						!parsed ||
							(read ? dayKey(read) : null) !== day ||
							(candidates.length === 0 && original?.dates[field] !== undefined),
						`${message}; unexplained refusal`,
					);
				}
			}
			continue;
		}
		assert.notEqual(result.line, line, message);
		assert.equal(
			result.line,
			proposedDateLine(line, field, day, newFieldStyle, candidates[0]),
			`${message}; exact edit`,
		);
		assert.ok(candidates.length <= 1 && (candidates.length === 0 || candidates[0].value !== null), message);
		const [removed, inserted] = changedRegion(line, result.line);
		const allowed = new Set(Array.from(`${FIELD_SYMBOLS[field].join("")}${field}[]()️:-0123456789T`));
		for (const character of removed + inserted)
			assert.ok(
				/\s/.test(character) || allowed.has(character),
				`${message}; changed ${JSON.stringify({ removed, inserted })}`,
			);
		const before = parseTaskLine(line, { moment });
		const after = parseTaskLine(result.line, { moment });
		assert.ok(before && after, message);
		assert.equal(after.dates[field] ? dayKey(after.dates[field]!) : null, day, message);
		for (const key of ["due", "scheduled", "start", "completion"] as const) {
			if (key !== field)
				assert.equal(after.dates[key]?.valueOf(), before.dates[key]?.valueOf(), `${message}; core ${key}`);
		}
		assert.equal(after.priority, before.priority, message);
		assert.equal(after.recurrence, before.recurrence, message);
		assert.deepEqual(after.tags, before.tags, message);
		assert.equal(after.statusMarker, before.statusMarker, message);
		// Core leaves an outer ] in visual for [[key:: value]]; deletion explicitly removes that target-owned bracket.
		const beforeVisual =
			day === null && candidates[0] && line.slice(candidates[0].start).startsWith("[[")
				? before.visual.replace("]", "")
				: before.visual;
		assert.equal(collapsed(after.visual), collapsed(beforeVisual), message);
		const format = candidates[0]?.format ?? (inserted.includes("::") ? "dataview" : "emoji");
		const tasksBefore = readTasksLine(line, format);
		const tasksAfter = readTasksLine(result.line, format);
		assert.ok(tasksBefore && tasksAfter, message);
		const targetKey = `${field}Date`;
		for (const key of [
			"indentation",
			"listMarker",
			"status",
			"blockLink",
			"priority",
			"startDate",
			"createdDate",
			"scheduledDate",
			"dueDate",
			"doneDate",
			"cancelledDate",
			"recurrenceRule",
			"onCompletion",
			"id",
			"dependsOn",
			"tags",
		] as const) {
			if (key !== targetKey) assert.deepEqual(tasksAfter[key], tasksBefore[key], `${message}; Tasks ${key}`);
		}
		const tasksDate =
			field === "due"
				? tasksBefore.dueDate
				: field === "scheduled"
					? tasksBefore.scheduledDate
					: tasksBefore.startDate;
		if (tasksDate !== null)
			assert.equal(
				collapsed(tasksAfter.description),
				collapsed(tasksBefore.description),
				`${message}; Tasks description`,
			);
		else
			assert.equal(
				withoutTarget(tasksAfter.description, field),
				withoutTarget(tasksBefore.description, field),
				`${message}; Tasks description`,
			);
	}
	assert.ok(counts.line >= DATE_CASES / 2, JSON.stringify(counts));
	assert.ok(counts.unchanged > 0 && counts.refused > 0, JSON.stringify(counts));
	context.diagnostic(`seed ${DATE_SEED}; ${DATE_CASES} cases: ${JSON.stringify(counts)}`);
});

test("write then undo property: undo restores the note byte for byte over the Tasks capture outputs", (context) => {
	const captured = [...loadTasksToggleFixtures().values()].flatMap((fixture) =>
		fixture.cases.map(({ api }) => ({ group: fixture.group, lines: api.split("\n") })),
	);
	const single = captured.filter(({ lines }) => lines.length === 1 && lines[0] !== "");
	const double = captured.filter(({ lines }) => lines.length === 2);
	const empty = captured.filter(({ lines }) => lines.length === 1 && lines[0] === "");
	assert.ok(single.length && double.length && empty.length, "the capture needs one-line, two-line and empty outputs");
	const random = mulberry32(UNDO_SEED);
	const kinds = new Set<string>();
	const groups = new Set<string>();
	const failures: string[] = [];
	for (let index = 0; index < UNDO_CASES; index++) {
		const before = noteFor(random, index);
		const rows = before.split("\n");
		// The note owns its leading BOM; task writers receive the first line without that envelope.
		const taskLines = rows
			.map((row, line) => ({
				line,
				sourceLine: line === 0 ? lineOfText(before, line)!.replace(/^\ufeff/, "") : lineOfText(before, line)!,
			}))
			.filter((target) => isTaskLine(target.sourceLine));
		const target = taskLines.length ? pick(random, taskLines) : { line: 0, sourceLine: lineOfText(before, 0)! };
		const sampled = [pick(random, single), pick(random, double), pick(random, empty)];
		for (const output of sampled) groups.add(output.group);
		// Tasks never returns zero lines, so the deletion shape stays a stand-in.
		const outputs: (readonly string[])[] = [[], ...sampled.map(({ lines }) => lines)];
		if (isTaskLine(target.sourceLine)) {
			const toggle = toggleTaskLine(target.sourceLine, "2026-10-24");
			if (toggle.kind === "lines") {
				outputs.push(toggle.lines);
				kinds.add("toggle");
			}
			const date = setTaskDate(target.sourceLine, pick(random, DATE_FIELDS), index % 2 ? "2026-10-26" : null, {
				newFieldStyle: index % 2 ? "emoji" : "dataview",
				moment,
			});
			if (date.kind === "line") {
				outputs.push([date.line]);
				kinds.add("date");
			} else if (date.kind === "unchanged") outputs.push([target.sourceLine.replace(/^\ufeff/, "")]);
		}
		for (const written of outputs) {
			kinds.add(written.length === 1 && written[0] === "" ? "empty" : String(written.length));
			const result = replaceTaskLine(before, Object.freeze(target), Object.freeze(written));
			const message = `seed ${UNDO_SEED}, case ${index}: ${JSON.stringify({ before, target, written })}`;
			assert.equal(result.kind, "replaced", message);
			if (result.kind !== "replaced") continue;
			const undo = undoSpanFor(before, target.line, written);
			const restored = replaceSpan(result.content, undo.span, [undo.original]);
			if (restored.kind !== "replaced" || restored.content !== before)
				failures.push(`${message}; result ${JSON.stringify(restored)}`);
		}
	}
	assert.deepEqual([...kinds].sort(), ["0", "1", "2", "date", "empty", "toggle"]);
	assert.deepEqual([...groups].sort(), [...TASKS_TOGGLE_GROUPS].sort());
	context.diagnostic(`seed ${UNDO_SEED}; ${UNDO_CASES} notes; ${failures.length} failures`);
	assert.equal(failures.length, 0, failures.slice(0, 10).join("\n"));
});
