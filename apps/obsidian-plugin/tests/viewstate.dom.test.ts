// Design step 18, V8: per-view state, in-session restore and the existing quick-filter rules.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement, Profiler, type ContextType } from "react";
import { providerValues, QuickEntryHandlerContext } from "@tasks-calendar-wrapper/ui";
import TasksCalendarWrapper from "../src/main";
import type { UserOption } from "../src/useroptions";
import {
	createViewSession,
	createViewState,
	onLoadViewState,
	restoredViewState,
	savedViewState,
} from "../src/state/viewstate";
import { TasksTimelineView, TIMELINE_VIEW } from "../src/views";
import { onTimelineRender } from "./component-harness";
import { fakeVault, type FakeLeaf } from "./fakevault";
import { MANIFEST, type StartedPlugin } from "./settings-fixtures";
import { AbstractInputSuggest } from "./stubs/obsidian";

const notes = {
	"Inbox.md": "- [ ] visible 📅 2026-01-15\n- [ ] hidden 📅 2026-01-20",
};
const onLoad = { defaultFilters: "", defaultTodayFocus: false };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Keeps the plugin's factory and leaf lifecycle, supplying only the DOM Obsidian normally creates. */
function pluginHarness(t: TestContext, content: Record<string, string> = notes) {
	const vault = fakeVault(content, { layoutReady: false });
	Object.assign(vault.app, { plugins: { plugins: {} } });
	const containers = new Map<TasksTimelineView, HTMLElement>();
	const plugins: StartedPlugin[] = [];
	const registry = vault.app.viewRegistry;
	const creatorOf = registry.creatorOf.bind(registry);
	t.mock.method(registry, "creatorOf", (type: string) => {
		const creator = creatorOf(type);
		if (!creator) return undefined;
		return (leaf: FakeLeaf) => {
			const view = creator(leaf);
			assert.ok(view instanceof TasksTimelineView, "the plugin factory creates a timeline view");
			const container = document.body.appendChild(document.createElement("div"));
			Object.assign(container, { empty: () => container.replaceChildren() });
			Object.assign(view.containerEl, { children: [document.createElement("div"), container] });
			containers.set(view, container);
			return view;
		};
	});
	t.after(async () => {
		try {
			await act(async () => {
				for (const leaf of vault.app.workspace.getLeavesOfType(TIMELINE_VIEW)) await leaf.detach();
				for (const plugin of plugins) plugin.unload();
				await settle();
			});
		} finally {
			for (const container of containers.values()) container.remove();
		}
	});
	const at = (leaf: FakeLeaf) => {
		const view = leaf.view;
		assert.ok(view instanceof TasksTimelineView, "the leaf holds a timeline view");
		const container = containers.get(view);
		assert.ok(container, "the view has a DOM container");
		return { leaf, view, container };
	};
	return {
		vault,
		at,
		async load(options: Partial<UserOption> = {}) {
			const plugin = new TasksCalendarWrapper(vault.app as never, MANIFEST as never) as StartedPlugin;
			plugin.dataJson = JSON.stringify({
				...onLoad,
				openViewOnStartup: false,
				showWhatsNewOnUpdate: false,
				lastSeenVersion: MANIFEST.version,
				taskFiles: ["Inbox.md"],
				sectionForNewTasks: "",
				...options,
			});
			plugins.push(plugin);
			await act(() => plugin.load());
			return plugin;
		},
		async command(plugin: StartedPlugin) {
			await act(async () => {
				await plugin.activateView(TIMELINE_VIEW);
				await settle();
			});
			const leaves = vault.app.workspace.getLeavesOfType(TIMELINE_VIEW);
			assert.equal(leaves.length, 1, "the command opens one new timeline");
			return at(leaves[0]);
		},
		async open(state?: unknown) {
			const leaf = vault.app.workspace.getRightLeaf(false);
			await act(async () => {
				await leaf.setViewState({ type: TIMELINE_VIEW, state });
				await settle();
			});
			return at(leaf);
		},
	};
}

type RenderedView = ReturnType<ReturnType<typeof pluginHarness>["at"]>;

function control(container: HTMLElement, selector: string) {
	// jsdom's querySelector ID shortcut misses a later view with the same public counter ids.
	const element = container.querySelectorAll<HTMLElement>(selector)[0];
	assert.ok(element, `the timeline renders ${selector}`);
	return element;
}

async function click(view: RenderedView, selector: string) {
	await act(() => control(view.container, selector).click());
}

