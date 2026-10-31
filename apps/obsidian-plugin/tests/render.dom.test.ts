// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import { GOLDEN_NOW } from "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, createRef, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTaskLine, type Store, type Task } from "@tasks-calendar-wrapper/core";
import { Notice } from "./stubs/obsidian";

import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { TasksTimelineView, timelineTaskIndex } from "../src/views";
import type { TimelineState } from "../src/state/timeline";
import { providerValues, renderedDays, rendersOf, resetRenderCounts } from "../timeline/src/components/renderprobe";
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from "../timeline/src/components/context";
import { TimelineView } from "../timeline/src/components/timelineview";
import { StripWithIcon } from "../timeline/src/components/statusmarker";
import { getTaskStatusIcon } from "../timeline/src/components/asserts/icons";
import { createPendingWrites } from "../timeline/src/pendingwrites";
import { clickTime, clickIsGuarded } from "../timeline/src/components/clickguard";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { moment } from "../utils/moment";
import { notesApp, openView } from "./view-harness";
import type { TaskWriter, WriteEvent, WriteResult } from "../timeline/src/taskwriter";
import { deferred, flush, writerHarness } from "./writer-harness";

async function mountWritingTimeline(t: TestContext, text: string, toggle?: (line: string) => string) {
	const h = writerHarness({ "Note.md": text });
	Object.assign(h.app, { plugins: { plugins: {} } });
	const index = timelineTaskIndex(h.app as never);
	const writer = h.create({ index, ...(toggle ? { tasks: () => ({ kind: "toggle" as const, toggle }) } : {}) });
	const undo: (() => Promise<void>)[] = [];
	const view = new TasksTimelineView({ app: h.app } as never, index, writer, {
		undo(_context, _change, run) {
			undo.push(async () => {
				await run();
			});
			return new Notice("Undo", 10000) as never;
		},
	});
	h.leaves.push({ view });
	const store = (view as unknown as { store: Store<TimelineState> }).store;
	await view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	await act(() =>
		root.render(
			createElement(ObsidianBridge, {
				plugin: view,
				store,
				writer: view.viewWriter,
				ledger: view.ledger,
				pendingWrites: view.pendingWrites,
				onWriteResult: view.onWriteResult,
			}),
		),
	);
	t.after(async () => {
		await act(() => root.unmount());
		await view.onClose();
		writer.dispose();
		index.dispose();
		container.remove();
	});
	const click = async (line: number) => {
		const control = container.querySelector<HTMLElement>(`.task[data-line="${line}"] label.icon`);
		assert.ok(control);
		await act(async () => {
			control.click();
			await flush();
		});
	};
	return { h, view, store, writer, undo, container, click };
}

/** A display-only writer event, mounted through the same stable store as a view. */
async function mountPendingRow(t: TestContext, sourceLine: string, lines: readonly string[]) {
	const task = parseTaskLine(sourceLine, { moment, path: "Note.md" });
	assert.ok(task);
	const pending = createPendingWrites();
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	const options = { ...defaultUserOptions, hideStatusTasks: [] };
	let tasks: readonly Task[] = [task];
	let writes = 0;
	let opens = 0;
	const callbacks = {
		handleOpenFile: () => {
			opens++;
		},
		handleTagClick: () => {},
		handleModifyTask: () => {
			writes++;
		},
		handleCompleteTask: () => {
			writes++;
			pending.apply(
				{ id: 1, kind: "pending", path: task.path, line: task.line, sourceLine, lines },
				tasks,
				options,
				{ now: moment(), moment },
			);
		},
	};
	const timeline = createRef<TimelineView>();
	const render = () =>
		root.render(
			createElement(
				TaskItemEventHandlersContext.Provider,
				{ value: callbacks },
				createElement(TimelineView, { ref: timeline, tasks, userOptions: options, pendingWrites: pending }),
			),
		);
	await act(render);
	t.after(async () => {
		await act(() => root.unmount());
		container.remove();
	});
	const click = async (selector = ".task label.icon") => {
		const control = container.querySelector<HTMLElement>(selector);
		assert.ok(control);
		await act(() => control.click());
	};
	return {
		container,
		pending,
		timeline,
		task,
		click,
		writes: () => writes,
		opens: () => opens,
		renderTasks: async (next: readonly Task[]) => {
			tasks = next;
			await act(render);
		},
		commit: (next: readonly Task[]) => {
			tasks = next;
			render();
		},
	};
}

