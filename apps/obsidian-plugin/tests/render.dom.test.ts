// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement, createRef, Fragment, Profiler, Suspense } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTaskLine, type DateField, type Store, type Task, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { MarkdownView, Notice, Platform } from "./stubs/obsidian";

import { defaultUserOptions } from "../src/useroptions";
import { TasksTimelineView, timelineTaskIndex } from "../src/views";
import type { TimelineState } from "../src/state/timeline";
import { providerValues } from "../timeline/src/components/renderprobe";
import { TaskItemEventHandlersContext } from "../timeline/src/components/context";
import { TimelineView } from "../timeline/src/components/timelineview";
import { StripWithIcon } from "../timeline/src/components/statusmarker";
import { getTaskStatusIcon } from "../timeline/src/components/asserts/icons";
import { createPendingWrites } from "../timeline/src/pendingwrites";
import { clickTime, clickIsGuarded } from "../timeline/src/components/clickguard";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { undoNoticeText } from "../timeline/src/notices";
import { getTasksDialog } from "../timeline/src/tasksplugin";
import { moment } from "../utils/moment";
import type { WriteEvent } from "../timeline/src/taskwriter";
import { deferred, flush, writerHarness } from "./writer-harness";

test("the dimmed row uses no layer-creating property", () => {
	const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const busyRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) =>
		selector.includes("[aria-busy"),
	);
	assert.ok(busyRules.length > 0);
	for (const [, selector, body] of busyRules) {
		assert.doesNotMatch(
			body,
			/(?:^|;)\s*(?:opacity|filter|transform|will-change|backdrop-filter)\s*:/i,
			selector.trim(),
		);
	}
});

async function mountWritingTimeline(
	t: TestContext,
	text: string,
	toggle?: (line: string) => string,
	probe?: { onCommit?: (container: HTMLElement) => void; suspend?: boolean },
) {
	const h = writerHarness({ "Note.md": text });
	Object.assign(h.app, { plugins: { plugins: {} } });
	const index = timelineTaskIndex(h.app as never);
	const writer = h.create({
		index,
		tasksDialog: () => getTasksDialog(h.app as never),
		...(toggle ? { tasks: () => ({ kind: "toggle" as const, toggle }) } : {}),
	});
	const write = t.mock.fn(writer.write);
	const editInTasksDialog = t.mock.fn(writer.editInTasksDialog);
	const undo: (() => Promise<void>)[] = [];
	const undoNotices: Notice[] = [];
	const view = new TasksTimelineView(
		{ app: h.app } as never,
		index,
		{ ...writer, write, editInTasksDialog },
		{
			undo(context, change, run) {
				undo.push(async () => {
					await run();
				});
				const notice = new Notice(undoNoticeText(context, change), 10000);
				undoNotices.push(notice);
				return notice as never;
			},
		},
	);
	h.leaves.push({ view });
	const store = (view as unknown as { store: Store<TimelineState> }).store;
	await view.onUpdateOptions({ ...defaultUserOptions, hideStatusTasks: [] });
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	const bridge = createRef<ObsidianBridge>();
	const element = createElement(ObsidianBridge, {
		ref: bridge,
		plugin: view,
		store,
		writer: view.viewWriter,
		ledger: view.ledger,
		pendingWrites: view.pendingWrites,
		onWriteResult: view.onWriteResult,
		onListCommitted: view.onListCommitted,
	});
	const observed = probe
		? createElement(Profiler, { id: "timeline", onRender: () => probe.onCommit?.(container) }, element)
		: element;
	await act(() => root.render(probe?.suspend ? createElement(Suspense, { fallback: null }, observed) : observed));
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
	return { h, view, store, writer, write, editInTasksDialog, undo, undoNotices, container, click, bridge };
}

async function mountNoteActions(
	t: TestContext,
	{ openNoteInsteadOfInPlace = true, tasks = {} }: { openNoteInsteadOfInPlace?: boolean; tasks?: object | null } = {},
) {
	const text = "Heading\n\n- [ ] a";
	const fixture = await mountWritingTimeline(t, text, (line) => line.replace("[ ]", "[x]"));
	const noteView = new MarkdownView();
	noteView.editor = { setCursor: () => {} };
	const openFile = t.mock.fn(async () => {});
	const getLeaf = t.mock.fn(() => ({ view: noteView, openFile }));
	Object.assign(fixture.h.app.workspace, { getLeaf });
	Object.assign(fixture.h.app, { plugins: { plugins: tasks === null ? {} : { "obsidian-tasks-plugin": tasks } } });
	const command = t.mock.fn();
	const commands = t.mock.fn(() => ({
		commands: { "obsidian-tasks-plugin:edit-task": { editorCheckCallback: command } },
	}));
	Object.defineProperty(fixture.h.app, "commands", { get: commands });
	await act(() =>
		fixture.view.onUpdateOptions({
			...defaultUserOptions,
			hideStatusTasks: [],
			openNoteInsteadOfInPlace,
		}),
	);
	return { ...fixture, text, openFile, getLeaf, commands, command };
}