function assertState(view: RenderedView, counter: boolean, focus: boolean, message: string) {
	const root = control(view.container, ".taskido");
	assert.equal(root.classList.contains("todoFilter"), counter, `${message}: Todo filter`);
	assert.equal(root.classList.contains("todayFocus"), focus, `${message}: Focus on today`);
	assert.equal(control(view.container, ".counter#todo").getAttribute("aria-pressed"), String(counter));
	assert.equal(control(view.container, ".todayHeader").getAttribute("aria-pressed"), String(focus));
}

async function close(view: RenderedView) {
	await act(() => view.leaf.detach());
}

async function unload(plugin: StartedPlugin) {
	await act(async () => {
		plugin.unload();
		await settle();
	});
}

function quickFilter() {
	const handlers = providerValues().QuickEntryHandlerContext;
	assert.ok(handlers, "the rendered bridge provides quick-entry handlers");
	return (handlers as ContextType<typeof QuickEntryHandlerContext>).quickFilter;
}

async function select(view: RenderedView, selector: string, value: string) {
	const input = view.container.querySelector<HTMLSelectElement>(selector);
	assert.ok(input, selector);
	await act(() => {
		input.value = value;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function applyFilter(view: RenderedView) {
	await select(view, "select.dateScope", "custom");
	const inputs = view.container.querySelectorAll<HTMLInputElement>('.dateRange input[type="date"]');
	assert.equal(inputs.length, 2);
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	assert.ok(setter);
	await act(() => {
		for (const [index, value] of ["2026-01-14", "2026-01-16"].entries()) {
			setter.call(inputs[index], value);
			inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
	await click(view, ".applyDateRange");
	const filter = quickFilter();
	assert.ok(filter, "the date-range Apply button applies a quick filter");
	assert.deepEqual(rows(view), ["visible"]);
	return filter;
}

const rows = (view: RenderedView) =>
	[...view.container.querySelectorAll(".task .content")].map((row) => row.textContent?.trim());

/** Supplies the vault write ports used by the real plugin writer. */
function writeEntries(h: ReturnType<typeof pluginHarness>) {
	Object.assign(h.vault.app.vault, {
		getFileByPath: (path: string) => h.vault.app.vault.getAbstractFileByPath(path),
		adapter: {
			async readBinary(path: string) {
				return new TextEncoder().encode(h.vault.contentOf(path)).buffer;
			},
		},
		async process(file: { path: string }, edit: (content: string) => string) {
			const before = h.vault.contentOf(file.path);
			assert.ok(typeof before === "string", "quick entry writes an existing note");
			const after = edit(before);
			h.vault.write(file.path, after);
			return after;
		},
	});
}

async function quickEntry(view: RenderedView) {
	const input = view.container.querySelector<HTMLInputElement>("input.newTask");
	assert.ok(input);
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "new task");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => {
		control(view.container, ".quickEntryPanel button.ok").click();
		await settle();
	});
	assert.equal(input.value, "", "the successful quick entry clears its draft");
}

test("reopening a view in the same session restores counter and focus", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const first = await h.command(plugin);
	assertState(first, false, false, "On Load");
	await click(first, "#todo");
	await click(first, ".todayHeader");
	assertState(first, true, true, "before closing");
	await close(first);
	const reopened = await h.command(plugin);
	assertState(reopened, true, true, "reopened view restores the last closed state");
	const second = await h.open();
	await click(second, ".todayHeader");
	assertState(second, true, false, "second view differs");
	await close(reopened);
	await close(second);
	assertState(await h.command(plugin), true, false, "the last of two closed views wins");
});

test("the restored Today heading preserves applied dates, tags, priorities and the status card", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const opened = await h.command(plugin);
	await applyFilter(opened);
	await click(opened, "#todo");
	await click(opened, '.priorityOptions input[value="No"]');
	const tag = control(opened.container, '.tagFilterBar input[type="search"]') as HTMLInputElement;
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(tag, "#work");
		tag.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(() => tag.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
	const applied = quickFilter();
	assert.deepEqual(applied, {
		from: "2026-01-14",
		to: "2026-01-16",
		priorities: ["No", ""],
		tags: ["#work"],
	});
	for (const focused of [true, false]) {
		await click(opened, ".todayHeader");
		assertState(opened, true, focused, `heading focus ${focused}`);
		assert.strictEqual(quickFilter(), applied, "the heading preserves the exact applied filter");
		assert.equal((control(opened.container, "select.dateScope") as HTMLSelectElement).value, "custom");
		assert.equal(tag.value, "#work");
		assert.equal(
			(control(opened.container, '.priorityOptions input[value="No"]') as HTMLInputElement).checked,
			true,
		);
	}
	await click(opened, ".todayHeader");
	await select(opened, "select.dateScope", "week");
	assertState(opened, true, true, "a date preset preserves independent Today focus");
	assert.deepEqual(quickFilter(), {
		from: "2026-01-15",
		to: "2026-01-21",
		priorities: ["No", ""],
		tags: ["#work"],
	});
});

test("priority multi-selection stays open when filtering removes and restores an earlier year", async (t) => {
	const h = pluginHarness(t, {
		"Earlier.md": "- [ ] Earlier 📅 2025-12-31",
		"Today.md": "- [ ] Today ⏫ 📅 2026-01-15",
	});
	const plugin = await h.load({ forward: false, entryPosition: "today" });
	const opened = await h.command(plugin);
	const years = () => [...opened.container.querySelectorAll(".year")].map((year) => year.textContent);
	const menu = () => control(opened.container, "details.priorityFilter") as HTMLDetailsElement;
	assert.deepEqual(years(), ["2025", "2026"]);
	await click(opened, ".priorityFilter summary");
	const original = menu();
	assert.equal(original.open, true);
	await click(opened, '.priorityOptions input[value="High"]');
	assert.deepEqual(years(), ["2026"], "the first priority removes the preceding year");
	const remounted = menu();
	assert.notStrictEqual(remounted, original, "the entry actually remounts under its new year position");
	assert.equal(original.isConnected, false);
	assert.equal(remounted.open, true, "the remounted menu stays open for the next choice");
	assert.strictEqual(
		document.activeElement,
		control(remounted, "summary"),
		"keyboard access follows the remounted menu",
	);
	assert.equal(control(remounted, ".prioritySummary").textContent, "High");
	await click(opened, '.priorityOptions input[value="No"]');
	assert.deepEqual(years(), ["2025", "2026"], "adding None restores the preceding year");
	assert.equal(menu().open, true, "the second remount also keeps the multi-select open");
	assert.strictEqual(document.activeElement, control(menu(), "summary"));
	assert.deepEqual(quickFilter()?.priorities, ["High", "No", ""]);
	assert.equal(control(menu(), ".prioritySummary").textContent, "Priority (2)");
	for (const value of ["High", "No"])
		assert.equal((control(menu(), `input[value="${value}"]`) as HTMLInputElement).checked, true);
});

test("native tag selection restores the editor and caret after a year remount for another suggestion", async (t) => {
	const h = pluginHarness(t, {
		"Earlier.md": "- [ ] Earlier #old 📅 2025-12-31",
		"Today.md": "- [ ] Today #one #two 📅 2026-01-15",
	});
	const plugin = await h.load({ forward: false, entryPosition: "today" });
	const opened = await h.command(plugin);
	const editor = () => control(opened.container, '.tagFilterBar input[type="search"]') as HTMLInputElement;
	const suggestion = () => {
		const adapter = AbstractInputSuggest.made.at(-1) as AbstractInputSuggest<string>;
		assert.strictEqual(adapter.textInputEl, editor(), "the native suggester follows the current mounted editor");
		return adapter;
	};
	async function type(text: string) {
		await act(() => {
			const input = editor();
			input.focus();
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, text);
			input.setSelectionRange(text.length, text.length);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}
	const original = editor();
	await type("#o");
	assert.ok((await suggestion().suggestions()).includes("#one"));
	await act(() => suggestion().selectSuggestion("#one"));
	const remounted = editor();
	assert.notStrictEqual(remounted, original, "removing the earlier year remounts the entry");
	assert.equal(original.isConnected, false);
	assert.strictEqual(document.activeElement, remounted);
	assert.equal(remounted.value, "#one ");
	assert.equal(remounted.selectionStart, remounted.value.length);
	assert.equal(remounted.selectionEnd, remounted.value.length);
	assert.deepEqual(quickFilter()?.tags, ["#one"]);
	assert.deepEqual(
		[...opened.container.querySelectorAll(".year")].map((year) => year.textContent),
		["2026"],
	);
	await type("#one #t");
	assert.deepEqual(await suggestion().suggestions(), ["#two"]);
	await act(() => suggestion().selectSuggestion("#two"));
	assert.strictEqual(document.activeElement, editor());
	assert.equal(editor().value, "#one #two ");
	assert.equal(editor().selectionStart, editor().value.length);
	assert.equal(editor().selectionEnd, editor().value.length);
	assert.deepEqual(quickFilter()?.tags, ["#one", "#two"]);
});

test("a moved view restores from getState", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const source = await h.command(plugin);
	await click(source, "#todo");
	await click(source, ".todayHeader");
	const other = await h.open();
	assertState(other, false, false, "the other view has different state");
	await close(other);
	const saved = source.leaf.getViewState();
	const movedLeaf = h.vault.app.workspace.getRightLeaf(false);
	await act(() => movedLeaf.setViewState(saved));
	await close(source);
	assertState(h.at(movedLeaf), true, true, "the moved state wins over the earlier closed view");
});

test("a new plugin session uses the On Load settings", async (t) => {
	const h = pluginHarness(t);
	const firstPlugin = await h.load();
	const first = await h.command(firstPlugin);
	await click(first, "#todo");
	await click(first, ".todayHeader");
	assertState(first, true, true, "saved workspace state");
	const saved = first.leaf.getViewState();
	await unload(firstPlugin);
	await h.load({ defaultFilters: "todoFilter", defaultTodayFocus: false });
	const leaf = h.vault.app.workspace.getRightLeaf(false);
	await act(() => leaf.setViewState(saved));
	assertState(h.at(leaf), true, false, "a new session uses On Load instead of the saved focus");
});

test("disabling and enabling the plugin forgets the last closed state", async (t) => {
	const h = pluginHarness(t);
	const firstPlugin = await h.load();
	const first = await h.command(firstPlugin);
	await click(first, "#todo");
	await click(first, ".todayHeader");
	assertState(first, true, true, "before disabling");
	await close(first);
	await unload(firstPlugin);
	const secondPlugin = await h.load();
	assertState(await h.command(secondPlugin), false, false, "re-enabling forgets last closed");
});

test("a foreign or garbage state falls back to On Load without throwing", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const first = await h.command(plugin);
	const session = first.view.getState().session;
	const invalid = [
		undefined,
		null,
		{},
		"x",
		42,
		{ v: 2, session, counter: "todoFilter", todayFocus: true },
		{ v: 1, session: "other", counter: "todoFilter", todayFocus: true },
		{ v: 1, session, counter: 3, todayFocus: "yes" },
		{ v: 1, session, counter: "todoFilter" },
		{ v: 1, session, todayFocus: true },
	];
	// Keep every leaf open so there is no last-closed fallback in this test.
	for (const state of invalid) {
		await assert.doesNotReject(async () => {
			const opened = await h.open(state);
			assertState(opened, false, false, `invalid state ${JSON.stringify(state)}`);
		});
	}
});

test("the quick filter is not restored after the view closes", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const source = await h.command(plugin);
	await applyFilter(source);
	const saved = source.leaf.getViewState();
	assert.equal(Object.prototype.hasOwnProperty.call(source.view.getState(), "quickFilter"), false);
	await close(source);
	const reopened = await h.command(plugin);
	assert.equal(quickFilter(), undefined);
	assert.deepEqual(rows(reopened), ["visible", "hidden"]);
	await applyFilter(reopened);
	assert.equal(Object.prototype.hasOwnProperty.call(reopened.view.getState(), "quickFilter"), false);
	const movedLeaf = h.vault.app.workspace.getRightLeaf(false);
	await act(() => movedLeaf.setViewState(saved));
	const moved = h.at(movedLeaf);
	await close(reopened);
	assert.equal(quickFilter(), undefined);
	assert.deepEqual(rows(moved), ["visible", "hidden"]);
	assert.equal(Object.prototype.hasOwnProperty.call(moved.view.getState(), "quickFilter"), false);
});

test("the quick filter survives a reload", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const opened = await h.command(plugin);
	const filter = await applyFilter(opened);
	await act(async () => {
		h.vault.write("Inbox.md", notes["Inbox.md"].replace("visible", "visible edited"));
		await opened.view.onReloadTasks();
	});
	assert.strictEqual(quickFilter(), filter, "an edit and reload keep the same filter object");
	await act(() => opened.view.onUpdateOptions({ ...plugin.userOptions, dateFormat: "YYYY/MM/DD" }));
	await act(() => opened.view.onReloadTasks());
	assert.strictEqual(quickFilter(), filter, "an options push and reload keep the same filter object");
	assert.deepEqual(rows(opened), ["visible edited"]);
	assert.equal(opened.container.querySelector<HTMLSelectElement>("select.dateScope")?.value, "custom");
	assert.deepEqual(
		[...opened.container.querySelectorAll<HTMLInputElement>('.dateRange input[type="date"]')].map(
			(input) => input.value,
		),
		["2026-01-14", "2026-01-16"],
	);
});

