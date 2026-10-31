import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { setTaskDate, toggleTaskLine, type DateField, type NewDateStyle, type SetDateResult } from "../src/writeline";
import { readTasksLine } from "./support/tasksreader";

import {
	checkEncoding,
	checkReplacement,
	countsOn,
	dateTokens,
	decodeUtf8Strict,
	findImpossibleDate,
	findRevert,
	isRealDay,
	isTaskLine,
	lineOfText,
	lostWrites,
	recurrenceMarkers,
	replaceSpan,
	replaceTaskLine,
	taskLineCounts,
	undoSpanFor,
	type Neighbours,
	type ReplaceResult,
	type WriteCounts,
} from "../src/write";

const OPEN = "- [ ] x";
const DONE = "- [x] x";
const NEXT = "- [ ] r 🔁 every day 📅 2026-10-26";
const FINISHED = "- [x] r 🔁 every day 📅 2026-10-25 ✅ 2026-10-25";
const RECURRING = "- [ ] r 🔁 every day 📅 2026-10-25";

function contentOf(result: ReplaceResult): string {
	assert.equal(result.kind, "replaced");
	assert.ok(result.kind === "replaced");
	return result.content;
}

function undoRoundTrip(before: string, line: number, written: readonly string[]): void {
	const sourceLine = lineOfText(before, line);
	assert.notEqual(sourceLine, null);
	const after = contentOf(replaceTaskLine(before, { line, sourceLine: sourceLine! }, written));
	const undo = undoSpanFor(before, line, written);
	assert.equal(contentOf(replaceSpan(after, undo.span, [undo.original])), before);
}

test("lineOfText reads LF lines", () => {
	assert.equal(lineOfText("a\nb\nc", 0), "a");
	assert.equal(lineOfText("a\nb\nc", 1), "b");
	assert.equal(lineOfText("a\nb\nc", 2), "c");
	assert.equal(lineOfText("\uFEFFa\nb", 0), "\uFEFFa");
});

test("lineOfText strips one CR of CRLF lines", () => {
	assert.equal(lineOfText("a\r\nb\r\nc\r", 1), "b");
	assert.equal(lineOfText("a\r\nb\r\nc\r", 2), "c");
	assert.equal(lineOfText("a\r\r\nb", 0), "a\r");
});

test("lineOfText returns null out of range", () => {
	for (const line of [-1, 2, 1.5, NaN, Infinity]) {
		assert.equal(lineOfText("a\nb", line), null);
	}
});

test("lineOfText sees the empty line after a final newline", () => {
	assert.equal(lineOfText("a\n", 1), "");
	assert.equal(lineOfText("", 0), "");
});

test("replaceTaskLine keeps CRLF", () => {
	assert.deepEqual(replaceTaskLine("a\r\n- [ ] x\r\nb", { line: 1, sourceLine: OPEN }, [DONE]), {
		kind: "replaced",
		content: "a\r\n- [x] x\r\nb",
		delta: 0,
	});
});

test("replaceTaskLine handles a BOM and a task on line 0", () => {
	for (const sourceLine of ["\uFEFF" + OPEN, OPEN]) {
		assert.equal(
			contentOf(replaceTaskLine("\uFEFF" + OPEN + "\nb", { line: 0, sourceLine }, [DONE])),
			"\uFEFF" + DONE + "\nb",
		);
	}
});

test("replaceTaskLine gives a last line without ending two lines", () => {
	assert.equal(
		contentOf(replaceTaskLine("a\r\n" + RECURRING, { line: 1, sourceLine: RECURRING }, [NEXT, FINISHED])),
		"a\r\n" + NEXT + "\r\n" + FINISHED,
	);
	assert.equal(
		contentOf(replaceTaskLine(RECURRING, { line: 0, sourceLine: RECURRING }, [NEXT, FINISHED])),
		NEXT + "\n" + FINISHED,
	);
});

test("replaceTaskLine treats a U+FEFF not at the start as an ordinary character", () => {
	const before = "a\n\uFEFF" + OPEN;
	assert.deepEqual(replaceTaskLine(before, { line: 1, sourceLine: OPEN }, [DONE]), {
		kind: "mismatch",
		reason: "line-changed",
	});
	assert.equal(contentOf(replaceTaskLine(before, { line: 1, sourceLine: "\uFEFF" + OPEN }, [DONE])), "a\n" + DONE);
});

test("replaceTaskLine refuses a changed line and an out-of-range line", () => {
	assert.deepEqual(replaceTaskLine(OPEN, { line: 0, sourceLine: DONE }, [DONE]), {
		kind: "mismatch",
		reason: "line-changed",
	});
	for (const line of [-1, 1, 1.5, NaN, Infinity]) {
		assert.deepEqual(replaceTaskLine(OPEN, { line, sourceLine: OPEN }, [DONE]), {
			kind: "mismatch",
			reason: "out-of-range",
		});
	}
});

test("replaceTaskLine deletes a line, and leaves an empty last line", () => {
	assert.deepEqual(replaceTaskLine("a\n" + OPEN + "\nb", { line: 1, sourceLine: OPEN }, []), {
		kind: "replaced",
		content: "a\nb",
		delta: -1,
	});
	assert.deepEqual(replaceTaskLine("a\n" + OPEN, { line: 1, sourceLine: OPEN }, []), {
		kind: "replaced",
		content: "a\n",
		delta: -1,
	});
	assert.equal(contentOf(replaceTaskLine(OPEN, { line: 0, sourceLine: OPEN }, [])), "");
});

test("undo puts back two lines as one", () => {
	for (const before of [RECURRING, "a\n" + RECURRING, "a\n" + RECURRING + "\nb", "\uFEFF" + RECURRING + "\n"]) {
		undoRoundTrip(before, before.startsWith("a\n") ? 1 : 0, [NEXT, FINISHED]);
	}
	undoRoundTrip("\uFEFF" + OPEN + "\nb", 0, [DONE]);
});

