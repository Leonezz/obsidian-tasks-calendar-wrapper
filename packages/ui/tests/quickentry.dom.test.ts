// Quick capture and filtering stay independent, including across keyed timeline remounts.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import {
	copy,
	type DateValue,
	type MomentFactory,
	type NewDateStyle,
	type QuickFilter,
} from "@tasks-calendar-wrapper/core";
import { HostContext, QuickEntryHandlerContext, ViewActionsContext, type CounterId } from "../src/contexts";
import type { UiHost } from "../src/host";
import { createQuickEntryDraft, QuickEntry } from "../src/entry/QuickEntry";
import { QuickFilters } from "../src/entry/QuickFilters";
import { TodayFocus } from "../src/entry/TodayFocus";
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

class TestDate {
	private day: Date;
	constructor(value: string | number) {
		this.day = new Date(typeof value === "string" ? value.trim() + "T00:00:00Z" : value);
	}
	year() {
		return this.day.getUTCFullYear();
	}
	month() {
		return this.day.getUTCMonth();
	}
	date() {
		return this.day.getUTCDate();
	}
	valueOf() {
		return this.day.valueOf();
	}
	isValid() {
		return !Number.isNaN(this.valueOf());
	}
	clone() {
		return new TestDate(this.valueOf());
	}
	add(value: number) {
		this.day.setUTCDate(this.date() + value);
		return this;
	}
}

function entryHarness(
	t: TestContext,
	create: () => Promise<boolean> = () => Promise.resolve(true),
	newDateStyle: NewDateStyle = "emoji",
) {
	const { container, root } = mountRoot(t);
	const draft = createQuickEntryDraft();
	const createCalls: [string, string][] = [];
	const filterCalls: Parameters<ContextType<typeof QuickEntryHandlerContext>["handleFilterEnable"]>[] = [];
	const counterCalls: CounterId[] = [];
	let applied: QuickFilter | undefined;
	let todayFocus = false;
	let activeCounter: CounterId | undefined;
	let key = 0;
	let nowCalls = 0;
	const moment = Object.assign(
		(value: Parameters<MomentFactory>[0]) => new TestDate(value as string) as unknown as ReturnType<MomentFactory>,
		{ locale: () => "en" },
	);
	const host: UiHost = {
		isMobile: false,
		now: () => {
			nowCalls++;
			return new TestDate("2026-01-15") as unknown as DateValue;
		},
		moment,
		renderMarkdown: () => assert.fail("quick capture does not render markdown"),
	};
	const paint = () =>
		root.render(
			createElement(
				HostContext.Provider,
				{ value: host },
				createElement(
					ViewActionsContext.Provider,
					{
						value: {
							toggleTodayFocus: () => {
								todayFocus = !todayFocus;
								paint();
							},
							toggleCounter: (id) => {
								counterCalls.push(id);
								activeCounter = activeCounter === id ? undefined : id;
								paint();
							},
						},
					},
					createElement(
						QuickEntryHandlerContext.Provider,
						{ value: handlers },
						createElement(TodayFocus, { visual: copy.timeline.focusOnToday, active: todayFocus }),
						createElement(QuickFilters, {
							applied,
							tags: ["#work", "#home"],
							todayFocus,
							activeCounter,
							todayKey: "2026-01-15",
						}),
						createElement(QuickEntry, {
							applied,
							taskFiles: ["Notes/Work.md", "Inbox.md"],
							draft,
							key,
							newDateStyle,
						}),
					),
				),
			),
		);
	const handlers: ContextType<typeof QuickEntryHandlerContext> = {
		handleCreateNewTask: (path, text) => {
			createCalls.push([path, text]);
			return create();
		},
		handleFilterEnable: (...args) => {
			filterCalls.push(args);
			applied = { from: args[0], to: args[1], priorities: args[2], tags: args[3] };
			paint();
		},
	};
	return {
		container,
		draft,
		createCalls,
		filterCalls,
		counterCalls,
		nowCalls: () => nowCalls,
		todayFocus: () => todayFocus,
		render: async (filter?: QuickFilter) => {
			applied = filter;
			await act(paint);
		},
		remount: async () => {
			key++;
			await act(paint);
		},
		counter: async (id: CounterId) => {
			activeCounter = id;
			await act(paint);
		},
	};
}

function element<T extends Element>(container: Element, selector: string): T {
	const found = container.querySelector<T>(selector);
	assert.ok(found, selector);
	return found;
}

