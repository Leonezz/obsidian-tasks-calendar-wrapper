import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
	createDailyNoteDateCache,
	createResolvedTaskCache,
	createStore,
	type DateValue,
	type MomentFactory,
	type Task,
} from "@tasks-calendar-wrapper/core";
import { HostContext, type RowOverlay, type ViewActions, type ViewState } from "../src/contexts";
import type { UiHost, TimelineHandle } from "../src/host";
import { onTimelineRender, rendersOf, resetRenderCounts } from "../src/renderprobe";
import { Timeline, type TimelineOptions, type TimelineProps } from "../src/timeline/Timeline";

class FakeDate {
	private value: Date;

	constructor(input: string | number) {
		this.value = new Date(typeof input === "string" ? input + "T00:00:00Z" : input);
	}

	year(value?: number): number | this {
		if (value === undefined) return this.value.getUTCFullYear();
		this.value.setUTCFullYear(value);
		return this;
	}
	month() {
		return this.value.getUTCMonth();
	}
	date() {
		return this.value.getUTCDate();
	}
	hours() {
		return this.value.getUTCHours();
	}
	minutes() {
		return this.value.getUTCMinutes();
	}
	valueOf() {
		return this.value.valueOf();
	}
	isValid() {
		return Number.isFinite(this.valueOf());
	}
	clone() {
		return new FakeDate(this.valueOf());
	}
	format(format = "YYYY-MM-DD") {
		const year = String(this.year()).padStart(4, "0");
		const month = String(this.month() + 1).padStart(2, "0");
		const day = String(this.date()).padStart(2, "0");
		if (format === "YYYY") return year;
		if (format === "YYYYMMDD") return year + month + day;
		assert.equal(format, "YYYY-MM-DD");
		return `${year}-${month}-${day}`;
	}
	isSame(other: DateValue, unit: string) {
		assert.equal(unit, "day");
		return this.year() === other.year() && this.month() === other.month() && this.date() === other.date();
	}
	from() {
		return assert.fail("undated tasks have no relative date badges");
	}
}

function task(line: number, marker = "/"): Task {
	return {
		id: `Tasks.md:${line}`,
		note: { path: "Tasks.md", frontmatter: {}, tags: [] },
		path: "Tasks.md",
		line,
		lineCount: 1,
		position: { start: { line, col: 0, offset: 0 }, end: { line, col: 12, offset: 12 } },
		sourceLine: `- [${marker}] A task`,
		text: "A task",
		symbol: "-",
		statusMarker: marker,
		completed: false,
		fullyCompleted: marker !== " ",
		checked: marker !== " ",
		isTasksTask: false,
		visual: "A task",
		priority: "3",
		recurrence: "",
		tags: [],
		dates: {},
		extraDates: [],
		section: { path: "Tasks.md", type: "file", embed: false },
		outlinks: [],
	};
}

const options: TimelineOptions = {
	forward: true,
	dailyNoteFormat: "YYYY-MM-DD",
	dailyNoteFolder: "",
	taskFiles: ["Tasks.md"],
	inbox: "Tasks.md",
	useCounters: true,
	useQuickEntry: true,
	useYearHeader: true,
	useFileBadge: true,
	usePriority: true,
	useRecurrence: true,
	useRelative: true,
	useSection: true,
	useTags: true,
	useModifyBadge: true,
	counterBehavior: "Filter",
	defaultFilters: "",
	defaultTodayFocus: false,
	hideTags: [],
	tagColorPalette: {},
	dateFormat: "YYYY-MM-DD",
	useBuiltinStyle: true,
};

