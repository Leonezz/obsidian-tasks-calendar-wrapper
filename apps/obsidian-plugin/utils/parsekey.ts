/**
 * What parsing a note depends on besides the note: moment's global locale and the time zone. Tasks parsed under one
 * key are parsed again under another, see timeline/src/taskindex.ts. Compare keys with sameParseKey, never by the
 * locale's name.
 */
export interface ParseKey {
	/**
	 * moment.localeData(). moment.locale(x), defineLocale and the first updateLocale of a locale each give a new
	 * object; the name may stay the same.
	 */
	readonly locale: object;
	/**
	 * Its _config. Every updateLocale replaces it, also a later one, which changes the object above in place. Parsing
	 * uses it: moment runs the locale's preparse on every string it parses.
	 */
	readonly localeConfig: unknown;
	/** Intl's time zone name; undefined in WebViews that give none. */
	readonly timeZone: string | undefined;
	/** getTimezoneOffset at the two probe instants below. These tell zones apart where there is no name. */
	readonly offsets: readonly [number, number];
}

/** Noon UTC in mid-January and mid-July: daylight saving time in either hemisphere shows, and no switch is near. */
const WINTER = Date.UTC(2026, 0, 15, 12);
const SUMMER = Date.UTC(2026, 6, 15, 12);

/**
 * The key of the parse environment now. `m` is Obsidian's moment (utils/moment), or the npm one in tests; both fit
 * structurally. The key is frozen. Each call constructs an Intl.DateTimeFormat, so call it per update, not per note.
 */
export function parseKeyOf(m: { localeData(): object }): ParseKey {
	const locale = m.localeData();
	const timeZone: string | undefined = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return Object.freeze({
		locale,
		localeConfig: (locale as { _config?: unknown })._config,
		timeZone,
		offsets: Object.freeze([new Date(WINTER).getTimezoneOffset(), new Date(SUMMER).getTimezoneOffset()] as const),
	});
}

/** Whether two keys are the same, part by part with ===: new objects with the same parts are the same key. */
export function sameParseKey(a: ParseKey, b: ParseKey): boolean {
	return (
		a.locale === b.locale &&
		a.localeConfig === b.localeConfig &&
		a.timeZone === b.timeZone &&
		a.offsets[0] === b.offsets[0] &&
		a.offsets[1] === b.offsets[1]
	);
}