test("with the setting on, clicking a checkbox opens the note once and does not call the writer", async (t) => {
	const fixture = await mountNoteActions(t);
	await fixture.click(2);
	assert.equal(fixture.openFile.mock.callCount(), 1);
	assert.deepEqual(fixture.openFile.mock.calls[0].arguments, [
		fixture.h.app.vault.getFileByPath("Note.md"),
		{ active: true, eState: { line: 2 } },
	]);
	assert.equal(fixture.write.mock.callCount(), 0);
	assert.equal(fixture.commands.mock.callCount(), 0);
	assert.equal(fixture.view.pendingWrites.getSnapshot("Note.md:2"), undefined);
	assert.equal(fixture.container.querySelector(".task")?.hasAttribute("aria-busy"), false);
	assert.equal(fixture.h.text("Note.md"), fixture.text);
});

test("with the setting on, ✏️ opens the note once and runs no Tasks command", async (t) => {
	const editTaskLineModal = t.mock.fn(async () => "- [ ] edited");
	const fixture = await mountNoteActions(t, { tasks: { apiV1: { editTaskLineModal } } });
	const modify = fixture.container.querySelector<HTMLElement>(".task .modify");
	assert.ok(modify);
	await act(async () => {
		modify.click();
		await flush();
	});
	assert.equal(fixture.openFile.mock.callCount(), 1);
	assert.deepEqual(fixture.openFile.mock.calls[0].arguments, [
		fixture.h.app.vault.getFileByPath("Note.md"),
		{ active: true, eState: { line: 2 } },
	]);
	assert.equal(fixture.commands.mock.callCount(), 0);
	assert.equal(fixture.command.mock.callCount(), 0);
	assert.equal(fixture.write.mock.callCount(), 0);
	assert.equal(fixture.editInTasksDialog.mock.callCount(), 0);
	assert.equal(editTaskLineModal.mock.callCount(), 0);
	assert.equal(fixture.view.pendingWrites.getSnapshot("Note.md:2"), undefined);
	assert.equal(fixture.container.querySelector(".task")?.hasAttribute("aria-busy"), false);
	assert.equal(fixture.h.text("Note.md"), fixture.text);
});

test("✏️ does not open the note through the row", async (t) => {
	const editTaskLineModal = t.mock.fn(() => new Promise<string>(() => {}));
	const fixture = await mountNoteActions(t, {
		openNoteInsteadOfInPlace: false,
		tasks: { apiV1: { editTaskLineModal } },
	});
	const modify = fixture.container.querySelector<HTMLElement>(".task .modify");
	assert.ok(modify);
	await act(async () => {
		modify.click();
		await flush();
	});
	assert.equal(editTaskLineModal.mock.callCount(), 1);
	assert.deepEqual(editTaskLineModal.mock.calls[0].arguments, ["- [ ] a"]);
	assert.equal(fixture.editInTasksDialog.mock.callCount(), 1);
	assert.equal(fixture.openFile.mock.callCount(), 0);
	assert.equal(fixture.commands.mock.callCount(), 0);
	assert.equal(fixture.command.mock.callCount(), 0);
	assert.equal(fixture.h.text("Note.md"), fixture.text);
	assert.equal(fixture.view.pendingWrites.getSnapshot("Note.md:2"), undefined);
	assert.deepEqual(fixture.h.events, []);
});

test("with the setting off, ✏️ writes the dialog edit and shows its Undo notice", async (t) => {
	const editTaskLineModal = t.mock.fn(async () => "- [ ] edited");
	const fixture = await mountNoteActions(t, {
		openNoteInsteadOfInPlace: false,
		tasks: { apiV1: { editTaskLineModal } },
	});
	const modify = fixture.container.querySelector<HTMLElement>(".task .modify");
	assert.ok(modify);
	await act(async () => {
		modify.click();
		await flush();
	});
	assert.equal(fixture.editInTasksDialog.mock.callCount(), 1);
	assert.equal(editTaskLineModal.mock.callCount(), 1);
	assert.deepEqual(editTaskLineModal.mock.calls[0].arguments, ["- [ ] a"]);
	assert.equal((await fixture.editInTasksDialog.mock.calls[0].result)?.kind, "written");
	assert.equal(fixture.h.text("Note.md"), "Heading\n\n- [ ] edited");
	assert.equal(fixture.openFile.mock.callCount(), 0);
	assert.equal(fixture.commands.mock.callCount(), 0);
	assert.equal(fixture.undoNotices.length, 1);
	assert.equal(fixture.undoNotices[0].message, "Saved your edit to “a” in Note.");
});