test("undo puts back two lines as one with CRLF", () => {
	undoRoundTrip("a\r\n" + RECURRING + "\r\nb", 1, [NEXT, FINISHED]);
	undoRoundTrip("a\r\n" + RECURRING, 1, [NEXT, FINISHED]);
});

test("undo puts back a deleted middle line", () => {
	undoRoundTrip("a\n" + OPEN + "\nb", 1, []);
	undoRoundTrip("a\r\n" + OPEN + "\r\nb", 1, []);
	const undo = undoSpanFor("a\r\n" + OPEN + "\nb", 1, []);
	assert.deepEqual(undo, { original: OPEN, span: { line: 1, expected: [], above: "a", below: "b", eol: "\n" } });
	undoRoundTrip("a\r\n" + OPEN + "\nb", 1, []);
});

test("undo puts back a deleted first line", () => {
	undoRoundTrip(OPEN + "\nb", 0, []);
	undoRoundTrip("\uFEFF" + OPEN + "\r\nb", 0, []);
});

test("undo puts back a deleted last line", () => {
	for (const before of ["a\n" + OPEN + "\n", "a\n" + OPEN, "a\r\n" + OPEN + "\r\n", "a\r\n" + OPEN]) {
		undoRoundTrip(before, 1, []);
	}
	for (const before of [OPEN, OPEN + "\n", "\uFEFF" + OPEN]) undoRoundTrip(before, 0, []);
	assert.deepEqual(undoSpanFor("a\n" + OPEN, 1, []), {
		original: OPEN,
		span: { line: 1, expected: [""], above: "a", below: null, eol: "" },
	});
});

test("undo refuses when a neighbour changed", () => {
	const undo = undoSpanFor("a\n" + OPEN + "\nb", 1, []);
	for (const current of ["changed\nb", "a\nchanged"]) {
		assert.deepEqual(replaceSpan(current, undo.span, [undo.original]), {
			kind: "mismatch",
			reason: "neighbour-changed",
		});
	}
	const first = undoSpanFor(OPEN + "\nb", 0, []);
	assert.deepEqual(replaceSpan("other\nb", first.span, [first.original]), {
		kind: "mismatch",
		reason: "neighbour-changed",
	});
	const last = undoSpanFor("a\n" + OPEN, 1, []);
	assert.deepEqual(replaceSpan("a\n\nother", last.span, [last.original]), {
		kind: "mismatch",
		reason: "neighbour-changed",
	});
});

test("undo refuses when the written line was edited", () => {
	const undo = undoSpanFor(OPEN, 0, [DONE]);
	assert.deepEqual(replaceSpan("- [x] edited", undo.span, [undo.original]), {
		kind: "mismatch",
		reason: "line-changed",
	});
});

test("undo refuses out of range", () => {
	const undo = undoSpanFor("a\n" + OPEN, 1, [DONE]);
	assert.deepEqual(replaceSpan("a", undo.span, [undo.original]), { kind: "mismatch", reason: "out-of-range" });
	for (const line of [-1, 1, 1.5, NaN, Infinity]) assert.throws(() => undoSpanFor(OPEN, line, [DONE]), RangeError);
});

test("undo puts back a deleted first line before a U+FEFF that began the next line", () => {
	for (const before of ["- [ ] a\n﻿inside", "﻿- [ ] a\n﻿inside", "﻿- [ ] a\ninside"]) {
		const deleted = replaceTaskLine(before, { line: 0, sourceLine: "- [ ] a" }, []);
		const undo = undoSpanFor(before, 0, []);
		assert.equal(contentOf(replaceSpan(contentOf(deleted), undo.span, [undo.original])), before);
	}
});

test("replaceSpan checks full spans and insertion neighbours", () => {
	assert.equal(
		contentOf(replaceSpan("a\r\nb\nc\r\nd", { line: 1, expected: ["b", "c"] }, ["one", "two", "three"])),
		"a\r\none\r\ntwo\r\nthree\r\nd",
	);
	assert.equal(
		contentOf(replaceSpan("a\r\nb\nc", { line: 1, expected: ["b", "c"] }, ["one", "two"])),
		"a\r\none\r\ntwo",
	);
	assert.equal(
		contentOf(replaceSpan("a\nb", { line: 1, expected: [], above: "a", below: "b", eol: "\r\n" }, ["inserted"])),
		"a\ninserted\r\nb",
	);
	assert.deepEqual(replaceSpan("a\nb", { line: 1, expected: ["b", "c"] }, []), {
		kind: "mismatch",
		reason: "out-of-range",
	});
	assert.deepEqual(replaceSpan("a\nb", { line: 0, expected: ["a", "changed"] }, []), {
		kind: "mismatch",
		reason: "line-changed",
	});
	assert.deepEqual(replaceSpan("a\nb", { line: 2, expected: [] }, ["c"]), {
		kind: "mismatch",
		reason: "out-of-range",
	});
	assert.throws(() => replaceSpan("a\nb", { line: 1, expected: ["b"] }, ["one\ntwo"]), Error);
});

test("isTaskLine follows Tasks' list markers", () => {
	for (const line of ["- - [ ] foo", "1. - [ ] foo"]) assert.equal(isTaskLine(line), false);
	for (const line of ["  > - [ ] foo", "1) [ ] foo", "+ [ ] foo", "* [x] foo", "12. [ ] foo"])
		assert.equal(isTaskLine(line), true);
});