test("quick entry preserves the quick filter", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const opened = await h.command(plugin);
	writeEntries(h);
	const filter = await applyFilter(opened);
	await quickEntry(opened);
	assert.strictEqual(quickFilter(), filter, "quick entry preserves the applied filter");
	assert.deepEqual(rows(opened).sort(), ["new task", "visible"], "forwarding places the new undated task on today");
	assert.match(h.vault.contentOf("Inbox.md") ?? "", /- \[ \] new task/);
	await act(() => opened.view.onReloadTasks());
	assert.strictEqual(quickFilter(), filter, "the reload keeps the same filter");
	assert.deepEqual(rows(opened).sort(), ["new task", "visible"]);
});

test("quick-entry due choices survive year remounts and write the selected custom date", async (t) => {
	const h = pluginHarness(t, {
		"Earlier.md": "- [ ] Earlier 📅 2025-12-31",
		"Inbox.md": "- [ ] Today ⏫ 📅 2026-01-15",
	});
	const plugin = await h.load({ forward: false, entryPosition: "today" });
	const opened = await h.command(plugin);
	writeEntries(h);
	const input = () => control(opened.container, "input.newTask") as HTMLInputElement;
	const due = () => control(opened.container, "input.taskDue") as HTMLInputElement;
	const choice = () => control(opened.container, "select.taskDuePreset") as HTMLSelectElement;
	const years = () => [...opened.container.querySelectorAll(".year")].map((year) => year.textContent);
	const original = input();
	await act(() => {
		original.focus();
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(original, "Due draft");
		original.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await select(opened, "select.taskDuePreset", "today");
	assert.equal(due().value, "2026-01-15");
	assert.equal(due().hidden, true);
	assert.equal(choice().value, "today");
	await click(opened, ".priorityFilter summary");
	await click(opened, '.priorityOptions input[value="High"]');
	assert.deepEqual(years(), ["2026"]);
	assert.notStrictEqual(input(), original, "the first priority really remounts the composer under another year");
	assert.equal(input().value, "Due draft");
	assert.equal(choice().value, "today");
	assert.equal(due().value, "2026-01-15", "Today is retained as an absolute due date");
	await act(() => input().focus());
	await select(opened, "select.taskDuePreset", "tomorrow");
	assert.equal(due().value, "2026-01-16");
	await act(() => control(opened.container, ".todayHeader").focus());
	assert.equal(control(opened.container, ".entryMetaReveal").getAttribute("aria-hidden"), "true");
	await act(() => input().focus());
	assert.equal(choice().value, "tomorrow");
	await select(opened, "select.taskDuePreset", "none");
	assert.equal(due().value, "", "No date clears the stored due date");
	assert.equal(choice().value, "none");
	await select(opened, "select.taskDuePreset", "custom");
	assert.strictEqual(document.activeElement, due());
	assert.equal(due().hidden, false);
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(due(), "2026-02-24");
		due().dispatchEvent(new Event("input", { bubbles: true }));
	});
	const beforeSecondRemount = input();
	await click(opened, ".priorityFilter summary");
	await click(opened, '.priorityOptions input[value="No"]');
	assert.deepEqual(years(), ["2025", "2026"]);
	assert.notStrictEqual(input(), beforeSecondRemount, "restoring the earlier year remounts the composer again");
	await act(() => input().focus());
	assert.equal(choice().value, "custom");
	assert.equal(due().hidden, false);
	assert.equal(due().value, "2026-02-24");
	assert.equal(input().value, "Due draft");
	assert.doesNotMatch(h.vault.contentOf("Inbox.md") ?? "", /Due draft/, "choosing due dates never writes a task");
	const filter = quickFilter();
	await act(async () => {
		control(opened.container, ".quickEntryPanel button.ok").click();
		await settle();
	});
	assert.match(h.vault.contentOf("Inbox.md") ?? "", /- \[ \] Due draft 📅 2026-02-24/);
	assert.strictEqual(quickFilter(), filter, "creating the dated task preserves the active priority filter");
});