test("with the setting off, ✏️ visibility follows the Tasks entry", async (t) => {
	for (const [name, tasks] of [
		["dialog API", { apiV1: { editTaskLineModal: async () => "" } }],
		["older API", { apiV1: {} }],
		["malformed API", {}],
		["absent", null],
	] as const) {
		await t.test(name, async (t) => {
			const fixture = await mountNoteActions(t, { openNoteInsteadOfInPlace: false, tasks });
			assert.equal(fixture.container.querySelector(".task .modify") !== null, tasks !== null);
		});
	}
});

test("with the setting off, the checkbox still writes through the writer", async (t) => {
	const fixture = await mountNoteActions(t);
	await act(() =>
		fixture.view.onUpdateOptions({
			...defaultUserOptions,
			hideStatusTasks: [],
			openNoteInsteadOfInPlace: false,
		}),
	);
	await fixture.click(2);
	assert.equal(fixture.write.mock.callCount(), 1);
	assert.equal(fixture.openFile.mock.callCount(), 0);
	assert.equal(fixture.h.text("Note.md"), "Heading\n\n- [x] a");
	assert.equal(fixture.container.querySelector(".task")?.getAttribute("aria-busy"), "true");
});

test("with the setting on, mod-clicking either control opens a new tab", async (t) => {
	const fixture = await mountNoteActions(t);
	for (const selector of [".task label.icon", ".task .modify"]) {
		const control = fixture.container.querySelector<HTMLElement>(selector);
		assert.ok(control);
		await act(async () => {
			control.dispatchEvent(new MouseEvent("click", { bubbles: true, view: window, metaKey: true }));
			await flush();
		});
	}
	assert.equal(fixture.openFile.mock.callCount(), 2);
	assert.deepEqual(
		fixture.getLeaf.mock.calls.map((call) => call.arguments),
		[["tab"], ["tab"]],
	);
	assert.equal(fixture.write.mock.callCount(), 0);
	assert.equal(fixture.commands.mock.callCount(), 0);
});

test("with the setting on, the native checkbox opens the note without changing its marker", async (t) => {
	const fixture = await mountNoteActions(t);
	await act(() => fixture.view.onUpdateOptions({ ...fixture.store.getSnapshot().options, useBuiltinStyle: false }));
	const checkbox = fixture.container.querySelector<HTMLInputElement>('.task input[type="checkbox"]');
	assert.ok(checkbox);
	await act(async () => {
		checkbox.click();
		await flush();
	});
	assert.equal(fixture.openFile.mock.callCount(), 1);
	assert.equal(fixture.write.mock.callCount(), 0);
	assert.equal(checkbox.checked, false);
	assert.equal(fixture.h.text("Note.md"), fixture.text);
});

test("with the setting on, guarded control clicks do not open the note", async (t) => {
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
	const fixture = await mountNoteActions(t);
	await act(async () => {
		fixture.h.put("Note.md", fixture.text + "\n- [ ] b");
		fixture.h.changed("Note.md");
		await fixture.view.onReloadTasks();
	});
	for (const selector of [".task label.icon", ".task .modify"]) {
		const control = fixture.container.querySelector<HTMLElement>(selector);
		assert.ok(control);
		const event = new MouseEvent("click", { bubbles: true, view: window });
		Object.defineProperty(event, "timeStamp", { value: 990 });
		await act(() => control.dispatchEvent(event));
	}
	assert.equal(fixture.openFile.mock.callCount(), 0);
	assert.equal(fixture.write.mock.callCount(), 0);
	assert.equal(fixture.commands.mock.callCount(), 0);
});

test("with the setting on, ✏️ is still hidden without Tasks", async (t) => {
	const fixture = await mountWritingTimeline(t, "- [ ] a");
	await act(() =>
		fixture.view.onUpdateOptions({ ...fixture.store.getSnapshot().options, openNoteInsteadOfInPlace: true }),
	);
	assert.equal(fixture.container.querySelector(".task .modify"), null);
});

/** A display-only writer event, mounted through the same stable store as a view. */
async function mountPendingRow(t: TestContext, sourceLine: string, lines: readonly string[], dateActions = false) {
	const task = parseTaskLine(sourceLine, { moment, path: "Note.md" });
	assert.ok(task);
	const pending = createPendingWrites();
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	const options = { ...defaultUserOptions, hideStatusTasks: [] };
	let tasks: readonly Task[] = [task];
	let writes = 0;
	let opens = 0;
	const menuEvents: MouseEvent[] = [];
	const pickedFields: DateField[] = [];
	const callbacks = {
		handleOpenFile: () => {
			opens++;
		},
		handleTagClick: () => {},
		handleModifyTask: () => {
			writes++;
		},
		handleRowMenu: dateActions
			? (_model: TaskRowModel, event: MouseEvent) => {
					menuEvents.push(event);
				}
			: undefined,
		handleDateBadge: dateActions
			? (_model: TaskRowModel, field: DateField) => {
					pickedFields.push(field);
				}
			: undefined,
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
		menuEvents,
		pickedFields,
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

test("right-click on a row opens the menu once and does not open the note", async (t) => {
	const row = await mountPendingRow(t, "- [ ] a", ["- [x] a"], true);
	let bubbled = 0;
	const onContextMenu = () => bubbled++;
	document.body.addEventListener("contextmenu", onContextMenu);
	t.after(() => document.body.removeEventListener("contextmenu", onContextMenu));
	const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window });
	await act(() => row.container.querySelector(".task .content")!.dispatchEvent(event));
	assert.equal(event.defaultPrevented, true);
	assert.deepEqual(row.menuEvents, [event]);
	assert.equal(bubbled, 0);
	assert.equal(row.opens(), 0);
});

