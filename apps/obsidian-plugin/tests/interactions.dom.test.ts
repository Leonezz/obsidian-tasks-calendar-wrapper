// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement, type ContextType, type ReactNode } from "react";
import type { TaskRowModel } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from "@tasks-calendar-wrapper/ui";
import { mountView, onTimelineRender } from "./component-harness";
import { notesApp } from "./view-harness";
import { AbstractInputSuggest, Platform } from "./stubs/obsidian";

// Inline Note.md has the action badges; Done.md supplies a noninteractive relative badge, Other.md an unplanned row.
const sourceLine = "- [ ] all badges #work ⏫ 🔁 every day 🛫 2026-01-13 ⏳ 2026-01-14 📅 2026-01-16";
const doneLine = "- [x] finished ✅ 2026-01-14";
const taskSelector = '.task:has(a.file[aria-label="Note.md"])';
const position = {
	start: { line: 0, col: 0, offset: 0 },
	end: { line: 0, col: sourceLine.length, offset: sourceLine.length },
};
const modelArgs = { id: "Note.md:0", sourceLine, statusMarker: " " };
const openArgs = ["Note.md", position, "click"];
type Call = { handler: string; args: unknown[] };
type Gesture = "click" | "contextmenu" | "keydown" | "change";
type Interaction = {
	name: string;
	selector: string;
	event: Gesture;
	handler: string;
	args: unknown[];
	openNote: boolean;
	defaultPrevented: boolean;
	options?: Partial<UserOption>;
	mobile?: boolean;
	guarded?: boolean;
	prepare?: "append" | "filter" | "dates" | "tags";
	rootClass?: string;
	value?: string;
	checkLocal?: (fixture: Mounted) => void;
};

