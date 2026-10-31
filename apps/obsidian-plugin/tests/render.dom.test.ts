// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import { GOLDEN_NOW } from "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";

import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { providerValues, renderedDays, rendersOf, resetRenderCounts } from "../timeline/src/components/renderprobe";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { moment } from "../utils/moment";
import { notesApp, openView } from "./view-harness";
import type { TaskWriter, WriteResult } from "../timeline/src/taskwriter";
import { deferred } from "./writer-harness";

/** The view's bridge mounted in a real DOM, with its store already loaded. */
async function mountTimeline(t: TestContext, notes: Record<string, string>, writer?: Pick<TaskWriter, "insert">) {
	const app = notesApp(notes);
	Object.assign(app.vault, { getFileByPath: (path: string) => (path in notes ? { path } : null) });
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
		root.render(
			createElement(ObsidianBridge, {
				plugin: { app } as never,
				store: opened.store,
				writer: writer ?? opened.writer,
				ref: bridge,
			}),
		);
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

test("one task changed re-renders one row", async (t) => {
	const notes = {
		"A.md": "- [ ] alpha 📅 2026-01-20",
		"B.md": "- [ ] beta 📅 2026-01-25",
		"C.md": "- [ ] gamma 📅 2026-01-27",
	};
	const { opened, container } = await mountTimeline(t, notes);
	resetRenderCounts();
	await act(async () => {
		notes["B.md"] = "- [ ] beta, renamed 📅 2026-01-25";
		opened.edited("B.md");
		await opened.view.onReloadTasks();
	});
	assert.ok([...container.querySelectorAll(".task .content")].some((row) => row.textContent === "beta, renamed"));
	assert.equal(rendersOf("TaskItemView"), 1);
	assert.equal(rendersOf("DateView"), 1);
	assert.deepEqual(renderedDays(), ["2026-01-25"]);
});

test("unchanged options keep provider values", async (t) => {
	const { opened } = await mountTimeline(t, {
		"A.md": "- [ ] alpha 📅 2026-01-20",
		"B.md": "- [ ] beta 📅 2026-01-25",
		"C.md": "- [ ] gamma 📅 2026-01-27",
	});
	const before = providerValues();
	for (const name of ["QuickEntryHandlerContext", "TodayFocusEventHandlersContext", "UserOptionContext"] as const)
		assert.ok(before[name], name);
	resetRenderCounts();
	await act(async () => {
		await opened.view.onUpdateOptions(structuredClone(opened.store.getSnapshot().options));
	});
	const after = providerValues();
	assert.equal(rendersOf("TaskItemView"), 0);
	assert.equal(rendersOf("DateView"), 0);
	for (const name of ["QuickEntryHandlerContext", "TodayFocusEventHandlersContext", "UserOptionContext"] as const)
		assert.strictEqual(after[name], before[name], name);
});

test("an equal quick filter keeps its provider and the unsubmitted draft", async (t) => {
	const { container, bridge } = await mountTimeline(t, { "A.md": "- [ ] alpha 📅 2026-01-20" });
	await select(container, "select.actionName", "filter");
	await select(container, "select.filterSelector", "date");
	const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
	await act(() => {
		setDate(dates[0], "2026-01-19");
		setDate(dates[1], "2026-01-21");
	});
	const apply = container.querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(apply && bridge.current);
	await act(() => apply.click());
	const before = providerValues().QuickEntryHandlerContext;
	const filter = bridge.current.state.quickFilter;
	assert.ok(filter);
	await act(() => setDate(dates[0], "2026-01-18"));
	resetRenderCounts();
	await act(() => bridge.current!.handleFilterEnable(filter.from, filter.to, [...filter.priorities]));
	assert.strictEqual(bridge.current.state.quickFilter, filter);
	assert.strictEqual(providerValues().QuickEntryHandlerContext, before);
	assert.equal(dates[0].value, "2026-01-18");
	assert.equal(rendersOf("TaskItemView"), 0);
	assert.equal(rendersOf("DateView"), 0);
});

test("changed counts update the entry while its counter and focus handlers still work", async (t) => {
	const notes = {
		"A.md": "- [ ] alpha 📅 2026-01-20",
		"B.md": "- [ ] beta 📅 2026-01-25",
		"C.md": "- [ ] gamma 📅 2026-01-27",
	};
	const { opened, container } = await mountTimeline(t, notes);
	assert.equal(container.querySelector("#todo .count")?.textContent, "3");
	resetRenderCounts();
	await act(async () => {
		notes["B.md"] = "- [x] beta 📅 2026-01-25";
		opened.edited("B.md");
		await opened.view.onReloadTasks();
	});
	assert.equal(container.querySelector("#todo .count")?.textContent, "2");
	assert.equal(rendersOf("TaskItemView"), 0);
	assert.deepEqual(renderedDays(), ["2026-01-15"]);
	const timeline = container.querySelector(".taskido");
	const focus = container.querySelector<HTMLElement>(".todayHeader");
	const unplanned = container.querySelector<HTMLElement>("#unplanned");
	const todo = container.querySelector<HTMLElement>("#todo");
	assert.ok(timeline && focus && unplanned && todo);
	const before = providerValues().TodayFocusEventHandlersContext;
	await act(() => focus.click());
	assert.ok(timeline.classList.contains("todayFocus"));
	await act(() => focus.click());
	assert.ok(!timeline.classList.contains("todayFocus"));
	assert.strictEqual(providerValues().TodayFocusEventHandlersContext, before);
	await act(() => unplanned.click());
	assert.ok(timeline.classList.contains("unplannedFilter"));
	assert.equal(container.querySelectorAll(".task").length, 0);
	await act(() => todo.click());
	assert.ok(timeline.classList.contains("todoFilter"));
	assert.equal(container.querySelectorAll(".task").length, 2);
	await act(() => todo.click());
	assert.ok(!timeline.classList.contains("todoFilter"));
});

test("quick-entry targets update without rendering task rows or other days", async (t) => {
	const { opened, container } = await mountTimeline(t, {
		"A.md": "- [ ] alpha 📅 2026-01-20",
		"B.md": "- [ ] beta 📅 2026-01-25",
	});
	const targets = () => [...container.querySelectorAll<HTMLOptionElement>(".fileSelect option")].map((o) => o.value);
	const before = targets();
	const taskFiles = ["Projects/Capture.md", "Projects/Later.md"];
	resetRenderCounts();
	await act(async () => {
		await opened.view.onUpdateOptions({ ...opened.store.getSnapshot().options, taskFiles });
	});
	assert.deepEqual(targets(), [...taskFiles, ...before]);
	assert.equal(rendersOf("TaskItemView"), 0);
	assert.deepEqual(renderedDays(), ["2026-01-15"]);
});

test("each row option refreshes the cached model and its visible fields", async (t) => {
	const { opened, container } = await mountTimeline(t, {
		"A.md": "- [ ] alpha #work #home 📅 2026-01-16",
	});
	const changes: { options: Partial<UserOption>; check: () => void }[] = [
		{
			options: { dateFormat: "YYYY/MM/DD" },
			check: () =>
				assert.equal(
					container.querySelector('.task [aria-label^="due at "]')?.getAttribute("aria-label"),
					"due at 2026/01/16",
				),
		},
		{
			options: { hideTags: ["#home"] },
			check: () =>
				assert.deepEqual(
					[...container.querySelectorAll(".task .tag")].map((tag) => tag.getAttribute("href")),
					["#work"],
				),
		},
		{
			options: { tagColorPalette: { "#work": "#123456" } },
			check: () =>
				assert.equal(
					container.querySelector<HTMLElement>(".task .tag")?.style.getPropertyValue("--tag-color"),
					"#123456",
				),
		},
		{
			options: { useBuiltinStyle: false },
			check: () => {
				assert.equal(container.querySelector(".task input[type=checkbox]")?.className, "");
				assert.equal(container.querySelector(".task label.icon"), null);
			},
		},
	];
	for (const change of changes) {
		resetRenderCounts();
		await act(async () => {
			await opened.view.onUpdateOptions({ ...opened.store.getSnapshot().options, ...change.options });
		});
		assert.equal(rendersOf("TaskItemView"), 1);
		change.check();
	}
});

test("row models last within a day and refresh with the locale and next day", async (t) => {
	const { container } = await mountTimeline(t, { "A.md": "- [ ] alpha 📅 2026-01-16" });
	const previousNow = moment.now;
	const previousLocale = moment.locale();
	t.after(() => {
		moment.now = previousNow;
		moment.locale(previousLocale);
	});
	const focus = container.querySelector<HTMLElement>(".todayHeader");
	assert.ok(focus);
	const label = () => container.querySelector('.task [aria-label^="due at "] .label')?.textContent;
	assert.equal(label(), "Tomorrow");
	moment.now = () => GOLDEN_NOW + 60 * 60 * 1000;
	resetRenderCounts();
	await act(() => focus.click());
	assert.equal(rendersOf("TaskItemView"), 0);
	assert.equal(rendersOf("DateView"), 0);
	moment.locale("zh-cn");
	resetRenderCounts();
	await act(() => focus.click());
	assert.equal(label(), "明天");
	assert.equal(rendersOf("TaskItemView"), 1);
	moment.now = () => GOLDEN_NOW + 24 * 60 * 60 * 1000;
	resetRenderCounts();
	await act(() => focus.click());
	assert.equal(label(), "今天");
	assert.equal(rendersOf("TaskItemView"), 1);
	const dailyNote = moment().format(defaultUserOptions.dailyNoteFormat) + ".md";
	assert.ok(
		[...container.querySelectorAll<HTMLOptionElement>(".fileSelect option")].some((o) => o.value === dailyNote),
	);
});

for (const outcome of ["refused", "failed"] as const) {
	test(`quick entry keeps its input text on ${outcome} and clears it after success`, async (t) => {
		const pending = deferred<WriteResult>();
		const calls: { path: string; text: string }[] = [];
		let result: WriteResult =
			outcome === "refused"
				? { kind: "refused", reason: "not-utf8", message: "Inbox is not saved as UTF-8." }
				: { kind: "failed", unknownOutcome: false, error: new Error("disk full") };
		const writer: Pick<TaskWriter, "insert"> = {
			async insert(path, edit) {
				calls.push({ path, text: edit("## Tasks\n") });
				return calls.length === 1 ? pending.promise : result;
			},
		};
		const { opened, container } = await mountTimeline(t, { "Inbox.md": "- [ ] older" }, writer);
		await act(() =>
			opened.view.onUpdateOptions({
				...defaultUserOptions,
				taskFiles: ["Inbox.md"],
				sectionForNewTasks: "## Tasks",
			}),
		);
		const input = container.querySelector<HTMLInputElement>('.quickEntryPanel input[type="text"]');
		const submit = container.querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
		assert.ok(input && submit);
		input.value = "keep this draft";
		await act(() => submit.click());
		assert.equal(input.value, "keep this draft", "while the writer is still running");
		await act(async () => {
			pending.resolve(result);
		});
		assert.equal(input.value, "keep this draft");
		assert.deepEqual(calls, [{ path: "Inbox.md", text: "## Tasks\n- [ ] keep this draft\n" }]);
		result = { kind: "written", delta: 1, indexed: Promise.resolve() };
		await act(() => submit.click());
		assert.equal(input.value, "");
		assert.equal(calls.length, 2);
	});
}