test("dimmed and guarded right-clicks prevent the default without opening the menu", async (t) => {
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
	const row = await mountPendingRow(t, "- [ ] a", ["- [x] a"], true);
	await row.click();
	const dispatch = async (selector = ".task") => {
		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window });
		Object.defineProperty(event, "timeStamp", { value: 990 });
		await act(() => row.container.querySelector(selector)!.dispatchEvent(event));
		assert.equal(event.defaultPrevented, true);
	};
	await dispatch();
	assert.deepEqual(row.menuEvents, []);
	const b = parseTaskLine("- [ ] b", { moment, path: "Other.md" });
	assert.ok(b);
	await row.renderTasks([b, row.task]);
	assert.ok(row.container.querySelector(".task:not([aria-busy])"));
	await dispatch(".task:not([aria-busy])");
	assert.deepEqual(row.menuEvents, []);
	assert.equal(row.opens(), 0);
});

test("mobile renders ⋯ after ✏️ and sends its click to the row menu; desktop renders no ⋯", async (t) => {
	const previous = Platform.isMobile;
	t.after(() => {
		Platform.isMobile = previous;
	});
	Platform.isMobile = false;
	const desktop = await mountPendingRow(t, "- [ ] a", ["- [x] a"], true);
	assert.equal(desktop.container.querySelector(".info .menu"), null);
	assert.doesNotMatch(desktop.container.querySelector(".info")!.textContent!, /⋯/u);
	Platform.isMobile = true;
	const mobile = await mountPendingRow(t, "- [ ] a", ["- [x] a"], true);
	const button = mobile.container.querySelector<HTMLElement>(".info .menu");
	assert.ok(button);
	assert.equal(button.textContent, "⋯");
	assert.equal(button.getAttribute("aria-label"), "Task menu");
	assert.equal(button.previousElementSibling?.className, "modify");
	const event = new MouseEvent("click", { bubbles: true, view: window });
	await act(() => button.dispatchEvent(event));
	assert.deepEqual(mobile.menuEvents, [event]);
	assert.equal(mobile.opens(), 0);
	await mobile.click();
	await act(() => button.click());
	assert.equal(mobile.menuEvents.length, 1, "a dimmed mobile row ignores its menu button");
});

test("the setting leaves the default context menu and hides ⋯ on mobile", async (t) => {
	const previous = Platform.isMobile;
	Platform.isMobile = true;
	t.after(() => {
		Platform.isMobile = previous;
	});
	const fixture = await mountNoteActions(t);
	const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window });
	await act(() => fixture.container.querySelector(".task")!.dispatchEvent(event));
	assert.equal(event.defaultPrevented, false);
	assert.equal(fixture.container.querySelector(".info .menu"), null);
	assert.equal(fixture.openFile.mock.callCount(), 0);
	assert.equal(fixture.write.mock.callCount(), 0);
});

test("date badge clicks pick due, scheduled and start without opening the note", async (t) => {
	const source = "- [ ] a 📅 2026-10-31 ⏳ 2026-10-30 🛫 2026-10-29 ✅ 2026-10-28";
	const row = await mountPendingRow(t, source, [source.replace("[ ]", "[x]")], true);
	const selectors = ["due at ", "scheduled to ", "start at ", "complete at "].map(
		(prefix) => `.info > a[aria-label^="${prefix}"]`,
	);
	for (const selector of selectors) await row.click(selector);
	assert.deepEqual([...row.pickedFields].sort(), ["due", "scheduled", "start"]);
	assert.equal(row.opens(), 1, "the completion badge still opens the note");
	await row.click();
	for (const selector of selectors) await row.click(selector);
	assert.equal(row.pickedFields.length, 3, "dimmed badges do not pick a date");
	const withoutHandler = await mountPendingRow(t, source, []);
	for (const selector of selectors) await withoutHandler.click(selector);
	assert.equal(withoutHandler.opens(), 4, "without a handler every date badge bubbles to the row");
});

