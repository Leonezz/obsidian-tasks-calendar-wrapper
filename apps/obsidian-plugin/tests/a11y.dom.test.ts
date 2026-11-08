// Pins keyboard access, roving focus and screen-reader names without changing the write path.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import axe from "axe-core";
import { act, createElement, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import type { Store } from "@tasks-calendar-wrapper/core";
import { TaskItemEventHandlersContext } from "@tasks-calendar-wrapper/ui";
import { TasksTimelineView, timelineTaskIndex } from "../src/views";
import type { TimelineState } from "../src/state/timeline";
import { defaultUserOptions } from "../src/useroptions";
import { getTasksDialog } from "../timeline/src/tasksplugin";
import { moment } from "../utils/moment";
import { countRenders, mountBridge, mountView, onTimelineRender } from "./component-harness";
import { FIXTURES, goldenApp, loadVault } from "./golden-vault";
import { defaultMarkupState, reachMarkupState } from "./markup-states";
import { AbstractInputSuggest, MarkdownRenderer, Menu, Notice, Platform } from "./stubs/obsidian";
import { notesApp } from "./view-harness";
import { SCREENSHOT_NOW, settingsOf, stateNames, stateOf } from "./visible-states";
import { flush, writerHarness } from "./writer-harness";

const tasksPlugin = { "obsidian-tasks-plugin": { apiV1: { editTaskLineModal: async () => "" } } };
const interactive =
	'[role="button"], a[href], button, input, select, textarea, .task, .counter, .todayHeader, a.modify, a.menu';
const dateButtons =
	'a.relative[aria-label^="due at"], a.relative[aria-label^="scheduled to"], a.relative[aria-label^="start at"]';
const rowControls = `[role="button"], a[href], a.modify, a.menu, ${dateButtons}`;
const all = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
function get(root: ParentNode, selector: string): HTMLElement {
	const element = root.querySelector<HTMLElement>(selector);
	assert.ok(element, `mounted element: ${selector}`);
	return element;
}
const rows = (root: ParentNode) => all(root, ".task");
const eligibleRows = (root: HTMLElement) =>
	rows(root).filter((row) => !root.classList.contains("todayFocus") || row.closest(".details.today"));
// jsdom reports tabIndex 0 even for anchors without href that cannot take focus.
const tabOrder = (root: HTMLElement) =>
	all(root, "a[href], button, input, select, textarea, [tabindex]").filter(
		(el) => el.tabIndex >= 0 && !el.matches(":disabled") && !el.closest("[hidden]"),
	);
const describe = (el: HTMLElement) =>
	`${el.tagName.toLowerCase()}${el.className ? `.${el.className}` : ""}${el.id ? `#${el.id}` : ""}`;

function freezeEventClock(t: TestContext) {
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
}

async function focus(element: HTMLElement) {
	await act(() => element.focus());
}

async function key(element: HTMLElement, value: string, timeStamp = 2000, shiftKey = false, repeat = false) {
	const event = new window.KeyboardEvent("keydown", {
		key: value,
		shiftKey,
		repeat,
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, "timeStamp", { value: timeStamp });
	await focus(element);
	await act(async () => {
		element.dispatchEvent(event);
		await flush();
	});
	return event;
}

async function click(element: HTMLElement, timeStamp = 2000, type = "click") {
	const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window });
	Object.defineProperty(event, "timeStamp", { value: timeStamp });
	await act(async () => {
		element.dispatchEvent(event);
		await flush();
	});
	return event;
}

function cleanupScope(t: TestContext): TestContext {
	const callbacks: (() => void | Promise<void>)[] = [];
	// node:test retains its hooks for reporting; empty this queue so closed views can be collected.
	t.after(async () => {
		for (const callback of callbacks.splice(0)) await callback();
	});
	return Object.assign(Object.create(t), {
		after: (callback: () => void | Promise<void>) => callbacks.push(callback),
	});
}

async function mountState(t: TestContext, name = defaultMarkupState) {
	t = cleanupScope(t);
	moment.now = () => SCREENSHOT_NOW;
	const mobile = Platform.isMobile;
	const suggestionStart = AbstractInputSuggest.made.length;
	if (name === "mobile") Platform.isMobile = true;
	t.after(() => {
		Platform.isMobile = mobile;
	});
	const fixture = await mountView(t, {
		app: Object.assign(goldenApp(loadVault()), { plugins: { plugins: tasksPlugin } }),
		options: settingsOf(stateOf(name.startsWith("light-") ? name : defaultMarkupState)),
	});
	// The recorder otherwise keeps every detached input and its React tree across the 42-state sweeps.
	t.after(() => {
		AbstractInputSuggest.made.splice(suggestionStart);
	});
	await reachMarkupState(fixture, name);
	// Obsidian adds these methods; QuickEntry's native focus handler uses them.
	const panel = get(fixture.root(), ".quickEntryPanel");
	Object.assign(panel, {
		addClass: (name: string) => panel.classList.add(name),
		removeClass: (name: string) => panel.classList.remove(name),
	});
	return fixture;
}

