import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import {
	createDailyNoteDateCache,
	createResolvedTaskCache,
	createStore,
	taskRowModel,
	type DateValue,
	type MomentFactory,
	type Task,
} from "@tasks-calendar-wrapper/core";
import { HostContext, QuickEntryHandlerContext, type ViewActions, type ViewState } from "../src/contexts";
import type { ListChangeClock } from "../src/clickguard";
import type { UiHost } from "../src/host";
import { onTimelineRender, providerValues } from "../src/renderprobe";
import { Timeline, type TimelineOptions, type TimelineProps } from "../src/timeline/Timeline";

// Undated tasks need only day keys and labels from the factory; no date library is involved.
class FakeDate {
	private value: Date;

	constructor(input: string | number) {
		this.value = new Date(typeof input === "string" ? input.trim() + "T00:00:00Z" : input);
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
	add(amount: number, unit: string) {
		assert.match(unit, /^days?$/);
		this.value.setUTCDate(this.date() + amount);
		return this;
	}
	startOf(unit: string) {
		assert.equal(unit, "day");
		this.value.setUTCHours(0, 0, 0, 0);
		return this;
	}
	diff(other: DateValue, unit: string) {
		assert.equal(unit, "days");
		return (this.valueOf() - other.valueOf()) / 86_400_000;
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
	isBefore(other: DateValue) {
		return this.valueOf() < other.valueOf();
	}
	isAfter(other: DateValue) {
		return this.valueOf() > other.valueOf();
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

function timelineHarness(
	t: TestContext,
	parentLayout?: () => void,
	createTask: (path: string, text: string) => Promise<boolean> = async () => true,
) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	let locale = "en";
	let now = "2026-01-15";
	const moment: MomentFactory = Object.assign(
		(input: Parameters<MomentFactory>[0]) => {
			assert.equal(typeof input, "string");
			return new FakeDate(input as string) as unknown as ReturnType<MomentFactory>;
		},
		{ locale: () => locale },
	);
	const host: UiHost = {
		isMobile: false,
		now: () => moment(now),
		moment,
		renderMarkdown: (markdown) => markdown,
	};
	const dateCache = createDailyNoteDateCache();
	const taskCache = createResolvedTaskCache();
	const model = t.mock.fn(taskRowModel);
	let clock: ListChangeClock | undefined;
	const removeProbe = onTimelineRender((_props, rendered, nextClock) => {
		clock = nextClock;
		return rendered;
	});
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			removeProbe();
			container.remove();
		}
	});
	function Parent(props: TimelineProps) {
		useLayoutEffect(() => {
			parentLayout?.();
		});
		return createElement(Timeline, props);
	}
	const viewState = createStore<ViewState>({
		counter: options.defaultFilters,
		todayFocus: options.defaultTodayFocus,
	});
	const viewActions: ViewActions = {
		toggleTodayFocus: () => viewState.setState((state) => ({ ...state, todayFocus: !state.todayFocus })),
		toggleCounter: (id) =>
			viewState.setState((state) => ({
				...state,
				counter: state.counter !== `${id}Filter` ? `${id}Filter` : "",
			})),
	};
	let opened = false;
	const quickHandlers = { handleCreateNewTask: createTask, handleFilterEnable: () => {} };
	let props: TimelineProps = {
		userOptions: options,
		viewState,
		viewActions,
		tasks: [task(0), task(1, " ")],
		queryEnv: (now) => ({ env: { now, moment, dateCache, taskCache } }),
		taskRowModel: model,
	};
	const render = async (next: Partial<TimelineProps> = {}) => {
		props = { ...props, ...next };
		if (!opened) {
			viewState.setState({
				counter: props.userOptions.defaultFilters,
				todayFocus: props.userOptions.defaultTodayFocus,
			});
			opened = true;
		}
		await act(() =>
			root.render(
				createElement(
					HostContext.Provider,
					{ value: host },
					createElement(
						QuickEntryHandlerContext.Provider,
						{ value: quickHandlers },
						createElement(Parent, props),
					),
				),
			),
		);
	};
	return {
		container,
		model,
		render,
		clock: () => {
			assert.ok(clock);
			return clock;
		},
		setDay: (day: string) => {
			now = day;
		},
		setLocale: (value: string) => {
			locale = value;
		},
		rows: () => container.querySelectorAll(".task").length,
		click: async (selector: string) => {
			const element = container.querySelector<HTMLElement>(selector);
			assert.ok(element, selector);
			await act(() => element.click());
		},
		toggleToday: async () => {
			const heading = container.querySelector<HTMLElement>(".todayHeader");
			assert.ok(heading);
			await act(() => heading.click());
		},
	};
}

test("models reused across a counter click", async (t) => {
	const timeline = timelineHarness(t);
	await timeline.render();
	assert.equal(timeline.model.mock.callCount(), 2);
	timeline.model.mock.resetCalls();
	await timeline.click("#todo");
	assert.ok(timeline.rows() > 0);
	assert.equal(timeline.model.mock.callCount(), 0);
	await timeline.click("#todo");
	assert.equal(timeline.rows(), 2);
	assert.equal(timeline.model.mock.callCount(), 0);
});

