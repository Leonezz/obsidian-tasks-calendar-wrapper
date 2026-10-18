/**
 * The one module in core that calls moment. core never imports moment as a value: the plugin passes in
 * Obsidian's instance, whose locale follows the app language, and the tests pass the npm one. Every call
 * core makes on it is one of the functions below, so the moment surface in use fits on one screen.
 *
 * Elsewhere in core a date is a DateValue, which can be read but not changed. This is also the only file
 * allowed to cast a DateValue back to a Moment.
 */
import type { Moment, MomentInput } from "moment";
import { getFileTitle } from "./paths";

/**
 * The moment function. `typeof moment` satisfies it, so Obsidian's instance is passed as is. The input is
 * required: moment() without one reads the clock, and core gets the current time passed in instead.
 */
export interface MomentFactory {
    (input: Exclude<MomentInput, null | undefined | void>, format?: string, strict?: boolean): Moment;
    /** The global locale, which moments created from now on are written in. */
    locale(): string;
}

/**
 * A moment that can only be read. The methods that change a moment, such as add, startOf or year(n),
 * are not part of it, so calling them is a compile error. `clone()` gives a moment of one's own to change.
 */
export interface DateValue {
    format(format?: string): string;
    valueOf(): number;
    year(): number;
    month(): number;
    date(): number;
    hours(): number;
    minutes(): number;
    isValid(): boolean;
    clone(): Moment;
    from(other: Moment): string;
}

/** A calendar day as "YYYY-MM-DD", always in ASCII digits. */
export type DayKey = string;

/** Dates by name, in the order they were first written, e.g. [unplanned:: ] fields. Frozen. */
export type DateEntries = readonly (readonly [key: string, date: DateValue])[];

const pad = (value: number, length: number) => String(value).padStart(length, "0");

/**
 * The key of the day a date falls on. It is built from the numbers rather than with format(), which
 * writes the locale's own digits in Arabic, Persian, Hindi and other locales; a year cannot be read
 * back from those.
 */
export function dayKey(date: DateValue): DayKey {
    const year = date.year();
    const yearText = year < 0 ? "-" + pad(-year, 4) : pad(year, 4);
    return `${yearText}-${pad(date.month() + 1, 2)}-${pad(date.date(), 2)}`;
}

const dayKeyPattern = /^(-?\d{4,})-\d\d-\d\d$/;

/** The year a day key names, read from the key without parsing it. */
export function yearOfDay(key: DayKey): number {
    const match = dayKeyPattern.exec(key);
    if (!match) throw new Error(`"${key}" is not a day key; day keys are written as YYYY-MM-DD`);
    return Number(match[1]);
}

/**
 * Sorts days ("YYYY-MM-DD") or years in the order the timeline shows them:
 * from the earliest, or from the latest with the newest first option (issue #54).
 */
export function inDisplayOrder<T extends string | number>(values: Iterable<T>, newestFirst: boolean): T[] {
    const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return newestFirst ? sorted.reverse() : sorted;
}

/** The start of the day a key names. Labels formatted from it use the locale's own digits again. */
export function dateOfDay(m: MomentFactory, key: DayKey): Moment {
    const date = m(key, "YYYY-MM-DD", true);
    if (!date.isValid()) throw new Error(`"${key}" is not a day key; day keys are written as YYYY-MM-DD`);
    return date;
}

/** A date written in exactly the given format, or undefined if it is not a real day, e.g. 2024-02-31. */
export function parseStrictDate(m: MomentFactory, text: string, format: string): Moment | undefined {
    const date = m(text, format, true);
    return date.isValid() ? date : undefined;
}

/**
 * A date in any form moment() reads, such as the value of a dataview field. Text that is not ISO falls
 * back to the engine's Date parser, which logs moment's deprecation warning.
 */
export function parseLooseDate(m: MomentFactory, text: string): Moment | undefined {
    const date = m(text);
    return date.isValid() ? date : undefined;
}

/**
 * The part of a note's path that a daily note format describes. A format with folders, such as
 * YYYY/MMM/Wo/ddd, covers that many trailing path segments; comparing only the file name meant
 * such notes were never recognised, see issue #95.
 */