function harness(t: TestContext, count = 2_000, popup = false) {
	const iframe = popup ? document.body.appendChild(document.createElement("iframe")) : undefined;
	const doc = iframe?.contentDocument ?? document;
	const view = doc.defaultView!;
	const container = doc.body.appendChild(doc.createElement("div"));
	const viewport = doc.body.appendChild(doc.createElement("div"));
	viewport.append(container);
	let height = 300;
	Object.defineProperties(viewport, {
		clientHeight: { configurable: true, get: () => height },
		clientWidth: { configurable: true, get: () => width },
	});
	let width = 600;
	let defaultHeight = 60;
	let collapsedMargins = false;
	let escapedMargins = false;
	let contentPadding = 0;
	let items = Array.from({ length: count }, (_, i) => ({ ...task(i), text: `Task ${i}`, visual: `Task ${i}` }));
	const heights = new Map<number, number>();
	const frames = new Map<number, FrameRequestCallback>();
	let frameId = 0;
	t.mock.method(view, "requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++frameId;
		frames.set(id, callback);
		return id;
	});
	t.mock.method(view, "cancelAnimationFrame", (id: number) => frames.delete(id));
	const observers: Observer[] = [];
	class Observer {
		readonly elements = new Set<Element>();
		disconnected = false;
		constructor(readonly callback: ResizeObserverCallback) {
			observers.push(this);
		}
		observe(element: Element) {
			this.elements.add(element);
		}
		unobserve(element: Element) {
			this.elements.delete(element);
		}
		disconnect() {
			this.disconnected = true;
			this.elements.clear();
		}
	}
	const descriptor = Object.getOwnPropertyDescriptor(view, "ResizeObserver");
	const heightDescriptor = Object.getOwnPropertyDescriptor(view, "innerHeight");
	t.after(() =>
		heightDescriptor
			? Object.defineProperty(view, "innerHeight", heightDescriptor)
			: Reflect.deleteProperty(view, "innerHeight"),
	);
	Object.defineProperty(view, "ResizeObserver", { configurable: true, value: Observer });
	t.after(() =>
		descriptor
			? Object.defineProperty(view, "ResizeObserver", descriptor)
			: Reflect.deleteProperty(view, "ResizeObserver"),
	);
	const rect = (top: number, height: number) => ({
		x: 0,
		y: top,
		top,
		bottom: top + height,
		left: 0,
		right: width,
		width,
		height,
		toJSON() {},
	});
	const rowTop = (line: number) => {
		let top = collapsedMargins ? 360 : 240;
		for (const item of items) {
			if (item.line === line) return top;
			top += heights.get(item.line) ?? defaultHeight;
		}
		return top;
	};
	t.mock.method(view.HTMLElement.prototype, "getBoundingClientRect", function (this: HTMLElement) {
		if (this === viewport) return rect(0, height);
		const noYear = !!container.querySelector(".taskido.noYear");
		const flowOffset = contentPadding - (escapedMargins && noYear ? 52 : 0);
		if (this.classList.contains("taskido"))
			return rect(
				contentPadding +
					(escapedMargins ? (noYear ? 10 : container.querySelector(".year") ? 20 : 0) : 0) -
					viewport.scrollTop,
				(collapsedMargins ? 360 : 240) +
					items.reduce((sum, item) => sum + (heights.get(item.line) ?? defaultHeight), 0),
			);
		if (this.classList.contains("task")) {
			const line = Number(this.dataset.line);
			return rect(rowTop(line) + flowOffset - viewport.scrollTop, heights.get(line) ?? defaultHeight);
		}
		if (this.classList.contains("year"))
			return rect((collapsedMargins ? 20 : 0) + flowOffset - viewport.scrollTop, 22);
		if (this.classList.contains("todayHeader"))
			return rect((collapsedMargins ? 62 : 22) + flowOffset - viewport.scrollTop, 30);
		if (this.classList.contains("counters"))
			return rect((collapsedMargins ? 112 : 52) + flowOffset - viewport.scrollTop, 90);
		if (this.classList.contains("quickEntryPanel"))
			return rect((collapsedMargins ? 222 : 142) + flowOffset - viewport.scrollTop, 60);
		if (this.classList.contains("dateLine"))
			return rect((collapsedMargins ? 312 : 202) + flowOffset - viewport.scrollTop, 38);
		return rect(0, 0);
	});
	const moment: MomentFactory = Object.assign(
		(input: Parameters<MomentFactory>[0]) => new FakeDate(input as string) as unknown as ReturnType<MomentFactory>,
		{ locale: () => "en" },
	);
	let minRows: number | undefined;
	let handle: TimelineHandle | undefined;
	const overlays = new Map<string, RowOverlay>();
	const listeners = new Map<string, Set<() => void>>();
	const host: UiHost = {
		isMobile: false,
		now: () => moment("2026-01-15"),
		moment,
		renderMarkdown: (text) => text,
		windowing: {
			getScrollElement: () => viewport,
			getMinRows: () => minRows,
			connect: (value) => {
				handle = value;
			},
		},
	};
	const dateCache = createDailyNoteDateCache();
	const taskCache = createResolvedTaskCache();
	const viewState = createStore<ViewState>({ counter: "", todayFocus: false });
	const viewActions: ViewActions = {
		toggleTodayFocus: () => viewState.setState((state) => ({ ...state, todayFocus: !state.todayFocus })),
		toggleCounter: (id) =>
			viewState.setState((state) => ({
				...state,
				counter: state.counter === `${id}Filter` ? "" : `${id}Filter`,
			})),
	};
	const pendingWrites: TimelineProps["pendingWrites"] = {
		getSnapshot: (id) => overlays.get(id),
		subscribe: (id, listener) => {
			const set = listeners.get(id) ?? new Set();
			set.add(listener);
			listeners.set(id, set);
			return () => {
				set.delete(listener);
				if (set.size === 0) listeners.delete(id);
			};
		},
	};
	const root = createRoot(container);
	let closed = false;
	let clock = -Infinity;
	const stopProbe = onTimelineRender((_props, tree, value) => {
		clock = value.lastListChangeAt;
		return tree;
	});
	let currentOptions = options;
	async function flush() {
		for (let i = 0; frames.size && i < 30; i++) {
			const callbacks = [...frames.values()];
			frames.clear();
			await act(async () => {
				for (const callback of callbacks) callback(i * 16);
				await Promise.resolve();
			});
		}
		assert.equal(frames.size, 0, "viewport settles without an animation-frame loop");
	}
	async function render(next = items, extra: Partial<TimelineOptions> = {}) {
		items = next;
		currentOptions = { ...currentOptions, ...extra };
		await act(() =>
			root.render(
				createElement(
					HostContext.Provider,
					{ value: host },
					createElement(Timeline, {
						userOptions: currentOptions,
						viewState,
						viewActions,
						tasks: items,
						pendingWrites,
						queryEnv: (now) => ({ env: { now, moment, dateCache, taskCache } }),
					}),
				),
			),
		);
		await flush();
	}
	async function unmount() {
		if (closed) return;
		closed = true;
		await act(() => root.unmount());
		stopProbe();
		viewport.remove();
		iframe?.remove();
	}
	t.after(unmount);
	const row = (line: number) => container.querySelector<HTMLElement>(`.task[data-line="${line}"]`);
	return {
		container,
		viewport,
		view,
		observers,
		frames,
		row,
		render,
		unmount,
		flush,
		items: () => items,
		handle: () => {
			assert.ok(handle);
			return handle;
		},
		clock: () => clock,
		setViewportHeight: (value: number) => {
			height = value;
		},
		setWindowHeight: (value: number) => {
			Object.defineProperty(view, "innerHeight", { configurable: true, value });
		},
		setMinRows: (value: number) => {
			minRows = value;
		},
		setOverlay: (line: number, overlay: RowOverlay) => {
			overlays.set(`Tasks.md:${line}`, overlay);
			listeners.get(`Tasks.md:${line}`)?.forEach((listener) => listener());
		},
		resize: async (nextWidth: number, rowHeight = defaultHeight) => {
			width = nextWidth;
			defaultHeight = rowHeight;
			await act(() => {
				for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver);
			});
			await flush();
		},
		changeHeight: async (line: number, height: number) => {
			heights.set(line, height);
			await act(() => {
				for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver);
			});
			await flush();
		},
		useCollapsedMargins: (escape = false, padding = 0) => {
			collapsedMargins = true;
			escapedMargins = escape;
			contentPadding = padding;
			const style = doc.createElement("style");
			style.textContent =
				".year{margin:20px 0}.todayHeader{margin:10px 0}.counters{margin:20px 0}.quickEntryPanel{margin:0 0 20px}.dateLine{margin:10px 0}";
			doc.head.append(style);
			t.after(() => style.remove());
		},
		scrollTo: async (top: number) => {
			await act(() => {
				viewport.scrollTop = top;
				viewport.dispatchEvent(new view.Event("scroll"));
			});
			await flush();
		},
	};
}