test("filter-driven year remounts keep creation metadata, pending state and the next draft", async (t) => {
	let resolve!: (added: boolean) => void;
	const pending = new Promise<boolean>((yes) => {
		resolve = yes;
	});
	const calls: [string, string][] = [];
	const timeline = timelineHarness(t, undefined, (path, text) => {
		calls.push([path, text]);
		return pending;
	});
	const past: Task = {
		...task(0, " "),
		tags: ["#past"],
		dates: { due: new FakeDate("2025-12-01") as unknown as DateValue },
	};
	const current: Task = { ...task(1), tags: ["#now"] };
	await timeline.render({
		tasks: [past, current],
		userOptions: {
			...options,
			forward: false,
			useRelative: false,
			taskFiles: ["Tasks.md", "Inbox.md"],
			newDateStyle: "dataview",
		},
	});
	const input = () => timeline.container.querySelector<HTMLInputElement>(".newTask")!;
	const original = input();
	const edit = async (target: HTMLInputElement, value: string) =>
		act(() => {
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(target, value);
			target.dispatchEvent(new Event("input", { bubbles: true }));
		});
	const choose = async (selector: string, value: string) =>
		act(() => {
			const select = timeline.container.querySelector<HTMLSelectElement>(selector)!;
			select.value = value;
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
	await edit(original, "first draft");
	await choose(".fileSelect", "Inbox.md");
	await edit(timeline.container.querySelector<HTMLInputElement>(".taskDue")!, "2026-01-20");
	await choose(".taskPriority", "High");
	await timeline.click(".quickEntryPanel button.ok");
	assert.deepEqual(calls, [["Inbox.md", "first draft [priority:: high]  [due:: 2026-01-20]"]]);
	await edit(input(), "next draft");
	await timeline.render({ quickFilter: { priorities: [], tags: ["#now"] } });
	assert.notEqual(input(), original, "removing the earlier year remounts the indexed entry year");
	assert.equal(input().value, "next draft");
	assert.equal(timeline.container.querySelector<HTMLSelectElement>(".fileSelect")!.value, "Inbox.md");
	assert.equal(timeline.container.querySelector<HTMLInputElement>(".taskDue")!.value, "2026-01-20");
	assert.equal(timeline.container.querySelector<HTMLSelectElement>(".taskPriority")!.value, "High");
	assert.equal(timeline.container.querySelector<HTMLButtonElement>("button.ok")!.disabled, true);
	await act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
	assert.equal(calls.length, 1, "the remounted composer cannot duplicate a pending write");
	await act(async () => resolve(true));
	assert.equal(input().value, "next draft", "completion does not erase text typed for the next task");
	assert.match(timeline.container.querySelector(".entryStatus")!.textContent!, /Added to Inbox/);
});

test("a new day discards models", async (t) => {
	const timeline = timelineHarness(t);
	await timeline.render();
	timeline.model.mock.resetCalls();
	timeline.setDay("2026-01-16");
	await timeline.toggleToday();
	assert.ok(timeline.rows() > 0);
	assert.equal(timeline.model.mock.callCount(), timeline.rows());
	timeline.model.mock.resetCalls();
	await timeline.toggleToday();
	assert.equal(timeline.model.mock.callCount(), 0);
});

test("a locale change discards models", async (t) => {
	const timeline = timelineHarness(t);
	await timeline.render();
	timeline.model.mock.resetCalls();
	timeline.setLocale("fr");
	await timeline.toggleToday();
	assert.ok(timeline.rows() > 0);
	assert.equal(timeline.model.mock.callCount(), timeline.rows());
	timeline.model.mock.resetCalls();
	await timeline.toggleToday();
	assert.equal(timeline.model.mock.callCount(), 0);
});

// Brief-derived tests pin commit timing, provider identity, initial state and component shape.
test("the click clock stays at mount and moves only when the rendered ids change", async (t) => {
	let commitTime = 1000;
	t.mock.method(performance, "now", () => commitTime);
	const timeline = timelineHarness(t);
	await timeline.render();
	assert.equal(timeline.clock().lastListChangeAt, -Infinity);
	await timeline.toggleToday();
	assert.equal(timeline.clock().lastListChangeAt, -Infinity);
	await timeline.render();
	assert.equal(timeline.clock().lastListChangeAt, -Infinity);
	await timeline.render({ userOptions: { ...options, useCounters: false } });
	assert.equal(timeline.clock().lastListChangeAt, -Infinity);
	await timeline.click("#todo");
	assert.equal(timeline.rows(), 1);
	assert.equal(timeline.clock().lastListChangeAt, 1000);
	commitTime = 2000;
	await timeline.render({ tasks: [task(0), task(1, " "), task(2)] });
	assert.equal(timeline.rows(), 2);
	assert.equal(timeline.clock().lastListChangeAt, 2000);
});

test("the click clock moves before the parent's layout effects", async (t) => {
	t.mock.method(performance, "now", () => 1000);
	const observed: number[] = [];
	const timeline = timelineHarness(t, () => observed.push(timeline.clock().lastListChangeAt));
	await timeline.render();
	assert.deepEqual(observed, [-Infinity]);
	await timeline.render({ tasks: [task(0), task(1, " "), task(2)] });
	assert.deepEqual(observed, [-Infinity, 1000]);
});

test("cached logical lists refresh for tasks, dates and Focus while stable commits initialize links", async (t) => {
	let now = 1000;
	t.mock.method(performance, "now", () => now);
	const timeline = timelineHarness(t);
	const dated = (day: string): Task => ({
		...task(0),
		extraDates: [["date", new FakeDate(day) as unknown as DateValue]],
	});
	await timeline.render({ tasks: [dated("2026-01-14"), task(1)] });
	const row = (line: number) => {
		const element = timeline.container.querySelector<HTMLElement>(`.task[data-line="${line}"]`);
		assert.ok(element);
		return element;
	};
	assert.equal(timeline.rows(), 2);
	assert.match(row(0).getAttribute("aria-labelledby")!, /2026-01-14/);
	await act(() => row(1).focus());
	const link = document.createElement("a");
	link.href = "#new-markdown-link";
	row(1).querySelector(".lines > .content")!.append(link);
	await timeline.render();
	assert.equal(link.tabIndex, 0, "a stable result still initializes newly mounted Markdown links");
	await timeline.toggleToday();
	assert.equal(timeline.rows(), 1);
	assert.equal(row(1).tabIndex, 0);
	assert.equal(timeline.clock().lastListChangeAt, -Infinity, "Focus does not change the full-list click clock");
	await timeline.toggleToday();
	assert.equal(timeline.rows(), 2);
	await act(() => row(0).focus());
	await timeline.render({ tasks: [dated("2026-01-15"), task(1), task(2)] });
	assert.equal(timeline.rows(), 3);
	assert.match(row(0).getAttribute("aria-labelledby")!, /2026-01-15/);
	assert.equal(timeline.clock().lastListChangeAt, 1000);
	assert.strictEqual(document.activeElement, row(1), "a moved date instance hands focus to the surviving neighbour");
	await act(() => row(1).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
	assert.strictEqual(document.activeElement, row(2), "keyboard navigation includes the newly added task");
	now = 2000;
	timeline.setDay("2026-01-16");
	await timeline.render();
	assert.match(row(1).getAttribute("aria-labelledby")!, /2026-01-16/);
	assert.equal(timeline.clock().lastListChangeAt, 1000, "equal full-list IDs retain the clock across a new result");
	await timeline.toggleToday();
	assert.equal(timeline.rows(), 2);
	assert.equal(timeline.container.querySelector('.task[data-line="0"]'), null);
});

test("handlers and provider values keep their identity", async (t) => {
	const timeline = timelineHarness(t);
	await timeline.render();
	const initial = providerValues();
	assert.ok(initial.ViewActions);
	const sameProviders = () => {
		const current = providerValues();
		assert.equal(current.ViewActions, initial.ViewActions);
	};
	await timeline.click("#todo");
	sameProviders();
	await timeline.toggleToday();
	sameProviders();
	await timeline.render({ userOptions: { ...options, hideTags: [], tagColorPalette: {}, taskFiles: ["Tasks.md"] } });
	sameProviders();
	await timeline.render({ userOptions: { ...options, hideTags: ["#hidden"] } });
	assert.equal(providerValues().ViewActions, initial.ViewActions);
});

test("the open filter and focus come from the first render only", async (t) => {
	const timeline = timelineHarness(t);
	await timeline.render({ userOptions: { ...options, defaultFilters: "todoFilter", defaultTodayFocus: true } });
	const root = timeline.container.querySelector<HTMLElement>(".taskido");
	assert.ok(root);
	assert.match(root.className, /todoFilter/);
	assert.match(root.className, /todayFocus/);
	const heading = root.querySelector<HTMLElement>(".todayHeader");
	assert.ok(heading);
	assert.equal(heading.textContent, "Focus on today");
	assert.equal(heading.getAttribute("aria-pressed"), "true");
	assert.equal(
		heading.nextElementSibling?.className,
		"entryControls",
		"the original title precedes the status cards",
	);
	await timeline.render({ userOptions: { ...options, defaultFilters: "", defaultTodayFocus: false } });
	assert.match(root.className, /todoFilter/);
	assert.match(root.className, /todayFocus/);
	assert.equal(heading.getAttribute("aria-pressed"), "true");
});

test("Timeline is a plain function component", () => {
	assert.equal(typeof Timeline, "function");
	const component = Timeline as unknown as { prototype?: { render?: unknown }; $$typeof?: symbol };
	assert.equal(component.prototype?.render, undefined);
	assert.notEqual(component.$$typeof, Symbol.for("react.memo"));
});
