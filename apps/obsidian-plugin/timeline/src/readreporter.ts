import type { ContentId } from "../../utils/contentid";
import { tellFailures, warningLine } from "./taskadapter";
import type { IndexUpdate, WarnedNote } from "./taskindex";

/**
 * What one timeline tells of its reloads, so it does not say the same again on every reload:
 * - a warning line once for the same text of the same note: the note's lines are told again once its text changes (a
 *   new content id), and once it leaves the timeline's updates, removed, renamed, filtered out or without warnings, and
 *   comes back. A note that cannot be read keeps what was told, so it says nothing new when it heals with the same text;
 * - the reasons of the notes that cannot be read on every reload, as before, on the console;
 * - the Notice "N file(s) could not be read" only when the set of those notes changed since its last report, and is
 *   not empty: when one starts failing, another one fails instead, or one of several heals.
 * A report is made for each update that succeeded; a rejected one changes nothing. Each timeline has its own, so a
 * timeline opened later tells of what fails already, as with an index of its own.
 */
export interface ReadReporter {
	report(update: Pick<IndexUpdate, "warned" | "failures">): void;
}

/** What was told of one note's text. */
interface Told {
	/** The WarnedNote last reported: a note kept by the index gives the same object, told as it is. */
	readonly note: WarnedNote;
	readonly content: ContentId;
	readonly lines: ReadonlySet<string>;
}

/** A reporter that has told nothing: its first report tells what reportNoteReads tells. */
export function createReadReporter(): ReadReporter {
	let told: ReadonlyMap<string, Told> = new Map();
	let failing: readonly string[] = [];
	return Object.freeze({
		report({ warned, failures }: Pick<IndexUpdate, "warned" | "failures">): void {
			const next = new Map<string, Told>();
			for (const note of warned) next.set(note.path, tell(note, told.get(note.path)));
			// A note that cannot be read now keeps what was told of it.
			for (const { path } of failures) {
				const before = told.get(path);
				if (before && !next.has(path)) next.set(path, before);
			}
			told = next;
			const paths = failures.map((failure) => failure.path);
			const changed = paths.length !== failing.length || paths.some((path, i) => path !== failing[i]);
			failing = paths;
			tellFailures(failures, changed);
		},
	});
}

/** Logs the note's lines not told yet for its text, and returns what is told of it now. */
function tell(note: WarnedNote, before: Told | undefined): Told {
	if (before?.note === note) return before;
	const toldBefore = before?.content === note.content ? before.lines : new Set<string>();
	const lines = new Set(toldBefore);
	// Checked against what was told before this report, so a line a note has twice is told twice the first time.
	for (const warning of note.warnings) {
		const line = warningLine(warning);
		if (!toldBefore.has(line)) console.warn(line);
		lines.add(line);
	}
	return Object.freeze({ note, content: note.content, lines });
}
