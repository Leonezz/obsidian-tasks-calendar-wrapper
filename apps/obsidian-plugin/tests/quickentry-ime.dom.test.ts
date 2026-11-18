// IME confirmation must not submit a task; composer focus keeps its metadata available.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement, type ContextType, type ReactNode } from "react";
import { defaultUserOptions } from "../src/useroptions";
import { QuickEntryHandlerContext } from "@tasks-calendar-wrapper/ui";
import { mountView, onTimelineRender } from "./component-harness";
import { notesApp } from "./view-harness";

type Call = { handler: string; args: unknown[] };

async function mountQuickEntry(t: TestContext) {
	const calls: Call[] = [];
	const record = (handler: string, ...args: unknown[]) => {
		calls.push({ handler, args });
	};
	const quickCallbacks = {
		handleCreateNewTask: async (path: string, text: string) => {
			record("handleCreateNewTask", path, text);
			return true;
		},
		handleFilterEnable: (
			from: string | undefined,
			to: string | undefined,
			priorities: string[],
			tags: string[] = [],
		) => record("handleFilterEnable", from, to, priorities, tags),
	};
	// Preserve the bridge's context and replace only the callbacks before any writer is reached.
	onTimelineRender(t, (_props, rendered) =>
		createElement(QuickEntryHandlerContext.Consumer, {
			children: (value: ContextType<typeof QuickEntryHandlerContext>): ReactNode =>
				createElement(QuickEntryHandlerContext.Provider, { value: { ...value, ...quickCallbacks } }, rendered),
		}),
	);
	const fixture = await mountView(t, {
		app: notesApp({ "Note.md": "- [ ] existing task", "Other.md": "- [ ] another task" }),
		options: {
			...structuredClone(defaultUserOptions),
			defaultFilters: "",
			defaultTodayFocus: false,
			dateFormat: "YYYY-MM-DD",
			hideStatusTasks: [],
			inbox: "Note.md",
			taskFiles: ["Note.md", "Other.md"],
		},
	});
	const panel = fixture.root().querySelector<HTMLElement>(".quickEntryPanel");
	const input = fixture.root().querySelector<HTMLInputElement>("input.newTask");
	assert.ok(panel);
	assert.ok(input);
	Object.assign(panel, {
		addClass: (name: string) => panel.classList.add(name),
		removeClass: (name: string) => panel.classList.remove(name),
	});
	return { ...fixture, calls, panel, input };
}

test("Enter confirms IME composition without submitting the draft", async (t) => {
	const { calls, input } = await mountQuickEntry(t);
	const text = "输入中的任务";
	const { CompositionEvent } = window;
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, text);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
		);
	});
	await act(async () => {});
	assert.deepEqual(calls, []);
	assert.equal(input.value, text);
	await act(() => {
		input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	});
	await act(async () => {});
	assert.deepEqual(calls, [{ handler: "handleCreateNewTask", args: ["Note.md", text] }]);
});

test("the quick entry panel keeps its focus state throughout the composer and collapses outside", async (t) => {
	const { root, panel, input, calls } = await mountQuickEntry(t);
	const metadata = panel.querySelector<HTMLElement>(".entryMetaReveal");
	const due = panel.querySelector<HTMLSelectElement>("select.taskDuePreset");
	const select = panel.querySelector<HTMLSelectElement>("select.fileSelect");
	const add = panel.querySelector<HTMLButtonElement>("button.ok");
	const outside = root().querySelector<HTMLElement>(".todayHeader");
	assert.ok(metadata && due && select && add && outside);
	const assertFocused = (focused: boolean) => {
		assert.equal(panel.classList.contains("focus"), focused);
		assert.equal(metadata.getAttribute("aria-hidden"), String(!focused));
		assert.equal(metadata.hasAttribute("inert"), !focused);
	};
	assertFocused(false);
	for (const control of [input, due, select, add]) {
		await act(() => control.focus());
		assert.strictEqual(document.activeElement, control);
		assertFocused(true);
	}
	await act(() => {
		select.focus();
		Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(select, "Other.md");
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	assert.equal(document.activeElement, input);
	assertFocused(true);
	await act(() => outside.focus());
	assert.strictEqual(document.activeElement, outside);
	assertFocused(false);
	assert.equal(select.value, "Other.md", "collapsing the composer preserves its selected destination");
	await act(() => input.focus());
	assertFocused(true);
	await act(() => input.blur());
	assertFocused(false);
	assert.deepEqual(calls, [], "moving focus and choosing a destination never submits or changes filters");
});