test("renders only the range plus overscan", async (t) => {
	const f = harness(t);
	await f.render();
	assert.ok(f.container.querySelector(".taskido.tcw-windowed"));
	assert.ok(f.container.querySelector(".tcw-gap[aria-hidden=true]"));
	assert.ok(f.container.querySelectorAll(".task").length < 30);
	const clock = f.clock();
	await f.scrollTo(30_240);
	assert.ok(f.row(500));
	assert.equal(f.row(100), null);
	assert.ok(f.container.querySelectorAll(".task").length < 30);
	assert.equal(f.clock(), clock, "changing mounted rows does not change the full-list click guard");
});

test("the entry panel stays mounted when scrolled away and modes change", async (t) => {
	const f = harness(t);
	await f.render();
	const input = f.container.querySelector<HTMLInputElement>("input.newTask")!;
	input.value = "keep the draft";
	await act(() => input.focus());
	await f.scrollTo(60_240);
	assert.strictEqual(f.container.querySelector("input.newTask"), input);
	assert.strictEqual(f.view.document.activeElement, input);
	await f.render(f.items().slice(0, 799));
	assert.equal(f.handle().getWindowingInfo().windowed, false);
	assert.strictEqual(f.container.querySelector("input.newTask"), input);
	assert.equal(input.value, "keep the draft");
	await f.render(Array.from({ length: 1_001 }, (_, i) => task(i)));
	assert.equal(f.handle().getWindowingInfo().windowed, true);
	assert.strictEqual(f.container.querySelector("input.newTask"), input);
	assert.equal(input.value, "keep the draft");
});

