// Pins Enter keyup submission during IME composition and the panel's focus class following its text input.
// The move into packages/ui must preserve both behaviors.
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

test("an Enter keyup during IME composition submits, as on master (known issue)", async (t) => {
	const { calls, input } = await mountQuickEntry(t);
	const text = "输入中的任务";
	const { CompositionEvent } = window;
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, text);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		input.dispatchEvent(
			new KeyboardEvent("keyup", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
		);
	});
	await act(async () => {});
	// Known issue kept on purpose: the move must preserve this submission; a later step adds the IME guard.
	assert.deepEqual(calls, [{ handler: "handleCreateNewTask", args: ["Note.md", text] }]);
});

test("the quick entry panel has the focus class only while its text input is focused", async (t) => {
	const { root, panel, input } = await mountQuickEntry(t);
	assert.equal(panel.className, "quickEntryPanel");
	await act(() => input.focus());
	assert.equal(panel.classList.contains("focus"), true);
	assert.equal(panel.className, "quickEntryPanel focus");
	await act(() => input.blur());
	assert.equal(panel.className, "quickEntryPanel");

	const select = root().querySelector<HTMLSelectElement>("select.fileSelect");
	assert.ok(select);
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(select, "Other.md");
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	assert.equal(document.activeElement, input);
	assert.equal(panel.classList.contains("focus"), true);
	assert.equal(panel.className, "quickEntryPanel focus");
	await act(() => input.blur());
	assert.equal(panel.className, "quickEntryPanel");
});