test("quick-entry No date removes inline metadata through the real writer and preserves the filter", async (t) => {
	for (const [style, token] of [
		["emoji", "📅 2026-01-20"],
		["dataview", "[due:: 2026-01-20]"],
	] as const) {
		for (const route of ["direct", "after Today"] as const) {
			await t.test(`${style}: ${route}`, async (t) => {
				const h = pluginHarness(t);
				const plugin = await h.load({ newDateStyle: style });
				const opened = await h.command(plugin);
				writeEntries(h);
				const filter = await applyFilter(opened);
				const title = `Cleared capture ${style} ${route}`;
				const input = control(opened.container, "input.newTask") as HTMLInputElement;
				await act(() => {
					input.focus();
					Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
						input,
						`${title} ${token}`,
					);
					input.dispatchEvent(new Event("input", { bubbles: true }));
				});
				const choice = control(opened.container, "select.taskDuePreset") as HTMLSelectElement;
				assert.equal(choice.value, "");
				if (route === "after Today") {
					await select(opened, "select.taskDuePreset", "today");
					assert.equal((control(opened.container, "input.taskDue") as HTMLInputElement).value, "2026-01-15");
				}
				await select(opened, "select.taskDuePreset", "none");
				assert.equal(choice.value, "none");
				assert.doesNotMatch(
					h.vault.contentOf("Inbox.md") ?? "",
					/Cleared capture/,
					"choosing No date does not write",
				);
				await act(async () => {
					control(opened.container, ".quickEntryPanel button.ok").click();
					await settle();
				});
				const written = (h.vault.contentOf("Inbox.md") ?? "").split("\n").find((line) => line.includes(title));
				assert.ok(written, "the real plugin writer creates the capture");
				assert.equal(
					written.trim(),
					`- [ ] ${title}`,
					"the raw inline due date must not return after clearing",
				);
				assert.strictEqual(quickFilter(), filter, "clearing and submitting preserve the active filter object");
			});
		}
	}
});