test("isRealDay knows months and leap years", () => {
	for (const value of [
		"2026-02-29",
		"1900-02-29",
		"2026-13-01",
		"2026-00-10",
		"2026-04-31",
		"2026-1-01",
		"٢٠٢٦-١٠-٢٥",
		"2026-01-00",
		"2026-01-32",
		"2026-01-01T00:00",
	])
		assert.equal(isRealDay(value), false, value);
	for (const value of ["2024-02-29", "2000-02-29", "2026-01-31", "2026-04-30", "0000-02-29"])
		assert.equal(isRealDay(value), true, value);
	for (const value of ["2026-10-25\n", "2026-10-25\r\n"])
		assert.equal(isRealDay(value), false, JSON.stringify(value));
});

test("findImpossibleDate names the field and value", () => {
	assert.deepEqual(findImpossibleDate("- [ ] a 📅 2026-02-30"), { field: "📅", value: "2026-02-30" });
	assert.deepEqual(findImpossibleDate("- [ ] a [due:: 2026-02-31]"), { field: "due", value: "2026-02-31" });
	assert.deepEqual(findImpossibleDate("- [ ] a (start:: 2026-04-31T14:30) 📅 2026-02-30"), {
		field: "start",
		value: "2026-04-31T14:30",
	});
	assert.equal(findImpossibleDate("- [ ] a 📅 2024-02-29 ✅ 2026-10-25"), null);
	assert.equal(findImpossibleDate("- [ ] a 📅 calendar [due:: 2026-02-30junk]"), null);
});

test("dateTokens returns values and UTF-16 offsets in line order", () => {
	const line = "😀 [ due :: 2026-10-25 ] 🗓️ 2026-10-26 14:30:59 (cancelled:: 2026-10-27T09:15) ✅";
	const values = ["2026-10-25", "2026-10-26 14:30:59", "2026-10-27T09:15", ""];
	const tokens = dateTokens(line);
	assert.deepEqual(
		tokens.map(({ symbol, value }) => ({ symbol, value })),
		[
			{ symbol: "due", value: values[0] },
			{ symbol: "🗓", value: values[1] },
			{ symbol: "cancelled", value: values[2] },
			{ symbol: "✅", value: "" },
		],
	);
	for (const token of tokens) {
		assert.equal(line.slice(token.start, token.end), token.value);
		assert.equal(token.start, token.value ? line.indexOf(token.value) : line.length);
	}
	for (const symbol of ["➕", "🛫", "⏳", "⌛", "📅", "📆", "🗓", "✅", "❌"]) {
		assert.deepEqual(
			dateTokens(symbol + "️2026-10-25").map(({ symbol, value }) => ({ symbol, value })),
			[{ symbol, value: "2026-10-25" }],
		);
	}
	assert.deepEqual(
		dateTokens("[other:: x] (due:: )").map(({ symbol, value }) => ({ symbol, value })),
		[{ symbol: "due", value: "" }],
	);
});

test("checkReplacement refuses invalid dates in English, Spanish and Portuguese", () => {
	for (const [value, token] of [
		["Invalid date", "Invalid"],
		["Fecha inválida", "Fecha"],
		["Data inválida", "Data"],
	]) {
		assert.deepEqual(checkReplacement("- [ ] a 📅 2026-10-25", ["- [x] a 📅 " + value], "inplace"), {
			ok: false,
			reason: "unreadable-date",
			token,
			localDigits: false,
		});
	}
});

test("checkReplacement refuses Arabic and Persian digits", () => {
	for (const token of ["٢٠٢٦-١٠-٢٥", "۲۰۲۶-۱۰-۲۵"])
		assert.deepEqual(checkReplacement(OPEN, [DONE + " 📅 " + token], "inplace"), {
			ok: false,
			reason: "unreadable-date",
			token,
			localDigits: true,
		});
});

test("checkReplacement refuses local digits after 🗓️", () => {
	assert.deepEqual(checkReplacement(OPEN, [DONE + " 🗓️ ٢٠٢٦-١٠-٢٥"], "inplace"), {
		ok: false,
		reason: "unreadable-date",
		token: "٢٠٢٦-١٠-٢٥",
		localDigits: true,
	});
});

test("checkReplacement accepts real ASCII days, 📅 calendar in a description, and an untouched impossible date", () => {
	assert.deepEqual(checkReplacement(OPEN, [DONE + " 📅 2024-02-29"], "inplace"), {
		ok: true,
		unchanged: false,
		recurrenceRemoved: false,
	});
	for (const suffix of [" 📅 calendar", " 📅 2026-02-30"])
		assert.deepEqual(checkReplacement(OPEN + suffix, [DONE + suffix], "inplace"), {
			ok: true,
			unchanged: false,
			recurrenceRemoved: false,
		});
});

test("checkReplacement compares each line of a recurring task's output with the original", () => {
	assert.deepEqual(checkReplacement(RECURRING, [NEXT, FINISHED], "inplace"), {
		ok: true,
		unchanged: false,
		recurrenceRemoved: false,
	});
	assert.equal(
		checkReplacement(RECURRING + " 📅 calendar", [NEXT + " 📅 calendar", FINISHED + " 📅 calendar"], "inplace").ok,
		true,
	);
});

test("checkReplacement refuses a new unreadable token", () => {
	assert.deepEqual(checkReplacement(OPEN + " 📅 2026-02-30", [DONE + " 📅 2026-02-30 ⏳ 2026-02-31"], "inplace"), {
		ok: false,
		reason: "unreadable-date",
		token: "2026-02-31",
		localDigits: false,
	});
	assert.deepEqual(checkReplacement(OPEN + " 📅 calendar", [DONE + " 📅 calendar ⏳ calendar"], "inplace"), {
		ok: false,
		reason: "unreadable-date",
		token: "calendar",
		localDigits: false,
	});
});

