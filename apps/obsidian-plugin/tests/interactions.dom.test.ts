// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement, type ContextType, type ReactNode } from "react";
import type { TaskRowModel } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from "../timeline/src/components/context";
import { mountView, onTimelineRender } from "./component-harness";
import { notesApp } from "./view-harness";
import { Platform } from "./stubs/obsidian";

// Inline Note.md has the action badges; Done.md supplies a noninteractive relative badge, Other.md an unplanned row.
const sourceLine = "- [ ] all badges #work ⏫ 🔁 every day 🛫 2026-01-13 ⏳ 2026-01-14 📅 2026-01-16";
const doneLine = "- [x] finished ✅ 2026-01-14";
const taskSelector = '.task[aria-label="Note"]';
const position = {
	start: { line: 0, col: 0, offset: 0 },
	end: { line: 0, col: sourceLine.length, offset: sourceLine.length },
};
const modelArgs = { id: "Note.md:0", sourceLine, statusMarker: " " };
const openArgs = ["Note.md", position, "click"];
type Call = { handler: string; args: unknown[] };
type Gesture = "click" | "contextmenu" | "keyup" | "change";
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
	prepare?: "append" | "filter" | "filter-mode" | "dates" | "priorities";
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
			["due", "due at"],
			["scheduled", "scheduled to"],
			["start", "start at"],
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
		selector: '.task[aria-label="Done"] a.relative[aria-label^="complete at"]',
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
		name: "Focus on today toggles todayFocus and a second click clears it",
		selector: "div.todayHeader",
		event: "click",
		handler: "root class",
		args: ["todayFocus"],
		openNote: false,
		defaultPrevented: false,
		rootClass: "todayFocus",
	},
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
		name: "Enter keyup calls handleCreateNewTask with the selected note and text",
		selector: ".quickEntryPanel input.newTask",
		event: "keyup",
		handler: "handleCreateNewTask",
		args: ["Other.md", "a new task"],
		openNote: false,
		defaultPrevented: false,
		prepare: "append",
	},
	{
		name: "the filter button calls handleFilterEnable with dates and priorities",
		selector: ".quickEntryPanel button.ok",
		event: "click",
		handler: "handleFilterEnable",
		args: ["2026-01-10", "2026-01-20", ["1", "2"]],
		openNote: false,
		defaultPrevented: false,
		prepare: "filter",
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
		name: "changing the quick entry action shows the filter controls without submitting",
		selector: "select.actionName",
		event: "change",
		value: "filter",
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		checkLocal: (fixture) => {
			assert.ok(fixture.root().querySelector("select.filterSelector"));
			assert.equal(fixture.root().querySelector("input.newTask"), null);
		},
	},
	{
		name: "changing the filter type adds date inputs without submitting",
		selector: "select.filterSelector",
		event: "change",
		value: "date",
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		prepare: "filter-mode",
		checkLocal: (fixture) => assert.equal(fixture.root().querySelectorAll('input[type="date"]').length, 2),
	},
	{
		name: "changing a priority marks the draft selection without submitting",
		selector: 'select[name="priorityFilter"]',
		event: "change",
		value: "1",
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		prepare: "priorities",
		checkLocal: (fixture) =>
			assert.equal(fixture.root().querySelector('select[name="priorityFilter"] + a')?.textContent, "High🎯"),
	},
	...(
		[
			["from", "first-of-type", "2026-01-10"],
			["to", "last-of-type", "2026-01-20"],
		] as const
	).map(([field, nth, value]) => ({
		name: `changing the ${field} date updates the draft without submitting`,
		selector: `.dateFilter input:${nth}`,
		event: "change" as const,
		value,
		handler: "none",
		args: [],
		openNote: false,
		defaultPrevented: false,
		prepare: "dates" as const,
		checkLocal: (fixture: Mounted) =>
			assert.equal(fixture.root().querySelector(`.dateFilter input:${nth}`)?.getAttribute("value"), value),
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
		handleFilterEnable: (from: string | undefined, to: string | undefined, priorities: string[]) =>
			record("handleFilterEnable", from, to, priorities),
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
		app: notesApp(notes),
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
		row.event === "keyup"
			? new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true })
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
		fixture.root().querySelector<HTMLInputElement>("input.newTask")!.value = "a new task";
	} else if (mode) {
		await select(fixture, "select.actionName", "filter");
		if (mode === "filter-mode") return;
		if (mode === "priorities") {
			await select(fixture, "select.filterSelector", "priority");
			return;
		}
		await select(fixture, "select.filterSelector", "date");
		if (mode === "dates") return;
		await select(fixture, "select.filterSelector", "priority");
		const dates = fixture.root().querySelectorAll<HTMLInputElement>('input[type="date"]');
		assert.equal(dates.length, 2);
		await act(() => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
			for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
				setter.call(dates[index], value);
				dates[index].dispatchEvent(new Event("input", { bubbles: true }));
			}
		});
		await select(fixture, 'select[name="priorityFilter"]', "1");
		await select(fixture, 'select[name="priorityFilter"]', "2");
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
	assert.equal(fixture.root().querySelector(row.selector)?.getAttribute("aria-label"), "Task menu");
	const event = await dispatch(fixture, row);
	assert.equal(event.defaultPrevented, false);
	assert.deepEqual(fixture.calls, [{ handler: "handleRowMenu", args: [modelArgs, "click"] }]);
});