const interactions: Interaction[] = [
	{
		name: "the checkbox label calls handleCompleteTask and does not open the note",
		selector: `${taskSelector} label.icon`,
		event: "click",
		handler: "handleCompleteTask",
		args: [modelArgs, "click"],
		openNote: false,
		defaultPrevented: false,
		guarded: true,
	},
	{
		name: "the native checkbox calls handleCompleteTask and does not open the note",
		selector: `${taskSelector} input[type="checkbox"]`,
		event: "click",
		handler: "handleCompleteTask",
		args: [modelArgs, "click"],
		openNote: false,
		defaultPrevented: false,
		guarded: true,
		options: { useBuiltinStyle: false },
	},
	{
		name: "a row click calls handleOpenFile",
		selector: `${taskSelector} .lines`,
		event: "click",
		handler: "handleOpenFile",
		args: openArgs,
		openNote: true,
		defaultPrevented: false,
	},
	{
		name: "✏️ calls handleModifyTask and does not open the note",
		selector: `${taskSelector} a.modify`,
		event: "click",
		handler: "handleModifyTask",
		args: [modelArgs, "click"],
		openNote: false,
		defaultPrevented: false,
		guarded: true,
	},
	{
		name: "a row contextmenu calls handleRowMenu and prevents the default",
		selector: `${taskSelector} .lines`,
		event: "contextmenu",
		handler: "handleRowMenu",
		args: [modelArgs, "contextmenu"],
		openNote: false,
		defaultPrevented: true,
		guarded: true,
	},
	{
		name: "mobile ⋯ calls handleRowMenu and does not open the note",
		selector: `${taskSelector} a.menu`,
		event: "click",
		handler: "handleRowMenu",
		args: [modelArgs, "click"],
		openNote: false,
		defaultPrevented: false,
		guarded: true,
		mobile: true,
	},
	...(
		[
			["due", "Due: "],
			["scheduled", "Scheduled: "],
			["start", "Start: "],
		] as const
	).map(([kind, label]) => ({
		name: `the ${kind} badge calls handleDateBadge and does not open the note`,
		selector: `${taskSelector} a.relative[aria-label^="${label}"]`,
		event: "click" as const,
		handler: "handleDateBadge",
		args: [modelArgs, kind],
		openNote: false,
		defaultPrevented: false,
		guarded: true,
	})),
	{
		name: "the relative badge bubbles to handleOpenFile",
		selector: '.task:has(a.file[aria-label="Done.md"]) a.relative[aria-label^="Completed: "]',
		event: "click",
		handler: "handleOpenFile",
		args: [
			"Done.md",
			{ start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: doneLine.length, offset: doneLine.length } },
			"click",
		],
		openNote: true,
		defaultPrevented: false,
	},
	...(
		[
			["repeat", "a.repeat"],
			["priority", "a.priority"],
			["file", "a.file"],
		] as const
	).map(([badge, selector]) => ({
		name: `the ${badge} badge bubbles to handleOpenFile`,
		selector: `${taskSelector} ${selector}`,
		event: "click" as const,
		handler: "handleOpenFile",
		args: openArgs,
		openNote: true,
		defaultPrevented: false,
	})),
	{
		name: "the tag calls handleTagClick and does not open the note",
		selector: `${taskSelector} a.tag[target="_blank"]`,
		event: "click",
		handler: "handleTagClick",
		args: ["#work"],
		openNote: false,
		defaultPrevented: false,
	},
	...(["Filter", "Focus"] as const).flatMap((counterBehavior) =>
		["todo", "overdue", "unplanned"].map((counter) => ({
			name: `${counter} toggles ${counter}${counterBehavior} and a second click clears it`,
			selector: `#${counter}`,
			event: "click" as const,
			handler: "root class",
			args: [`${counter}${counterBehavior}`],
			openNote: false,
			defaultPrevented: false,
			options: { counterBehavior },
			rootClass: `${counter}${counterBehavior}`,
		})),
	),
	{
		name: "the quick entry button calls handleCreateNewTask with the selected note and text",
		selector: ".quickEntryPanel button.ok",
		event: "click",
		handler: "handleCreateNewTask",
		args: ["Other.md", "a new task"],
		openNote: false,
		defaultPrevented: false,
		prepare: "append",
	},
	{
		name: "Enter keydown calls handleCreateNewTask with the selected note and text",
		selector: ".quickEntryPanel input.newTask",
		event: "keydown",
		handler: "handleCreateNewTask",
		args: ["Other.md", "a new task"],
		openNote: false,
		defaultPrevented: true,
		prepare: "append",
	},
	{
		name: "the date-range Apply button calls handleFilterEnable with the selected dates",
		selector: ".applyDateRange",
		event: "click",
		handler: "handleFilterEnable",
		args: ["2026-01-10", "2026-01-20", [], []],
		openNote: false,
		defaultPrevented: false,
		prepare: "filter",
	},
	{
		name: "Enter in the tag filter calls handleFilterEnable with the typed tag and its #",
		selector: ".tagFilterBar input",
		event: "keydown",
		handler: "handleFilterEnable",
		args: [undefined, undefined, [], ["#home"]],
		openNote: false,
		defaultPrevented: true,
		prepare: "tags",
		// Shown although the quick entry panel is not.
		options: { useQuickEntry: false },
	},
	{
		name: "changing the quick entry note selects it and focuses the text without submitting",
		selector: "select.fileSelect",
		event: "change",
		value: "Other.md",
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		checkLocal: (fixture) => {
			assert.equal(fixture.root().querySelector<HTMLSelectElement>("select.fileSelect")?.value, "Other.md");
			assert.equal(document.activeElement, fixture.root().querySelector("input.newTask"));
		},
	},
	{
		name: "choosing a custom date range reveals its inputs while keeping task entry available",
		selector: "select.dateScope",
		event: "change",
		value: "custom",
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		checkLocal: (fixture) => {
			assert.equal(fixture.root().querySelectorAll('.dateRange input[type="date"]').length, 2);
			assert.ok(fixture.root().querySelector("input.newTask"));
		},
	},
	{
		name: "checking a priority applies that filter without submitting a task",
		selector: '.priorityOptions input[value="High"]',
		event: "click",
		handler: "handleFilterEnable",
		args: [undefined, undefined, ["High"], []],
		openNote: false,
		defaultPrevented: false,
	},
	...(
		[
			["from", "Show tasks on or after this date", "2026-01-10"],
			["to", "Show tasks on or before this date", "2026-01-20"],
		] as const
	).map(([field, aria, value]) => ({
		name: `changing the ${field} date updates the draft without submitting`,
		selector: `.dateRange input[aria-label="${aria}"]`,
		event: "change" as const,
		value,
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		prepare: "dates" as const,
		checkLocal: (fixture: Mounted) =>
			assert.equal(
				fixture.root().querySelector<HTMLInputElement>(`.dateRange input[aria-label="${aria}"]`)?.value,
				value,
			),
	})),
];

