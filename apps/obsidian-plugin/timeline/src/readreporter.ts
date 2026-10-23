import type { ContentId } from "../../utils/contentid";
import { tellFailures, warningLine } from "./taskadapter";
import type { IndexUpdate, WarnedNote } from "./taskindex";

/**
 * What one timeline tells of its reloads, so it does not say the same again on every reload:
 * - a warning line once for the same text of the same note, for as long as the timeline is open: a note read again,
 *   filtered out and back in, unreadable for a while, or edited and the edit undone says nothing new for a text it was
 *   told for. A line is told again for another text of the note, and under its new path after a rename, as the line
 *   names the path. The last TEXTS_PER_NOTE texts of each note are remembered;
 * - the reasons of the notes that cannot be read on every reload, as before, on the console;
 * - the Notice "N file(s) could not be read" only when the set of those notes changed since its last report, and is
 *   not empty: when one starts failing, another one fails instead, or one of several heals.
 * A report is made for each update that succeeded; a rejected one changes nothing. Each timeline has its own, so a
 * timeline opened later tells of what fails already, as with an index of its own.
 */
export interface ReadReporter {
	report(update: Pick<IndexUpdate, "warned" | "failures">): void;
}

/** How many texts of a note a reporter remembers the told lines of, so a note edited very often costs no more. */
export const TEXTS_PER_NOTE = 16;

/** What was told of one note. */
interface Told {
	/** The WarnedNote last reported: a note kept by the index gives the same object, told already. */
	readonly note: WarnedNote;
	/** The lines told for each text, the most recent text last. */
	readonly texts: ReadonlyMap<ContentId, ReadonlySet<string>>;
}

/** A reporter that has told nothing: its first report tells what reportNoteReads tells. */
export function createReadReporter(): ReadReporter {
	/** By path, every note told of while the timeline is open. Changed in place, one entry per warned note. */
	const told = new Map<string, Told>();
	let failing: readonly string[] = [];
	return Object.freeze({
		report({ warned, failures }: Pick<IndexUpdate, "warned" | "failures">): void {
			for (const note of warned) told.set(note.path, tell(note, told.get(note.path)));
			const paths = failures.map((failure) => failure.path);
			const changed = paths.length !== failing.length || paths.some((path, i) => path !== failing[i]);
			failing = paths;
			tellFailures(failures, changed);
		},
	});
}

/** Logs the note's lines not told yet for its text, and returns what is told of the note now. */
function tell(note: WarnedNote, before: Told | undefined): Told {
	if (before?.note === note) return before;
	const toldBefore = before?.texts.get(note.content) ?? new Set<string>();
	const lines = new Set(toldBefore);
	// Checked against what was told before this report, so a line a note has twice is told twice the first time.
	for (const warning of note.warnings) {
		const line = warningLine(warning);
		if (!toldBefore.has(line)) console.warn(line);
		lines.add(line);
	}
	const texts = new Map(before?.texts);
	texts.delete(note.content);
	texts.set(note.content, lines);
	for (const oldest of texts.keys()) {
		if (texts.size <= TEXTS_PER_NOTE) break;
		texts.delete(oldest);
	}
	return Object.freeze({ note, texts });
}
