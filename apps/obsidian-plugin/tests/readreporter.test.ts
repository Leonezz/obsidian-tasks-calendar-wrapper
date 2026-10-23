// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import type { ParseWarning } from "@tasks-calendar-wrapper/core";
import { createReadReporter } from "../timeline/src/readreporter";
import { reportNoteReads, type NoteReadFailure } from "../timeline/src/taskadapter";
import type { WarnedNote } from "../timeline/src/taskindex";
import { ourLines, shownNotices, telling } from "./indexed-vault";

// A timeline's ReadReporter: what it tells of each reload's warnings and failures, see readreporter.ts. The user's
// approved change: "N file(s) could not be read" only when the set of failing notes changes; a warning once for the
// same content of the same note.

const warning = (path: string, line: number, message: string): ParseWarning => Object.freeze({ path, line, message });
const warned = (path: string, content: number, ...warnings: ParseWarning[]): WarnedNote =>
	Object.freeze({ path, content, warnings: Object.freeze(warnings) });
const failure = (path: string): NoteReadFailure => Object.freeze({ path, reason: new Error(`could not read ${path}`) });

const DUE = warning("Dates.md", 1, 'could not read the date " soon" of [due:: ]');
const SCHEDULED = warning("Dates.md", 2, 'could not read the date " later" of [scheduled:: ]');
const OTHER = warning("Other.md", 0, 'could not read the date " never" of [due:: ]');

/** What one report tells, as telling() records it: our console lines, then the Notices. */
function reporting(t: TestContext) {
	const lines = ourLines(t);
	const reporter = createReadReporter();
	return {
		reporter,
		report: (notes: WarnedNote[], failures: NoteReadFailure[] = []) =>
			telling(lines, () => reporter.report({ warned: notes, failures })),
		lines,
	};
}

const warn = (w: ParseWarning) => ["warn", `Tasks Calendar Wrapper: ${w.path}, line ${w.line + 1}: ${w.message}`];
const error = (path: string) => ["error", "Tasks Calendar Wrapper: reading a file failed", failure(path).reason];
const notice = (count: number) => [
	"notice",
	`Tasks Calendar Wrapper: ${count} file(s) could not be read, their tasks are missing. See the developer console.`,
];

test("the first report tells what reportNoteReads tells, in its order: warnings, reasons, the Notice", async (t) => {
	const { report, lines } = reporting(t);
	const notes = [warned("Dates.md", 1, DUE, SCHEDULED, DUE), warned("Other.md", 2, OTHER)];
	const failures = [failure("A.md"), failure("B.md")];
	const told = await report(notes, failures);
	const reference = await telling(lines, () =>
		reportNoteReads(
			notes.flatMap((note) => note.warnings),
			failures,
		),
	);
	assert.deepEqual(told, reference);
	assert.deepEqual(told, [
		warn(DUE),
		warn(SCHEDULED),
		warn(DUE),
		warn(OTHER),
		error("A.md"),
		error("B.md"),
		notice(2),
	]);
});

test("the Notice shows when the set of failing notes changed and is not empty; the reasons on every report", async (t) => {
	shownNotices.length = 0;
	const { report } = reporting(t);
	const steps: [string[], unknown[][]][] = [
		[["A.md"], [error("A.md"), notice(1)]],
		[["A.md"], [error("A.md")]],
		[
			["A.md", "B.md"],
			[error("A.md"), error("B.md"), notice(2)],
		],
		[["A.md"], [error("A.md"), notice(1)]],
		[["B.md"], [error("B.md"), notice(1)]],
		[[], []],
		[[], []],
		[["B.md"], [error("B.md"), notice(1)]],
	];
	for (const [paths, expected] of steps)
		assert.deepEqual(await report([], paths.map(failure)), expected, JSON.stringify(paths));
});

test("a warning is told once for the same content of the same note, and again for new content", async (t) => {
	const { report } = reporting(t);
	assert.deepEqual(await report([warned("Dates.md", 1, DUE)]), [warn(DUE)]);
	assert.deepEqual(await report([warned("Dates.md", 1, DUE)]), [], "read again, the same text");
	assert.deepEqual(await report([warned("Dates.md", 2, DUE)]), [warn(DUE)], "a save: new text, the same line");
	// The same text with a line more, as after another locale: only the new line.
	assert.deepEqual(await report([warned("Dates.md", 2, DUE, SCHEDULED)]), [warn(SCHEDULED)]);
	assert.deepEqual(await report([warned("Dates.md", 2, DUE)]), [], "back to the first locale");
	assert.deepEqual(await report([warned("Dates.md", 1, DUE)]), [warn(DUE)], "the text edited back");
});

test("a note that leaves the updates is told again when it comes back; one that fails keeps what was told", async (t) => {
	const { report } = reporting(t);
	const dates = warned("Dates.md", 1, DUE);
	assert.deepEqual(await report([dates, warned("Other.md", 3, OTHER)]), [warn(DUE), warn(OTHER)]);
	// Other.md left: removed, filtered out, or without warnings now.
	assert.deepEqual(await report([dates]), []);
	assert.deepEqual(await report([dates, warned("Other.md", 3, OTHER)]), [warn(OTHER)]);
	// Dates.md cannot be read for a while, then reads with the same text: nothing new.
	assert.deepEqual(await report([], [failure("Dates.md")]), [error("Dates.md"), notice(1)]);
	assert.deepEqual(await report([warned("Dates.md", 1, DUE)]), []);
});

test("each reporter has its own memory, and reports change none of what they are given", async (t) => {
	const lines = ourLines(t);
	const a = createReadReporter();
	const b = createReadReporter();
	const notes = Object.freeze([warned("Dates.md", 1, DUE)]);
	const failures = Object.freeze([failure("A.md")]);
	const told = (reporter: typeof a) => telling(lines, () => reporter.report({ warned: notes, failures }));
	assert.deepEqual(await told(a), [warn(DUE), error("A.md"), notice(1)]);
	assert.deepEqual(await told(b), [warn(DUE), error("A.md"), notice(1)], "a timeline opened later");
	assert.deepEqual(await told(a), [error("A.md")]);
	assert.deepEqual(notes, [warned("Dates.md", 1, DUE)]);
});
