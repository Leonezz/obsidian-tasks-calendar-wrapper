// Pins the bridge's list transition, store catch-up and commit-report order (#252).
// Must stay green, unchanged, when the bridge becomes a function component.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement, Fragment, startTransition, Suspense, useLayoutEffect, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Store, Task } from "@tasks-calendar-wrapper/core";
import type { TimelineState } from "../src/state/timeline";
import { defaultUserOptions } from "../src/useroptions";
import { TasksTimelineView, timelineTaskIndex } from "../src/views";
import type { WriteEvent } from "../timeline/src/taskwriter";
import { mountBridge, onTimelineRender } from "./component-harness";
import { Notice } from "./stubs/obsidian";
import { deferred, flush, writerHarness } from "./writer-harness";

async function mountTimeline(
	t: TestContext,
	text = "- [ ] a",
	probe: {
		beforeMount?: (fixture: {
			h: ReturnType<typeof writerHarness>;
			view: TasksTimelineView;
			store: Store<TimelineState>;
		}) => void | Promise<void>;
		wrap?: (element: ReactNode) => ReactNode;
	} = {},
) {
	const h = writerHarness({ "Note.md": text });
	const index = timelineTaskIndex(h.app as never);
	const writer = h.create({ index });
	let listener: ((event: WriteEvent) => void) | undefined;
	const view = new TasksTimelineView(
		{ app: h.app } as never,
		index,
		{
			...writer,
			onWrite: (callback) => {
				listener = callback;
				return writer.onWrite(callback);
			},
		},
		{ undo: () => new Notice("Undo", 10000) as never },
	);
	h.leaves.push({ view });
	const { store } = view as unknown as { store: Store<TimelineState> };
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		await act(() => root.unmount());
		await view.onClose();
		writer.dispose();
		index.dispose();
		container.remove();
	});
	await view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
	await probe.beforeMount?.({ h, view, store });
	const reports: number[] = [];
	const { bridge, element } = mountBridge({
		plugin: view,
		store,
		writer: view.viewWriter,
		ledger: view.ledger,
		pendingWrites: view.pendingWrites,
		onWriteResult: view.onWriteResult,
		onListCommitted: (id) => {
			reports.push(id);
			view.onListCommitted(id);
		},
	});
	const render = () =>
		root.render(createElement(Suspense, { fallback: null }, probe.wrap ? probe.wrap(element) : element));
	await act(render);
	const reload = async (next: string) => {
		h.put("Note.md", next);
		await h.deliver();
		await view.onReloadTasks();
	};
	const click = async (selector: string) => {
		const control = container.querySelector<HTMLElement>(selector);
		assert.ok(control);
		await act(async () => {
			control.click();
			await flush();
		});
	};
	const feed = (event: WriteEvent) => {
		assert.ok(listener);
		listener(event);
	};
	return { h, view, store, container, bridge, reports, render, reload, click, feed };
}

function pauseList(t: TestContext, when: (props: Parameters<Parameters<typeof onTimelineRender>[1]>[0]) => boolean) {
	const gate = deferred();
	let blocked = true;
	let attempts = 0;
	const rendered: (readonly Task[])[] = [];
	const Pause = () => {
		attempts++;
		throw gate.promise;
	};
	onTimelineRender(t, (props, result) => {
		rendered.push(props.tasks);
		return blocked && when(props) ? createElement(Fragment, null, result, createElement(Pause)) : result;
	});
	return {
		rendered,
		attempts: () => attempts,
		resolve: async () => {
			blocked = false;
			gate.resolve();
			await gate.promise;
		},
	};
}

function assertRows(container: HTMLElement, expected: string[]) {
	const timeline = container.querySelector<HTMLElement>(".taskido");
	assert.ok(timeline);
	assert.notEqual(timeline.style.display, "none", "the committed timeline is visible, not the Suspense fallback");
	const rows = [...container.querySelectorAll(".task")];
	assert.deepEqual(
		rows.map((row) => row.querySelector(".content")?.textContent?.trim()),
		expected,
	);
}

async function clickCounter(container: HTMLElement) {
	const counter = container.querySelector<HTMLElement>("#unplanned");
	assert.ok(counter);
	await act(() => flushSync(() => counter.click()));
	assert.ok(container.querySelector(".taskido.unplannedFilter"));
}