test("changing an On Load setting leaves open views as they are", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const opened = await h.command(plugin);
	assertState(opened, false, false, "original On Load");
	const next = { ...plugin.userOptions, defaultFilters: "todoFilter", defaultTodayFocus: true };
	await act(() => opened.view.onUpdateOptions(next));
	assertState(opened, false, false, "pushing On Load settings leaves an open view unchanged");
	await close(opened);
	await unload(plugin);
	const fresh = await h.load(next);
	assertState(await h.command(fresh), true, true, "a fresh session uses the changed On Load settings");
});

test("popout window views keep their own state", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const first = await h.command(plugin);
	// A second leaf stands for the popout; fakevault has no windows.
	const second = await h.open();
	await click(first, "#todo");
	assertState(first, true, false, "first view");
	assertState(second, false, false, "the second view ignores the first's toggle");
	await click(second, ".todayHeader");
	assertState(first, true, false, "the first view ignores the second's toggle");
	assertState(second, false, true, "second view");
	const firstState = first.view.getState();
	const secondState = second.view.getState();
	assert.equal(firstState.counter, "todoFilter", "the first view saves its own counter");
	assert.equal(firstState.todayFocus, false);
	assert.equal(secondState.counter, "");
	assert.equal(secondState.todayFocus, true);
	const leaf = h.vault.app.workspace.getRightLeaf(false);
	await act(() => leaf.setViewState(second.leaf.getViewState()));
	await close(second);
	const moved = h.at(leaf);
	assertState(moved, false, true, "moving the second restores the second's state");
	await close(first);
	await close(moved);
	assertState(await h.command(plugin), false, true, "reopening takes the second view's state");
});