test("the focused row stays mounted", async (t) => {
	const f = harness(t);
	await f.render();
	const row = f.row(0)!;
	await act(() => row.focus());
	await f.scrollTo(30_240);
	assert.strictEqual(f.row(0), row);
	assert.strictEqual(f.view.document.activeElement, row);
});

test("windowed rows report their position in the complete day list", async (t) => {
	const f = harness(t);
	await f.render();
	await f.scrollTo(30_240);
	assert.equal(f.row(500)?.getAttribute("aria-posinset"), "501");
	assert.equal(f.row(500)?.getAttribute("aria-setsize"), "2000");
	await f.render(f.items().slice(1));
	assert.equal(f.row(500)?.getAttribute("aria-posinset"), "500");
	assert.equal(f.row(500)?.getAttribute("aria-setsize"), "1999");
	await f.render(f.items().slice(0, 799));
	assert.equal(f.row(500)?.hasAttribute("aria-posinset"), false);
	assert.equal(f.row(500)?.hasAttribute("aria-setsize"), false);
});

test("a removed focused row restores its unmounted surviving neighbour", async (t) => {
	const f = harness(t);
	await f.render();
	let revealed!: Promise<boolean>;
	await act(() => {
		revealed = f.handle().revealTask("Tasks.md:500");
	});
	await f.flush();
	await revealed;
	await act(() => f.row(500)!.focus());
	await f.render(f.items().filter((item) => item.line > 500));
	assert.equal(f.handle().getWindowingInfo().windowed, true);
	assert.strictEqual(f.view.document.activeElement, f.row(501));
	const input = f.container.querySelector<HTMLInputElement>("input.newTask")!;
	await act(() => input.focus());
	await f.render(f.items().filter((item) => item.line > 501));
	assert.strictEqual(f.view.document.activeElement, input, "an input retains focus during later row removals");
});

