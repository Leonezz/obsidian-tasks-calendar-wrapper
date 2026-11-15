// Brief-derived tests pin the day's comparison, context boundary and content-visibility attributes.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ComponentProps, type ContextType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ResolvedTask, TaskRowModel } from "@tasks-calendar-wrapper/core";
import { HostContext, QuickEntryHandlerContext } from "../src/contexts";
import type { UiHost } from "../src/host";
import { Day, sameDayProps } from "../src/timeline/Day";
import { renderedDays, rendersOf, resetRenderCounts } from "../src/renderprobe";

type DayProps = ComponentProps<typeof Day>;

function resolvedTask(line: number): ResolvedTask {
	return {
		task: {
			id: `Tasks.md:${line}`,
			note: { path: "Tasks.md", frontmatter: {}, tags: [] },
			path: "Tasks.md",
			line,
			lineCount: 1,
			position: { start: { line, col: 0, offset: 0 }, end: { line, col: 12, offset: 12 } },
			sourceLine: "- [ ] A task",
			text: "A task",
			symbol: "-",
			statusMarker: " ",
			completed: false,
			fullyCompleted: false,
			checked: false,
			isTasksTask: false,
			visual: "A task",
			priority: "3",
			recurrence: "",
			tags: [],
			dates: {},
			extraDates: [],
			section: { path: "Tasks.md", type: "file", embed: false },
			outlinks: [],
		},
		status: "due",
		order: 1,
		dailyNote: false,
		dates: {},
		extraDates: [],
		visual: "A task",
	};
}

const modelFor = ({ task, visual, status }: ResolvedTask): TaskRowModel => ({
	display: visual,
	path: task.path,
	sourceLine: task.sourceLine,
	position: task.position,
	line: task.line,
	col: task.position.end.col,
	link: task.path,
	isDailyNote: false,
	color: "",
	fileTitle: "Tasks",
	subPath: "",
	statusMarker: task.statusMarker,
	status,
	useBuiltinStyle: true,
	badges: [],
	tags: [],
});
const props: DayProps = {
	day: {
		key: "2026-01-15",
		label: "January 15",
		isToday: false,
		isEntry: false,
		dated: true,
		statuses: ["due", "overdue"],
		tasks: [resolvedTask(0), resolvedTask(1)],
	},
	yearLabel: "2026",
	entry: { counters: [], taskFiles: ["Tasks.md"], tags: ["#home"] },
	modelFor,
};
const changes: [string, DayProps][] = [
	[
		"window identity",
		{
			...props,
			window: {
				showHeader: true,
				headerHeight: 41,
				parts: [
					{ kind: "row", index: 0 },
					{ kind: "row", index: 1 },
				],
				ref: () => {},
			},
		},
	],
	["yearLabel", { ...props, yearLabel: "2027" }],
	["modelFor", { ...props, modelFor: (task) => modelFor(task) }],
	["entry identity", { ...props, entry: { ...props.entry! } }],
	["entry to undefined", { ...props, entry: undefined }],
	["day.key", { ...props, day: { ...props.day, key: "2026-01-16" } }],
	["day.label", { ...props, day: { ...props.day, label: "January 16" } }],
	["day.isToday", { ...props, day: { ...props.day, isToday: true } }],
	["day.isEntry", { ...props, day: { ...props.day, isEntry: true } }],
	["day.dated", { ...props, day: { ...props.day, dated: false } }],
	["day.statuses longer", { ...props, day: { ...props.day, statuses: [...props.day.statuses, "done"] } }],
	["day.statuses shorter", { ...props, day: { ...props.day, statuses: props.day.statuses.slice(0, 1) } }],
	["day.statuses element", { ...props, day: { ...props.day, statuses: ["due", "done"] } }],
	["day.tasks longer", { ...props, day: { ...props.day, tasks: [...props.day.tasks, resolvedTask(2)] } }],
	["day.tasks shorter", { ...props, day: { ...props.day, tasks: props.day.tasks.slice(0, 1) } }],
	[
		"equal-valued new task object",
		{ ...props, day: { ...props.day, tasks: [{ ...props.day.tasks[0] }, props.day.tasks[1]] } },
	],
];
const equals: [string, DayProps][] = [
	["same props object", props],
	[
		"new day and arrays with the same elements",
		{ ...props, day: { ...props.day, statuses: [...props.day.statuses], tasks: [...props.day.tasks] } },
	],
];

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

function Parent(props: DayProps) {
	return createElement(Day, props);
}

function dayHarness(t: TestContext) {
	const { container, root } = mountRoot(t);
	const host: UiHost = {
		isMobile: false,
		now: () => assert.fail("Day does not read the clock"),
		moment: Object.assign(() => assert.fail("Day does not create a moment"), { locale: () => "en" }),
		renderMarkdown: (markdown) => markdown,
	};
	const handlers: ContextType<typeof QuickEntryHandlerContext> = {
		handleCreateNewTask: async () => false,
		handleFilterEnable: () => {},
	};
	const render = async (next: DayProps, callback = handlers) => {
		await act(() =>
			root.render(
				createElement(
					HostContext.Provider,
					{ value: host },
					createElement(QuickEntryHandlerContext.Provider, { value: callback }, createElement(Parent, next)),
				),
			),
		);
	};
	return { container, render, handlers };
}

