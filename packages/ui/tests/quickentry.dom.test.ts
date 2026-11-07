// Pins quick entry's submission, focus and applied-filter draft rules, plus shortcut and MultiSelect behavior.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import type { DateValue, QuickFilter } from "@tasks-calendar-wrapper/core";
import { HostContext, QuickEntryHandlerContext } from "../src/contexts";
import type { UiHost } from "../src/host";
import { QuickEntry } from "../src/entry/QuickEntry";
import { MultiSelect, type MultiSelectProps } from "../src/entry/MultiSelect";

function mountRoot(t: TestContext) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	return { container, root };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function entryHarness(t: TestContext, create = () => Promise.resolve(true)) {
	const { container, root } = mountRoot(t);
	const createCalls: [string, string][] = [];
	const filterCalls: Parameters<ContextType<typeof QuickEntryHandlerContext>["handleFilterEnable"]>[] = [];
	let nowCalls = 0;
	const today = { year: () => 2026, month: () => 0, date: () => 15 } as DateValue;
	const host: UiHost = {
		isMobile: false,
		now: () => {
			nowCalls++;
			return today;
		},
		moment: Object.assign(() => assert.fail("QuickEntry does not create a moment"), {
			locale: () => assert.fail("QuickEntry does not read the moment locale"),
		}),
		renderMarkdown: () => assert.fail("QuickEntry does not render markdown"),
	};
	const handlers: ContextType<typeof QuickEntryHandlerContext> = {
		handleCreateNewTask: (path, text) => {
			createCalls.push([path, text]);
			return create();
		},
		handleFilterEnable: (...args) => filterCalls.push(args),
	};
	const render = async (applied?: QuickFilter) => {
		await act(() =>
			root.render(
				createElement(
					HostContext.Provider,
					{ value: host },
					createElement(
						QuickEntryHandlerContext.Provider,
						{ value: handlers },
						createElement(QuickEntry, { applied, taskFiles: ["Notes/Work.md", "Inbox.md"] }),
					),
				),
			),
		);
	};
	return { container, render, createCalls, filterCalls, nowCalls: () => nowCalls };
}

function element<T extends Element>(container: Element, selector: string): T {
	const found = container.querySelector<T>(selector);
	assert.ok(found, selector);
	return found;
}

function enter(input: HTMLInputElement) {
	input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
}

async function changeSelect(select: HTMLSelectElement, value: string) {
	await act(() => {
		select.value = value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function editDate(input: HTMLInputElement, value: string) {
	await act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		setter.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

test("Enter submits once", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	input.value = "buy milk";
	await act(() => input.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true })));
	assert.deepEqual(entry.createCalls, []);
	await act(() => enter(input));
	assert.deepEqual(entry.createCalls, [["Notes/Work.md", "buy milk"]]);
});

test("a second Enter while pending is ignored", async (t) => {
	const pending = deferred<boolean>();
	const entry = entryHarness(t, () => pending.promise);
	await entry.render();
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	const submit = element<HTMLButtonElement>(entry.container, "button.ok");
	input.value = "add once";
	await act(() => {
		enter(input);
		enter(input);
		submit.click();
	});
	assert.deepEqual(entry.createCalls, [["Notes/Work.md", "add once"]]);
	assert.equal(input.value, "add once");
	await act(async () => pending.resolve(false));
	await act(() => enter(input));
	assert.deepEqual(entry.createCalls, [
		["Notes/Work.md", "add once"],
		["Notes/Work.md", "add once"],
	]);
});