test("guarded mobile menu and date badge clicks do not open the note", async (t) => {
	const previous = Platform.isMobile;
	Platform.isMobile = true;
	t.after(() => {
		Platform.isMobile = previous;
	});
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
	const row = await mountPendingRow(t, "- [ ] a 📅 2026-10-31", [], true);
	const other = parseTaskLine("- [ ] b", { moment, path: "Other.md" });
	assert.ok(other);
	await row.renderTasks([other, row.task]);
	for (const selector of [".info .menu", '.info > a[aria-label^="due at "]']) {
		const control = row.container.querySelector<HTMLElement>(selector);
		assert.ok(control);
		const event = new MouseEvent("click", { bubbles: true, view: window });
		Object.defineProperty(event, "timeStamp", { value: 990 });
		await act(() => control.dispatchEvent(event));
	}
	assert.deepEqual(row.menuEvents, []);
	assert.deepEqual(row.pickedFields, []);
	assert.equal(row.opens(), 0);
});

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

test("🏁 deletion then Undo keeps both shifts", async (t) => {
	const original = "- [ ] a 📅 2026-01-15 🏁 delete";
	const fixture = await mountWritingTimeline(t, original + "\n- [ ] b", (line) =>
		line === original ? "" : line.replace("[ ]", "[x]"),
	);
	await fixture.click(0);
	assert.equal(fixture.h.text("Note.md"), "- [ ] b");
	assert.equal(fixture.view.ledger.shift("Note.md", 1), 0);
	assert.equal(fixture.undo.length, 1);
	await fixture.h.clock.advance(1000);
	await act(() => fixture.undo[0]());
	assert.equal(fixture.view.ledger.shift("Note.md", 1), 1, "both -1 and +1 remain before re-read");
	await fixture.click(1);
	assert.equal(fixture.h.events.filter((event) => event.kind === "written").at(-1)?.line, 1);
	assert.equal(fixture.h.text("Note.md"), original + "\n- [x] b");
	assert.deepEqual(fixture.h.refusals, []);
});

test("an Undo after the re-read dims the restored row", async (t) => {
	t.mock.method(performance, "now", () => 0);
	const fixture = await mountWritingTimeline(t, "- [ ] Pay");
	await fixture.click(0);
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
	});
	assert.equal(fixture.store.getSnapshot().tasks[0].sourceLine, "- [x] Pay ✅ 2026-10-31");
	assert.equal(fixture.container.querySelector(".task")?.hasAttribute("aria-busy"), false);
	await act(() => fixture.undo[0]());
	assertIcon(fixture.container, "unplanned", " ");
	const writes = fixture.write.mock.callCount();
	t.mock.method(performance, "now", () => 1000);
	t.mock.method(window.performance, "now", () => 1000);
	const event = new MouseEvent("click", { bubbles: true, view: window });
	Object.defineProperty(event, "timeStamp", { value: 1000 });
	const control = fixture.container.querySelector<HTMLElement>(".task label.icon");
	assert.ok(control);
	await act(async () => {
		control.dispatchEvent(event);
		await flush();
	});
	assert.equal(fixture.write.mock.callCount(), writes, "the dimmed row ignores a click after the list guard");
	assert.equal(fixture.h.text("Note.md"), "- [ ] Pay");
});

test("an Undo after the re-read dims the restored duplicate, not the other", async (t) => {
	const fixture = await mountWritingTimeline(t, "- [ ] Pay\n- [ ] Pay");
	await fixture.click(0);
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
	});
	assert.deepEqual(
		fixture.store.getSnapshot().tasks.map((task) => task.sourceLine),
		["- [x] Pay ✅ 2026-10-31", "- [ ] Pay"],
	);
	await act(() => fixture.undo[0]());
	const restored = fixture.container.querySelector('.task[data-line="0"]');
	const other = fixture.container.querySelector('.task[data-line="1"]');
	assert.ok(restored && other);
	assert.equal(restored.getAttribute("aria-busy"), "true");
	assert.equal(restored.getAttribute("aria-disabled"), "true");
	assert.equal(restored.querySelector("input")?.getAttribute("data-task"), " ");
	assert.equal(other.hasAttribute("aria-busy"), false);
	assert.equal(other.hasAttribute("aria-disabled"), false);
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

/** A commit probe sees intermediate sync commits that MutationObserver batches together. */
function rowFrame(container: HTMLElement, line = 0) {
	const row = container.querySelector(`.task[data-line="${line}"]`);
	return {
		marker: row?.querySelector("input[data-task]")?.getAttribute("data-task"),
		busy: row?.getAttribute("aria-busy") === "true",
	};
}

