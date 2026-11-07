// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import { GOLDEN_NOW } from "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { moment } from "../utils/moment";
import { countRenders, mountView } from "./component-harness";
import { deeplyFrozen, nothingFrozen } from "./frozen";
import { notesApp } from "./view-harness";

const DAY = 24 * 60 * 60 * 1000;

test("an equal push after load neither renders nor reloads", async (t) => {
	const probe = countRenders(t);
	const { view, store, options, pushOptions } = await mountView(t);
	const reload = t.mock.method(view, "onReloadTasks");
	const before = store.getSnapshot();
	probe.reset();
	await pushOptions(structuredClone(options()));
	for (const [name, count] of Object.entries(probe.snapshot().renders)) assert.equal(count, 0, name);
	assert.equal(reload.mock.callCount(), 0);
	assert.equal(store.getSnapshot(), before);
});

test("first push after load reads no note", async (t) => {
	const app = notesApp({ "A.md": "- [ ] alpha" });
	const reads = t.mock.method(app.vault, "cachedRead");
	const { options, pushOptions } = await mountView(t, { app });
	const before = reads.mock.callCount();
	assert.equal(before, 1);
	await pushOptions(structuredClone(options()));
	assert.equal(reads.mock.callCount(), before);
});

test("an equal push on a new day shows the new day when the list shown stays the same", async (t) => {
	const previousNow = moment.now;
	t.after(() => {
		moment.now = previousNow;
	});
	const { container, store, options, pushOptions } = await mountView(t, {
		app: notesApp({ "A.md": "- [ ] alpha 📅 2026-03-20" }),
	});
	const label = () => container.querySelector('.task [aria-label^="due at "] .label')?.textContent;
	const before = store.getSnapshot();
	assert.equal(label(), "in 64 days");
	moment.now = () => GOLDEN_NOW + DAY;
	const pushed = structuredClone(options());
	await pushOptions(pushed);
	assert.equal(store.getSnapshot().shown, before.shown);
	assert.equal(label(), "in 63 days");
	assert.notEqual(options(), before.options);
	assert.notEqual(options(), pushed);
	assert.deepEqual(options(), pushed);
	assert.ok(deeplyFrozen(options()));
	assert.ok(nothingFrozen(pushed));
});