test("input cleared only after a written result", async (t) => {
	const refused = deferred<boolean>();
	const failed = deferred<boolean>();
	const written = deferred<boolean>();
	let result = refused.promise;
	const error = new Error("adding a task failed");
	let rejection: Promise<void> | undefined;
	t.mock.method(failed.promise, "then", (...callbacks: Parameters<Promise<boolean>["then"]>) => {
		const chained = Promise.prototype.then.call(failed.promise, ...callbacks);
		rejection = assert.rejects(chained, error);
		return chained;
	});
	const entry = entryHarness(t, () => result);
	await entry.render();
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	input.value = "keep this draft";
	await act(() => enter(input));
	assert.equal(input.value, "keep this draft", "pending");
	await act(async () => refused.resolve(false));
	assert.equal(input.value, "keep this draft", "refused");
	result = failed.promise;
	await act(() => enter(input));
	await act(async () => {
		failed.reject(error);
		assert.ok(rejection, "the handler keeps rejection observable");
		await rejection;
	});
	assert.equal(input.value, "keep this draft", "rejected");
	result = written.promise;
	await act(() => enter(input));
	await act(async () => written.resolve(true));
	assert.equal(input.value, "", "written");
	assert.equal(entry.createCalls.length, 3);
});

test(".focus class on focus and blur", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	const panel = element<HTMLDivElement>(entry.container, ".quickEntryPanel");
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	const file = element<HTMLSelectElement>(entry.container, "select.fileSelect");
	assert.equal(panel.className, "quickEntryPanel");
	await act(() => input.focus());
	assert.equal(panel.className, "quickEntryPanel focus");
	await act(() => input.blur());
	assert.equal(panel.className, "quickEntryPanel");
	await act(() => file.focus());
	assert.equal(panel.className, "quickEntryPanel");
	await changeSelect(file, "Inbox.md");
	assert.equal(document.activeElement, input);
	assert.equal(panel.className, "quickEntryPanel focus");
	await act(() => input.blur());
	assert.equal(panel.className, "quickEntryPanel");
	assert.deepEqual(entry.createCalls, []);
});

test("applied filter re-derived when the prop changes", async (t) => {
	const a: QuickFilter = { from: "2026-01-10", to: "2026-01-20", priorities: ["1"], tags: ["#work"] };
	const b: QuickFilter = { to: "2026-02-20", priorities: [], tags: ["#home"] };
	// Brief-derived cases pin reference identity and resets even without an edit between applied values.
	const cases: [string, (QuickFilter | undefined)[], string][] = [
		["same object keeps edits", [a], "2026-01-12"],
		["equal new object resets", [{ ...a, priorities: [...a.priorities], tags: [...a.tags!] }], a.from!],
		["A to undefined clears dates", [undefined], ""],
		["A to B to A resets", [b, a], a.from!],
		["A to undefined to A resets without an intervening edit", [undefined, a], a.from!],
	];
	for (const [name, changes, expectedFrom] of cases) {
		await t.test(name, async (t) => {
			const entry = entryHarness(t);
			await entry.render(a);
			const dates = () => [...entry.container.querySelectorAll<HTMLInputElement>('input[type="date"]')];
			const assertMountChoices = () => {
				assert.equal(element<HTMLSelectElement>(entry.container, "select.actionName").value, "filter");
				assert.deepEqual(
					[...entry.container.querySelectorAll("select.filterSelector ~ a")].map((item) => item.textContent),
					["📆 date🎯", "⏫ priority🎯"],
				);
				assert.equal(dates().length, 2);
				assert.ok(entry.container.querySelector('select[name="priorityFilter"]'));
			};
			assertMountChoices();
			await editDate(dates()[0], "2026-01-12");
			assert.equal(dates()[0].value, "2026-01-12");
			for (const applied of changes) {
				await entry.render(applied);
				assertMountChoices();
				if (applied !== a) {
					assert.deepEqual(
						dates().map((input) => input.value),
						[applied?.from ?? "", applied?.to ?? ""],
					);
				}
			}
			const applied = changes[changes.length - 1];
			assert.deepEqual(
				dates().map((input) => input.value),
				[expectedFrom, applied?.to ?? ""],
			);
			await act(() => element<HTMLButtonElement>(entry.container, "button.ok").click());
			assert.deepEqual(entry.filterCalls, [
				[expectedFrom, applied?.to ?? "", [...(applied?.priorities ?? [])], [...(applied?.tags ?? [])]],
			]);
		});
	}
	await t.test("append and empty filter types remain the mount values", async (t) => {
		const entry = entryHarness(t);
		await entry.render();
		await entry.render(a);
		assert.equal(element<HTMLSelectElement>(entry.container, "select.actionName").value, "append");
		assert.ok(entry.container.querySelector("input.newTask"));
		await changeSelect(element<HTMLSelectElement>(entry.container, "select.actionName"), "filter");
		assert.deepEqual([...entry.container.querySelectorAll("select.filterSelector ~ a")], []);
		assert.equal(entry.container.querySelector(".dateFilter"), null);
		assert.equal(entry.container.querySelector('select[name="priorityFilter"]'), null);
	});
});