async function assertMountedRowBeforePaint(t: TestContext, source: string, written: string, marker: string) {
	let now = 1000;
	t.mock.method(performance, "now", () => now);
	t.mock.method(window.performance, "now", () => now);
	let recording = false;
	let frame:
		| (ReturnType<typeof rowFrame> & { row: Element | null; disabled: boolean | undefined; cleared: boolean })
		| undefined;
	const fixture = await mountWritingTimeline(t, source, () => written, {
		onCommit: (container) => {
			if (!recording || fixture.bridge.current!.state.reloadId === previousReload) return;
			recording = false;
			// Exhaust the scheduler slice so passive effects wait for a later task even on a small list.
			now += 10;
			// Capture after layout updates finish, before a later scheduler task can flush passive effects.
			queueMicrotask(() => {
				const row = container.querySelector('.task[data-line="0"]');
				frame = {
					...rowFrame(container),
					row,
					disabled: row?.hasAttribute("aria-disabled"),
					cleared: fixture.view.pendingWrites.getSnapshot("Note.md:0") === undefined,
				};
			});
		},
	});
	const oldRow = fixture.container.querySelector('.task[data-line="0"]');
	assert.ok(oldRow);
	await fixture.click(0);
	assertIcon(fixture.container, "done", "x");
	assert.equal(fixture.h.text("Note.md"), written);
	const previousReload = fixture.bridge.current!.state.reloadId;
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
	scope.IS_REACT_ACT_ENVIRONMENT = false;
	try {
		recording = true;
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
		for (let attempt = 0; frame === undefined && attempt < 100; attempt++)
			await new Promise((resolve) => setTimeout(resolve, 10));
		assert.ok(frame, "the reload committed and its microtask captured the row");
		assert.equal(fixture.bridge.current!.state.reloadId, fixture.store.getSnapshot().reloadId);
		assert.ok(frame.row);
		assert.notStrictEqual(frame.row, oldRow, "the changed date group mounted a new row");
		assert.equal(oldRow.isConnected, false);
		assert.equal(frame.cleared, true, "the list commit cleared the store overlay");
		assert.deepEqual(
			{ busy: frame.busy, disabled: frame.disabled, marker: frame.marker },
			{ busy: false, disabled: false, marker },
			"the freshly mounted row has no cleared overlay before the next scheduler task",
		);
	} finally {
		scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
	}
}

test("a row mounted by the transition commit drops a cleared overlay before paint", async (t) => {
	await assertMountedRowBeforePaint(
		t,
		"- [ ] a 🔁 every day 📅 2026-01-15",
		"- [ ] a 🔁 every day 📅 2026-01-16\n- [x] a 🔁 every day 📅 2026-01-15 ✅ 2026-01-15",
		" ",
	);
});

test("a written row that changes date group in the transition commit is not left dimmed", async (t) => {
	await assertMountedRowBeforePaint(t, "- [ ] a 📅 2026-11-01", "- [x] a ✅ 2026-10-31", "x");
});

test("overlay is not cleared before the transition commits the written text", async (t) => {
	const commits: ReturnType<typeof rowFrame>[] = [];
	const frames: ReturnType<typeof rowFrame>[] = [];
	let recording = false;
	const fixture = await mountWritingTimeline(t, "- [ ] a", undefined, {
		onCommit: (container) => {
			if (recording) commits.push(rowFrame(container));
		},
	});
	await fixture.click(0);
	recording = true;
	const observer = new window.MutationObserver(() => frames.push(rowFrame(fixture.container)));
	observer.observe(fixture.container, { subtree: true, attributes: true, childList: true });
	t.after(() => observer.disconnect());
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
		const counter = fixture.container.querySelector<HTMLElement>("#unplanned");
		assert.ok(counter);
		flushSync(() => counter.click());
		assert.equal(fixture.bridge.current!.state.tasks[0].statusMarker, " ", "the old model is still shown");
		assert.deepEqual(rowFrame(fixture.container), { marker: "x", busy: true });
		assert.ok(fixture.view.pendingWrites.getSnapshot("Note.md:0"));
		flushSync(() => counter.click());
	});
	assert.deepEqual(rowFrame(fixture.container), { marker: "x", busy: false });
	assert.ok(commits.length > 0);
	assert.ok(frames.length > 0);
	for (const frame of [...commits, ...frames])
		assert.ok(frame.busy || frame.marker !== " ", "no commit or mutation frame exposes the pre-write marker");
});

test("an urgent update while the list is pending keeps the old list and its line shifts", async (t) => {
	let now = 1000;
	t.mock.method(performance, "now", () => now);
	t.mock.method(window.performance, "now", () => now);
	const original = "- [ ] a 🔁 every day 📅 2026-01-15";
	const fixture = await mountWritingTimeline(t, original + "\n- [ ] b", (line) =>
		line === original
			? "- [ ] a 🔁 every day 📅 2026-01-16\n- [x] a 🔁 every day 📅 2026-01-15 ✅ 2026-01-15"
			: line.replace(/\[( |x)\]/, (_, marker) => (marker === " " ? "[x]" : "[ ]")),
	);
	await fixture.click(0);
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
		assert.equal(fixture.view.ledger.shift("Note.md", 1), 2, "the old row still needs the first write's shift");
		flushSync(() => fixture.container.querySelector<HTMLElement>('.task[data-line="1"] label.icon')!.click());
		await flush();
		assert.equal(fixture.h.events.filter((event) => event.kind === "written").at(-1)?.line, 2);
		assert.equal(fixture.h.text("Note.md").split("\n")[2], "- [x] b");
	});
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
	});
	now += 1000;
	assert.equal(fixture.view.ledger.shift("Note.md", 2), 2, "the committed line receives no second shift");
	await fixture.click(2);
	assert.equal(fixture.h.events.filter((event) => event.kind === "written").at(-1)?.line, 2);
	assert.equal(fixture.h.text("Note.md").split("\n")[2], "- [ ] b");
	assert.deepEqual(fixture.h.refusals, []);
});