function defaultStop(root: HTMLElement) {
	const eligible = eligibleRows(root);
	const entry = get(root, ".quickEntryPanel");
	return eligible.find((row) => entry.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) ?? eligible[0];
}

function assertRoving(root: HTMLElement, stop: HTMLElement | undefined, name: string) {
	const list = rows(root);
	assert.deepEqual(
		list.flatMap((row, index) => (row.tabIndex === 0 ? [index] : [])),
		stop ? [list.indexOf(stop)] : [],
		`${name}: exactly the eligible row is the list Tab stop`,
	);
	for (const row of rows(root)) {
		assert.equal(row.tabIndex, row === stop ? 0 : -1, `${name}: row tabIndex`);
		for (const control of all(row, rowControls))
			assert.equal(control.tabIndex, row === stop ? 0 : -1, `${name}: ${describe(control)} follows its row`);
		for (const box of all(row, 'input[type="checkbox"]'))
			assert.equal(box.tabIndex, -1, `${name}: the checkbox is never a Tab stop`);
	}
	assert.ok(
		all(root, "*").every((el) => el.tabIndex <= 0),
		`${name}: no positive tabIndex`,
	);
}

function assertNames(root: HTMLElement, name: string) {
	const controls = all(root, `${interactive}, ${dateButtons}`);
	axe.setup(root);
	try {
		const unnamed = controls.filter((el) => !axe.commons.text.accessibleText(el).trim());
		const emptyTags = all(root, 'a.tag[href=""]').filter(
			(el) => el.textContent?.trim() === "" && el.getAttribute("aria-label") === "",
		);
		assert.deepEqual(
			unnamed.map(describe),
			emptyTags.map(describe),
			`${name}: the only unnamed interactive elements must be the ${emptyTags.length} empty tag links`,
		);
		assert.equal(unnamed.length, emptyTags.length, `${name}: empty tag exception count`);
		for (const el of unnamed) assert.ok(el.matches('a.tag[href=""]'), `${name}: unnamed exception is an empty tag`);
	} finally {
		axe.teardown();
	}
	for (const box of all(root, 'input[type="checkbox"]'))
		assert.equal(box.getAttribute("aria-label"), "Complete task");
	for (const control of all(root, `.counter, .todayHeader, a.modify, a.menu, ${dateButtons}`))
		assert.equal(control.getAttribute("role"), "button", `${name}: ${describe(control)} has button semantics`);
	for (const tag of all(root, "a.tag")) assert.equal(tag.hasAttribute("role"), false);
	for (const counter of all(root, ".counter")) {
		const pressed = root.classList.contains(`${counter.id}Filter`) || root.classList.contains(`${counter.id}Focus`);
		assert.equal(counter.getAttribute("aria-pressed"), String(pressed), `${name}: ${counter.id} pressed state`);
	}
	assert.equal(get(root, ".todayHeader").getAttribute("aria-pressed"), String(root.classList.contains("todayFocus")));
}

async function assertFocusable(root: HTMLElement, name: string) {
	for (const element of all(root, `${interactive}, ${dateButtons}`)) {
		await focus(element);
		assert.ok(document.activeElement === element, `${name}: ${describe(element)} accepts focus`);
	}
}

async function mountWritingTimeline(t: TestContext, text: string, options: Partial<typeof defaultUserOptions> = {}) {
	const h = writerHarness({ "Note.md": text });
	Object.assign(h.app, { plugins: { plugins: tasksPlugin } });
	const index = timelineTaskIndex(h.app as never);
	const writer = h.create({
		index,
		tasksDialog: () => getTasksDialog(h.app as never),
		tasks: () => ({ kind: "toggle" as const, toggle: (line: string) => line.replace("[ ]", "[x]") }),
	});
	const write = t.mock.fn(writer.write);
	const view = new TasksTimelineView(
		{ app: h.app } as never,
		index,
		{ ...writer, write },
		{ undo: () => new Notice("Undo") as never },
	);
	h.leaves.push({ view });
	const store = (view as unknown as { store: Store<TimelineState> }).store;
	await view.onUpdateOptions({
		...defaultUserOptions,
		defaultFilters: "",
		defaultTodayFocus: false,
		hideStatusTasks: [],
		openNoteInsteadOfInPlace: false,
		useBuiltinStyle: false,
		...options,
	});
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	const { element } = mountBridge({
		plugin: view,
		store,
		writer: view.viewWriter,
		ledger: view.ledger,
		pendingWrites: view.pendingWrites,
		onWriteResult: view.onWriteResult,
		onListCommitted: view.onListCommitted,
	});
	await act(() => root.render(element));
	t.after(async () => {
		await act(() => root.unmount());
		await view.onClose();
		writer.dispose();
		index.dispose();
		container.remove();
	});
	return { h, view, write, container };
}