test("checkReplacement counts 🔁 markers", () => {
	assert.equal(recurrenceMarkers("🔁 🔁️ [repeat:: every day] (RePeAt:: weekly)"), 4);
	for (const marker of ["🔁 every day", "🔁️ every day", "[repeat:: every day]"]) {
		const source = OPEN + " " + marker;
		assert.deepEqual(checkReplacement(source, [DONE], "inplace"), { ok: false, reason: "recurrence-lost" });
		assert.deepEqual(checkReplacement(source, [DONE], "edit"), {
			ok: true,
			unchanged: false,
			recurrenceRemoved: true,
		});
		assert.deepEqual(checkReplacement(source, [], "inplace"), {
			ok: true,
			unchanged: false,
			recurrenceRemoved: false,
		});
	}
	assert.deepEqual(checkReplacement(RECURRING, [NEXT, DONE], "inplace"), { ok: false, reason: "recurrence-lost" });
});

test("checkReplacement refuses bad output", () => {
	for (const lines of [
		[DONE, DONE, DONE],
		[DONE + "\r"],
		[DONE + "\n" + OPEN],
		["not a task"],
		["- - [ ] foo"],
		["1. - [ ] foo"],
	])
		assert.deepEqual(checkReplacement(OPEN, lines, "inplace"), { ok: false, reason: "bad-output" });
	assert.deepEqual(checkReplacement("  > " + OPEN, [DONE], "inplace"), { ok: false, reason: "bad-output" });
	assert.deepEqual(checkReplacement("  > " + OPEN, ["  " + DONE], "inplace"), { ok: false, reason: "bad-output" });
});

test("checkReplacement accepts Tasks list markers", () => {
	for (const source of ["  > - [ ] foo", "1) [ ] foo"])
		assert.deepEqual(checkReplacement(source, [source.replace("[ ]", "[x]")], "inplace"), {
			ok: true,
			unchanged: false,
			recurrenceRemoved: false,
		});
});

test("checkReplacement reads values with a time", () => {
	for (const value of ["2026-10-26T14:30", "2026-10-26T14:30:59", "2026-10-26 14:30", "2026-10-26 14:30:59"]) {
		for (const field of ["📅 " + value, "[due:: " + value + "]", "(start:: " + value + ")"])
			assert.equal(checkReplacement(OPEN, [DONE + " " + field], "inplace").ok, true, field);
	}
	for (const value of ["2026-10-26T24:00", "2026-10-26T14:60", "2026-10-26T14:30:60", "2026-10-26 24:00"])
		assert.deepEqual(checkReplacement(OPEN, [DONE + " 📅 " + value], "inplace"), {
			ok: false,
			reason: "unreadable-date",
			token: value,
			localDigits: false,
		});
});

test("checkReplacement reports unchanged", () => {
	assert.deepEqual(checkReplacement(OPEN, [OPEN], "inplace"), {
		ok: true,
		unchanged: true,
		recurrenceRemoved: false,
	});
	assert.deepEqual(checkReplacement(OPEN, [], "edit"), { ok: true, unchanged: false, recurrenceRemoved: false });
	assert.equal(checkReplacement(OPEN, [OPEN, OPEN], "inplace").ok, true);
});

test("taskLineCounts counts lines wherever they are", () => {
	assert.deepEqual(taskLineCounts("a\n" + OPEN + "\nb\n" + OPEN), taskLineCounts(OPEN + "\na\n" + OPEN + "\nb"));
	assert.equal(taskLineCounts(OPEN + "\n" + OPEN).get(OPEN), 2);
	assert.deepEqual(taskLineCounts("\uFEFFa\r\n" + OPEN + "\r\nb"), taskLineCounts("a\n" + OPEN + "\nb"));
	assert.deepEqual(
		taskLineCounts("a\nb", ["a", "missing"]),
		new Map([
			["a", 1],
			["missing", 0],
		]),
	);
	assert.deepEqual(countsOn(taskLineCounts("a\na\nb"), ["b", "missing", "a"]), [1, 0, 2]);
	assert.deepEqual(taskLineCounts(""), new Map([["", 1]]));
});

const A = "- [ ] A";
const B = "- [x] B";
const C = "- [ ] C";
const D = "- [x] D";
const KEYS = [A, B, C, D];
const counts = taskLineCounts;
const noAdjacency = new Map<number, Neighbours>();

test("findRevert finds the latest matching snapshot", () => {
	assert.equal(
		findRevert(
			B,
			[counts(D)],
			[counts(A), counts(B), counts(B), counts(C), counts(C), counts(D)],
			KEYS,
			noAdjacency,
		),
		2,
	);
	assert.equal(
		findRevert(
			C,
			[counts(D)],
			[counts(A), counts(C), counts(C), counts(B), counts(B), counts(C)],
			KEYS,
			noAdjacency,
		),
		5,
	);
	assert.equal(
		findRevert(
			B,
			[counts(D)],
			[counts(A), counts(B), counts(B), counts(C)],
			KEYS,
			new Map([[2, { above: "missing", below: null }]]),
		),
		1,
	);
});

test("findRevert returns null when the note is as expected", () => {
	assert.equal(findRevert(B, [counts(B)], [counts(A), counts(B)], KEYS, noAdjacency), null);
	assert.equal(
		findRevert(
			A,
			[counts(A)],
			[counts(A), counts(B), counts(B), counts(C), counts(C), counts(A)],
			KEYS,
			noAdjacency,
		),
		null,
	);
	assert.equal(findRevert(A + "\nnew unrelated line", [counts(A)], [counts(A), counts(B)], KEYS, noAdjacency), null);
});

test("findRevert returns null when no snapshot matches", () => {
	assert.equal(findRevert(C, [counts(B)], [counts(A), counts(B)], KEYS, noAdjacency), null);
});