// Brief-derived: later restores and either order of setState/onOpen.
test("a later setState without this session's state leaves an open view as it is", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const source = await h.command(plugin);
	await click(source, "#todo");
	await click(source, ".todayHeader");
	for (const state of [{}, { v: 1, session: "other", counter: "", todayFocus: false }]) {
		await act(() => source.view.setState(state, { history: false }));
		assertState(source, true, true, "a later foreign or absent state leaves the view unchanged");
	}
	const saved = source.view.getState();
	const other = await h.open();
	assertState(other, false, false, "a different state will be last closed");
	await close(other);
	const factory = h.vault.app.viewRegistry.creatorOf(TIMELINE_VIEW);
	assert.ok(factory);
	const leaf = h.vault.app.workspace.getRightLeaf(false);
	const view = factory(leaf);
	leaf.view = view;
	assert.ok(view.setState && view.open, "the factory view supports restore before open");
	await act(async () => {
		await view.setState!(saved, { history: false });
		await view.open!();
	});
	assertState(h.at(leaf), true, true, "setState before open wins over last closed and On Load");
});

// Brief-derived: the public saved shape identifies the plugin session, never the quick filter.
test("getState holds exactly v, session, counter and todayFocus", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const first = await h.command(plugin);
	await click(first, "#todo");
	await click(first, ".todayHeader");
	await applyFilter(first);
	const firstState = first.view.getState();
	assert.deepEqual(Object.keys(firstState).sort(), ["counter", "session", "todayFocus", "v"], "saved state keys");
	assert.ok(typeof firstState.session === "string" && firstState.session.length > 0, "session is a non-empty string");
	assert.deepEqual(firstState, { v: 1, session: firstState.session, counter: "todoFilter", todayFocus: true });
	assert.deepEqual(first.leaf.getViewState(), { type: TIMELINE_VIEW, state: firstState });
	const second = await h.open();
	assert.deepEqual(second.view.getState(), { v: 1, session: firstState.session, counter: "", todayFocus: false });
	const another = pluginHarness(t);
	const otherPlugin = await another.load();
	const other = await another.command(otherPlugin);
	const otherSession = other.view.getState().session;
	assert.ok(typeof otherSession === "string" && otherSession.length > 0, "the other plugin has a session id");
	assert.notEqual(otherSession, firstState.session, "each plugin instance owns a different session");
});