test("a write started during a pending list transition dims the row on screen", async (t) => {
	const original = "- [ ] a 🔁 every day 📅 2026-01-15";
	const fixture = await mountWritingTimeline(t, original + "\n- [ ] b\n- [ ] c", (line) =>
		line === original
			? "- [ ] a 🔁 every day 📅 2026-01-16\n- [x] a 🔁 every day 📅 2026-01-15 ✅ 2026-01-15"
			: line.replace("[ ]", "[x]"),
	);
	await fixture.click(0);
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
		assert.equal(fixture.store.getSnapshot().tasks.find((task) => task.sourceLine === "- [ ] b")?.line, 2);
		flushSync(() => fixture.container.querySelector<HTMLElement>('.task[data-line="1"] label.icon')!.click());
		await flush();
		flushSync(() => {});
		assert.deepEqual(rowFrame(fixture.container, 1), { marker: "x", busy: true });
		assert.deepEqual(rowFrame(fixture.container, 2), { marker: " ", busy: false });
		assert.equal(fixture.view.pendingWrites.getSnapshot("Note.md:1")?.id, 2);
		assert.equal(fixture.view.pendingWrites.getSnapshot("Note.md:2"), undefined);
	});
});

test("the list commit moves the click clock once", async (t) => {
	let now = 1000;
	t.mock.method(performance, "now", () => now);
	t.mock.method(window.performance, "now", () => now);
	const suspended = deferred();
	let block = true;
	let discarded = 0;
	const mounted: { timeline?: TimelineView } = {};
	const render = TimelineView.prototype.render;
	const Pause = () => {
		discarded++;
		throw suspended.promise;
	};
	t.mock.method(TimelineView.prototype, "render", function (this: TimelineView) {
		mounted.timeline = this;
		const result = render.call(this);
		return block && this.props.tasks.length > 1
			? createElement(Fragment, null, result, createElement(Pause))
			: result;
	});
	const fixture = await mountWritingTimeline(t, "- [ ] a", undefined, { suspend: true });
	const clock = (mounted.timeline as unknown as { rowWrites: { clock: { lastListChangeAt: number } } }).rowWrites
		.clock;
	let value = clock.lastListChangeAt;
	const changes: number[] = [];
	Object.defineProperty(clock, "lastListChangeAt", {
		get: () => value,
		set: (next: number) => {
			value = next;
			changes.push(next);
		},
	});
	await act(async () => {
		fixture.h.put("Note.md", "- [ ] a\n- [ ] b");
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
	});
	assert.ok(discarded > 0, "the pending render reached TimelineView and then suspended");
	assert.deepEqual(changes, [], "the discarded list has not changed the click clock");
	await act(() => flushSync(() => fixture.container.querySelector<HTMLElement>("#unplanned")!.click()));
	assert.ok(fixture.container.querySelector(".taskido.unplannedFilter"));
	assert.equal(fixture.container.querySelectorAll(".task").length, 1);
	assert.deepEqual(changes, [], "the urgent old-list commit does not move the click clock");
	now = 2000;
	block = false;
	await act(() => suspended.resolve());
	assert.equal(fixture.container.querySelectorAll(".task").length, 2);
	assert.deepEqual(changes, [2000]);
	const event = new MouseEvent("click", { bubbles: true, view: window });
	Object.defineProperty(event, "timeStamp", { value: 1990 });
	await act(() => fixture.container.querySelector<HTMLElement>(".task label.icon")!.dispatchEvent(event));
	assert.equal(fixture.write.mock.callCount(), 0, "a click stamped before the list commit is ignored");
	assert.deepEqual(changes, [2000]);
});