test("findRevert needs a 🏁 deletion's neighbours to be adjacent", () => {
	const before = "above\n" + OPEN + "\nbelow";
	const after = "above\nbelow";
	const adjacency = new Map([[1, { above: "above", below: "below" }]]);
	assert.equal(findRevert(after, [counts(before)], [counts(before), counts(after)], [OPEN], adjacency), 1);
	assert.equal(
		findRevert("above\ninserted\nbelow", [counts(before)], [counts(before), counts(after)], [OPEN], adjacency),
		null,
	);
	const undoAdjacency = new Map([[0, { above: "above", below: "below" }]]);
	assert.equal(findRevert(after, [counts(before)], [counts(after), counts(before)], [OPEN], undoAdjacency), 0);
	assert.equal(
		findRevert("above\ninserted\nbelow", [counts(before)], [counts(after), counts(before)], [OPEN], undoAdjacency),
		null,
	);
	assert.equal(
		findRevert(
			"\uFEFF",
			[counts(OPEN)],
			[counts(OPEN), counts("")],
			[OPEN],
			new Map([[1, { above: null, below: null }]]),
		),
		1,
	);
	assert.equal(
		findRevert(
			"\n",
			[counts(OPEN)],
			[counts(OPEN), counts("")],
			[OPEN],
			new Map([[1, { above: null, below: null }]]),
		),
		null,
	);
	assert.equal(
		findRevert(
			"below",
			[counts(OPEN)],
			[counts(OPEN), counts("below")],
			[OPEN],
			new Map([[1, { above: null, below: "below" }]]),
		),
		1,
	);
	assert.equal(
		findRevert(
			"above",
			[counts(OPEN)],
			[counts(OPEN), counts("above")],
			[OPEN],
			new Map([[1, { above: "above", below: null }]]),
		),
		1,
	);
});

test("findRevert finds a revert on a BOM note's line 0 and does not misreport it", () => {
	const before = "\uFEFF" + OPEN + "\r\nb";
	const after = "\uFEFF" + DONE + "\r\nb";
	const snapshots = [counts(before), counts(after)];
	assert.equal(findRevert(after, [counts(after)], snapshots, [OPEN, DONE], noAdjacency), null);
	assert.equal(findRevert(before, [counts(after)], snapshots, [OPEN, DONE], noAdjacency), 0);
});

test("findRevert handles a recurring task's two lines", () => {
	const after = NEXT + "\n" + FINISHED;
	const keys = [RECURRING, NEXT, FINISHED];
	assert.equal(findRevert(RECURRING, [counts(after)], [counts(RECURRING), counts(after)], keys, noAdjacency), 0);
	assert.equal(
		findRevert(FINISHED + "\n" + NEXT, [counts(after)], [counts(RECURRING), counts(after)], keys, noAdjacency),
		null,
	);
	assert.equal(findRevert(NEXT, [counts(after)], [counts(RECURRING), counts(after)], keys, noAdjacency), null);
});

function write(id: number, before: string, after: string, extra: Partial<WriteCounts> = {}): WriteCounts {
	return { id, before: counts(before), after: counts(after), outcome: "written", reported: false, ...extra };
}

test("lostWrites drops a write and its own Undo", () => {
	const writes = [write(1, A, B), write(2, B, C), write(3, C, D, { undoOf: 1 })];
	assert.deepEqual(lostWrites(writes, 0, KEYS), [writes[1]]);
	assert.deepEqual(lostWrites([writes[0], write(4, B, B, { undoOf: 1, outcome: "already-undone" })], 0, KEYS), []);
});

test("lostWrites drops a run that ends where it started", () => {
	assert.deepEqual(lostWrites([write(1, A, B), write(2, B, C), write(3, C, A)], 0, KEYS), []);
	const writes = [write(1, A, B), write(2, B, A), write(3, A, C), write(4, C, A), write(5, A, D)];
	assert.deepEqual(lostWrites(writes, 0, KEYS), [writes[4]]);
	const disconnected = [write(1, A, B), write(2, C, A), write(3, D, C), write(4, C, A), write(5, A, D)];
	assert.deepEqual(lostWrites(disconnected, 0, KEYS), [disconnected[4]]);
});

test("lostWrites drops reported and unknown writes", () => {
	const writes = [write(1, A, B, { reported: true }), write(2, B, C, { outcome: "unknown" }), write(3, C, D)];
	assert.deepEqual(lostWrites(writes, 0, KEYS), [writes[2]]);
	assert.deepEqual(lostWrites([write(1, A, B, { outcome: "unknown" }), write(2, B, A)], 0, KEYS), []);
});

test("lostWrites starts after a matched T and at a matched P", () => {
	const writes = [write(1, A, B), write(2, B, C), write(3, C, D)];
	assert.deepEqual(lostWrites(writes, 0, KEYS), writes);
	assert.deepEqual(lostWrites(writes, 1, KEYS), writes.slice(1));
	assert.deepEqual(lostWrites(writes, 2, KEYS), writes.slice(1));
	assert.deepEqual(lostWrites(writes, 3, KEYS), writes.slice(2));
	assert.deepEqual(lostWrites(writes, 5, KEYS), []);
});

test("lostWrites drops unchanged and already-undone records (P = T)", () => {
	const writes = [
		write(1, A, A, { outcome: "unchanged" }),
		write(2, A, B),
		write(3, B, B, { outcome: "already-undone", undoOf: 99 }),
	];
	assert.deepEqual(lostWrites(writes, 0, KEYS), [writes[1]]);
});

test("decodeUtf8Strict refuses Latin-1, Shift-JIS, GBK, CESU-8, overlong and truncated bytes", () => {
	for (const bytes of [
		[0x63, 0x61, 0x66, 0xe9],
		[0x93, 0xfa, 0x96, 0x7b],
		[0xd6, 0xd0, 0xce, 0xc4],
		[0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80],
		[0xc0, 0xaf],
		[0xe6, 0x97],
	])
		assert.equal(decodeUtf8Strict(new Uint8Array(bytes)), null);
});

