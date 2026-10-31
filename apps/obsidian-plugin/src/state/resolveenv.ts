import {
	createDailyNoteDateCache,
	createResolvedTaskCache,
	dayKey,
	type DateValue,
	type DayKey,
	type QueryEnv,
} from "@tasks-calendar-wrapper/core";
import { moment } from "../../utils/moment";
import { parseKeyOf, sameParseKey, type ParseKey } from "../../utils/parsekey";

/**
 * A view's caches, replaced together when the locale or time zone changes, and when the day does: moment fills the
 * units a daily-note format leaves out from the clock, so a year-less format names another day in the new year.
 */
export function createResolveEnv(): (now: DateValue) => { env: QueryEnv; parseKey: ParseKey } {
	let held:
		| {
				readonly parseKey: ParseKey;
				readonly day: DayKey;
				readonly dateCache: ReturnType<typeof createDailyNoteDateCache>;
				readonly taskCache: ReturnType<typeof createResolvedTaskCache>;
		  }
		| undefined;
	return (now) => {
		const parseKey = parseKeyOf(moment);
		const day = dayKey(now);
		if (!held || held.day !== day || !sameParseKey(held.parseKey, parseKey))
			held = { parseKey, day, dateCache: createDailyNoteDateCache(), taskCache: createResolvedTaskCache() };
		return { env: { now, moment, dateCache: held.dateCache, taskCache: held.taskCache }, parseKey };
	};
}
