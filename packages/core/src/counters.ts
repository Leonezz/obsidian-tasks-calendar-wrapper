/**
 * The class that applies the active counter. A counter either filters the timeline to its tasks
 * ("todoFilter") or highlights them ("todoFocus"). The active filter is stored as "todoFilter",
 * "overdueFilter" or "unplannedFilter", the same values the "Activate Filter On Load" setting saves.
 * Joining it with the behaviour gave "todoFilter Focus", so Focus hid the other tasks like Filter.
 */
export function counterClass(filter: string, behavior: string): string {
    if (filter.length === 0) return "";
    return filter.replace(/Filter$/, "") + behavior;
}