test("decodeUtf8Strict keeps a BOM and a real U+FFFD", () => {
	assert.equal(decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), "\uFEFFa");
	assert.equal(decodeUtf8Strict(new Uint8Array([0xef, 0xbf, 0xbd])), "\uFFFD");
	assert.equal(decodeUtf8Strict(new Uint8Array([0xf0, 0x9f, 0x98, 0x80])), "😀");
	assert.equal(decodeUtf8Strict(new Uint8Array()), "");
});

test("checkEncoding asks for the bytes only when U+FFFD is present", () => {
	assert.deepEqual(checkEncoding("plain text", null), { kind: "ok" });
	assert.deepEqual(checkEncoding("\uFEFF中文\r\n", null), { kind: "ok" });
	assert.deepEqual(checkEncoding("a\uFFFDb", null), { kind: "verify-bytes" });
	assert.deepEqual(checkEncoding("a\uFFFDb", "a\uFFFDb"), { kind: "ok" });
});

test("checkEncoding compares with the verified text ignoring a BOM and CRLF", () => {
	assert.deepEqual(checkEncoding("\uFEFFa\r\nb", "a\nb"), { kind: "ok" });
	assert.deepEqual(checkEncoding("a\nb", "\uFEFFa\r\nb"), { kind: "ok" });
	assert.deepEqual(checkEncoding("a\nb", "a\nc"), { kind: "changed" });
	assert.deepEqual(checkEncoding("a\n\uFEFFb", "a\nb"), { kind: "changed" });
	assert.deepEqual(checkEncoding("a\r", "a"), { kind: "changed" });
});

const TOGGLE_TODAY = "2026-10-24";
const DATE_DAY = "2026-10-26";

function toggles(pairs: readonly (readonly [string, string])[]): void {
	for (const [line, expected] of pairs) {
		assert.deepEqual(toggleTaskLine(line, TOGGLE_TODAY), { kind: "lines", lines: [expected] }, line);
	}
}

function setDate(
	line: string,
	field: DateField,
	day: string | null,
	newFieldStyle: NewDateStyle = "emoji",
): SetDateResult {
	return setTaskDate(line, field, day, Object.freeze({ newFieldStyle, moment }));
}

test("toggleTaskLine completes and uncompletes as Tasks does", () => {
	toggles([
		["- [ ] a ✅ 2025-01-01", "- [x] a ✅ 2026-10-24"],
		["- [x] a ❌ 2025-01-01 ✅ 2025-01-02", "- [ ] a"],
		["- [-] a ❌ 2025-01-01", "- [ ] a"],
		["- [X] done ✅ 2025-03-01", "- [x] done ✅ 2026-10-24"],
		["- [/] a", "- [x] a ✅ 2026-10-24"],
		["- [ ] Pay 📅 2026-10-25 ⏫ #home", "- [x] Pay #home ⏫ 📅 2026-10-25 ✅ 2026-10-24"],
	]);
});

test("toggleTaskLine refuses to complete a recurring task", () => {
	for (const line of ["- [ ] a 🔁️ every day", "- [ ] a [repeat:: every day]", "- [X] a RePeAt:: weekly"]) {
		assert.deepEqual(toggleTaskLine(line, TOGGLE_TODAY), { kind: "refused", reason: "recurring-needs-tasks" });
	}
});

test("toggleTaskLine uncompletes a recurring task without touching its rule", () => {
	toggles([
		["- [x] a 🔁 every day ✅ 2026-10-01", "- [ ] a 🔁 every day"],
		["  > +   [x]  ✅️2026-10-01 a 🔁️ every  2 days! ❌ 2025-01-01 ^r  ", "  > +   [ ]  a 🔁️ every  2 days! ^r  "],
		["- [x] a 🔁 every day %% ✅ 2025-01-01 %% ✅ 2026-10-01", "- [ ] a 🔁 every day %% ✅ 2025-01-01 %%"],
		["- [-] a 🔁 every day ❌ 2026-10-01", "- [ ] a 🔁 every day"],
	]);
});

test("toggleTaskLine changes dataview-field lines minimally", () => {
	toggles([
		["- [ ] a [due:: 2026-10-25]", "- [x] a [due:: 2026-10-25]  [completion:: 2026-10-24]"],
		["- [ ] a (due:: 2026-10-25)", "- [x] a (due:: 2026-10-25)  [completion:: 2026-10-24]"],
		["- [x] a [due:: 2026-10-25] [completion:: 2026-10-01]", "- [ ] a [due:: 2026-10-25]"],
		["- [-] a [cancelled:: 2026-10-01]", "- [ ] a"],
		["- [ ] a [due:: 2026-10-25] ^id  ", "- [x] a [due:: 2026-10-25]  [completion:: 2026-10-24] ^id  "],
		[
			"- [X] a [completion:: 2025-03-01] (cancelled:: 2025-03-02) ✅ 2025-03-01",
			"- [x] a ✅ 2025-03-01  [completion:: 2026-10-24]",
		],
		[
			"12)   [x] a [repeat:: every  day] (completion:: 2026-10-01) [completion:: later] %% [completion:: old] %%",
			"12)   [ ] a [repeat:: every  day] %% [completion:: old] %%",
		],
	]);
});

test("toggleTaskLine drops an unreadable 🏁 value as Tasks 8.6.0 does", () => {
	// Derived from Tasks 8.6.0: parseOnCompletionValue gives Ignore, which is not written.
	// Step 6b's capture from Tasks itself will confirm this output.
	toggles([["- [ ] a 🏁 archive", "- [x] a ✅ 2026-10-24"]]);
});

test("toggleTaskLine deletes a 🏁 delete task when completing it", () => {
	assert.deepEqual(toggleTaskLine("- [ ] a 🏁 delete", TOGGLE_TODAY), { kind: "lines", lines: [] });
	assert.deepEqual(toggleTaskLine("- [X] a 🏁 DELETE", TOGGLE_TODAY), { kind: "lines", lines: [] });
	toggles([["- [x] a 🏁 delete ✅ 2026-10-01", "- [ ] a 🏁 delete"]]);
});

