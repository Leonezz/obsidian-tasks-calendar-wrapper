import { type CachedMetadata, debounce, type Debouncer } from "obsidian";

/**
 * Whether a change to a file can change the timeline: the file has tasks now, or one of its paths
 * (the old one, for a rename) had tasks at the last reload. Rebuilding the timeline after a change to
 * any file froze Obsidian while typing in notes without tasks, see issue #63.
 * @param paths The file's path, and for a rename also its old path.
 * @param cache The file's metadata now, or nothing when the file was deleted or is not indexed yet.
 * @param filesWithTasks The paths that had tasks at the last reload.
 */
export function changeAffectsTasks(
	paths: string[],
	cache: CachedMetadata | null | undefined,
	filesWithTasks: ReadonlySet<string>,
): boolean {
	if (paths.some((path) => filesWithTasks.has(path))) return true;
	return cache?.listItems?.some((item) => item.task !== undefined) ?? false;
}

/** Settings that change within this time of each other reach the views together. */
export const OPTIONS_DELAY_MS = 200;

/**
 * Runs `apply` once the settings stop changing for OPTIONS_DELAY_MS. Text settings save on every
 * keystroke, and handing the options to a view re-renders and reloads the whole timeline, so typing
 * does that once per pause, while a toggle still shows almost at once, see issue #202.
 */
export function debounceOptionUpdates(apply: () => void): Debouncer<[], void> {
	return debounce(apply, OPTIONS_DELAY_MS, true);
}
