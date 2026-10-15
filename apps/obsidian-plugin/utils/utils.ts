import { moment } from "./moment";
import type { Moment } from "moment";

/**
 * Describes a date relative to today, e.g. "Tomorrow" or "in 2 days", in the language
 * the app is set to.
 *
 * Both sides are compared by day. Comparing the exact moments made every date two or more
 * days away read as "in a day" from midday onwards, see issue #108.
 */
export function relativeDate(date: Moment, now: Moment = moment()): string {
    const day = date.clone().startOf("day");
    const today = now.clone().startOf("day");
    const days = day.diff(today, "days");
    const text = relativeDays(days, moment.locale()) ?? day.from(today);
    // Today, tomorrow and yesterday stand on their own, so they read better capitalized.
    return Math.abs(days) <= 1 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Uses the platform formatter, which names the nearby days instead of counting them. */
function relativeDays(days: number, locale: string): string | undefined {
    try {
        return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
    } catch (error) {
        console.warn(`Tasks Calendar Wrapper: no relative date format for locale ${locale}`, error);
        return undefined;
    }
}

type EditorCheckCallback = (checking: boolean, editor: unknown, view: unknown) => boolean | void;
type EditorCommand = { editorCheckCallback?: EditorCheckCallback };

/**
 * Looks up an editor command of the Tasks plugin. When the plugin is disabled or missing the
 * command is absent, which used to end in an uncaught TypeError with nothing shown to the user.
 */
export function tasksPluginCommand(
    commands: Record<string, EditorCommand>,
    commandId: string,
): Required<EditorCommand> {
    const command = commands[commandId];
    if (!command?.editorCheckCallback) throw new Error(`the Tasks plugin is not enabled, so ${commandId} is not available`);
    // The command object itself is returned, so the callback is still called as its method.
    return command as Required<EditorCommand>;
}

/** A tag is hidden by an entry that names it, or by one of its parent tags, e.g. #work hides #work/admin. */
export function isTagHidden(tag: string, hiddenTags: string[]): boolean {
    return hiddenTags.some(hidden => tag === hidden || tag.startsWith(hidden + "/"));
}