test("an overlay on an off-window row shows when it scrolls in", async (t) => {
	const f = harness(t);
	await f.render();
	assert.equal(f.row(700), null);
	f.setOverlay(700, { dimmed: true, marker: "x", status: "done" });
	let revealed!: Promise<boolean>;
	await act(() => {
		revealed = f.handle().revealTask("Tasks.md:700");
	});
	await f.flush();
	assert.equal(await revealed, true);
	assert.equal(f.row(700)?.getAttribute("aria-busy"), "true");
	assert.equal(f.row(700)?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked, true);
});

test("below 1000 rows the markup equals the unwindowed markup", async (t) => {
	const f = harness(t, 174);
	await f.render();
	const markup = f.container.innerHTML;
	f.setMinRows(Infinity);
	await f.render();
	assert.equal(f.container.innerHTML, markup);
	assert.equal(f.container.querySelector(".tcw-gap"), null);
	assert.equal(f.container.querySelector("[data-tcw-day]"), null);
});

test("the 1000/800 boundaries have hysteresis", async (t) => {
	const f = harness(t, 1_000);
	await f.render();
	assert.equal(f.handle().getWindowingInfo().windowed, false);
	const tasks = (count: number) => Array.from({ length: count }, (_, i) => task(i));
	for (const [count, enabled] of [
		[1_001, true],
		[900, true],
		[800, true],
		[799, false],
		[900, false],
		[1_001, true],
	] as const) {
		await f.render(tasks(count));
		assert.equal(f.handle().getWindowingInfo().windowed, enabled, String(count));
	}
});

test("a list change keeps the anchor row at its offset", async (t) => {
	const f = harness(t);
	await f.render();
	await f.scrollTo(30_240);
	const before = f.row(500)!.getBoundingClientRect().top;
	const scroll = f.viewport.scrollTop;
	await f.render([task(-1), ...f.items()]);
	assert.equal(f.row(500)!.getBoundingClientRect().top, before);
	assert.equal(f.viewport.scrollTop, scroll + 60);
});

test("height and width changes keep the visible row anchored", async (t) => {
	const f = harness(t);
	await f.render();
	await f.scrollTo(30_240);
	const top = f.row(500)!.getBoundingClientRect().top;
	const scroll = f.viewport.scrollTop;
	await f.changeHeight(0, 80);
	assert.equal(f.viewport.scrollTop, scroll + 20);
	assert.equal(f.row(500)!.getBoundingClientRect().top, top);
	await f.resize(400, 80);
	assert.equal(f.row(500)!.getBoundingClientRect().top, top);
});

test("entry and year measurements use actual collapsed flow boundaries", async (t) => {
	const f = harness(t);
	f.useCollapsedMargins();
	await f.render();
	let revealed!: Promise<boolean>;
	await act(() => {
		revealed = f.handle().revealTask("Tasks.md:500");
	});
	await f.flush();
	assert.equal(await revealed, true);
	assert.equal(f.viewport.scrollTop, 30_360, "collapsed 10/20px margins must not be added twice");
	assert.equal(f.row(500)!.getBoundingClientRect().top, 0);
	for (let repeat = 0; repeat < 3; repeat++) await f.resize(600);
	assert.equal(f.viewport.scrollTop, 30_360, "repeated measurement does not drift");
});