test("toggleTaskLine keeps a hard break and the block link, and reads fields only from the end", () => {
	toggles([
		["- [ ] a ^abc  ", "- [x] a ✅ 2026-10-24 ^abc  "],
		["- [ ] Pay 📅 2026-10-25 call bob", "- [x] Pay 📅 2026-10-25 call bob ✅ 2026-10-24"],
		["- [ ] a 📅 2026-10-01 📅 2026-10-02", "- [x] a 📅 2026-10-01 ✅ 2026-10-24"],
		["- [ ] a 🗓️ 2026-10-25", "- [x] a 📅 2026-10-25 ✅ 2026-10-24"],
		[
			"  > 12)   [/] a 📆️2026-10-25 ⌛️2026-10-23 🛫️2026-10-22 ➕️2026-10-01 🏁️ KEEP ⏫️ ⛔️ b, c 🆔️ task-1 #home ^abc   ",
			"  > 12) [x] a #home 🆔 task-1 ⛔ b,c ⏫ 🏁 keep ➕ 2026-10-01 🛫 2026-10-22 ⏳ 2026-10-23 📅 2026-10-25 ✅ 2026-10-24 ^abc   ",
		],
		["- [ ] a ", "- [x] a ✅ 2026-10-24"],
	]);
});

test("toggleTaskLine throws for impossible dates and non-task lines", () => {
	for (const line of ["- [ ] a 📅 2026-02-30", "- [ ] a [due:: 2026-02-31]"])
		assert.throws(() => toggleTaskLine(line, TOGGLE_TODAY), RangeError);
	for (const today of ["2026-02-30", "2026-1-1", "٢٠٢٦-١٠-٢٤"])
		assert.throws(() => toggleTaskLine("- [ ] a", today), RangeError);
	for (const line of ["- - [ ] foo", "- [ ] a\n", "- [ ] a\r"])
		assert.throws(() => toggleTaskLine(line, TOGGLE_TODAY), TypeError);
});

test("setTaskDate follows the example table", () => {
	const rows: readonly [string, DateField, string | null, SetDateResult, readonly NewDateStyle[]][] = [
		[
			"- [ ] Pay 📅 2026-10-25 #home",
			"due",
			DATE_DAY,
			{ kind: "line", line: "- [ ] Pay 📅 2026-10-26 #home" },
			["emoji", "dataview"],
		],
		[
			"- [ ] Pay 🗓️ 2026-10-25",
			"due",
			DATE_DAY,
			{ kind: "line", line: "- [ ] Pay 🗓️ 2026-10-26" },
			["emoji", "dataview"],
		],
		[
			"- [ ] Pay [due:: 2026-10-25T14:30]",
			"due",
			DATE_DAY,
			{ kind: "line", line: "- [ ] Pay [due:: 2026-10-26T14:30]" },
			["emoji", "dataview"],
		],
		[
			"- [ ] Pay 📅 2026-10-25 call bob",
			"scheduled",
			"2026-10-20",
			{ kind: "line", line: "- [ ] Pay 📅 2026-10-25 call bob ⏳ 2026-10-20" },
			["emoji", "dataview"],
		],
		[
			"- [ ] Pay 📅 2026-10-25 ^abc  ",
			"start",
			"2026-10-20",
			{ kind: "line", line: "- [ ] Pay 📅 2026-10-25 🛫 2026-10-20 ^abc  " },
			["emoji", "dataview"],
		],
		[
			"- [ ] Pay [due:: 2026-10-25]",
			"start",
			"2026-10-20",
			{ kind: "line", line: "- [ ] Pay [due:: 2026-10-25]  [start:: 2026-10-20]" },
			["emoji", "dataview"],
		],
		["- [ ] Pay", "due", DATE_DAY, { kind: "line", line: "- [ ] Pay  [due:: 2026-10-26]" }, ["dataview"]],
		["- [ ] 📅 2026-10-25 Pay", "due", null, { kind: "line", line: "- [ ] Pay" }, ["emoji", "dataview"]],
		[
			"- [ ] emoji due and dataview due 📅 2026-01-25 [due:: 2026-01-26]",
			"due",
			DATE_DAY,
			{ kind: "refused", reason: "date-ambiguous" },
			["emoji", "dataview"],
		],
		[
			"- [ ] parenthesis field (due:: 2026-01-20)",
			"due",
			DATE_DAY,
			{ kind: "refused", reason: "date-unreadable" },
			["emoji", "dataview"],
		],
		[
			"- [ ] a 📅 2026-10-25 [scheduled:: 2026-10-24]",
			"start",
			DATE_DAY,
			{ kind: "refused", reason: "date-style-mixed" },
			["emoji", "dataview"],
		],
	];
	for (const [line, field, day, expected, styles] of rows) {
		for (const style of styles) assert.deepEqual(setDate(line, field, day, style), expected, `${style}: ${line}`);
	}
});

test("setTaskDate deletes [[due:: ]] without a stray bracket", () => {
	assert.deepEqual(setDate("- [ ] double brackets [[due:: 2026-01-21]]", "due", null), {
		kind: "line",
		line: "- [ ] double brackets",
	});
});

test("setTaskDate fixes an impossible dataview date", () => {
	assert.deepEqual(setDate("- [ ] invalid field date [due:: 2026-02-31]", "due", "2026-02-28"), {
		kind: "line",
		line: "- [ ] invalid field date [due:: 2026-02-28]",
	});
	assert.deepEqual(setDate("- [ ] a 📅 2026-02-30", "due", "2026-03-01"), {
		kind: "line",
		line: "- [ ] a 📅 2026-03-01",
	});
});

test("setTaskDate refuses when core would not read the result", () => {
	for (const line of ["- [ ] see [ note [due:: 2026-10-25]", "- [ ] a 📅 ⏫ 2026-10-25"])
		assert.deepEqual(setDate(line, "due", DATE_DAY), { kind: "refused", reason: "date-unreadable" });
});

