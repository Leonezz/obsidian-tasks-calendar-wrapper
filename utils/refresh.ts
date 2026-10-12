import type { CachedMetadata } from "obsidian";

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
    if (paths.some(path => filesWithTasks.has(path))) return true;
    return cache?.listItems?.some(item => item.task !== undefined) ?? false;
}