async function mountInteractions(t: TestContext, options: Partial<UserOption> = {}, mobile = false) {
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
	const wasMobile = Platform.isMobile;
	Platform.isMobile = mobile;
	t.after(() => {
		Platform.isMobile = wasMobile;
	});
	const calls: Call[] = [];
	const record = (handler: string, ...args: unknown[]) => {
		calls.push({ handler, args });
	};
	const model = (value: TaskRowModel) => ({
		id: `${value.path}:${value.line}`,
		sourceLine: value.sourceLine,
		statusMarker: value.statusMarker,
	});
	const callbacks: ContextType<typeof TaskItemEventHandlersContext> = {
		handleCompleteTask: (value, event) => record("handleCompleteTask", model(value), event.type),
		handleModifyTask: (value, event) => record("handleModifyTask", model(value), event.type),
		handleRowMenu: (value, event) => record("handleRowMenu", model(value), event.type),
		handleDateBadge: (value, kind) => record("handleDateBadge", model(value), kind),
		handleOpenFile: (path, position, event) => record("handleOpenFile", path, position, event?.type),
		handleTagClick: (tag) => record("handleTagClick", tag),
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
	// Keep the bridge's quick-entry context and replace its callbacks at the boundary, before any writer is reached.
	const observed = onTimelineRender(t, (_props, rendered) =>
		createElement(
			TaskItemEventHandlersContext.Provider,
			{ value: callbacks },
			createElement(QuickEntryHandlerContext.Consumer, {
				children: (value: ContextType<typeof QuickEntryHandlerContext>): ReactNode =>
					createElement(
						QuickEntryHandlerContext.Provider,
						{ value: { ...value, ...quickCallbacks } },
						rendered,
					),
			}),
		),
	);
	const notes: Record<string, string> = { "Note.md": sourceLine, "Other.md": "- [ ] unplanned", "Done.md": doneLine };
	const fixture = await mountView(t, {
		app: {
			...notesApp(notes),
			plugins: { plugins: { "obsidian-tasks-plugin": { apiV1: { editTaskLineModal: async () => "" } } } },
		},
		options: {
			...structuredClone(defaultUserOptions),
			defaultFilters: "",
			defaultTodayFocus: false,
			dateFormat: "YYYY-MM-DD",
			hideStatusTasks: [],
			inbox: "Note.md",
			taskFiles: ["Note.md", "Other.md"],
			...options,
		},
	});
	const panel = fixture.root().querySelector<HTMLElement>(".quickEntryPanel")!;
	Object.assign(panel, {
		addClass: (name: string) => panel.classList.add(name),
		removeClass: (name: string) => panel.classList.remove(name),
	});
	return { ...fixture, notes, calls, clock: observed.clock };
}

type Mounted = Awaited<ReturnType<typeof mountInteractions>>;

async function dispatch(fixture: Mounted, row: Pick<Interaction, "selector" | "event" | "value">, timeStamp = 2000) {
	const target = fixture.root().querySelector<HTMLElement>(row.selector);
	assert.ok(target, row.selector);
	const event =
		row.event === "keydown"
			? new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
			: row.event === "change"
				? new Event("change", { bubbles: true, cancelable: true })
				: new MouseEvent(row.event, { bubbles: true, cancelable: true, view: window });
	Object.defineProperty(event, "timeStamp", { value: timeStamp });
	await act(() => {
		if (row.event === "change") {
			assert.notEqual(row.value, undefined);
			const prototype =
				target instanceof window.HTMLInputElement
					? window.HTMLInputElement.prototype
					: window.HTMLSelectElement.prototype;
			Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, row.value);
		}
		target.dispatchEvent(event);
	});
	return event;
}