function observeActions(t: TestContext) {
	type Handlers = ContextType<typeof TaskItemEventHandlersContext>;
	const callbacks = {
		handleOpenFile: t.mock.fn(),
		handleCompleteTask: t.mock.fn(),
		handleTagClick: t.mock.fn(),
		handleModifyTask: t.mock.fn<NonNullable<Handlers["handleModifyTask"]>>(),
		handleDateBadge: t.mock.fn<NonNullable<Handlers["handleDateBadge"]>>(),
		handleRowMenu: t.mock.fn<NonNullable<Handlers["handleRowMenu"]>>(),
	} satisfies ContextType<typeof TaskItemEventHandlersContext>;
	onTimelineRender(t, (_props, rendered) =>
		createElement(TaskItemEventHandlersContext.Provider, { value: callbacks }, rendered),
	);
	return callbacks;
}

test("every interactive element is focusable and has an accessible name", async (t) => {
	assert.equal(stateNames.length, 42);
	for (const name of [...stateNames, "mobile", "quick-filter"])
		await t.test(name, async (s) => {
			const fixture = await mountState(s, name);
			if (name === "mobile") {
				assert.equal(fixture.host.isMobile, true);
				assert.ok(all(fixture.root(), "a.menu").length > 0);
			}
			assertNames(fixture.root(), name);
			if (name === "quick-filter") {
				for (const [selector, label] of [
					["select.actionName", "Quick entry action"],
					["select.filterSelector", "Add a filter"],
					['select[name="priorityFilter"]', "Filter by priority"],
					[".dateFilter input:first-of-type", "Show tasks from this date"],
					[".dateFilter input:last-of-type", "Show tasks up to this date"],
				])
					assert.equal(get(fixture.root(), selector).getAttribute("aria-label"), label);
			}
			await assertFocusable(fixture.root(), name);
		});
});

test("Space on a focused row writes the same edit as a click", async (t) => {
	freezeEventClock(t);
	const mouse = await mountWritingTimeline(t, "Heading\n\n- [ ] Pay\n");
	const keyboard = await mountWritingTimeline(t, "Heading\n\n- [ ] Pay\n");
	await click(get(mouse.container, 'input[type="checkbox"]'));
	const event = await key(get(keyboard.container, ".task"), " ");
	assert.equal(mouse.write.mock.callCount(), 1, "the reference click writes once");
	assert.equal(keyboard.write.mock.callCount(), 1, "Space must invoke the same writer once");
	assert.deepEqual(keyboard.h.bytes, mouse.h.bytes, "Space and click produce identical note bytes");
	assert.deepEqual(keyboard.h.events, mouse.h.events, "Space and click produce identical writer events");
	assert.equal(event.defaultPrevented, true, "Space prevents page scrolling");
});

test("holding Space on a row toggles it once: repeated keydowns write nothing", async (t) => {
	freezeEventClock(t);
	const fixture = await mountWritingTimeline(t, "- [ ] Pay\n");
	const event = await key(get(fixture.container, ".task"), " ", 2000, false, true);
	assert.equal(event.defaultPrevented, true, "a repeated Space still does not scroll the page");
	assert.equal(fixture.write.mock.callCount(), 0, "a repeated Space writes nothing");
	assert.deepEqual(fixture.h.events, []);
	assert.equal(fixture.h.text("Note.md"), "- [ ] Pay\n");
});

async function reloadNote(fixture: Awaited<ReturnType<typeof mountWritingTimeline>>, text?: string) {
	await act(async () => {
		if (text !== undefined) fixture.h.put("Note.md", text);
		fixture.h.changed("Note.md");
		await fixture.view.onReloadTasks();
		await flush();
	});
}

const rowNamed = (root: ParentNode, text: string) => {
	const row = rows(root).find((row) => get(row, ".lines > .content").textContent?.trim() === text);
	assert.ok(row, `the row of ${text}`);
	return row;
};

test("completing the focused row with Space keeps focus on the next row", async (t) => {
	freezeEventClock(t);
	const fixture = await mountWritingTimeline(t, "- [ ] One\n- [ ] Two\n- [ ] Three\n", {
		hideStatusTasks: defaultUserOptions.hideStatusTasks,
	});
	assert.deepEqual(defaultUserOptions.hideStatusTasks, ["x", "-"]);
	await key(rowNamed(fixture.container, "Two"), " ");
	assert.equal(fixture.write.mock.callCount(), 1);
	assert.equal(fixture.h.text("Note.md"), "- [ ] One\n- [x] Two\n- [ ] Three\n");
	await reloadNote(fixture);
	assert.deepEqual(
		rows(fixture.container).map((row) => get(row, ".lines > .content").textContent?.trim()),
		["One", "Three"],
		"the completed row leaves the list",
	);
	const three = rowNamed(fixture.container, "Three");
	assert.ok(document.activeElement === three, "focus moves to the row after the completed one");
	assertRoving(fixture.container, three, "completed stop");
});