test("escaped year margins and content padding survive measurement and year gaps", async (t) => {
	const f = harness(t);
	f.useCollapsedMargins(true, 12);
	await f.render();
	assert.equal(f.viewport.scrollTop, 0, "opening must not absorb the escaped 20px margin or 12px content padding");
	assert.equal(f.container.querySelector(".taskido")!.getBoundingClientRect().top, 32);
	assert.equal(f.row(0)!.getBoundingClientRect().top, 372);
	await f.scrollTo(5);
	await f.resize(400);
	assert.equal(f.viewport.scrollTop, 5, "a partial leading inset survives remeasurement");
	await f.render([task(-1), ...f.items()]);
	assert.equal(f.viewport.scrollTop, 5, "a list change does not clamp the leading inset");
	await f.scrollTo(30_432);
	assert.equal(f.container.querySelector(".year"), null, "the first year is now represented by a gap");
	const before = f.row(500)!.getBoundingClientRect().top;
	const scroll = f.viewport.scrollTop;
	await f.changeHeight(0, 80);
	assert.equal(f.viewport.scrollTop, scroll + 20);
	assert.equal(f.row(500)!.getBoundingClientRect().top, before);
	await f.scrollTo(0);
	assert.ok(f.container.querySelector(".year"));
	assert.equal(f.viewport.scrollTop, 0, "returning from a gap restores the header without a scroll correction");
	await f.resize(600);
	await f.render([...f.items()]);
	assert.equal(f.viewport.scrollTop, 0, "measurement and list changes preserve the fully visible leading inset");
});

test("an entry at geometry zero preserves its escaped margin and content padding", async (t) => {
	const f = harness(t);
	f.useCollapsedMargins(true, 12);
	await f.render(f.items(), { useYearHeader: false });
	assert.equal(f.viewport.scrollTop, 0);
	assert.equal(f.container.querySelector(".todayHeader")!.getBoundingClientRect().top, 22);
	await f.scrollTo(5);
	await f.resize(400);
	await f.render([task(-1), ...f.items()]);
	assert.equal(f.viewport.scrollTop, 5);
	await f.scrollTo(0);
	await f.resize(600);
	assert.equal(f.viewport.scrollTop, 0);
});

test("touch anchoring waits, and disabling clears the previous gesture", async (t) => {
	const f = harness(t);
	await f.render();
	await f.scrollTo(30_240);
	await act(() => f.viewport.dispatchEvent(new f.view.Event("touchstart")));
	const before = f.viewport.scrollTop;
	await f.changeHeight(0, 80);
	assert.equal(f.viewport.scrollTop, before, "a pressed finger must not receive scrollTop corrections");
	await f.render(f.items().slice(0, 799));
	await f.render(Array.from({ length: 1_001 }, (_, i) => task(i)));
	const enabled = f.viewport.scrollTop;
	await f.changeHeight(0, 100);
	assert.equal(f.viewport.scrollTop, enabled + 20, "the old gesture cannot defer corrections after re-enabling");
});