// Brief-derived: action identities, immutable snapshots and the saved-state boundary.
test("view state actions keep their identity and change only what they name", () => {
	const initial = Object.freeze(onLoadViewState({ defaultFilters: "todo", defaultTodayFocus: false }));
	assert.deepEqual(initial, { counter: "todo", todayFocus: false }, "On Load preserves the raw counter string");
	const handle = createViewState(initial);
	const { actions, store } = handle;
	const methods = { ...actions };
	assert.ok(Object.isFrozen(actions), "the actions object is frozen");
	let changes = 0;
	const unsubscribe = store.subscribe(() => changes++);
	const unchanged = (action: () => void) => {
		const before = store.getSnapshot();
		const count = changes;
		action();
		assert.strictEqual(store.getSnapshot(), before, "a no-op keeps the snapshot");
		assert.equal(changes, count, "a no-op does not notify listeners");
	};
	const changed = (action: () => void, expected: ReturnType<typeof store.getSnapshot>) => {
		const before = store.getSnapshot();
		const saved = structuredClone(before);
		const count = changes;
		action();
		assert.notStrictEqual(store.getSnapshot(), before, "an action creates a new snapshot");
		assert.deepEqual(before, saved, "the previous snapshot is unchanged");
		assert.deepEqual(store.getSnapshot(), expected);
		assert.equal(changes, count + 1, "one changed snapshot notifies once");
	};
	unchanged(() => actions.clearQuickFilter());
	unchanged(() => actions.setQuickFilter(undefined));
	unchanged(() => actions.restore(initial));
	const filter = Object.freeze({ from: "2026-01-14", to: "2026-01-16", priorities: Object.freeze(["High"]) });
	changed(() => actions.setQuickFilter(filter), { ...initial, quickFilter: filter });
	unchanged(() => actions.setQuickFilter({ ...filter, priorities: [...filter.priorities] }));
	assert.strictEqual(store.getSnapshot().quickFilter, filter, "an equal filter keeps the original object");
	changed(() => actions.toggleCounter("todo"), { counter: "todoFilter", todayFocus: false, quickFilter: filter });
	assert.deepEqual(initial, { counter: "todo", todayFocus: false }, "the initial value is not mutated");
	for (const id of ["todo", "overdue", "unplanned"] as const) {
		if (id !== "todo") {
			changed(() => actions.toggleCounter(id), {
				counter: `${id}Filter`,
				todayFocus: false,
				quickFilter: filter,
			});
		}
		changed(() => actions.toggleCounter(id), { counter: "", todayFocus: false, quickFilter: filter });
	}
	changed(() => actions.toggleTodayFocus(), { counter: "", todayFocus: true, quickFilter: filter });
	changed(() => actions.toggleTodayFocus(), { counter: "", todayFocus: false, quickFilter: filter });
	changed(() => actions.restore({ counter: "todoFilter ", todayFocus: true }), {
		counter: "todoFilter ",
		todayFocus: true,
		quickFilter: filter,
	});
	assert.strictEqual(store.getSnapshot().quickFilter, filter, "restore preserves the quick filter object");
	unchanged(() => actions.restore({ counter: "todoFilter ", todayFocus: true }));
	const replacement = Object.freeze({ priorities: Object.freeze(["Low"]) });
	changed(() => actions.setQuickFilter(replacement), {
		counter: "todoFilter ",
		todayFocus: true,
		quickFilter: replacement,
	});
	changed(() => actions.clearQuickFilter(), { counter: "todoFilter ", todayFocus: true, quickFilter: undefined });
	unchanged(() => actions.clearQuickFilter());
	unchanged(() => actions.setQuickFilter(undefined));
	assert.strictEqual(handle.actions, actions, "the actions handle keeps its identity");
	for (const name of Object.keys(methods) as (keyof typeof methods)[])
		assert.strictEqual(actions[name], methods[name]);
	unsubscribe();

	const session = createViewSession("unit-session");
	assert.equal(session.id, "unit-session", "the session id is injectable");
	assert.equal(session.lastClosed(), undefined);
	const closed = { counter: "overdueFilter", todayFocus: false };
	session.recordClosed(closed);
	assert.deepEqual(session.lastClosed(), closed);
	assert.notStrictEqual(session.lastClosed(), closed, "last closed is a copy");
	assert.ok(Object.isFrozen(session.lastClosed()), "the remembered state is frozen");
	session.recordClosed({ counter: "", todayFocus: true });
	assert.deepEqual(
		session.lastClosed(),
		{ counter: "", todayFocus: true },
		"the latest close replaces the previous one",
	);
	assert.equal(createViewSession("another-session").lastClosed(), undefined, "sessions do not share last closed");
	const valid = { v: 1, session: session.id, counter: "todoFilter ", todayFocus: true };
	assert.deepEqual(savedViewState({ ...store.getSnapshot(), quickFilter: filter }, session), valid);
	for (const raw of [valid, { ...valid, quickFilter: filter }, { ...valid, counter: "", todayFocus: false }]) {
		assert.deepEqual(restoredViewState(raw, session), { counter: raw.counter, todayFocus: raw.todayFocus });
	}
	for (const raw of [
		undefined,
		null,
		[],
		{},
		"x",
		42,
		true,
		{ ...valid, v: 2 },
		{ ...valid, v: "1" },
		{ ...valid, session: "other" },
		{ ...valid, session: undefined },
		{ ...valid, counter: undefined },
		{ ...valid, counter: 3 },
		{ ...valid, todayFocus: undefined },
		{ ...valid, todayFocus: "yes" },
	])
		assert.equal(restoredViewState(raw, session), undefined, `invalid saved state ${JSON.stringify(raw)}`);
});