test("a row leaving the list does not move focus that was outside the timeline", async (t) => {
	freezeEventClock(t);
	const fixture = await mountWritingTimeline(t, "- [ ] One\n- [ ] Two\n- [ ] Three\n- [ ] Four\n", {
		hideStatusTasks: defaultUserOptions.hideStatusTasks,
	});
	const input = get(fixture.container, "input.newTask");
	await focus(rowNamed(fixture.container, "Two"));
	await focus(input);
	await click(get(rowNamed(fixture.container, "Two"), 'input[type="checkbox"]'));
	assert.equal(fixture.write.mock.callCount(), 1);
	await reloadNote(fixture);
	assert.ok(document.activeElement === input, "focus stays on the quick entry");
	assertRoving(fixture.container, defaultStop(fixture.container), "stop after Two left");
	await focus(rowNamed(fixture.container, "Three"));
	await act(() => rowNamed(fixture.container, "Three").blur());
	assert.ok(document.activeElement === document.body);
	await click(get(rowNamed(fixture.container, "Three"), 'input[type="checkbox"]'));
	assert.equal(fixture.write.mock.callCount(), 2);
	await reloadNote(fixture);
	assert.ok(document.activeElement === document.body, "focus stays on the body");
	assertRoving(fixture.container, defaultStop(fixture.container), "stop after Three left");
});

test("a control mounted later in the stop row joins the Tab order", async (t) => {
	const fixture = await mountWritingTimeline(t, "- [ ] One\n- [ ] Two\n");
	const two = rowNamed(fixture.container, "Two");
	await focus(two);
	assert.equal(all(two, "a.tag").length, 0);
	await reloadNote(fixture, "- [ ] One\n- [ ] Two #later\n");
	assert.ok(get(fixture.container, '.task[data-line="1"]') === two, "the edit keeps the row element");
	assert.equal(all(two, "a.tag").length, 1, "the edit mounts a tag in the stop row");
	assertRoving(fixture.container, two, "tag added to the stop row");
});

test("Enter on a counter toggles it and aria-pressed", async (t) => {
	const fixture = await mountState(t);
	for (const keyName of ["Enter", " "])
		for (const pressed of [true, false]) {
			const event = await key(get(fixture.root(), "#todo"), keyName);
			assert.equal(fixture.root().classList.contains("todoFilter"), pressed, `${keyName} toggles todoFilter`);
			assert.equal(get(fixture.root(), "#todo").getAttribute("aria-pressed"), String(pressed));
			for (const id of ["overdue", "unplanned"])
				assert.equal(get(fixture.root(), `#${id}`).getAttribute("aria-pressed"), "false");
			assert.equal(event.defaultPrevented, true);
		}
});

test("ArrowDown moves focus to the next row and Tab enters its controls", async (t) => {
	t.mock.method(
		MarkdownRenderer,
		"renderMarkdown",
		async (_markdown: string, element: { firstElementChild: unknown }) => {
			Object.defineProperty(element, "firstElementChild", {
				configurable: true,
				value: {
					innerHTML:
						'<a class="internal-link" href="Note.md">Note</a> <a class="external-link" href="https://example.invalid">Reference</a>',
				},
			});
		},
	);
	const fixture = await mountState(t);
	assert.ok(
		all(fixture.root(), ".task .content a[href]").length > 0,
		"rendered markdown links participate in roving focus",
	);
	const eligible = eligibleRows(fixture.root());
	const stop = defaultStop(fixture.root())!;
	const next = eligible[eligible.indexOf(stop) + 1];
	assert.ok(next, "there is a row after the default stop");
	const event = await key(stop, "ArrowDown");
	assert.ok(document.activeElement === next, "ArrowDown focuses the next eligible row");
	assert.equal(event.defaultPrevented, true);
	assertRoving(fixture.root(), next, "ArrowDown");
	const order = tabOrder(fixture.root());
	const first = get(next, rowControls);
	assert.ok(order[order.indexOf(next) + 1] === first, "the next Tab target belongs to the focused row");
	await focus(first);
	assert.ok(document.activeElement === first);
	await key(next, "ArrowUp");
	assert.ok(document.activeElement === stop);
});

// The ContextMenu key is a keydown followed by the native contextmenu event (on Windows, on keyup).
async function contextMenuKey(row: HTMLElement) {
	await key(row, "ContextMenu");
	return click(row, 2000, "contextmenu");
}

