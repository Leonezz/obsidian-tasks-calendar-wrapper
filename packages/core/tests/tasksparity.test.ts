import { test } from "node:test";
import assert from "node:assert/strict";

import { findImpossibleDate, isRealDay, replaceTaskLine, tasksTaskLineRegex, type ReplaceResult } from "../src/write";
import { toggleTaskLine } from "../src/writeline";
import { readTasksLine, type TasksFormat } from "./support/tasksreader";
import {
	applyNoteDiff,
	loadTasksToggleFixtures,
	TASKS_TOGGLE_GROUPS,
	type TasksToggleCase,
	type TasksToggleFixture,
} from "./support/tasksfixtures";

function contentOf(result: ReplaceResult, message: string): string {
	assert.equal(result.kind, "replaced", message);
	assert.ok(result.kind === "replaced", message);
	return result.content;
}

function noteBefore(fixture: TasksToggleFixture, captured: TasksToggleCase): string {
	const before = fixture.notes[captured.path];
	assert.equal(typeof before, "string", `${fixture.group}: missing ${captured.path}`);
	return before;
}

function contextFor(fixture: TasksToggleFixture, captured: TasksToggleCase): string {
	return `${fixture.group}: ${captured.path}:${captured.line}: ${JSON.stringify(captured.sourceLine)}`;
}

function writtenLines(note: string, line: number, count: number): string[] {
	return note
		.split("\n")
		.slice(line, line + count)
		.map((text, index) => {
			const withoutCR = text.replace(/\r$/, "");
			// The note owns a leading BOM; neither the API nor the corpus's sourceLine contains it.
			return line + index === 0 ? withoutCR.replace(/^\ufeff/, "") : withoutCR;
		});
}