test("ArrowDown past the window reveals the next row and keeps focus", async (t) => {
	const f = harness(t);
	await f.render();
	const last = [...f.container.querySelectorAll<HTMLElement>(".task")].at(-1)!;
	const next = Number(last.dataset.line) + 1;
	assert.equal(f.row(next), null);
	await act(() => {
		last.focus();
		last.dispatchEvent(new f.view.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
	});
	await f.flush();
	assert.strictEqual(f.view.document.activeElement, f.row(next));
	await act(() => f.row(next)!.dispatchEvent(new f.view.KeyboardEvent("keydown", { key: "End", bubbles: true })));
	await f.flush();
	assert.strictEqual(f.view.document.activeElement, f.row(1_999));
});

test("a popout window uses its own window's observer and animation frames", async (t) => {
	t.mock.method(window, "requestAnimationFrame", () => assert.fail("main-window frames must not drive a popout"));
	const f = harness(t, 2_000, true);
	await f.render();
	await f.scrollTo(30_240);
	assert.ok(f.observers.length > 0);
	assert.ok(f.row(500));
	await f.unmount();
	assert.ok(f.observers.every((observer) => observer.disconnected));
	assert.equal(f.frames.size, 0);
});

test("an oversized temporary viewport is bounded by its owner's window height", async (t) => {
	const f = harness(t);
	f.setViewportHeight(200_000);
	f.setWindowHeight(700);
	resetRenderCounts();
	await f.render();
	assert.ok(f.container.querySelectorAll(".task").length < 40);
	assert.ok(rendersOf("TaskItemView") < 100, "no intermediate render mounts the complete list");
	assert.equal(f.row(100), null);
	f.setWindowHeight(200_000);
	f.setMinRows(0);
	await f.render(f.items().slice(0, 100));
	assert.equal(f.handle().getWindowingInfo().windowed, true);
	assert.equal(f.container.querySelectorAll(".task").length, 100, "an intentionally full-height window remains full");
});

test("a popout with no window dimensions bounds zero and oversized temporary layouts", async (t) => {
	const f = harness(t, 2_000, true);
	f.setWindowHeight(0);
	f.setViewportHeight(0);
	resetRenderCounts();
	await f.render();
	assert.ok(f.container.querySelectorAll(".task").length < 30);
	f.setViewportHeight(200_000);
	await f.resize(600);
	assert.ok(f.container.querySelectorAll(".task").length < 30);
	assert.ok(rendersOf("TaskItemView") < 100, "the initial fallback never expands with the unconstrained contents");
});

test("adopting the same viewport cancels its pending reveal and rebinds to the new owner window", async (t) => {
	const f = harness(t);
	await f.render();
	const oldObserver = f.observers[0];
	const popup = document.body.appendChild(document.createElement("iframe"));
	t.after(() => popup.remove());
	const popupView = popup.contentDocument!.defaultView!;
	const popupFrames = new Map<number, FrameRequestCallback>();
	let frameId = 10_000;
	t.mock.method(popupView, "requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++frameId;
		popupFrames.set(id, callback);
		return id;
	});
	t.mock.method(popupView, "cancelAnimationFrame", (id: number) => popupFrames.delete(id));
	const popupObservers: Observer[] = [];
	class Observer {
		readonly elements = new Set<Element>();
		disconnected = false;
		constructor(readonly callback: ResizeObserverCallback) {
			popupObservers.push(this);
		}
		observe(element: Element) {
			this.elements.add(element);
		}
		unobserve(element: Element) {
			this.elements.delete(element);
		}
		disconnect() {
			this.disconnected = true;
			this.elements.clear();
		}
	}
	Object.defineProperty(popupView, "ResizeObserver", { configurable: true, value: Observer });
	const clearedTimers: number[] = [];
	const clearTimeout = f.view.clearTimeout.bind(f.view);
	t.mock.method(f.view, "clearTimeout", (id: number) => {
		clearedTimers.push(id);
		clearTimeout(id);
	});
	let pending!: Promise<boolean>;
	await act(() => {
		pending = f.handle().revealTask("Tasks.md:1800");
	});
	f.viewport.dispatchEvent(new f.view.Event("touchstart"));
	f.viewport.dispatchEvent(new f.view.Event("touchend"));
	f.viewport.dispatchEvent(new f.view.Event("scroll"));
	assert.ok(f.frames.size > 0);
	popup.contentDocument!.body.appendChild(popup.contentDocument!.adoptNode(f.viewport));
	await act(() => f.viewport.dispatchEvent(new popupView.Event("scroll")));
	assert.strictEqual(f.viewport.ownerDocument.defaultView, popupView);
	assert.equal(oldObserver.disconnected, true);
	assert.ok(clearedTimers.length > 0, "the old owner's pending touch timer is cleared");
	assert.equal(f.frames.size, 0, "the old owner's pending frame is cancelled");
	assert.equal(await pending, false, "a reveal waiting on the old window finishes without another old-window frame");
	assert.equal(popupObservers.length, 1);
	assert.equal(popupFrames.size, 1);
	assert.equal(f.frames.size, 0);
	await act(() => {
		const callbacks = [...popupFrames.values()];
		popupFrames.clear();
		for (const callback of callbacks) callback(16);
	});
	assert.ok(popupObservers[0].elements.has(f.viewport));
	await act(() => popupObservers[0].callback([], popupObservers[0] as unknown as ResizeObserver));
	assert.equal(popupFrames.size, 1, "the new owner's observer schedules its own animation frame");
	await f.unmount();
	assert.ok(popupObservers.every((observer) => observer.disconnected));
	assert.equal(popupFrames.size, 0);
});