test("Shift+F10 opens the row menu", async (t) => {
	freezeEventClock(t);
	const show = t.mock.method(Menu.prototype, "showAtMouseEvent");
	const fixture = await mountState(t);
	await fixture.pushOptions({ ...fixture.options(), openNoteInsteadOfInPlace: false });
	for (const value of ["F10", "ContextMenu"]) {
		const before = show.mock.callCount();
		const row = defaultStop(fixture.root())!;
		const event = value === "F10" ? await key(row, value, 2000, true) : await contextMenuKey(row);
		assert.equal(show.mock.callCount(), before + 1, `${value} opens the row menu exactly once`);
		const mouse = show.mock.calls.at(-1)!.arguments[0];
		assert.ok(mouse instanceof window.MouseEvent, "the menu receives the view's MouseEvent");
		assert.ok(Number.isFinite(mouse.clientX) && Number.isFinite(mouse.clientY));
		assert.ok(Menu.instances.at(-1)!.items.some((item) => item.title === "Pick due date…"));
		assert.equal(event.defaultPrevented, true);
	}
	await fixture.pushOptions({ ...fixture.options(), openNoteInsteadOfInPlace: true });
	const before = show.mock.callCount();
	for (const value of ["F10", "ContextMenu"])
		if (value === "F10") await key(defaultStop(fixture.root())!, value, 2000, true);
		else await contextMenuKey(defaultStop(fixture.root())!);
	assert.equal(show.mock.callCount(), before, "in-place changes off disables the row menu");
});

test("the ContextMenu keydown alone opens no menu; the native contextmenu event does", async (t) => {
	freezeEventClock(t);
	const show = t.mock.method(Menu.prototype, "showAtMouseEvent");
	const fixture = await mountState(t);
	await fixture.pushOptions({ ...fixture.options(), openNoteInsteadOfInPlace: false });
	await key(defaultStop(fixture.root())!, "ContextMenu");
	assert.equal(show.mock.callCount(), 0, "the keydown leaves the menu to the contextmenu event that follows");
	await click(defaultStop(fixture.root())!, 2000, "contextmenu");
	assert.equal(show.mock.callCount(), 1, "the native contextmenu event opens it once");
});

test("Tab order follows the DOM: Focus on today, counters, the quick entry, then the list", async (t) => {
	const fixture = await mountState(t);
	const root = fixture.root();
	const stop = defaultStop(root)!;
	const expected = [
		get(root, ".todayHeader"),
		...all(root, ".counter"),
		get(root, ".tagFilterBar input"),
		...all(get(root, ".quickEntryPanel"), "select, input, button"),
		stop,
		...all(stop, rowControls),
	];
	assert.ok(
		all(root, "*").every((el) => el.tabIndex <= 0),
		"no positive tabIndex changes DOM order",
	);
	assert.deepEqual(
		tabOrder(root).map(describe),
		expected.map(describe),
		"Tab visits Focus today, counters, quick entry, then one row and its controls",
	);
	assertRoving(root, stop, "default Tab order");
});

test("axe-core finds no violation of the six rules in any of the 42 states", async (t) => {
	const rules = [
		"button-name",
		"aria-allowed-role",
		"nested-interactive",
		"aria-valid-attr-value",
		"aria-required-children",
		"duplicate-id-aria",
	];
	assert.equal(stateNames.length, 42);
	for (const name of stateNames)
		await t.test(name, async (s) => {
			const fixture = await mountState(s, name);
			const result = await axe.run(fixture.root(), { runOnly: { type: "rule", values: rules } });
			assert.deepEqual(result.violations, [], `${name}: no violations of the six rules`);
			const reported = [...result.passes, ...result.inapplicable].map((rule) => rule.id);
			for (const rule of rules) assert.ok(reported.includes(rule), `${name}: ${rule} ran`);
		});
});

test("the list has exactly one Tab stop in every state, on a row of today when Focus on today is on", async (t) => {
	for (const name of stateNames)
		await t.test(name, async (s) => {
			const fixture = await mountState(s, name);
			const root = fixture.root();
			assertRoving(root, defaultStop(root), name);
			if (stateOf(name).todayFocus)
				for (const row of rows(root).filter((row) => row.tabIndex === 0))
					assert.ok(row.closest(".details.today"));
		});
});

test("Home and End move focus to the first and last row", async (t) => {
	const fixture = await mountState(t);
	const eligible = eligibleRows(fixture.root());
	for (const [value, target] of [
		["End", eligible.at(-1)!],
		["Home", eligible[0]],
	] as const) {
		const event = await key(defaultStop(fixture.root())!, value);
		assert.ok(document.activeElement === target, `${value} focuses the boundary row`);
		assert.equal(event.defaultPrevented, true);
		assertRoving(fixture.root(), target, value);
		await key(target, value === "Home" ? "ArrowUp" : "ArrowDown");
		assert.ok(document.activeElement === target, "arrows stay at the list boundary");
	}
});

