/** A tag is hidden by an entry that names it, or by one of its parent tags, e.g. #work hides #work/admin. */
export function isTagHidden(tag: string, hiddenTags: readonly string[]): boolean {
    return hiddenTags.some(hidden => tag === hidden || tag.startsWith(hidden + "/"));
}