function assertIcon(container: HTMLElement, status: string, marker: string) {
	assert.equal(
		container.querySelector(".task label.icon")?.innerHTML,
		renderToStaticMarkup(getTaskStatusIcon(status)),
	);
	assert.equal(container.querySelector(".task input")?.getAttribute("data-task"), marker);
	assert.equal(container.querySelector(".task")?.getAttribute("aria-busy"), "true");
	assert.equal(container.querySelector(".task")?.getAttribute("aria-disabled"), "true");
	assert.equal(container.querySelector(".task input")?.hasAttribute("disabled"), false);
}

test("' '→'x' shows the done icon", async (t) => {
	const row = await mountPendingRow(t, "- [ ] a", ["- [x] a"]);
	await row.click();
	assertIcon(row.container, "done", "x");
	await row.click();
	await row.click(".modify");
	assert.equal(row.writes(), 1);
	assert.equal(row.opens(), 0, "a dimmed edit click does not open the note");
});

test("custom cycle shows in-progress", async (t) => {
	const row = await mountWritingTimeline(t, "- [ ] a", () => "- [/] a");
	await row.click(0);
	assertIcon(row.container, "process", "/");
});

test("un-complete shows the resolved status", async (t) => {
	const before = moment.now;
	moment.now = () => Date.parse("2026-10-24T12:00:00Z");
	t.after(() => {
		moment.now = before;
	});
	const row = await mountPendingRow(t, "- [x] a 📅 2026-10-01 ✅ 2026-10-02", ["- [ ] a 📅 2026-10-01"]);
	await row.click();
	assertIcon(row.container, "overdue", " ");
});

test("recurring completion picks the done line", async (t) => {
	const row = await mountPendingRow(t, "- [ ] a 🔁 every day 📅 2026-01-15", [
		"- [ ] a 🔁 every day 📅 2026-01-16",
		"- [x] a 🔁 every day 📅 2026-01-15 ✅ 2026-01-15",
	]);
	await row.click();
	assertIcon(row.container, "done", "x");
});

test("recurring completion then Undo keeps both shifts", async (t) => {
	const original = "- [ ] a 🔁 every day 📅 2026-01-15";
	const fixture = await mountWritingTimeline(t, original + "\n- [ ] b", (line) =>
		line === original
			? "- [ ] a 🔁 every day 📅 2026-01-16\n- [x] a 🔁 every day 📅 2026-01-15 ✅ 2026-01-15"
			: line.replace("[ ]", "[x]"),
	);
	await fixture.click(0);
	assert.equal(fixture.view.ledger.shift("Note.md", 1), 2);
	assert.equal(fixture.undo.length, 1);
	await fixture.h.clock.advance(1000);
	await act(() => fixture.undo[0]());
	assert.equal(fixture.view.ledger.shift("Note.md", 1), 1, "both +1 and -1 remain before re-read");
	await fixture.click(1);
	assert.equal(fixture.h.events.filter((event) => event.kind === "written").at(-1)?.line, 1);
	assert.equal(fixture.h.text("Note.md"), original + "\n- [x] b");
});

test("slow rows accept a checkbox click while keeping the written icon", async (t) => {
	const fixture = await mountWritingTimeline(t, "- [ ] a");
	fixture.h.setDelivery("dropped");
	await fixture.click(0);
	assert.equal(fixture.container.querySelector(".task")?.getAttribute("aria-busy"), "true");
	await act(() => fixture.h.clock.advance(10000));
	const row = fixture.container.querySelector(".task");
	assert.ok(row);
	assert.equal(row.hasAttribute("aria-busy"), false);
	assert.equal(row.hasAttribute("aria-disabled"), false);
	assert.equal(row.querySelector("input")?.getAttribute("data-task"), "x");
	assert.equal(row.querySelector("input")?.hasAttribute("disabled"), false);
	assert.equal(row.querySelector("label.icon")?.innerHTML, renderToStaticMarkup(getTaskStatusIcon("done")));
	await fixture.click(0);
	assert.equal(fixture.h.refusals.at(-1)?.reason, "not-reread");
	assert.equal(fixture.h.events.filter((event) => event.kind === "written").length, 1);
	assert.equal(row.querySelector("input")?.getAttribute("data-task"), "x");
});

