import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { defaultUserOptions } from "../src/useroptions";
import { mountView } from "./component-harness";
import { notesApp } from "./view-harness";

test("view reveal commands use the mounted timeline controller and stop after close", async (t) => {
	const fixture = await mountView(t);
	const windowing = fixture.host.windowing;
	assert.ok(windowing);
	assert.strictEqual(windowing.getScrollElement(), fixture.container);
	const calls: string[] = [];
	const info = { rowCount: 2, windowed: true };
	const handle = {
		getWindowingInfo: () => info,
		revealTask: async (id: string) => {
			calls.push(`task:${id}`);
			return true;
		},
		revealDay: async (key: string) => {
			calls.push(`day:${key}`);
			return true;
		},
	};
	windowing.connect(handle);
	assert.strictEqual(fixture.view.getWindowingInfo(), info);
	assert.equal(await fixture.view.revealTask("Inbox.md:3"), true);
	assert.equal(await fixture.view.revealDay("2026-01-15"), true);
	assert.deepEqual(calls, ["task:Inbox.md:3", "day:2026-01-15"]);
	windowing.connect(undefined);
	assert.equal(fixture.view.getWindowingInfo(), undefined);
	assert.equal(await fixture.view.revealTask("Inbox.md:3"), false);
	windowing.connect(handle);
	await fixture.unmount();
	assert.equal(fixture.view.getWindowingInfo(), undefined);
	assert.equal(await fixture.view.revealDay("2026-01-15"), false);
	assert.deepEqual(calls, ["task:Inbox.md:3", "day:2026-01-15"]);
});

test("toggling Focus on today keeps the entry panel mounted, its draft and the keyboard focus", async (t) => {
	for (const entryPosition of ["top", "today"] as const) {
		const fixture = await mountView(t, {
			app: notesApp({
				"Earlier.md": "- [ ] earlier year 📅 2025-12-31",
				"Today.md": "- [ ] today 📅 2026-01-15",
				"Later.md": "- [ ] later year 📅 2027-01-01",
			}),
			options: {
				...structuredClone(defaultUserOptions),
				defaultFilters: "",
				defaultTodayFocus: false,
				forward: false,
				entryPosition,
			},
		});
		const panel = fixture.container.querySelector<HTMLElement>(".quickEntryPanel");
		const focus = fixture.container.querySelector<HTMLElement>(".todayHeader");
		const input = panel?.querySelector<HTMLInputElement>('input[type="text"]');
		assert.ok(panel && focus && input, entryPosition);
		const draft = "keep this draft";
		await act(() => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
			setter.call(input, draft);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(() => focus.focus());
		assert.equal(document.activeElement, focus, entryPosition);
		for (const focused of [true, false]) {
			await act(() => {
				focus.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
			});
			const message = `${entryPosition}, focus ${focused}`;
			assert.equal(fixture.root().classList.contains("todayFocus"), focused, message);
			assert.strictEqual(fixture.container.querySelector(".quickEntryPanel"), panel, message);
			assert.strictEqual(fixture.container.querySelector(".todayHeader"), focus, message);
			assert.strictEqual(panel.querySelector('input[type="text"]'), input, message);
			assert.equal(panel.isConnected, true, message);
			assert.equal(focus.isConnected, true, message);
			assert.equal(input.value, draft, message);
			assert.strictEqual(document.activeElement, focus, message);
		}
		await fixture.unmount();
	}
});
