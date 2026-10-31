// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import { GOLDEN_NOW } from "./golden-clock";

import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, parseTaskLine, resolveTasks } from "@tasks-calendar-wrapper/core";

import { createResolveEnv } from "../src/state/resolveenv";
import { moment } from "../utils/moment";

// A view's caches hold what parsing a note name gave. Moment fills the units a format leaves out from the clock, so the
// caches must not outlive the day they were filled on, nor the locale.

/** The start day of a task in the note, resolved in the env with the daily-note format. */
function startIn(env: ReturnType<ReturnType<typeof createResolveEnv>>["env"], path: string, format: string) {
	const task = parseTaskLine("- [ ] a", { moment, path });
	assert.ok(task);
	const [resolved] = resolveTasks([task], { dailyNoteFormat: format }, env).shown;
	assert.ok(resolved.dates.start);
	return dayKey(resolved.dates.start);
}

test("year-less daily-note format follows the new year", () => {
	const resolveEnv = createResolveEnv();
	try {
		moment.now = () => Date.UTC(2026, 11, 31, 9, 0, 0);
		assert.equal(startIn(resolveEnv(moment()).env, "Daily/03-10.md", "MM-DD"), "2026-03-10");
		moment.now = () => Date.UTC(2027, 0, 1, 9, 0, 0);
		assert.equal(startIn(resolveEnv(moment()).env, "Daily/03-10.md", "MM-DD"), "2027-03-10");
	} finally {
		moment.now = () => GOLDEN_NOW;
	}
});

test("updateLocale replaces the date cache", () => {
	const resolveEnv = createResolveEnv();
	const format = "gggg-[W]ww-e";
	const name = "2026-W11-2";
	let updated = false;
	try {
		moment.locale("en");
		const before = resolveEnv(moment()).env;
		assert.equal(resolveEnv(moment()).env.dateCache, before.dateCache, "the same day and parse key keep the cache");
		assert.equal(startIn(before, `Daily/${name}.md`, format), dayKey(moment(name, format, true)));
		moment.updateLocale("en", { week: { dow: 1, doy: 4 } });
		updated = true;
		const after = resolveEnv(moment()).env;
		assert.notEqual(after.dateCache, before.dateCache);
		const strict = moment(name, format, true);
		assert.ok(strict.isValid());
		assert.equal(startIn(after, `Daily/${name}.md`, format), dayKey(strict));
	} finally {
		if (updated) moment.updateLocale("en", null);
		moment.locale("en");
	}
});