test("a pending write renders only its subscribed row and keeps provider values", async (t) => {
	const fixture = await mountWritingTimeline(t, "- [ ] a\n- [ ] b");
	const before = providerValues();
	const untouched = fixture.container.querySelector('.task[data-line="1"]');
	assert.ok(untouched);
	const html = untouched.outerHTML;
	const render = StripWithIcon.prototype.render;
	let icons = 0;
	t.mock.method(StripWithIcon.prototype, "render", function (this: StripWithIcon) {
		icons++;
		return render.call(this);
	});
	await fixture.click(0);
	assert.equal(icons, 1, "only the affected row renders its icon");
	assert.equal(untouched.outerHTML, html);
	const after = providerValues();
	for (const name of ["QuickEntryHandlerContext", "TodayFocusEventHandlersContext", "UserOptionContext"] as const)
		assert.strictEqual(after[name], before[name], name);
});

test("overlay cleared only in the commit that shows the written text", async (t) => {
	const row = await mountWritingTimeline(t, "- [ ] a");
	await row.click(0);
	const frames: string[] = [];
	const observer = new window.MutationObserver(() => {
		if (!row.container.querySelector(".task")?.hasAttribute("aria-busy"))
			frames.push(row.container.querySelector(".task input")?.getAttribute("data-task") ?? "missing");
	});
	observer.observe(row.container, { subtree: true, attributes: true, childList: true });
	await act(async () => {
		await row.h.deliver();
		await row.view.onReloadTasks();
	});
	observer.disconnect();
	assert.ok(frames.length > 0);
	assert.deepEqual([...new Set(frames)], ["x"]);
	assert.equal(row.container.querySelector(".task")?.hasAttribute("aria-disabled"), false);
});

test("click clock in a popout", (t) => {
	t.mock.method(performance, "now", () => 3602000);
	const event = { timeStamp: 1400, view: { performance: { now: () => 2000 } } } as unknown as MouseEvent;
	assert.equal(clickTime(event), 3601400);
	assert.equal(clickIsGuarded(event, { lastListChangeAt: 3601000 }), false);
});

test("click stamped before a list change is ignored", async (t) => {
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
	const row = await mountPendingRow(t, "- [ ] a", ["- [x] a"]);
	const b = parseTaskLine("- [ ] b", { moment, path: "Other.md" });
	assert.ok(b);
	await row.renderTasks([b, row.task]);
	const dispatch = async (selector: string, timeStamp: number) => {
		const event = new MouseEvent("click", { bubbles: true, view: window });
		Object.defineProperty(event, "timeStamp", { value: timeStamp });
		const control = row.container.querySelector<HTMLElement>(selector);
		assert.ok(control);
		await act(() => control.dispatchEvent(event));
	};
	await dispatch(".task label.icon", 990);
	await dispatch(".task .modify", 990);
	assert.equal(row.writes(), 0);
	assert.equal(row.opens(), 0);
	await dispatch(".task label.icon", 1400);
	assert.equal(row.writes(), 1);
});

test("pending writes map identical source lines only when the event line identifies one", () => {
	const sourceLine = "- [ ] same";
	const first = parseTaskLine(sourceLine, { moment, path: "Note.md" });
	assert.ok(first);
	const second = { ...first, line: 3, id: "Note.md:3" };
	const pending = createPendingWrites();
	const event: WriteEvent = { id: 1, kind: "pending", path: first.path, line: 2, sourceLine, lines: ["- [x] same"] };
	const apply = (next: WriteEvent, tasks = [first, second]) =>
		pending.apply(next, tasks, defaultUserOptions, { now: moment(), moment });
	apply(event);
	assert.equal(pending.getSnapshot(first.id), undefined);
	assert.equal(pending.getSnapshot(second.id), undefined);
	apply({ ...event, line: 3 });
	assert.equal(pending.getSnapshot(first.id), undefined);
	assert.equal(pending.getSnapshot(second.id)?.id, 1);
	apply({ ...event, id: 2, line: 20 }, [first]);
	assert.equal(pending.getSnapshot(first.id)?.id, 2, "a unique source match may have shifted");
});