test("a row that moves to another day in the transition commit loses its overlay", async (t) => {
	const commits: (ReturnType<typeof rowFrame> & { moved: boolean })[] = [];
	const frames: ReturnType<typeof rowFrame>[] = [];
	let recording = false;
	let oldRow: Element | null = null;
	const fixture = await mountWritingTimeline(t, "- [ ] a 📅 2026-11-01", () => "- [x] a ✅ 2026-10-31", {
		onCommit: (container) => {
			if (recording)
				commits.push({
					...rowFrame(container),
					moved:
						container.querySelector(".task") !== oldRow &&
						fixture.bridge.current!.state.tasks[0].statusMarker === "x",
				});
		},
	});
	oldRow = fixture.container.querySelector(".task");
	await fixture.click(0);
	recording = true;
	const observer = new window.MutationObserver(() => frames.push(rowFrame(fixture.container)));
	observer.observe(fixture.container, { subtree: true, attributes: true, childList: true });
	t.after(() => observer.disconnect());
	await act(async () => {
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
	});
	assert.notStrictEqual(fixture.container.querySelector(".task"), oldRow, "moving to the done day mounts a new row");
	assert.deepEqual(rowFrame(fixture.container), { marker: "x", busy: false });
	assert.ok(commits.some((frame) => frame.moved));
	for (const frame of [...commits, ...frames])
		assert.ok(frame.busy || frame.marker !== " ", "the moved row never exposes the pre-write marker");
	t.diagnostic(
		`Moved-row commits with written text and aria-busy: ${commits.filter((frame) => frame.moved && frame.marker === "x" && frame.busy).length}; jsdom does not measure painted frames.`,
	);
});

test("options change renders urgently, the reload's list follows in a transition", async (t) => {
	const commits: ReturnType<typeof rowFrame>[] = [];
	let recording = false;
	const fixture = await mountWritingTimeline(t, "- [ ] a 📅 2026-01-15", undefined, {
		onCommit: (container) => {
			if (recording) commits.push(rowFrame(container));
		},
	});
	await fixture.click(0);
	recording = true;
	await act(async () => {
		await fixture.h.deliver();
		let updated!: Promise<void>;
		flushSync(() => {
			updated = fixture.view.onUpdateOptions({ ...fixture.store.getSnapshot().options, useRelative: false });
		});
		assert.ok(fixture.container.querySelector(".taskido.noRelative"), "the option is already visible");
		await updated;
		assert.equal(fixture.bridge.current!.state.tasks[0].statusMarker, " ", "the reload list is still pending");
		assert.deepEqual(rowFrame(fixture.container), { marker: "x", busy: true });
	});
	assert.equal(fixture.bridge.current!.state.tasks[0].statusMarker, "x");
	assert.deepEqual(rowFrame(fixture.container), { marker: "x", busy: false });
	assert.ok(commits.length > 0);
	for (const frame of commits) assert.ok(frame.busy || frame.marker !== " ", "the options commit keeps the overlay");
});

test("quick filter and counters stay urgent during a pending list transition", async (t) => {
	const fixture = await mountWritingTimeline(t, "- [ ] a 📅 2026-01-15\n- [ ] b 📅 2026-01-16");
	await act(async () => {
		fixture.h.put("Note.md", "- [ ] a 📅 2026-01-15\n- [ ] b 📅 2026-01-16\n- [ ] c 📅 2026-01-15");
		await fixture.h.deliver();
		await fixture.view.onReloadTasks();
		flushSync(() => fixture.bridge.current!.handleFilterEnable("2026-01-14", "2026-01-16", []));
		assert.equal(fixture.container.querySelectorAll(".task").length, 1, "the quick filter applies to the old list");
		assert.equal(fixture.bridge.current!.state.tasks.length, 2);
		flushSync(() => fixture.container.querySelector<HTMLElement>("#todo")!.click());
		assert.ok(fixture.container.querySelector(".taskido.todoFilter"));
		assert.equal(fixture.bridge.current!.state.tasks.length, 2);
	});
	assert.equal(fixture.bridge.current!.state.tasks.length, 3);
	assert.equal(fixture.container.querySelectorAll(".task").length, 2);
	assert.ok(fixture.container.querySelector(".taskido.todoFilter"));
	assert.equal(fixture.bridge.current!.state.quickFilter?.from, "2026-01-14");
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

test("an Undo of recurring completion after the re-read predicts the restored status", () => {
	const sourceLine = "- [ ] a 🔁 every day 📅 2026-01-14";
	const written = ["- [ ] a 🔁 every day 📅 2026-01-15", "- [x] a 🔁 every day 📅 2026-01-14 ✅ 2026-01-15"];
	const tasks = written.map((line, i) => {
		const task = parseTaskLine(line, { moment, path: "Note.md" });
		assert.ok(task);
		return { ...task, line: i + 2, id: `Note.md:${i + 2}` };
	});
	const pending = createPendingWrites();
	const event = {
		id: 1,
		kind: "pending" as const,
		path: "Note.md",
		line: 2,
		sourceLine,
		lines: [sourceLine],
		written,
	};
	pending.apply(event, [...tasks].reverse(), defaultUserOptions, { now: moment(), moment });
	assert.equal(pending.getSnapshot(tasks[0].id)?.dimmed, true);
	assert.equal(pending.getSnapshot(tasks[0].id)?.status, "overdue");
	assert.equal(pending.getSnapshot(tasks[0].id)?.marker, " ");
	assert.equal(pending.getSnapshot(tasks[1].id), undefined);
});