// Brief-derived: the clock is read for each input event, not while rendering the panel.
test("input expands shortcuts against host.now() at each input event", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	assert.equal(entry.nowCalls(), 0);
	await entry.render();
	assert.equal(entry.nowCalls(), 0);
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	await act(() => {
		input.value = "buy milk today ";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	assert.equal(input.value, "buy milk 2026-01-15 ");
	assert.equal(entry.nowCalls(), 1);
	assert.equal(document.activeElement, input);
	await entry.render();
	assert.equal(entry.nowCalls(), 1);
	await act(() => {
		input.value = "unchanged text";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	assert.equal(input.value, "unchanged text");
	assert.equal(entry.nowCalls(), 2);
});

// Brief-derived: generic values pin the selection contract independently of today's priority names.
test("MultiSelect toggles a value, ignores the fallback index and marks the selection", async (t) => {
	const { container, root } = mountRoot(t);
	const calls: string[][] = [];
	const props: MultiSelectProps = {
		name: "choice",
		className: "",
		options: ["+", "alpha", "beta"],
		selected: [],
		visual: ["➕", "Alpha", "Beta"],
		fallbackValueIndex: 0,
		selectChangeHandler: (selected) => calls.push(selected),
	};
	const render = async (selected: readonly string[]) => {
		await act(() => root.render(createElement(MultiSelect, { ...props, selected })));
	};
	const labels = () => [...container.querySelectorAll("option")].map((option) => option.textContent);
	const marks = () => [...container.querySelectorAll("a")].map((anchor) => anchor.textContent);
	await render([]);
	const select = element<HTMLSelectElement>(container, "select");
	assert.equal(select.hasAttribute("class"), true);
	assert.equal(select.getAttribute("class"), "");
	assert.deepEqual(labels(), ["➕ ", "Alpha ", "Beta "]);
	assert.deepEqual(marks(), []);
	await changeSelect(select, "+");
	assert.deepEqual(calls, []);
	await changeSelect(select, "alpha");
	assert.deepEqual(calls, [["alpha"]]);
	await render(calls[0]);
	assert.deepEqual(labels(), ["➕ ", "Alpha🎯", "Beta "]);
	assert.deepEqual(marks(), ["Alpha🎯"]);
	await act(() => select.click());
	assert.equal(select.selectedIndex, 0);
	assert.equal(calls.length, 1);
	await changeSelect(select, "beta");
	assert.deepEqual(calls[1], ["alpha", "beta"]);
	await render(calls[1]);
	assert.deepEqual(labels(), ["➕ ", "Alpha🎯", "Beta🎯"]);
	assert.deepEqual(marks(), ["Alpha🎯", "Beta🎯"]);
	await changeSelect(select, "alpha");
	assert.deepEqual(calls[2], ["beta"]);
	await render(calls[2]);
	assert.deepEqual(labels(), ["➕ ", "Alpha ", "Beta🎯"]);
	assert.deepEqual(marks(), ["Beta🎯"]);
	await changeSelect(select, "+");
	assert.equal(calls.length, 3);
});
