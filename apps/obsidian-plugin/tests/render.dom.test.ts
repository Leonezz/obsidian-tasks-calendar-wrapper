// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";

import { defaultUserOptions } from "../src/useroptions";
import { renderedDays, rendersOf, resetRenderCounts } from "../timeline/src/components/renderprobe";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { notesApp, openView } from "./view-harness";

/** The view's bridge mounted in a real DOM, with its store already loaded. */
async function mountTimeline(t: TestContext, notes: Record<string, string>) {
	const app = notesApp(notes);
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	const bridge = createRef<ObsidianBridge>();
	await act(() => {
		root.render(createElement(ObsidianBridge, { plugin: { app } as never, store: opened.store, ref: bridge }));
	});
	return { opened, container, bridge };
}

async function select(container: HTMLElement, selector: string, value: string) {
	const input = container.querySelector<HTMLSelectElement>(selector);
	assert.ok(input, selector);
	await act(() => {
		input.value = value;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

/** Use the native setter so React observes the input event as a user edit. */
function setDate(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
	setter.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("inputs show the applied filter after a reload", async (t) => {
	const notes = { "Inbox.md": "- [ ] beta ⏫ 📅 2026-01-20", "Later.md": "- [ ] alpha 📅 2026-01-25" };
	const { opened, container, bridge } = await mountTimeline(t, notes);
	const texts = () => [...container.querySelectorAll(".task .content")].map((row) => row.textContent);
	assert.deepEqual(texts(), ["beta", "alpha"]);

	await select(container, "select.actionName", "filter");
	await select(container, "select.filterSelector", "date");
	await select(container, "select.filterSelector", "priority");
	const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
	assert.equal(dates.length, 2);
	await act(() => {
		setDate(dates[0], "2026-01-19");
		setDate(dates[1], "2026-01-21");
	});
	await select(container, 'select[name="priorityFilter"]', "1");
	const apply = container.querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(apply);
	await act(() => apply.click());

	await act(async () => {
		notes["Inbox.md"] = "- [ ] beta, renamed ⏫ 📅 2026-01-20";
		opened.edited("Inbox.md");
		await opened.view.onReloadTasks();
	});
	assert.equal(container.querySelector<HTMLSelectElement>("select.actionName")?.value, "filter");
	assert.deepEqual(
		[...container.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((input) => input.value),
		["2026-01-19", "2026-01-21"],
	);
	const priority = container.querySelector('select[name="priorityFilter"]')?.parentElement;
	assert.ok(priority);
	assert.deepEqual(
		[...priority.querySelectorAll("a")].map((selected) => selected.textContent),
		["High🎯"],
	);
	// The reload changed the list the bridge shows. The priority selector passes its option value, as before, which
	// no task's priority is written as, so the filter lists no task.
	assert.ok(bridge.current?.state.tasks.some((task) => task.text.includes("beta, renamed")));
	assert.deepEqual(texts(), []);
});

test("render counters count TaskItemView and DateView renders", async (t) => {
	resetRenderCounts();
	const { opened } = await mountTimeline(t, {
		"Inbox.md": "- [ ] beta 📅 2026-01-20",
		"Later.md": "- [ ] alpha 📅 2026-01-25",
	});
	assert.equal(rendersOf("TaskItemView"), 2);
	assert.equal(rendersOf("DateView"), 3);
	assert.deepEqual(renderedDays(), ["2026-01-15", "2026-01-20", "2026-01-25"]);
	resetRenderCounts();
	await act(async () => {
		await opened.view.onUpdateOptions({ ...defaultUserOptions, dateFormat: "DD.MM.YYYY" });
	});
	assert.equal(rendersOf("TaskItemView"), 2);
	assert.equal(rendersOf("DateView"), 3);
	assert.deepEqual(renderedDays(), ["2026-01-15", "2026-01-20", "2026-01-25"]);
});