test("an empty force-windowed view reports its logical row count", async (t) => {
	const f = harness(t, 0);
	f.setMinRows(0);
	await f.render();
	assert.deepEqual(f.handle().getWindowingInfo(), { rowCount: 0, windowed: false });
	assert.ok(f.container.querySelector("input.newTask"));
});

test("a small view reveals the requested date header when one task occurs on several days", async (t) => {
	const f = harness(t, 1);
	await f.render([
		{
			...task(0),
			extraDates: [
				["first", new FakeDate("2026-01-14") as unknown as DateValue],
				["second", new FakeDate("2026-01-15") as unknown as DateValue],
			],
		},
	]);
	assert.deepEqual(f.handle().getWindowingInfo(), { rowCount: 2, windowed: false });
	const headers = [...f.container.querySelectorAll<HTMLElement>(".dateLine")];
	assert.equal(headers.length, 2);
	for (const header of headers) {
		const top = header.textContent === "2026-01-14" ? 100 : 900;
		const headerRect = header.getBoundingClientRect();
		t.mock.method(header, "getBoundingClientRect", () => ({
			...headerRect,
			top: top - f.viewport.scrollTop,
			bottom: top + headerRect.height - f.viewport.scrollTop,
		}));
	}
	assert.equal(await f.handle().revealDay("2026-01-15"), true);
	assert.equal(f.viewport.scrollTop, 900, "the requested day's header is aligned, despite another visible instance");
	assert.equal(await f.handle().revealDay("2026-01-14"), true);
	assert.equal(f.viewport.scrollTop, 100);
	assert.equal(f.container.querySelector("[data-tcw-day]"), null, "inactive markup gains no diagnostic attributes");
});

test("a small empty view reveals only its own entry day", async (t) => {
	const f = harness(t, 0);
	await f.render([], { useQuickEntry: false, useCounters: false });
	assert.equal(await f.handle().revealDay("2026-01-15"), true);
	assert.equal(f.viewport.scrollTop, 22, "the empty entry is reachable without a quick-entry panel");
	assert.equal(await f.handle().revealDay("2026-01-14"), false);
	assert.equal(f.viewport.scrollTop, 22, "a missing day does not scroll the entry");
	const header = f.container.querySelector<HTMLElement>(".todayHeader")!;
	const rect = header.getBoundingClientRect();
	t.mock.method(header, "getBoundingClientRect", () => ({ ...rect, height: 0 }));
	assert.equal(await f.handle().revealDay("2026-01-15"), false, "an entry hidden by CSS is not reported as revealed");
});

test("closing a view resolves pending reveal work and removes observers and frames", async (t) => {
	const f = harness(t);
	await f.render();
	let pending!: Promise<boolean>;
	await act(() => {
		pending = f.handle().revealTask("Tasks.md:1800");
	});
	await f.unmount();
	assert.equal(await pending, false);
	assert.equal(f.frames.size, 0);
	assert.ok(f.observers.every((observer) => observer.disconnected));
});