test("rows sharing a task id keep distinct names and keyboard stops for each day", async (t) => {
	moment.now = () => SCREENSHOT_NOW;
	const fixture = await mountView(t, {
		app: Object.assign(
			notesApp({ "Repeated.md": "- [ ] Across days #work 🛫 2026-01-14 ⏳ 2026-01-15 📅 2026-01-16" }),
			{ plugins: { plugins: tasksPlugin } },
		),
		options: {
			...settingsOf(stateOf(defaultMarkupState)),
			forward: false,
			openNoteInsteadOfInPlace: false,
		},
	});
	const root = fixture.root();
	const instances = rows(root);
	assert.equal(instances.length, 3, "one task is listed on three days");
	assert.equal(new Set(instances.map((row) => row.closest(".details"))).size, 3);
	const labels = instances.map((row) => {
		assert.equal(row.dataset.line, "0");
		assert.equal(get(row, "a.file").getAttribute("aria-label"), "Repeated.md");
		assert.ok(all(row, rowControls).length > 0, "each instance has controls to enter");
		const ids = [get(row, ".lines > .content").id, get(row, ":scope > .tcw-sr-only").id];
		assert.equal(row.getAttribute("aria-labelledby"), ids.join(" "));
		for (const id of ids) {
			assert.match(id, /^tcw-r[0-9a-v]+-/);
			assert.equal(all(root, "[id]").filter((element) => element.id === id).length, 1);
		}
		return ids.join(" ");
	});
	assert.equal(new Set(labels.flatMap((label) => label.split(" "))).size, 6);
	for (const [from, value, to] of [
		[0, "ArrowDown", 1],
		[1, "ArrowDown", 2],
		[2, "ArrowUp", 1],
		[1, "ArrowUp", 0],
		[0, "End", 2],
		[2, "Home", 0],
	] as const) {
		assert.equal((await key(instances[from], value)).defaultPrevented, true);
		assert.ok(document.activeElement === instances[to], `${value} reaches the day instance in DOM order`);
		assertRoving(root, instances[to], `${value} to instance ${to}`);
	}
	await focus(instances[2]);
	await fixture.reload();
	assert.ok(
		rows(root).every((row, index) => row === instances[index]),
		"reload preserves each row instance",
	);
	assert.deepEqual(
		rows(root).map((row) => row.getAttribute("aria-labelledby")),
		labels,
	);
	assertRoving(root, instances[2], "reload keeps the exact day instance as the stop");
	await key(get(root, ".todayHeader"), "Enter");
	const today = instances[1];
	assert.ok(today.closest(".details.today"));
	assertRoving(root, today, "Focus today chooses today's instance of the same task");
	for (const value of ["Home", "End", "ArrowUp", "ArrowDown"]) {
		await key(today, value);
		assert.ok(document.activeElement === today, `${value} excludes the same task's hidden instances`);
		assertRoving(root, today, value);
	}
});

test("a focused row that leaves the list hands its Tab stop to another row", async (t) => {
	const fixture = await mountState(t);
	const stop = get(fixture.root(), ".task.unplanned");
	await focus(stop);
	await key(get(fixture.root(), "#overdue"), "Enter");
	assert.equal(stop.isConnected, false, "the overdue filter removes the focused unplanned row");
	const successor = defaultStop(fixture.root());
	assert.ok(successor);
	assertRoving(fixture.root(), successor, "filtered stop");
});

test("Enter on a focused row opens the note like a click", async (t) => {
	const actions = observeActions(t);
	const fixture = await mountState(t);
	const row = defaultStop(fixture.root())!;
	await click(get(row, ".lines"));
	await key(row, "Enter");
	assert.equal(actions.handleOpenFile.mock.callCount(), 2, "click and Enter each open the note once");
	const [mouse, keyboard] = actions.handleOpenFile.mock.calls.map((call) => call.arguments);
	assert.deepEqual(keyboard.slice(0, 2), mouse.slice(0, 2), "Enter uses the click's path and source position");
	assert.ok(keyboard[2] instanceof window.KeyboardEvent);
	assert.equal(actions.handleCompleteTask.mock.callCount(), 0);
});

