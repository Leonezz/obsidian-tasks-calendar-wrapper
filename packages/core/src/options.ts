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
export function copyJsonValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(copyJsonValue) as T;
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJsonValue(item)])) as T;
    }
    return value;
}

/**
 * Freezes a value and every array and plain object in it, so code that receives it cannot change it. Dates are left
 * as they are: a frozen moment can still be changed through its methods, so dates are typed DateValue instead.
 */
export function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== "object" || !isPlainContainer(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}

function isPlainContainer(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}