async function select(fixture: Mounted, selector: string, value: string) {
	const target = fixture.root().querySelector<HTMLSelectElement>(selector);
	assert.ok(target, selector);
	const event = new Event("change", { bubbles: true, cancelable: true });
	await act(() => {
		target.value = value;
		target.dispatchEvent(event);
	});
	assert.equal(event.defaultPrevented, false, selector);
	assert.deepEqual(fixture.calls, [], `${selector} changes the draft without submitting it`);
}

async function prepare(fixture: Mounted, mode?: Interaction["prepare"]) {
	if (mode === "append") {
		await select(fixture, "select.fileSelect", "Other.md");
		await act(() => {
			const input = fixture.root().querySelector<HTMLInputElement>("input.newTask");
			assert.ok(input);
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "a new task");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	} else if (mode === "tags") {
		const input = fixture.root().querySelector<HTMLInputElement>(".tagFilterBar input");
		assert.ok(input);
		await act(() => {
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, " home ");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		assert.deepEqual(fixture.calls, [], "typing changes the draft without submitting it");
	} else if (mode) {
		await select(fixture, "select.dateScope", "custom");
		if (mode === "dates") return;
		const dates = fixture.root().querySelectorAll<HTMLInputElement>('.dateRange input[type="date"]');
		assert.equal(dates.length, 2);
		await act(() => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
			for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
				setter.call(dates[index], value);
				dates[index].dispatchEvent(new Event("input", { bubbles: true }));
			}
		});
	}
}

for (const row of interactions) {
	test(row.name, async (t) => {
		const fixture = await mountInteractions(t, row.options, row.mobile);
		await prepare(fixture, row.prepare);
		if (row.rootClass) assert.equal(fixture.root().classList.contains(row.rootClass), false);
		const event = await dispatch(fixture, row);
		assert.equal(event.defaultPrevented, row.defaultPrevented);
		assert.equal(
			fixture.calls.some(({ handler }) => handler === "handleOpenFile"),
			row.openNote,
		);
		if (row.rootClass) {
			assert.deepEqual(fixture.calls, []);
			assert.deepEqual(
				{
					handler: "root class",
					args: [row.rootClass].filter((name) => fixture.root().classList.contains(name)),
				},
				{ handler: row.handler, args: row.args },
			);
			const second = await dispatch(fixture, row);
			assert.equal(second.defaultPrevented, row.defaultPrevented);
			assert.equal(fixture.root().classList.contains(row.rootClass), false);
			assert.deepEqual(fixture.calls, []);
		} else if (row.handler === "none") {
			assert.deepEqual(fixture.calls, row.args);
			assert.ok(row.checkLocal);
			row.checkLocal(fixture);
		} else assert.deepEqual(fixture.calls, [{ handler: row.handler, args: row.args }]);
	});
}

test("choosing custom dates preserves the independent Focus on today state", async (t) => {
	const fixture = await mountInteractions(t);
	const scope = fixture.root().querySelector<HTMLSelectElement>("select.dateScope");
	const heading = fixture.root().querySelector<HTMLElement>(".todayHeader");
	assert.ok(scope && heading);
	assert.deepEqual(
		[...scope.options].map((option) => option.value),
		["all", "week", "custom"],
	);
	await act(() => heading.click());
	await select(fixture, "select.dateScope", "custom");
	assert.equal(fixture.root().classList.contains("todayFocus"), true);
	assert.equal(heading.getAttribute("aria-pressed"), "true");
	assert.equal(scope.value, "custom");
	assert.equal(fixture.root().querySelectorAll(".dateRange input").length, 2);
	assert.deepEqual(fixture.calls, [], "neither focus nor an unsubmitted date draft calls the writer or filter");
});

