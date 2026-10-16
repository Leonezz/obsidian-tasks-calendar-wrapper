/**
 * Builds the plugin options from the defaults and the options saved in data.json. Keys missing from the
 * saved options take the default. Every array and object in the result is a new copy, so editing the
 * options never changes the defaults. A shallow merge shared them, and the next load then merged
 * against the edited defaults.
 * @param saved The parsed data.json, or nothing when the plugin has not saved its options yet.
 */
export function mergeOptions<T extends object>(defaults: T, saved: Partial<T> | null | undefined): T {
    return copyJsonValue({ ...defaults, ...saved });
}

/** Copies a value that can be stored in data.json, with new arrays and objects at every level. */
function copyJsonValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(copyJsonValue) as T;
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJsonValue(item)])) as T;
    }
    return value;
}