test("Enter and Space on a control inside the row do not reach the row", async (t) => {
	freezeEventClock(t);
	const actions = observeActions(t);
	const fixture = await mountWritingTimeline(t, "- [ ] Pay #work 📅 2026-01-16");
	const modify = get(fixture.container, "a.modify");
	const date = get(fixture.container, dateButtons);
	for (const value of ["Enter", " "]) {
		const before = actions.handleModifyTask.mock.callCount();
		assert.equal((await key(modify, value)).defaultPrevented, true, `${value} activates only the modify control`);
		assert.equal(actions.handleModifyTask.mock.callCount(), before + 1);
		const dates = actions.handleDateBadge.mock.callCount();
		assert.equal((await key(date, value)).defaultPrevented, true);
		assert.equal(actions.handleDateBadge.mock.callCount(), dates + 1);
	}
	// Links do not stop keydown propagation: the row must reject events from descendants itself.
	for (const value of ["Enter", " "]) await key(get(fixture.container, "a.tag[href]"), value);
	assert.equal(actions.handleOpenFile.mock.callCount(), 0);
	assert.equal(actions.handleCompleteTask.mock.callCount(), 0);
	assert.equal(fixture.write.mock.callCount(), 0);
	assert.deepEqual(fixture.h.events, []);
});

test("Space on a dimmed row or within 300 ms of the list commit writes nothing", async (t) => {
	freezeEventClock(t);
	const fixture = await mountWritingTimeline(t, "- [ ] Pay");
	const observed = onTimelineRender(t, (_props, rendered) => rendered);
	await act(async () => {
		fixture.h.put("Note.md", "- [ ] Pay\n- [ ] Added");
		fixture.h.changed("Note.md");
		await fixture.view.onReloadTasks();
	});
	assert.equal(observed.clock().lastListChangeAt, 1000);
	const row = get(fixture.container, '.task[data-line="0"]');
	for (const time of [990, 1000, 1299]) {
		await key(row, " ", time);
		assert.equal(fixture.write.mock.callCount(), 0, `Space at ${time} is guarded`);
		assert.equal(fixture.h.text("Note.md"), "- [ ] Pay\n- [ ] Added");
	}
	await key(row, " ", 1300);
	assert.equal(fixture.write.mock.callCount(), 1, "Space at the 300 ms boundary writes once");
	assert.equal(row.getAttribute("aria-busy"), "true", "the pending row is dimmed");
	const bytes = new Uint8Array(fixture.h.bytes.get("Note.md")!);
	const events = [...fixture.h.events];
	await key(row, " ", 2000);
	assert.equal(fixture.write.mock.callCount(), 1, "a dimmed row ignores Space after the guard");
	assert.deepEqual(fixture.h.bytes.get("Note.md"), bytes);
	assert.deepEqual(fixture.h.events, events);
});

test("Enter and Space on Focus on today toggle it and aria-pressed", async (t) => {
	const fixture = await mountState(t);
	const control = get(fixture.root(), '[aria-label="Focus today"]');
	for (const value of ["Enter", " "])
		for (const pressed of [true, false]) {
			const event = await key(control, value);
			assert.equal(fixture.root().classList.contains("todayFocus"), pressed, `${value} toggles todayFocus`);
			assert.equal(control.getAttribute("aria-pressed"), String(pressed));
			assert.equal(event.defaultPrevented, true);
			const stop = rows(fixture.root()).find((row) => row.tabIndex === 0);
			assertRoving(fixture.root(), stop, "Focus today toggle");
			if (pressed && stop) assert.ok(stop.closest(".details.today"));
		}
});

test("badges without their own handler have no role and are not focusable", async (t) => {
	const fixture = await mountState(t);
	for (const inPlace of [true, false]) {
		await fixture.pushOptions({ ...fixture.options(), openNoteInsteadOfInPlace: !inPlace });
		const badges = all(fixture.root(), "a.priority, a.repeat, a.file, a.relative").filter(
			(badge) => !inPlace || !badge.matches(dateButtons),
		);
		for (const selector of ["a.priority", "a.repeat", "a.file", "a.relative"])
			assert.ok(
				badges.some((badge) => badge.matches(selector)),
				selector,
			);
		for (const badge of badges) {
			assert.equal(badge.hasAttribute("role"), false);
			assert.equal(badge.hasAttribute("tabindex"), false);
			await focus(badge);
			assert.ok(document.activeElement !== badge);
		}
	}
});