function dailyNoteName(path: string, dailyNoteFormat: string): string {
    const segments = dailyNoteFormat.split("/").length;
    if (segments === 1) return getFileTitle(path);
    return path.replace(/\.md$/i, "").split("/").slice(-segments).join("/");
}

/** The date of the daily note at a path, or undefined if the path does not match the daily note format. */
export function parseDailyNoteName(m: MomentFactory, path: string, dailyNoteFormat: string): Moment | undefined {
    const name = dailyNoteName(path, dailyNoteFormat);
    return parseStrictDate(m, name, dailyNoteFormat) ?? dailyNoteDateByLookup(m, name, dailyNoteFormat);
}

/** Daily note names of one year, keyed by locale, format and year. */
const dailyNoteNameIndex = new Map<string, Map<string, Moment>>();

/**
 * Some formats, such as YYYY/MMM/Wo/ddd, can be written by moment but not read back, because a
 * week number and a weekday do not parse into a date. For those, the names of every day in the
 * years mentioned in the name are generated once and looked up.
 */
function dailyNoteDateByLookup(m: MomentFactory, name: string, dailyNoteFormat: string): Moment | undefined {
    const years = new Set((name.match(/\d{4}/g) ?? []).map(Number).filter(year => year >= 1900 && year <= 2200));
    for (const year of years) {
        const key = `${m.locale()}|${dailyNoteFormat}|${year}`;
        let index = dailyNoteNameIndex.get(key);
        if (!index) {
            index = new Map();
            for (const day = m({ year, month: 0, date: 1 }); day.year() === year; day.add(1, "day")) {
                index.set(day.format(dailyNoteFormat), day.clone());
            }
            dailyNoteNameIndex.set(key, index);
        }
        const date = index.get(name);
        if (date) return date.clone();
    }
    return undefined;
}

/**
 * Writes a 24-hour time at the start of a task's text in the 12-hour clock, e.g. "14:00 call" becomes
 * "2:00 pm call", in the words and digits of the locale. Text that does not start with one is returned as is.
 */
export function convert24HourPrefix(m: MomentFactory, text: string): string {
    if (text.length < 5) return text;
    const time = m(text.substring(0, 5), "HH:mm", true);
    if (!time.isValid()) return text;
    return time.format("h:mm a") + text.substring(5);
}

/**
 * Describes a date relative to now, e.g. "Tomorrow" or "in 2 days", in the given locale.
 *
 * Both sides are compared by day. Comparing the exact moments made every date two or more
 * days away read as "in a day" from midday onwards, see issue #108.
 */
export function relativeDate(date: DateValue, now: DateValue, locale: string, warn: (message: string, error: unknown) => void): string {
    const day = date.clone().startOf("day");
    const today = now.clone().startOf("day");
    const days = day.diff(today, "days");
    const text = relativeDays(days, locale, warn) ?? day.from(today);
    // Today, tomorrow and yesterday stand on their own, so they read better capitalized.
    return Math.abs(days) <= 1 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Uses the platform formatter, which names the nearby days instead of counting them. */
function relativeDays(days: number, locale: string, warn: (message: string, error: unknown) => void): string | undefined {
    try {
        return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
    } catch (error) {
        warn(`Tasks Calendar Wrapper: no relative date format for locale ${locale}`, error);
        return undefined;
    }
}

const asMoment = (date: DateValue) => date as unknown as Moment;

/** Whether two dates fall on the same calendar day. */
export function sameDay(a: DateValue, b: DateValue): boolean {
    return asMoment(a).isSame(asMoment(b), "day");
}

/** Whether a falls on an earlier calendar day than b. */
export function beforeDay(a: DateValue, b: DateValue): boolean {
    return asMoment(a).isBefore(asMoment(b), "day");
}

/** Whether two dates fall in the same calendar year. */
export function sameYear(a: DateValue, b: DateValue): boolean {
    return asMoment(a).isSame(asMoment(b), "year");
}

/** Whether a is a later instant than b. */
export function afterInstant(a: DateValue, b: DateValue): boolean {
    return asMoment(a).isAfter(asMoment(b));
}

/** Whether a date falls on a day after `from` and before `to`, both days left out. */
export function betweenDaysExclusive(date: DateValue, from: DateValue, to: DateValue): boolean {
    return asMoment(date).isBetween(asMoment(from), asMoment(to), "day");
}
