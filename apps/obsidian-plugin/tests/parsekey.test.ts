// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { parseKeyOf, sameParseKey, type ParseKey } from "../utils/parsekey";

// The parse key says what parsing a note depends on besides the note: moment's global locale and the time zone. These
// tests change both, the way Obsidian or the user can, and put them back as golden-clock set them.

/** Runs `body` in the time zone, then puts UTC back. */
function inZone<T>(zone: string, body: () => T): T {
	process.env.TZ = zone;
	try {
		return body();
	} finally {
		process.env.TZ = "UTC";
	}
}

/** The key in the time zone. */
const keyIn = (zone: string) => inZone(zone, () => parseKeyOf(moment));

/** Intl gives no time zone name, as some WebViews do; the offsets are all that is left. */
function withoutZoneNames(t: TestContext): void {
	const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
	t.mock.method(Intl.DateTimeFormat.prototype, "resolvedOptions", function (this: Intl.DateTimeFormat) {
		return { ...resolvedOptions.call(this), timeZone: undefined };
	});
}

test("two keys taken in the same environment are the same key, and frozen", () => {
	const first = parseKeyOf(moment);
	const second = parseKeyOf(moment);
	assert.notEqual(first, second);
	assert.ok(sameParseKey(first, second));
	assert.ok(Object.isFrozen(first) && Object.isFrozen(first.offsets));
	assert.equal(first.locale, moment.localeData());
	assert.equal(first.timeZone, "UTC");
	assert.deepEqual(first.offsets, [0, 0]);
});

test("each part of the key counts on its own", () => {
	const key = parseKeyOf(moment);
	const changes: Partial<ParseKey>[] = [
		{ locale: {} },
		{ localeConfig: {} },
		{ timeZone: "Europe/Lisbon" },
		{ timeZone: undefined },
		{ offsets: [0, -60] },
		{ offsets: [-60, 0] },
	];
	for (const change of changes) {
		assert.ok(!sameParseKey(key, { ...key, ...change }), `a key with ${JSON.stringify(change)} is another key`);
		assert.ok(!sameParseKey({ ...key, ...change }, key), `and the other way round: ${JSON.stringify(change)}`);
	}
	assert.ok(sameParseKey(key, { ...key, offsets: [key.offsets[0], key.offsets[1]] }), "new objects, the same parts");
});

test("another locale is another key, and switching back gives the first key again", () => {
	const english = parseKeyOf(moment);
	try {
		moment.locale("zh-cn");
		const chinese = parseKeyOf(moment);
		assert.ok(!sameParseKey(english, chinese));
	} finally {
		moment.locale("en");
	}
	assert.ok(sameParseKey(english, parseKeyOf(moment)));
});

test("updateLocale: the first gives a new locale object, a second changes it in place, undoing it is the first key", () => {
	const first = parseKeyOf(moment);
	let updated = false;
	try {
		moment.updateLocale("en", { week: { dow: 1, doy: 4 } });
		updated = true;
		const once = parseKeyOf(moment);
		assert.notEqual(once.locale, first.locale, "the first update makes a new locale with the same name");
		assert.ok(!sameParseKey(first, once));
		moment.updateLocale("en", { week: { dow: 0, doy: 6 } });
		const twice = parseKeyOf(moment);
		assert.equal(twice.locale, once.locale, "a second update changes the same object");
		assert.notEqual(twice.localeConfig, once.localeConfig, "and gives it a new _config");
		assert.ok(!sameParseKey(once, twice));
	} finally {
		// Undoing a locale that was never updated would delete it.
		if (updated) moment.updateLocale("en", null);
		moment.locale("en");
	}
	assert.ok(sameParseKey(first, parseKeyOf(moment)), "undone, the locale and its _config are the first ones again");
});

test("another time zone is another key, and UTC again gives the first key", () => {
	const utc = parseKeyOf(moment);
	const newYork = keyIn("America/New_York");
	assert.ok(!sameParseKey(utc, newYork));
	assert.equal(newYork.timeZone, "America/New_York");
	assert.deepEqual(newYork.offsets, [300, 240], "daylight saving time shows in July");
	assert.deepEqual(keyIn("Asia/Shanghai").offsets, [-480, -480]);
	assert.ok(sameParseKey(utc, parseKeyOf(moment)));
});

test("London and Lisbon have the same offsets on both probe days; their names tell them apart", () => {
	const london = keyIn("Europe/London");
	const lisbon = keyIn("Europe/Lisbon");
	assert.deepEqual(london.offsets, lisbon.offsets);
	assert.ok(!sameParseKey(london, lisbon));
});

test("without a zone name from Intl the offsets tell UTC from Tokyo; London and Lisbon look the same", (t) => {
	withoutZoneNames(t);
	const utc = parseKeyOf(moment);
	const tokyo = keyIn("Asia/Tokyo");
	assert.equal(utc.timeZone, undefined);
	assert.equal(tokyo.timeZone, undefined);
	assert.deepEqual(utc.offsets, [0, 0]);
	assert.deepEqual(tokyo.offsets, [-540, -540]);
	assert.ok(!sameParseKey(utc, tokyo));
	// The documented limit: two zones with the same offsets on both days are the same key without names.
	assert.ok(sameParseKey(keyIn("Europe/London"), keyIn("Europe/Lisbon")));
});

test("a locale without _config gives no localeConfig, and two of them differ only by the object", () => {
	const locale = {};
	const key = parseKeyOf({ localeData: () => locale });
	assert.equal(key.locale, locale);
	assert.equal(key.localeConfig, undefined);
	assert.ok(sameParseKey(key, parseKeyOf({ localeData: () => locale })));
	assert.ok(!sameParseKey(key, parseKeyOf({ localeData: () => ({}) })));
});