async function edit(input: HTMLInputElement, value: string) {
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function changeSelect(select: HTMLSelectElement, value: string) {
	await act(() => {
		select.value = value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function enter(input: HTMLInputElement, isComposing = false) {
	await act(async () => {
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing, bubbles: true }));
		await Promise.resolve();
	});
}

test("the composer stays available while filters change and submits through its own action", async (t) => {
	const entry = entryHarness(t);
	await entry.render({ priorities: ["High"], tags: ["#work"] });
	assert.equal(entry.container.querySelector("select.actionName"), null);
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	const submit = element<HTMLButtonElement>(entry.container, "button.ok");
	assert.equal(submit.textContent, "Add");
	assert.equal(submit.getAttribute("aria-label"), "Add task to selected note");
	await edit(input, "buy milk");
	await act(() => element<HTMLElement>(entry.container, ".todayHeader").click());
	assert.equal(input.value, "buy milk");
	await enter(input);
	assert.deepEqual(entry.createCalls, [["Notes/Work.md", "buy milk"]]);
	assert.deepEqual(entry.filterCalls, []);
	assert.equal(input.value, "");
});

test("IME confirmation never submits or expands the composing text", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	await act(() => input.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true })));
	await edit(input, "输入中的任务 today ");
	assert.equal(input.value, "输入中的任务 today ");
	assert.equal(entry.nowCalls(), 0);
	await enter(input, true);
	assert.deepEqual(entry.createCalls, []);
	await act(() => input.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true })));
	await enter(input);
	assert.deepEqual(entry.createCalls, [["Notes/Work.md", "输入中的任务 today"]]);
});

test("pending capture survives remount and never clears a newer draft", async (t) => {
	const pending = deferred<boolean>();
	const entry = entryHarness(t, () => pending.promise);
	await entry.render();
	await edit(element(entry.container, "input.newTask"), "first task");
	await enter(element(entry.container, "input.newTask"));
	await edit(element(entry.container, "input.newTask"), "next task");
	await entry.remount();
	await enter(element(entry.container, "input.newTask"));
	await act(() => element<HTMLButtonElement>(entry.container, "button.ok").click());
	assert.equal(entry.createCalls.length, 1);
	assert.equal(element<HTMLInputElement>(entry.container, "input.newTask").value, "next task");
	await act(async () => pending.resolve(true));
	assert.equal(element<HTMLInputElement>(entry.container, "input.newTask").value, "next task");
	assert.equal(entry.draft.getSnapshot().pending, false);
	assert.match(element(entry.container, ".entryStatus").textContent!, /Added to Work/);
});

test("refused and rejected captures keep the draft; a later successful write clears it", async (t) => {
	const refused = deferred<boolean>();
	const failed = deferred<boolean>();
	const written = deferred<boolean>();
	let result = refused.promise;
	const entry = entryHarness(t, () => result);
	await entry.render();
	const input = element<HTMLInputElement>(entry.container, "input.newTask");
	await edit(input, "keep this draft");
	await enter(input);
	await act(async () => refused.resolve(false));
	assert.equal(input.value, "keep this draft");
	result = failed.promise;
	await enter(input);
	await act(async () => failed.reject(new Error("write failed")));
	assert.equal(input.value, "keep this draft");
	assert.match(element(entry.container, ".entryError").textContent!, /draft was kept/);
	result = written.promise;
	await enter(input);
	await act(async () => written.resolve(true));
	assert.equal(input.value, "");
});

test("completion preserves the title when creation metadata changes during a pending write", async (t) => {
	for (const [selector, value] of [
		[".fileSelect", "Inbox.md"],
		[".taskDue", "2026-01-21"],
		[".taskPriority", "High"],
	]) {
		await t.test(selector, async (t) => {
			const pending = deferred<boolean>();
			const entry = entryHarness(t, () => pending.promise);
			await entry.render();
			await edit(element(entry.container, ".newTask"), "same title, new capture details");
			await enter(element(entry.container, ".newTask"));
			const control = element<HTMLInputElement | HTMLSelectElement>(entry.container, selector);
			if (control instanceof window.HTMLSelectElement) await changeSelect(control, value);
			else await edit(control, value);
			await act(async () => pending.resolve(true));
			assert.equal(
				element<HTMLInputElement>(entry.container, ".newTask").value,
				"same title, new capture details",
			);
			assert.equal(control.value, value);
		});
	}
});

