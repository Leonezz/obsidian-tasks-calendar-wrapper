import {
	createDailyNoteDateCache,
	createResolvedTaskCache,
	type DateValue,
	type QueryEnv,
} from "@tasks-calendar-wrapper/core";
import { moment } from "../../utils/moment";
import { parseKeyOf, sameParseKey, type ParseKey } from "../../utils/parsekey";

/** A view's caches, replaced together when the locale or time zone changes. */
export function createResolveEnv(): (now: DateValue) => { env: QueryEnv; parseKey: ParseKey } {
	let held:
		| {
				readonly parseKey: ParseKey;
				readonly dateCache: ReturnType<typeof createDailyNoteDateCache>;
				readonly taskCache: ReturnType<typeof createResolvedTaskCache>;
		  }
		| undefined;
	return (now) => {
		const parseKey = parseKeyOf(moment);
		if (!held || !sameParseKey(held.parseKey, parseKey))
			held = { parseKey, dateCache: createDailyNoteDateCache(), taskCache: createResolvedTaskCache() };
		return { env: { now, moment, dateCache: held.dateCache, taskCache: held.taskCache }, parseKey };
	};
}