test("list change renders in a transition (an urgent counter click during it is not blocked)", async (t) => {
	const pause = pauseList(t, (props) => props.tasks.length > 1);
	const f = await mountTimeline(t);
	const before = f.store.getSnapshot();
	await act(() => f.reload("- [ ] a\n- [ ] b"));
	assert.notEqual(f.store.getSnapshot().shown, before.shown);
	assert.ok(pause.attempts() > 0, "the new list rendered and suspended");
	await clickCounter(f.container);
	assertRows(f.container, ["a"]);
	await act(pause.resolve);
	assertRows(f.container, ["a", "b"]);
	assert.equal(f.bridge.current!.state.tasks, f.store.getSnapshot().tasks);
});

test("a store change between render and subscribe is caught", async (t) => {
	let changed = false;
	const f = await mountTimeline(t, "- [ ] a", {
		beforeMount: async ({ h, view, store }) => {
			const before = store.getSnapshot();
			h.put("Note.md", "- [ ] b\n- [ ] c");
			await h.deliver();
			await view.onUpdateOptions({ ...before.options, useRelative: false });
			const next = store.getSnapshot();
			store.setState(before);
			const ChangeBeforeSubscribe = () => {
				useLayoutEffect(() => {
					if (changed) return;
					changed = true;
					store.setState(next);
				}, []);
				return null;
			};
			onTimelineRender(t, (_props, result) =>
				createElement(Fragment, null, result, createElement(ChangeBeforeSubscribe)),
			);
		},
	});
	assert.equal(changed, true);
	assertRows(f.container, ["b", "c"]);
	assert.ok(f.container.querySelector(".taskido.noRelative"));
	assert.equal(f.bridge.current!.state.tasks, f.store.getSnapshot().tasks);
});

test("onListCommitted reports each reloadId once, in commit order", async (t) => {
	const pause = pauseList(t, (props) => props.tasks.length > 2 && props.quickFilter !== undefined);
	const f = await mountTimeline(t);
	assert.deepEqual(f.reports, [1]);
	await act(() => f.reload("- [ ] a\n- [ ] b"));
	assertRows(f.container, ["a", "b"]);
	assert.deepEqual(f.reports, [1, 2]);
	const shown = f.store.getSnapshot().shown;
	await act(() => f.view.onReloadTasks());
	assert.equal(f.store.getSnapshot().shown, shown);
	assert.equal(f.store.getSnapshot().reloadId, 3);
	await act(() => f.view.onUpdateOptions({ ...f.store.getSnapshot().options, useRelative: false }));
	assert.ok(f.container.querySelector(".taskido.noRelative"));
	assert.equal(f.store.getSnapshot().reloadId, 4);
	await act(() => f.bridge.current!.handleFilterEnable(undefined, undefined, [], ["#later"]));
	assertRows(f.container, []);
	assert.deepEqual(f.reports, [1, 2]);
	await act(() => f.reload("- [ ] a\n- [ ] b\n- [ ] c"));
	assert.ok(pause.attempts() > 0);
	assert.deepEqual(f.reports, [1, 2]);
	await act(async () => assert.equal(await f.bridge.current!.handleCreateNewTask("Note.md", "new"), true));
	assertRows(f.container, ["a", "b", "c"]);
	assert.equal(f.bridge.current!.state.reloadId, 5);
	assert.deepEqual(f.reports, [1, 2, 5]);
	await act(pause.resolve);
	assertRows(f.container, ["a", "b", "c"]);
	assert.deepEqual(f.reports, [1, 2, 5]);
});

test("the 120 s cap list also transitions", async (t) => {
	const f = await mountTimeline(t);
	const before = f.store.getSnapshot();
	const pause = pauseList(t, (props) => props.tasks !== before.tasks);
	await act(async () => {
		// The writer's 120 s cap releases the hold and emits this recheck through its public listener.
		f.feed({ kind: "recheck", id: 1, path: "Note.md", line: 0, sourceLine: "- [ ] a", lines: ["- [x] a"] });
		await f.reload("- [ ] a");
	});
	const after = f.store.getSnapshot();
	assert.equal(after.shown, before.shown);
	assert.notEqual(after.taskRevision, before.taskRevision);
	assert.notEqual(after.tasks[0], before.tasks[0]);
	assert.ok(pause.attempts() > 0, "the taskRevision-only list rendered and suspended");
	pause.rendered.length = 0;
	await clickCounter(f.container);
	assertRows(f.container, ["a"]);
	assert.ok(pause.rendered.includes(before.tasks), "the urgent counter rendered the old task objects");
	await act(pause.resolve);
	assertRows(f.container, ["a"]);
	assert.equal(f.bridge.current!.state.tasks, f.store.getSnapshot().tasks);
});