test("title, destination and creation metadata survive an explicit remount", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	await edit(element(entry.container, "input.newTask"), "write a proposal");
	await changeSelect(element(entry.container, ".fileSelect"), "Inbox.md");
	await edit(element(entry.container, ".taskDue"), "2026-01-20");
	await changeSelect(element(entry.container, ".taskPriority"), "Highest");
	await entry.remount();
	assert.equal(element<HTMLInputElement>(entry.container, ".newTask").value, "write a proposal");
	assert.equal(element<HTMLSelectElement>(entry.container, ".fileSelect").value, "Inbox.md");
	assert.equal(element<HTMLInputElement>(entry.container, ".taskDue").value, "2026-01-20");
	assert.equal(element<HTMLSelectElement>(entry.container, ".taskPriority").value, "Highest");
	await enter(element(entry.container, ".newTask"));
	assert.deepEqual(entry.createCalls, [["Inbox.md", "write a proposal 🔺 📅 2026-01-20"]]);
});

test("creation controls replace existing date and priority rather than duplicating them", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	await edit(element(entry.container, ".newTask"), "buy milk 📅 2026-01-16 ⏫ #work ^milk");
	await edit(element(entry.container, ".taskDue"), "2026-01-20");
	await changeSelect(element(entry.container, ".taskPriority"), "Low");
	await enter(element(entry.container, ".newTask"));
	assert.deepEqual(entry.createCalls, [["Notes/Work.md", "buy milk 📅 2026-01-20 🔽 #work ^milk"]]);
	await edit(element(entry.container, ".newTask"), "buy milk [due:: 2026-01-16] [priority:: high]");
	await edit(element(entry.container, ".taskDue"), "2026-01-21");
	await changeSelect(element(entry.container, ".taskPriority"), "Lowest");
	await enter(element(entry.container, ".newTask"));
	assert.equal(entry.createCalls[1][1], "buy milk [due:: 2026-01-21] [priority:: lowest]");
});

test("ambiguous metadata refuses capture and preserves the complete draft", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	await edit(element(entry.container, ".newTask"), "keep ⏫ 🔽");
	await changeSelect(element(entry.container, ".taskPriority"), "Highest");
	await enter(element(entry.container, ".newTask"));
	assert.deepEqual(entry.createCalls, []);
	assert.equal(element<HTMLInputElement>(entry.container, ".newTask").value, "keep ⏫ 🔽");
	assert.match(element(entry.container, '[role="alert"]').textContent!, /cannot be changed safely/);
});

test("new metadata follows the configured Dataview style while existing emoji fields keep theirs", async (t) => {
	const entry = entryHarness(t, undefined, "dataview");
	await entry.render();
	await edit(element(entry.container, ".newTask"), "new task");
	await edit(element(entry.container, ".taskDue"), "2026-01-20");
	await changeSelect(element(entry.container, ".taskPriority"), "High");
	await enter(element(entry.container, ".newTask"));
	assert.equal(entry.createCalls[0][1], "new task [priority:: high]  [due:: 2026-01-20]");
	await edit(element(entry.container, ".newTask"), "keep emoji 📅 2026-01-16");
	await edit(element(entry.container, ".taskDue"), "2026-01-21");
	await changeSelect(element(entry.container, ".taskPriority"), "Low");
	await enter(element(entry.container, ".newTask"));
	assert.equal(entry.createCalls[1][1], "keep emoji 📅 2026-01-21 🔽");
});

