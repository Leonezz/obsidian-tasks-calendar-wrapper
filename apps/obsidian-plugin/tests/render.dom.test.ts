// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTaskLine, type Store, type Task } from "@tasks-calendar-wrapper/core";
import { MarkdownView, Notice } from "./stubs/obsidian";

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
import { moment } from "../utils/moment";
import type { WriteEvent } from "../timeline/src/taskwriter";
import { flush, writerHarness } from "./writer-harness";

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

async function mountWritingTimeline(t: TestContext, text: string, toggle?: (line: string) => string) {
	const h = writerHarness({ "Note.md": text });
	Object.assign(h.app, { plugins: { plugins: {} } });
	const index = timelineTaskIndex(h.app as never);
	const writer = h.create({ index, ...(toggle ? { tasks: () => ({ kind: "toggle" as const, toggle }) } : {}) });
	const write = t.mock.fn(writer.write);
	const undo: (() => Promise<void>)[] = [];
	const view = new TasksTimelineView(
		{ app: h.app } as never,
		index,
		{ ...writer, write },
		{
			undo(_context, _change, run) {
				undo.push(async () => {
					await run();
				});
				return new Notice("Undo", 10000) as never;
			},
		},
	);
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
	return { h, view, store, writer, write, undo, container, click };
}

async function mountNoteActions(t: TestContext) {
	const text = "Heading\n\n- [ ] a";
	const fixture = await mountWritingTimeline(t, text, (line) => line.replace("[ ]", "[x]"));
	const noteView = new MarkdownView();
	noteView.editor = { setCursor: () => {} };
	const openFile = t.mock.fn(async () => {});
	const getLeaf = t.mock.fn(() => ({ view: noteView, openFile }));
	Object.assign(fixture.h.app.workspace, { getLeaf });
	Object.assign(fixture.h.app, { plugins: { plugins: { "obsidian-tasks-plugin": {} } } });
	const command = t.mock.fn();
	const commands = t.mock.fn(() => ({
		commands: { "obsidian-tasks-plugin:edit-task": { editorCheckCallback: command } },
	}));
	Object.defineProperty(fixture.h.app, "commands", { get: commands });
	await act(() =>
		fixture.view.onUpdateOptions({
			...defaultUserOptions,
			hideStatusTasks: [],
			openNoteInsteadOfInPlace: true,
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
	const fixture = await mountNoteActions(t);
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
	assert.equal(fixture.view.pendingWrites.getSnapshot("Note.md:2"), undefined);
	assert.equal(fixture.container.querySelector(".task")?.hasAttribute("aria-busy"), false);
	assert.equal(fixture.h.text("Note.md"), fixture.text);
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
