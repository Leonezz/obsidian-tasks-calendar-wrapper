// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import { query } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions } from "../src/useroptions";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { goldenApp, loadVault } from "./golden-vault";
import { assertDisplayed, displayed, NOW, settingsOf, stateNames, stateOf } from "./visible-states";

/**
 * What the timeline displayed in a real Obsidian for fixtures/golden-vault (see visible-states.ts), against what core
 * arranges for the same notes, settings and state, laid out the way the views render it. The snapshots were taken with
 * the views and the stylesheet's Filter rules, which arrange does in data. Focus on today and the Focus highlight stay
 * in the stylesheet, so they are applied here as styles.css applies them. timeline.test.ts checks the views themselves.
 */

test("visible: every light state has a snapshot", () => {
	// 3 entry positions × Focus on today off and on × no counter, or 3 counters with Filter or Focus.
	assert.equal(stateNames.length, 3 * 2 * 7);
});

test("visible: core arranges what the timeline displayed in Obsidian, in every state", async () => {
	const tasks = await readTasks(goldenApp(loadVault()), defaultUserOptions, moment);
	for (const name of stateNames) {
		const state = stateOf(name);
		const settings = settingsOf(state);
		const arranged = query(
			tasks,
			{ settings, counter: state.counter && state.behavior ? `${state.counter}Filter` : "" },
			{ now: NOW, moment },
		);
		assertDisplayed(displayed(arranged, state, settings), name);
	}
});