test("the row's accessible name reads the task text, its status, dates and note", async (t) => {
	const fixture = await mountState(t);
	await fixture.pushOptions({ ...fixture.options(), hideStatusTasks: [] });
	const statuses: Record<string, string> = {
		overdue: "Overdue",
		due: "Due",
		scheduled: "Scheduled",
		start: "Started",
		done: "Done",
		unplanned: "Unplanned",
		process: "In progress",
		cancelled: "Cancelled",
	};
	axe.setup(fixture.root());
	try {
		for (const row of rows(fixture.root())) {
			assert.equal(row.getAttribute("role"), "listitem", "the row has listitem semantics");
			assert.equal(row.parentElement?.getAttribute("role"), "list");
			assert.equal(row.hasAttribute("aria-label"), false);
			const ids = row.getAttribute("aria-labelledby")?.split(/\s+/);
			assert.equal(ids?.length, 2, "aria-labelledby references task content and summary");
			const targets = ids!.map((id) => all(fixture.root(), "[id]").filter((el) => el.id === id));
			assert.ok(
				targets.every((matches) => matches.length === 1),
				"every label id resolves once inside this view",
			);
			assert.ok(targets[0][0] === get(row, ".lines > .content"));
			const summary = get(row, ":scope > span.tcw-sr-only");
			assert.equal(all(row, ".tcw-sr-only").length, 1);
			assert.ok(row.lastElementChild === summary);
			assert.ok(targets[1][0] === summary);
			const status = Object.keys(statuses).find((status) => row.classList.contains(status))!;
			const dates = all(row, "a.relative").map((badge) => badge.getAttribute("aria-label")!);
			const note = get(row, "a.file .label").textContent!;
			assert.equal(summary.textContent, [statuses[status], ...dates, note].join(", "));
			const name = axe.commons.text.accessibleText(row);
			assert.ok(
				name.includes(get(row, ".lines > .content").textContent!.replace(/\s+/g, " ").trim()),
				"the name includes the task text",
			);
			for (const part of [statuses[status], ...dates, note])
				assert.ok(name.includes(part), `the name includes ${part}`);
		}
	} finally {
		axe.teardown();
	}
});

test("two open timelines never share an id", async (t) => {
	const first = await mountState(t);
	const second = await mountState(t);
	const legacy = ["todo", "overdue", "unplanned"];
	for (const id of legacy)
		assert.equal(
			all(document, "[id]").filter((el) => el.id === id).length,
			2,
			`the existing counter id ${id} is unchanged in both views`,
		);
	const ids = all(document, "[id]")
		.filter((el) => !legacy.includes(el.id))
		.map((el) => el.id);
	assert.equal(new Set(ids).size, ids.length, "all non-counter ids are document-unique across two timelines");
	assert.equal(rows(first.root()).length, rows(second.root()).length);
	assert.ok(rows(first.root()).length > 0);
	for (const fixture of [first, second])
		for (const row of all(fixture.root(), ".task[aria-labelledby]"))
			for (const id of row.getAttribute("aria-labelledby")!.split(/\s+/))
				assert.equal(
					all(fixture.root(), "[id]").filter((el) => el.id === id).length,
					1,
					"the label target belongs to its own timeline",
				);
});

test("the Tab stop stays on its row when the list reorders", async (t) => {
	const notes = {
		"A.md": "- [ ] a 📅 2026-01-15",
		"Stop.md": "- [ ] stop 📅 2026-01-15",
		"Z.md": "- [ ] z 📅 2026-01-15",
	};
	const fixture = await mountView(t, {
		app: notesApp(notes),
		options: { ...settingsOf(stateOf(defaultMarkupState)), hideStatusTasks: [] },
	});
	const rowFor = (note: string) =>
		rows(fixture.root()).find((row) => row.querySelector("a.file")?.getAttribute("aria-label") === note)!;
	const stop = rowFor("Z.md");
	await focus(stop);
	const order = () => rows(fixture.root()).map((row) => row.querySelector("a.file")?.getAttribute("aria-label"));
	const before = order();
	const untouched = [stop, rowFor("Stop.md")].map((row) => [row, row.outerHTML] as const);
	notes["A.md"] = "- [x] a ✅ 2026-01-16";
	fixture.edited("A.md");
	await fixture.reload();
	assert.notDeepEqual(order(), before, "completion actually changes the DOM row order");
	assert.ok(defaultStop(fixture.root()) !== stop, "recomputing the default would lose the recorded stop");
	assert.ok(rowFor("Z.md") === stop, "the stop row keeps its identity");
	assert.equal(stop.tabIndex, 0, "the recorded stop stays on its row after reordering");
	assertRoving(fixture.root(), stop, "reordered list");
	for (const [row, markup] of untouched)
		assert.equal(row.outerHTML, markup, "an untouched row's attributes do not change");
});

test("Enter on Focus on today and on a counter render nothing but the Timeline", async (t) => {
	const expected = JSON.parse(readFileSync(path.join(FIXTURES, "markup", "render-counts.json"), "utf8")) as {
		operation: string;
		renders: Record<string, number>;
		providers: Record<string, string>;
	}[];
	for (const [operation, selector] of [
		["Focus on today click", '[aria-label="Focus today"]'],
		["counter click", "#todo"],
	])
		await t.test(operation, async (s) => {
			const counts = countRenders(s);
			const fixture = await mountState(s);
			counts.reset();
			await key(get(fixture.root(), selector), "Enter");
			const baseline = expected.find((entry) => entry.operation === operation)!;
			assert.deepEqual(
				counts.snapshot(),
				{ renders: baseline.renders, providers: baseline.providers },
				`${operation}: Enter matches the recorded click render counts and provider identities`,
			);
		});
});
