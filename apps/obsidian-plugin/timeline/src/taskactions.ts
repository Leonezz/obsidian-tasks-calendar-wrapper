import type { UserOption } from "../../src/useroptions";

/** The row menu (step 10) hides its date and cancel items when this is false. */
export function changesInPlace(options: UserOption): boolean {
	return !options.openNoteInsteadOfInPlace;
}