test("input-only date edits survive another control before the browser commits change", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	const due = element<HTMLInputElement>(entry.container, ".taskDue");
	await act(() => {
		due.value = "2026-01-20";
		due.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(() => element<HTMLElement>(entry.container, ".todayHeader").click());
	assert.equal(due.value, "2026-01-20");
	assert.equal(entry.draft.getSnapshot().due, "2026-01-20");
	await changeSelect(element(entry.container, ".dateScope"), "custom");
	const dates = entry.container.querySelectorAll<HTMLInputElement>(".dateRange input");
	await act(() => {
		for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
			dates[index].value = value;
			dates[index].dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
	await act(() => element<HTMLButtonElement>(entry.container, ".applyDateRange").click());
	assert.deepEqual(entry.filterCalls.at(-1), ["2026-01-10", "2026-01-20", [], []]);
	assert.equal(entry.todayFocus(), true, "applying a range retains the independent focus mode");
});

test("shortcuts read the current clock for each non-composing input, not for rendering", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	assert.equal(entry.nowCalls(), 0);
	const input = element<HTMLInputElement>(entry.container, ".newTask");
	await edit(input, "buy milk today ");
	assert.equal(input.value, "buy milk 2026-01-15 ");
	assert.equal(entry.nowCalls(), 1);
	await entry.render();
	assert.equal(entry.nowCalls(), 1);
	await edit(input, "unchanged text");
	assert.equal(entry.nowCalls(), 2);
});

test("focus and note selection return keyboard capture to its title", async (t) => {
	const entry = entryHarness(t);
	await entry.render();
	const panel = element<HTMLElement>(entry.container, ".quickEntryPanel");
	const input = element<HTMLInputElement>(entry.container, ".newTask");
	await act(() => input.focus());
	assert.equal(panel.className, "quickEntryPanel focus");
	await act(() => input.blur());
	assert.equal(panel.className, "quickEntryPanel");
	await changeSelect(element(entry.container, ".fileSelect"), "Inbox.md");
	assert.equal(document.activeElement, input);
});

test("priority filters retain six levels and None includes both stored representations", async (t) => {
	const entry = entryHarness(t);
	await entry.render({ priorities: ["High"], tags: ["#work"] });
	const choices = [...entry.container.querySelectorAll<HTMLInputElement>(".priorityOptions input")];
	assert.deepEqual(
		choices.map((input) => input.value),
		["Highest", "High", "Medium", "No", "Low", "Lowest"],
	);
	await act(() => element<HTMLInputElement>(entry.container, '.priorityOptions input[value="No"]').click());
	assert.deepEqual(entry.filterCalls.at(-1), [undefined, undefined, ["High", "No", ""], ["#work"]]);
	await act(() => element<HTMLInputElement>(entry.container, '.priorityOptions input[value="Lowest"]').click());
	assert.deepEqual(entry.filterCalls.at(-1), [undefined, undefined, ["High", "No", "", "Lowest"], ["#work"]]);
	await act(() => element<HTMLInputElement>(entry.container, '.priorityOptions input[value="No"]').click());
	assert.deepEqual(entry.filterCalls.at(-1), [undefined, undefined, ["High", "Lowest"], ["#work"]]);
	for (const values of [[""], ["No"], ["No", ""], ["", "No"]]) {
		await entry.render({ priorities: values });
		assert.equal(element<HTMLInputElement>(entry.container, '.priorityOptions input[value="No"]').checked, true);
		assert.equal(element(entry.container, ".priorityFilter summary").textContent, "None");
	}
});

test("date presets preserve other dimensions and Next 7 days keeps its selected label", async (t) => {
	const entry = entryHarness(t);
	await entry.render({ priorities: ["High"], tags: ["#work"] });
	await changeSelect(element(entry.container, ".dateScope"), "week");
	assert.deepEqual(entry.filterCalls.at(-1), ["2026-01-15", "2026-01-21", ["High"], ["#work"]]);
	assert.equal(element<HTMLSelectElement>(entry.container, ".dateScope").value, "week");
	await entry.remount();
	assert.equal(element<HTMLSelectElement>(entry.container, ".dateScope").value, "week");
	await act(() => element<HTMLElement>(entry.container, ".todayHeader").click());
	assert.equal(entry.todayFocus(), true);
	assert.deepEqual(entry.filterCalls.at(-1), ["2026-01-15", "2026-01-21", ["High"], ["#work"]]);
	assert.equal(element<HTMLSelectElement>(entry.container, ".dateScope").value, "week");
	await changeSelect(element(entry.container, ".dateScope"), "all");
	assert.equal(entry.todayFocus(), true, "date presets do not turn focus off");
	assert.deepEqual(entry.filterCalls.at(-1), [undefined, undefined, ["High"], ["#work"]]);
	await changeSelect(element(entry.container, ".dateScope"), "week");
	assert.equal(entry.todayFocus(), true, "date presets do not turn focus on or off");
	assert.deepEqual(entry.filterCalls.at(-1), ["2026-01-15", "2026-01-21", ["High"], ["#work"]]);
});

test("the original Focus on today heading preserves the explicit range and capture draft", async (t) => {
	const entry = entryHarness(t);
	await entry.render({ from: "2026-01-10", to: "2026-01-20", priorities: ["High", "No", ""], tags: ["#work"] });
	await entry.counter("todo");
	await edit(element(entry.container, ".newTask"), "keep this capture draft");
	await edit(element(entry.container, ".taskDue"), "2026-01-25");
	const today = element<HTMLElement>(entry.container, ".todayHeader");
	assert.equal(today.textContent, "Focus on today");
	assert.equal(today.getAttribute("aria-label"), "Focus on today");
	assert.equal(today.getAttribute("role"), "button");
	assert.equal(today.tabIndex, 0);
	assert.equal(today.getAttribute("aria-pressed"), "false");
	assert.equal(today.hidden, false);
	assert.equal(today.closest("details"), null, "the toggle is outside collapsed menus");
	assert.equal(
		element<HTMLSelectElement>(entry.container, ".dateScope").getAttribute("aria-label"),
		"Filter by date",
	);
	assert.deepEqual(
		[...element<HTMLSelectElement>(entry.container, ".dateScope").options].map((option) => option.value),
		["all", "week", "custom"],
	);
	await act(() => today.click());
	assert.equal(entry.todayFocus(), true);
	assert.equal(today.getAttribute("aria-pressed"), "true");
	assert.equal(element<HTMLSelectElement>(entry.container, ".dateScope").value, "custom");
	assert.deepEqual(entry.filterCalls, [], "the original focus action leaves the date/tag/priority query intact");
	assert.deepEqual(
		[...entry.container.querySelectorAll<HTMLInputElement>(".dateRange input")].map((input) => input.value),
		["2026-01-10", "2026-01-20"],
	);
	assert.deepEqual(entry.counterCalls, [], "focusing today retains the selected status card");
	assert.equal(element<HTMLInputElement>(entry.container, ".newTask").value, "keep this capture draft");
	assert.equal(element<HTMLInputElement>(entry.container, ".taskDue").value, "2026-01-25");
	await act(() => today.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
	assert.equal(entry.todayFocus(), false);
	assert.equal(today.getAttribute("aria-pressed"), "false");
	assert.equal(element<HTMLSelectElement>(entry.container, ".dateScope").value, "custom");
	assert.deepEqual(entry.filterCalls, []);
	assert.deepEqual(entry.counterCalls, []);
	assert.equal(element<HTMLInputElement>(entry.container, ".newTask").value, "keep this capture draft");
	const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
	await act(() => today.dispatchEvent(space));
	assert.equal(entry.todayFocus(), true);
	assert.equal(space.defaultPrevented, true, "Space activates the heading without scrolling the page");
	assert.deepEqual(entry.filterCalls, []);
});

test("custom ranges validate both endpoints and do not apply reversed or incomplete dates", async (t) => {
	const entry = entryHarness(t);
	await entry.render({ priorities: ["High"], tags: ["#work"] });
	await changeSelect(element(entry.container, ".dateScope"), "custom");
	await act(() => element<HTMLButtonElement>(entry.container, ".applyDateRange").click());
	assert.match(element(entry.container, ".filterError").textContent!, /both a start and an end/);
	assert.equal(entry.filterCalls.length, 0);
	const dates = entry.container.querySelectorAll<HTMLInputElement>(".dateRange input");
	await edit(dates[0], "2026-01-20");
	await edit(dates[1], "2026-01-10");
	await act(() => element<HTMLButtonElement>(entry.container, ".applyDateRange").click());
	assert.match(element(entry.container, ".filterError").textContent!, /End date/);
	assert.equal(entry.filterCalls.length, 0);
	await edit(dates[1], "2026-01-25");
	await act(() => element<HTMLButtonElement>(entry.container, ".applyDateRange").click());
	assert.deepEqual(entry.filterCalls.at(-1), ["2026-01-20", "2026-01-25", ["High"], ["#work"]]);
});

test("clear resets capture-independent filters, today focus and the selected category", async (t) => {
	const entry = entryHarness(t);
	await entry.render({ priorities: ["High"], tags: ["#work"] });
	await edit(element(entry.container, ".newTask"), "keep my draft");
	await entry.counter("todo");
	await act(() => element<HTMLElement>(entry.container, ".todayHeader").click());
	await act(() => element<HTMLButtonElement>(entry.container, ".clearFilters").click());
	assert.equal(entry.todayFocus(), false);
	assert.deepEqual(entry.counterCalls, ["todo"]);
	assert.deepEqual(entry.filterCalls.at(-1), [undefined, undefined, [], []]);
	assert.equal(element<HTMLInputElement>(entry.container, ".newTask").value, "keep my draft");
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