test("pending writes release independently, keep pinned notes, and notify only their row", () => {
	const task = parseTaskLine("- [ ] a", { moment, path: "Note.md" });
	assert.ok(task);
	const pending = createPendingWrites();
	const notifications: string[] = [];
	const stop = pending.subscribe(task.id, () => notifications.push(task.id));
	pending.subscribe("Other.md:0", () => notifications.push("other"));
	const event: WriteEvent = {
		id: 1,
		kind: "pending",
		path: task.path,
		line: 0,
		sourceLine: task.sourceLine,
		lines: ["- [x] a"],
	};
	const apply = (next: WriteEvent) => pending.apply(next, [task], defaultUserOptions, { now: moment(), moment });
	apply(event);
	apply({ ...event, id: 2, lines: [task.sourceLine] });
	apply({ ...event, kind: "released", releaseSeq: 1 });
	pending.clearThrough(1);
	assert.equal(pending.getSnapshot(task.id)?.id, 2);
	assert.deepEqual(notifications, [task.id, task.id], "releasing an older prediction does not redraw the latest");
	apply({ ...event, id: 2, kind: "released", releaseSeq: 2 });
	pending.clearThrough(2, new Set([task.path]));
	assert.equal(pending.getSnapshot(task.id)?.id, 2);
	pending.clearThrough(2);
	assert.equal(pending.getSnapshot(task.id), undefined);
	assert.ok(notifications.every((id) => id === task.id));
	stop();
	const count = notifications.length;
	apply({ ...event, id: 3 });
	assert.equal(notifications.length, count);
});

test("an Undo of recurring completion predicts the restored status", () => {
	const sourceLine = "- [ ] a 🔁 every day 📅 2026-01-16";
	const task = parseTaskLine(sourceLine, { moment, path: "Note.md" });
	assert.ok(task);
	const pending = createPendingWrites();
	pending.apply(
		{ id: 1, kind: "pending", path: task.path, line: 0, sourceLine, lines: [sourceLine] },
		[task],
		defaultUserOptions,
		{ now: moment(), moment },
	);
	assert.equal(pending.getSnapshot(task.id)?.status, "scheduled");
	assert.equal(pending.getSnapshot(task.id)?.marker, " ");
});

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
				writer: { ...opened.writer, ...writer },
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
		result = { kind: "written", id: 1, delta: 1, indexed: Promise.resolve() };
		await act(() => submit.click());
		assert.equal(input.value, "");
		assert.equal(calls.length, 2);
	});
}

test("quick entry ignores a second submit while the first is pending", async (t) => {
	const first = deferred<boolean>();
	const second = deferred<boolean>();
	const error = new Error("adding a task failed");
	let rejection: Promise<void> | undefined;
	t.mock.method(second.promise, "then", (...callbacks: Parameters<Promise<boolean>["then"]>) => {
		const chained = Promise.prototype.then.call(second.promise, ...callbacks);
		rejection = assert.rejects(chained, error);
		return chained;
	});
	const { opened, container } = await mountTimeline(t, { "Inbox.md": "- [ ] older" });
	await act(() => opened.view.onUpdateOptions({ ...defaultUserOptions, taskFiles: ["Inbox.md"] }));
	const handlers = providerValues().QuickEntryHandlerContext as ContextType<typeof QuickEntryHandlerContext>;
	let calls = 0;
	const create = t.mock.method(handlers, "handleCreateNewTask", () => {
		calls++;
		if (calls === 1) return first.promise;
		if (calls === 2) return second.promise;
		return Promise.resolve(true);
	});
	const input = container.querySelector<HTMLInputElement>('.quickEntryPanel input[type="text"]');
	const submit = container.querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(input && submit);
	input.value = "add once";
	resetRenderCounts();
	await act(() => {
		submit.click();
		submit.click();
		input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
	});
	assert.equal(create.mock.callCount(), 1);
	assert.deepEqual(create.mock.calls[0].arguments, ["Inbox.md", "add once"]);
	assert.equal(input.value, "add once");
	await act(async () => first.resolve(true));
	assert.equal(input.value, "");
	assert.equal(rendersOf("TaskItemView"), 0);
	assert.equal(rendersOf("DateView"), 0);
	input.value = "retry this";
	await act(() => submit.click());
	assert.equal(create.mock.callCount(), 2);
	await act(async () => {
		second.reject(error);
		assert.ok(rejection, "the handler keeps rejection observable");
		await rejection;
	});
	assert.equal(input.value, "retry this");
	await act(() => submit.click());
	assert.equal(create.mock.callCount(), 3);
	assert.equal(input.value, "");
});