test("setTaskDate keeps a trailing comment in front of the new field", () => {
	assert.deepEqual(setDate("- [ ] a %% note %%", "due", DATE_DAY), {
		kind: "line",
		line: "- [ ] a %% note %% 📅 2026-10-26",
	});
});

test("setTaskDate ignores dates inside comments", () => {
	assert.deepEqual(setDate("- [ ] a %% 📅 2026-10-25 %%", "due", DATE_DAY), {
		kind: "line",
		line: "- [ ] a %% 📅 2026-10-25 %% 📅 2026-10-26",
	});
	assert.deepEqual(setDate("- [ ] a %% [due:: 2026-10-25] %%", "due", DATE_DAY), {
		kind: "line",
		line: "- [ ] a %% [due:: 2026-10-25] %% 📅 2026-10-26",
	});
});

test("setTaskDate returns unchanged for the same day and for deleting a missing field", () => {
	for (const line of ["- [ ] a 📅 2026-10-26", "- [ ] a [due:: 2026-10-26T14:30:59]"])
		assert.deepEqual(setDate(line, "due", DATE_DAY), { kind: "unchanged" });
	assert.deepEqual(setDate("- [ ] a", "due", null), { kind: "unchanged" });
});

test("setTaskDate throws for bad input", () => {
	for (const line of ["not a task", "- - [ ] a", "- [ ] a\n", "- [ ] a\r"])
		assert.throws(() => setDate(line, "due", DATE_DAY), TypeError);
	for (const day of ["2026-02-30", "2026-1-1", "٢٠٢٦-١٠-٢٦"])
		assert.throws(() => setDate("- [ ] a", "due", day), RangeError);
});

test("setTaskDate preserves formatting and handles ambiguous or unreadable fields", () => {
	assert.deepEqual(setDate("  > 2.  [/]  Pay  [ due :: 2026-10-25 14:30:59 ] ^id\t ", "due", DATE_DAY), {
		kind: "line",
		line: "  > 2.  [/]  Pay  [ due :: 2026-10-26 14:30:59 ] ^id\t ",
	});
	assert.deepEqual(setDate("- [ ] a [[[due:: 2026-10-25]]] after", "due", null), {
		kind: "line",
		line: "- [ ] a after",
	});
	for (const line of [
		"- [ ] a [due:: tomorrow]",
		"- [ ] a [due:: ]",
		"- [ ] a [due:: %% hidden %%]",
		"- [ ] a ( due :: 2026-10-25)",
	])
		assert.deepEqual(setDate(line, "due", DATE_DAY), { kind: "refused", reason: "date-unreadable" });
	for (const line of ["- [ ] a 📅 2026-10-25 🗓️2026-10-26", "- [ ] a [due:: tomorrow] (due:: 2026-10-25)"])
		assert.deepEqual(setDate(line, "due", DATE_DAY), { kind: "refused", reason: "date-ambiguous" });
});

test("tasksreader reads fields from the end only", () => {
	const read = readTasksLine("- [ ] Pay 📅 2026-10-25 ⏫ #home", "emoji");
	assert.ok(read);
	assert.equal(read.description, "Pay #home");
	assert.equal(read.priority, "high");
	assert.equal(read.dueDate, "2026-10-25");
	assert.deepEqual(read.tags, ["#home"]);
	assert.equal(readTasksLine("- [ ] Pay 📅 2026-10-25 call bob", "emoji")?.dueDate, null);
	assert.equal(readTasksLine("- [ ] a 📅 2026-10-01 📅 2026-10-02", "emoji")?.dueDate, "2026-10-01");
	const all = readTasksLine(
		"  > + [X] a 🆔 id ⛔ a, b 🔺 🏁 KEEP ➕ 2026-10-01 🛫 2026-10-02 ⌛ 2026-10-03 🗓️2026-10-04 ❌ 2026-10-05 ✅ 2026-10-06 ^abc  ",
		"emoji",
	);
	assert.ok(all);
	assert.deepEqual(
		[
			all.indentation,
			all.listMarker,
			all.status,
			all.blockLink,
			all.description,
			all.priority,
			all.onCompletion,
			all.id,
			all.dependsOn,
		],
		["  > ", "+", "X", " ^abc", "a", "highest", "keep", "id", ["a", "b"]],
	);
	assert.deepEqual(
		[all.createdDate, all.startDate, all.scheduledDate, all.dueDate, all.cancelledDate, all.doneDate],
		["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"],
	);
	assert.equal(readTasksLine("- [ ] a 🏁 archive", "emoji")?.onCompletion, "");
	assert.equal(readTasksLine("not a task", "emoji"), null);
});

test("tasksreader reads the dataview format", () => {
	const read = readTasksLine("- [ ] a [due:: 2026-10-25]  [priority:: high]", "dataview");
	assert.ok(read);
	assert.equal(read.description, "a");
	assert.equal(read.dueDate, "2026-10-25");
	assert.equal(read.priority, "high");
	assert.equal(readTasksLine("- [ ] a (due:: 2026-10-25)", "dataview")?.dueDate, "2026-10-25");
	assert.equal(readTasksLine("- [ ] a (due:: 2026-10-25)", "emoji")?.dueDate, null);
	const recurrence = readTasksLine(
		"- [ ] a [repeat:: every day] [onCompletion:: DELETE] [id:: own] (dependsOn:: a, b),",
		"dataview",
	);
	assert.ok(recurrence);
	assert.deepEqual(
		[recurrence.recurrenceRule, recurrence.onCompletion, recurrence.id, recurrence.dependsOn],
		["every day", "delete", "own", ["a", "b"]],
	);
	assert.equal(readTasksLine("- [ ] a [due:: 2026-10-25T14:30]", "dataview")?.dueDate, null);
});