test("the commit report clears overlays before the parent's layout effects", async (t) => {
	let recording = false;
	const observations: { cleared: boolean; marker: string | null | undefined }[] = [];
	const Parent = ({ children }: { children: ReactNode }) => {
		useLayoutEffect(() => {
			if (recording)
				observations.push({
					cleared: f.view.pendingWrites.getSnapshot("Note.md:0") === undefined,
					marker: f.container.querySelector(".task input")?.getAttribute("data-task"),
				});
		});
		return children;
	};
	const f = await mountTimeline(t, "- [ ] a", { wrap: (element) => createElement(Parent, { children: element }) });
	await f.click(".task label.icon");
	assert.ok(f.view.pendingWrites.getSnapshot("Note.md:0"));
	assert.equal(f.container.querySelector(".task")?.getAttribute("aria-busy"), "true");
	await act(async () => {
		await f.h.deliver();
		await f.view.onReloadTasks();
		assert.ok(f.view.pendingWrites.getSnapshot("Note.md:0"), "the overlay waits for the list commit");
		recording = true;
		// Rerender the parent in the list's transition so its layout effect observes that commit.
		startTransition(f.render);
	});
	assert.deepEqual(observations, [{ cleared: true, marker: "x" }]);
	assertRows(f.container, ["a"]);
	assert.equal(f.container.querySelector(".task")?.hasAttribute("aria-busy"), false);
});

test("a reload that ends before the transition renders, with the same list shown, brings its tasks along", async (t) => {
	const f = await mountTimeline(t);
	const before = f.bridge.current!.state.tasks;
	await act(async () => {
		await f.reload("- [ ] renamed");
		const first = f.store.getSnapshot();
		await f.reload("- [ ] renamed");
		const second = f.store.getSnapshot();
		assert.equal(second.shown, first.shown);
		assert.notEqual(second.tasks, first.tasks);
		assert.notEqual(second.tasks[0], first.tasks[0]);
		assert.equal(f.bridge.current!.state.tasks, before, "both reloads ended before the transition rendered");
		assertRows(f.container, ["a"]);
	});
	assertRows(f.container, ["renamed"]);
	assert.equal(f.bridge.current!.state.tasks, f.store.getSnapshot().tasks);
	assert.equal(f.bridge.current!.state.reloadId, 3);
	assert.deepEqual(f.reports, [1, 3]);
});

test("quick entry during a pending list transition stays urgent and the transition does not restore the quick filter", async (t) => {
	const pause = pauseList(t, (props) => props.tasks.length > 2 && props.quickFilter !== undefined);
	const f = await mountTimeline(t, "- [ ] a 📅 2026-01-15\n- [ ] b 📅 2026-01-16");
	// An inclusive today-only range keeps a and leaves out tomorrow's b.
	await act(() => f.bridge.current!.handleFilterEnable("2026-01-15", "2026-01-15", []));
	assertRows(f.container, ["a"]);
	await act(() => f.reload("- [ ] a 📅 2026-01-15\n- [ ] b 📅 2026-01-16\n- [ ] c 📅 2026-01-15"));
	assert.ok(pause.attempts() > 0);
	assertRows(f.container, ["a"]);
	await act(() => {
		// The quick entry's successful-write update must commit before the pending transition can replay.
		flushSync(() => f.bridge.current!.onUpdateTasks());
		assert.equal(f.bridge.current!.state.quickFilter, undefined);
		assert.equal(f.bridge.current!.state.tasks, f.store.getSnapshot().tasks);
		assertRows(f.container, ["a", "c", "b"]);
		assert.deepEqual(f.reports, [1, 2]);
	});
	await act(pause.resolve);
	assert.equal(f.bridge.current!.state.quickFilter, undefined);
	assertRows(f.container, ["a", "c", "b"]);
	assert.deepEqual(f.reports, [1, 2]);
});

test("options pushed while a list transition is pending apply urgently, and the list still transitions", async (t) => {
	const pause = pauseList(t, (props) => props.tasks.length > 1);
	const f = await mountTimeline(t);
	await act(() => f.reload("- [ ] a\n- [ ] b"));
	assert.ok(pause.attempts() > 0);
	const attempts = pause.attempts();
	await act(() => f.view.onUpdateOptions({ ...f.store.getSnapshot().options, useRelative: false }));
	assert.ok(f.container.querySelector(".taskido.noRelative"));
	assertRows(f.container, ["a"]);
	assert.ok(pause.attempts() > attempts, "the list retried and stayed suspended after the urgent option commit");
	assert.deepEqual(f.reports, [1]);
	await act(pause.resolve);
	assertRows(f.container, ["a", "b"]);
	assert.ok(f.container.querySelector(".taskido.noRelative"));
	assert.equal(f.bridge.current!.state.tasks, f.store.getSnapshot().tasks);
	assert.deepEqual(f.reports, [1, 3]);
});