test("the restored Today heading toggles focus without submitting, clearing filters or opening a task", async (t) => {
	const fixture = await mountInteractions(t);
	const heading = fixture.root().querySelector<HTMLElement>(".todayHeader");
	const scope = fixture.root().querySelector<HTMLSelectElement>("select.dateScope");
	assert.ok(heading && scope);
	assert.equal(heading.textContent, "Focus on today");
	for (const focused of [true, false]) {
		await act(() => heading.click());
		assert.equal(fixture.root().classList.contains("todayFocus"), focused);
		assert.equal(heading.getAttribute("aria-pressed"), String(focused));
		assert.equal(scope.value, "all");
		assert.deepEqual(fixture.calls, []);
	}
});

test("the tag filter suggests the tasks' tags and applies the one picked", async (t) => {
	const fixture = await mountInteractions(t, { useQuickEntry: false });
	const input = fixture.root().querySelector<HTMLInputElement>(".tagFilterBar input");
	const suggest = AbstractInputSuggest.made.at(-1) as AbstractInputSuggest<string> & {
		selectSuggestion(tag: string): void;
	};
	assert.equal(suggest.textInputEl, input);
	input!.value = "WO";
	assert.deepEqual(await suggest.suggestions(), ["#work"]);
	input!.value = "#nothing";
	assert.deepEqual(await suggest.suggestions(), []);
	await act(() => suggest.selectSuggestion("#work"));
	assert.deepEqual(fixture.calls, [{ handler: "handleFilterEnable", args: [undefined, undefined, [], ["#work"]] }]);
	assert.equal(input!.value, "#work");
	assert.equal(suggest.isOpen, false);
});

test("a click within 300 ms of the list commit is ignored", async (t) => {
	const fixture = await mountInteractions(t, {}, true);
	fixture.notes["Added.md"] = "- [ ] newly indexed";
	fixture.edited("Added.md");
	await fixture.reload();
	assert.equal(fixture.clock().lastListChangeAt, 1000);
	for (const row of interactions.filter((row) => row.guarded)) {
		await fixture.pushOptions({ ...fixture.options(), useBuiltinStyle: row.options?.useBuiltinStyle ?? true });
		for (const time of [999, 1299]) {
			const event = await dispatch(fixture, row, time);
			assert.equal(event.defaultPrevented, row.defaultPrevented, row.name);
			assert.deepEqual(fixture.calls, [], row.name);
		}
		await dispatch(fixture, row, 1300);
		assert.deepEqual(fixture.calls.splice(0), [{ handler: row.handler, args: row.args }], row.name);
	}
	// Master deliberately leaves row navigation and tag links outside the control click guard.
	for (const row of interactions.filter(
		(row) =>
			(row.selector === `${taskSelector} .lines` && row.event === "click") || row.handler === "handleTagClick",
	)) {
		const event = await dispatch(fixture, row, 1001);
		assert.equal(event.defaultPrevented, row.defaultPrevented);
		assert.deepEqual(fixture.calls.splice(0), [{ handler: row.handler, args: row.args }]);
	}
});

test("a dimmed row ignores its controls", async (t) => {
	const fixture = await mountInteractions(t, {}, true);
	await fixture.feed({
		id: 1,
		kind: "pending",
		action: "toggle",
		path: "Note.md",
		line: 0,
		sourceLine,
		lines: [sourceLine.replace("[ ]", "[x]")],
	});
	assert.equal(fixture.root().querySelector(taskSelector)?.getAttribute("aria-busy"), "true");
	for (const row of interactions.filter((row) => row.guarded)) {
		await fixture.pushOptions({ ...fixture.options(), useBuiltinStyle: row.options?.useBuiltinStyle ?? true });
		const event = await dispatch(fixture, row);
		assert.equal(event.defaultPrevented, row.defaultPrevented, row.name);
		assert.deepEqual(fixture.calls, [], row.name);
	}
});

test("mobile ⋯ opens the row menu", async (t) => {
	const fixture = await mountInteractions(t, {}, true);
	const row = interactions.find((row) => row.mobile)!;
	assert.equal(fixture.root().querySelector(row.selector)?.getAttribute("aria-label"), "Open task menu");
	const event = await dispatch(fixture, row);
	assert.equal(event.defaultPrevented, false);
	assert.deepEqual(fixture.calls, [{ handler: "handleRowMenu", args: [modelArgs, "click"] }]);
});
