import { DateTime } from "luxon";
import { moment } from "obsidian";
import { innerDateFormat, TaskRegularExpressions } from "./tasks";

/**
 * Describes a date relative to today, e.g. "Tomorrow" or "in 2 days", in the language
 * the app is set to.
 *
 * Both sides are compared by day. Comparing the exact moments made every date two or more
 * days away read as "in a day" from midday onwards, see issue #108.
 */
export function relativeDate(date: moment.Moment, now: moment.Moment = moment()): string {
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

export function momentToDateTime(m: moment.Moment) {
    return DateTime.fromFormat(m.format(innerDateFormat), innerDateFormat);
}

export function DateTimeToMoment(d: DateTime){
    return d.toFormat(innerDateFormat);
}

export function removeHightlightMarker(text: string){
    const match = TaskRegularExpressions.highlightRegex.exec(text);
    while(match){
        text = text.replace(match[0], match[1]);
    }
    return text;
}
/**
 * @deprecated
 * @param momentFormat 
 * @returns 
 */
export function momentToRegex(momentFormat: string) : RegExp {
	momentFormat = momentFormat.replaceAll(".", "\\.");
	momentFormat = momentFormat.replaceAll(",", "\\,");
	momentFormat = momentFormat.replaceAll("-", "\\-");
	momentFormat = momentFormat.replaceAll(":", "\\:");
	momentFormat = momentFormat.replaceAll(" ", "\\s");
	
	momentFormat = momentFormat.replace("dddd", "\\w{1,}");
	momentFormat = momentFormat.replace("ddd", "\\w{1,3}");
	momentFormat = momentFormat.replace("dd", "\\w{2}");
	momentFormat = momentFormat.replace("d", "\\d{1}");
	
	momentFormat = momentFormat.replace("YYYY", "\\d{4}");
	momentFormat = momentFormat.replace("YY", "\\d{2}");
	
	momentFormat = momentFormat.replace("MMMM", "\\w{1,}");
	momentFormat = momentFormat.replace("MMM", "\\w{3}");
	momentFormat = momentFormat.replace("MM", "\\d{2}");
	
	momentFormat = momentFormat.replace("DDDD", "\\d{3}");
	momentFormat = momentFormat.replace("DDD", "\\d{1,3}");
	momentFormat = momentFormat.replace("DD", "\\d{2}");
	momentFormat = momentFormat.replace("D", "\\d{1,2}");
	
	momentFormat = momentFormat.replace("ww", "\\d{1,2}");
	return new RegExp("/^(" + momentFormat + ")$/");
}