test("sameDayProps: each compared field changed means a render", async (t) => {
	for (const [field, next] of changes) {
		await t.test(field, () => assert.equal(sameDayProps(props, next), false));
	}
});

test("sameDayProps: equal props mean no render", () => {
	for (const [label, next] of equals) assert.equal(sameDayProps(props, next), true, label);
});

test("sameDayProps: an unchanged day reference does not revisit its task or status arrays", () => {
	let arrayReads = 0;
	const day = new Proxy(Object.freeze({ ...props.day }), {
		get(target, key, receiver) {
			if (key === "tasks" || key === "statuses") arrayReads++;
			return Reflect.get(target, key, receiver);
		},
	});
	const initial = { ...props, day };
	assert.equal(sameDayProps(initial, { ...initial }), true);
	assert.equal(arrayReads, 0);
	assert.equal(sameDayProps(initial, { ...initial, day: { ...props.day } }), true);
	assert.ok(arrayReads > 0, "a new day reference still compares its arrays");
});

test("Day is memo with sameDayProps", () => {
	const memoDay = Day as unknown as {
		$$typeof: symbol;
		compare: typeof sameDayProps;
		type: ((props: DayProps) => ReactNode) & { prototype?: { render?: unknown } };
	};
	assert.equal(memoDay.$$typeof, Symbol.for("react.memo"));
	assert.equal(memoDay.compare, sameDayProps);
	assert.equal(typeof memoDay.type, "function");
	assert.equal(memoDay.type.prototype?.render, undefined);
});

test("Day renders through the comparator", async (t) => {
	for (const [field, changed] of changes) {
		await t.test(field, async (t) => {
			const day = dayHarness(t);
			const initial = field.startsWith("entry") ? props : { ...props, entry: undefined };
			const next = field.startsWith("entry") ? changed : { ...changed, entry: undefined };
			resetRenderCounts();
			await day.render(initial);
			assert.equal(rendersOf("DateView"), 1, "mount");
			const before = renderedDays();
			await day.render(next);
			assert.equal(rendersOf("DateView"), 2, field);
			assert.deepEqual(renderedDays(), [...before, next.day.key]);
		});
	}
	await t.test("equal rows", async (t) => {
		const day = dayHarness(t);
		resetRenderCounts();
		await day.render({ ...props, entry: undefined });
		const before = renderedDays();
		for (const [label, next] of equals) {
			await day.render({ ...next, entry: undefined });
			assert.equal(rendersOf("DateView"), 1, label);
			assert.deepEqual(renderedDays(), before);
		}
	});
});

test("a quick filter change renders the entry panel, not the day", async (t) => {
	const day = dayHarness(t);
	const entry = { ...props, day: { ...props.day, isEntry: true, isToday: true } };
	const callback = {
		...day.handlers,
		quickFilter: { from: "2026-01-10", to: "2026-01-20", priorities: [], tags: ["#home"] },
	};
	resetRenderCounts();
	await day.render(entry, callback);
	assert.equal(rendersOf("DateView"), 1);
	const before = renderedDays();
	await day.render(entry, {
		...callback,
		quickFilter: { from: "2026-02-10", to: "2026-02-20", priorities: [], tags: ["#work"] },
	});
	assert.equal(rendersOf("DateView"), 1);
	assert.deepEqual(renderedDays(), before);
	assert.equal(day.container.querySelector<HTMLInputElement>(".tagFilterBar input")?.value, "#work");
	assert.deepEqual(
		[...day.container.querySelectorAll<HTMLInputElement>('.quickEntryPanel input[type="date"]')].map(
			(input) => input.value,
		),
		["2026-02-10", "2026-02-20"],
	);
});

test("Day keeps step 2's content-visibility attributes", async (t) => {
	const day = dayHarness(t);
	for (const isToday of [false, true]) {
		await day.render({ ...props, day: { ...props.day, isToday }, entry: undefined });
		const outer = day.container.querySelector<HTMLElement>("div.details");
		assert.ok(outer);
		assert.equal(outer.className, isToday ? "details today tcw-day" : "details tcw-day");
		assert.equal(
			outer.style.getPropertyValue("--tcw-day-estimate"),
			"calc(2 * var(--tcw-day-row-estimate) + 41px)",
		);
	}
	await day.render({ ...props, day: { ...props.day, isEntry: true } });
	const outer = day.container.querySelector<HTMLElement>("div.details");
	assert.ok(outer);
	assert.equal(outer.className, "details");
	assert.equal(outer.style.getPropertyValue("--tcw-day-estimate"), "");
	await day.render({ ...props, day: { ...props.day, tasks: [] } });
	assert.equal(day.container.querySelector("div.details"), null);
});