// Every commit keeps the selected filter while the writer refreshes the task list.
test("quick entry refreshes the list without briefly clearing the filter", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const commits: (string | undefined)[][] = [];
	let recording = false;
	onTimelineRender(t, (props, rendered) =>
		createElement(
			Profiler,
			{
				id: "quick-entry",
				onRender: () => {
					if (recording) {
						assert.strictEqual(props.quickFilter, filter);
						commits.push(rows(opened));
					}
				},
			},
			rendered,
		),
	);
	const opened = await h.command(plugin);
	writeEntries(h);
	const filter = await applyFilter(opened);
	const frames: (string | undefined)[][] = [];
	const observer = new window.MutationObserver(() => {
		assert.strictEqual(quickFilter(), filter);
		frames.push(rows(opened));
	});
	observer.observe(opened.container, { subtree: true, attributes: true, childList: true, characterData: true });
	try {
		recording = true;
		await quickEntry(opened);
	} finally {
		recording = false;
		observer.disconnect();
	}
	assert.strictEqual(quickFilter(), filter);
	assert.ok(frames.length > 0, "MutationObserver sees the input and list update");
	assert.ok(commits.length > 0, "the commit probe sees the preserved filter");
	for (const frame of [...frames, ...commits]) {
		assert.ok(frame.includes("visible"));
		assert.ok(
			frame.every((text) => text === "visible" || text === "new task"),
			"no unfiltered row is shown",
		);
	}
	assert.deepEqual(rows(opened).sort(), ["new task", "visible"]);
	assert.match(h.vault.contentOf("Inbox.md") ?? "", /- \[ \] new task/);
});
