import "./setup";

import { mock, test } from "node:test";
import assert from "node:assert/strict";

import { debounceOptionUpdates, OPTIONS_DELAY_MS } from "../utils/refresh";

// Issue #202: settings reached the open timeline only 5 seconds after a change, even a toggle. Each
// hand-over re-renders and reloads the timeline, so typing in a text setting must not do it per keystroke.

test("a changed setting reaches the views after a short pause, not after 5 seconds", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		let applied = 0;
		const push = debounceOptionUpdates(() => applied++);

		push();
		mock.timers.tick(OPTIONS_DELAY_MS - 1);
		assert.equal(applied, 0);
		mock.timers.tick(1);
		assert.equal(applied, 1);
		assert.ok(OPTIONS_DELAY_MS <= 250);
	} finally {
		mock.timers.reset();
	}
});

test("typing a path reaches the views once, after the last keystroke", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		let applied = 0;
		const push = debounceOptionUpdates(() => applied++);

		for (let key = 0; key < 8; key++) {
			push();
			mock.timers.tick(100);
		}
		assert.equal(applied, 0);
		mock.timers.tick(OPTIONS_DELAY_MS);
		assert.equal(applied, 1);
	} finally {
		mock.timers.reset();
	}
});