// Keep this selection identical to writeline.ts's dataviewField rule, including its removal of %% comments.
function hasDataviewField(line: string): boolean {
	return /[[(](?:due|scheduled|start|created|completion|cancelled|done|complete|unplanned|priority|repeat|onCompletion|id|dependsOn)::/u.test(
		line.replace(/%%[\s\S]*?%%/g, ""),
	);
}

function checkUntouchedBytes(before: string, after: string, line: number, lines: readonly string[], message: string) {
	const bom = before.startsWith("\ufeff") ? "\ufeff" : "";
	const raw = before.slice(bom.length).split("\n");
	const endingAt = (index: number) => (index < raw.length - 1 ? (raw[index].endsWith("\r") ? "\r\n" : "\n") : "");
	const ending = endingAt(line);
	const between = ending || (line > 0 ? endingAt(line - 1) : "\n");
	const prefix =
		bom +
		raw
			.slice(0, line)
			.map((row) => row + "\n")
			.join("");
	const suffix = raw.slice(line + 1).join("\n");
	const inserted = lines.map((text, index) => text + (index === lines.length - 1 ? ending : between)).join("");
	assert.equal(after, prefix + inserted + suffix, `${message}; bytes outside the rewritten line`);
}

test("the Tasks capture covers the corpus", () => {
	const fixtures = loadTasksToggleFixtures();
	assert.deepEqual([...fixtures.keys()], TASKS_TOGGLE_GROUPS);
	const baseline = fixtures.get("default")!;
	const identity = ({ path, line, sourceLine }: TasksToggleCase) => ({ path, line, sourceLine });
	const corpus = baseline.cases.map(identity);
	assert.ok(corpus.length >= 500);
	assert.ok(baseline.cases.filter((captured) => captured.recurring).length >= 120);
	assert.equal(new Set(corpus.map(({ path, line }) => JSON.stringify([path, line]))).size, corpus.length);
	for (const [group, fixture] of fixtures) {
		assert.equal(fixture.group, group);
		assert.equal(fixture.tasksVersion, "8.6.0", group);
		assert.equal(fixture.timeZone, "UTC", group);
		assert.ok(isRealDay(fixture.day), group);
		assert.equal(typeof fixture.momentLocale, "string", group);
		assert.ok(fixture.momentLocale.length > 0, group);
		assert.match(fixture.obsidianVersion, /^\d+\.\d+/, group);
		assert.deepEqual(fixture.cases.map(identity), corpus, group);
		assert.deepEqual(Object.keys(fixture.notes).sort(), [...new Set(corpus.map(({ path }) => path))].sort(), group);
		for (const captured of fixture.cases) {
			const message = contextFor(fixture, captured);
			const before = noteBefore(fixture, captured);
			assert.deepEqual(writtenLines(before, captured.line, 1), [captured.sourceLine], message);
			const after = applyNoteDiff(before, captured.after);
			if (captured.api === "") {
				// Tasks removes the following newline too, but empties an unterminated final line.
				const deleted = contentOf(replaceTaskLine(before, captured, []), message);
				assert.equal(after.replace(/\r\n/g, "\n"), deleted.replace(/\r\n/g, "\n"), message);
			} else {
				const apiLines = captured.api.split("\n");
				assert.ok(apiLines.length === 1 || apiLines.length === 2, message);
				assert.deepEqual(writtenLines(after, captured.line, apiLines.length), apiLines, message);
			}
		}
	}
});

test("toggleTaskLine matches Tasks byte for byte on the lines it rewrites with Tasks' defaults", (context) => {
	const fixture = loadTasksToggleFixtures().get("default")!;
	let compared = 0;
	let impossible = 0;
	let dataview = 0;
	for (const captured of fixture.cases) {
		if (captured.recurring) continue;
		const message = contextFor(fixture, captured);
		if (findImpossibleDate(captured.sourceLine)) {
			assert.throws(() => toggleTaskLine(captured.sourceLine, fixture.day), RangeError, message);
			impossible++;
			continue;
		}
		if (hasDataviewField(captured.sourceLine)) {
			dataview++;
			continue;
		}
		const toggled = toggleTaskLine(captured.sourceLine, fixture.day);
		assert.equal(toggled.kind, "lines", message);
		assert.ok(toggled.kind === "lines", message);
		assert.equal(toggled.lines.join("\n"), captured.api, message);
		const before = noteBefore(fixture, captured);
		const after = applyNoteDiff(before, captured.after);
		const result = contentOf(replaceTaskLine(before, captured, toggled.lines), message);
		// Capture evidence: Obsidian 1.14.5's editor save drops a leading BOM, so BOM notes compare like CRLF notes.
		if (captured.lineEnding === "lf" && !before.startsWith("﻿")) assert.equal(result, after, message);
		else {
			assert.deepEqual(
				writtenLines(result, captured.line, toggled.lines.length),
				writtenLines(after, captured.line, toggled.lines.length),
				message,
			);
			checkUntouchedBytes(before, result, captured.line, toggled.lines, message);
		}
		compared++;
	}
	assert.ok(compared > 0);
	assert.ok(impossible >= 1);
	assert.equal(compared + impossible + dataview, fixture.cases.filter((captured) => !captured.recurring).length);
	context.diagnostic(
		`${compared} compared; ${impossible} impossible dates; ${dataview} dataview lines checked separately`,
	);
});

// A bracket walk keeps the expectation independent of the writer's field-removal regular expression.
function withoutCompletionFields(body: string): string {
	let kept = "";
	let cursor = 0;
	for (let index = 0; index < body.length; index++) {
		if (body.startsWith("%%", index)) {
			const end = body.indexOf("%%", index + 2);
			if (end >= 0) {
				index = end + 1;
				continue;
			}
		}
		if (body[index] !== "[" && body[index] !== "(") continue;
		let keyStart = index + 1;
		if (body[index] === "[") while (body[keyStart] === "[") keyStart++;
		if (!body.startsWith("completion::", keyStart) && !body.startsWith("cancelled::", keyStart)) continue;
		let end = body.indexOf(body[index] === "[" ? "]" : ")", keyStart);
		if (end < 0) continue;
		end++;
		if (body[index] === "[") {
			for (let extra = 1; extra < keyStart - index && body[end] === "]"; extra++) end++;
		}
		let start = index;
		while (start > cursor && /\s/u.test(body[start - 1])) start--;
		kept += body.slice(cursor, start);
		cursor = end;
		index = end - 1;
	}
	return kept + body.slice(cursor);
}

function minimalDataviewToggle(line: string, day: string): string {
	const match = tasksTaskLineRegex.exec(line);
	assert.ok(match);
	const statusAt = line.indexOf("[", match[1].length + match[2].length) + 1;
	const next = match[3] === "x" || match[3] === "-" ? " " : "x";
	const body = withoutCompletionFields(line.slice(statusAt + match[3].length + 1));
	const insertion = / \^[a-zA-Z0-9-]+$/u.exec(body.trimEnd())?.index ?? body.trimEnd().length;
	const changed = next === "x" ? body.slice(0, insertion) + `  [completion:: ${day}]` + body.slice(insertion) : body;
	return line.slice(0, statusAt) + next + "]" + changed;
}

test("toggleTaskLine changes only the status and the completion and cancelled fields on [key:: ] lines", (context) => {
	const fixture = loadTasksToggleFixtures().get("default")!;
	let compared = 0;
	let impossible = 0;
	for (const captured of fixture.cases) {
		if (captured.recurring || !hasDataviewField(captured.sourceLine)) continue;
		const message = contextFor(fixture, captured);
		if (findImpossibleDate(captured.sourceLine)) {
			assert.throws(() => toggleTaskLine(captured.sourceLine, fixture.day), RangeError, message);
			impossible++;
			continue;
		}
		assert.deepEqual(
			toggleTaskLine(captured.sourceLine, fixture.day),
			{
				kind: "lines",
				lines: [minimalDataviewToggle(captured.sourceLine, fixture.day)],
			},
			message,
		);
		compared++;
	}
	assert.ok(compared > 0);
	context.diagnostic(`${compared} minimal dataview edits; ${impossible} impossible dates refused`);
});

const DATE_KEYS = ["dueDate", "scheduledDate", "startDate", "createdDate"] as const;
const DATE_SYMBOLS = { dueDate: "📅", scheduledDate: "⏳", startDate: "🛫", createdDate: "➕" } as const;

function invalidDateField(field: (typeof DATE_KEYS)[number], format: TasksFormat): string {
	return format === "dataview"
		? `[${field.replace("Date", "")}:: Invalid date]`
		: `${DATE_SYMBOLS[field]} Invalid date`;
}

// Tasks only checks the box of a line without the global filter, so it never rewrites that line's dates.
function readsAsTask(fixture: TasksToggleFixture, line: string): boolean {
	const filter = fixture.settings.globalFilter;
	return typeof filter !== "string" || filter === "" || line.includes(filter);
}

test("tasksreader reads the dates Tasks writes", (context) => {
	const fixtures = loadTasksToggleFixtures();
	let compared = 0;
	let impossible = 0;
	let recurring = 0;
	let deleted = 0;
	for (const fixture of fixtures.values()) {
		const format = fixture.group === "dataview" ? "dataview" : "emoji";
		for (const captured of fixture.cases) {
			if (captured.recurring) {
				recurring++;
				continue;
			}
			if (captured.api === "") {
				deleted++;
				continue;
			}
			const message = contextFor(fixture, captured);
			assert.equal(captured.api.split("\n").length, 1, message);
			const before = readTasksLine(captured.sourceLine, format);
			const after = readTasksLine(captured.api, format);
			assert.ok(before && after, message);
			// Capture evidence: Tasks 8.6.0 writes an impossible date as "Invalid date", which is why
			// toggleTaskLine refuses such lines with a RangeError instead (design question 7).
			const refused =
				findImpossibleDate(captured.sourceLine) !== null && readsAsTask(fixture, captured.sourceLine);
			let invalid = false;
			for (const field of DATE_KEYS) {
				const value: string | null = before[field];
				if (refused && value !== null && !isRealDay(value)) {
					assert.equal(after[field], null, `${message}; ${field}`);
					assert.ok(captured.api.includes(invalidDateField(field, format)), `${message}; ${field}`);
					invalid = true;
				} else assert.equal(after[field], value, `${message}; ${field}`);
			}
			if (invalid) impossible++;
			else compared++;
		}
	}
	assert.ok(compared >= 300);
	assert.ok(impossible >= 1);
	assert.equal(
		compared + impossible + recurring + deleted,
		[...fixtures.values()].reduce((sum, fixture) => sum + fixture.cases.length, 0),
	);
	context.diagnostic(
		`${compared} compared; ${impossible} written as Invalid date; ${recurring} recurring; ${deleted} deleted`,
	);
});

test("🏁 archive is dropped as Tasks drops it", () => {
	const fixture = loadTasksToggleFixtures().get("default")!;
	const captured = fixture.cases.find(({ sourceLine }) => sourceLine === "- [ ] a 🏁 archive");
	assert.ok(captured);
	const toggled = toggleTaskLine(captured.sourceLine, fixture.day);
	assert.ok(toggled.kind === "lines");
	assert.equal(captured.api, toggled.lines.join("\n"));
	assert.equal(captured.api, `- [x] a ✅ ${fixture.day}`);
});
