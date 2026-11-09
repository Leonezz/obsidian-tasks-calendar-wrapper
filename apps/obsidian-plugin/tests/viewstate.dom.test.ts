// Design step 18, V8: per-view state, in-session restore and the existing quick-filter rules.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement, Profiler, type ContextType } from "react";
import { providerValues, QuickEntryHandlerContext } from "@tasks-calendar-wrapper/ui";
import TasksCalendarWrapper from "../src/main";
import type { UserOption } from "../src/useroptions";
import { TasksTimelineView, TIMELINE_VIEW } from "../src/views";
import { onTimelineRender } from "./component-harness";
import { fakeVault, type FakeLeaf } from "./fakevault";
import { MANIFEST, type StartedPlugin } from "./settings-fixtures";

const notes = {
	"Inbox.md": "- [ ] visible 📅 2026-01-15\n- [ ] hidden 📅 2026-01-20",
};
const onLoad = { defaultFilters: "", defaultTodayFocus: false };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Keeps the plugin's factory and leaf lifecycle, supplying only the DOM Obsidian normally creates. */
function pluginHarness(t: TestContext) {
	const vault = fakeVault(notes, { layoutReady: false });
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
	await select(view, "select.actionName", "filter");
	await select(view, "select.filterSelector", "date");
	const inputs = view.container.querySelectorAll<HTMLInputElement>('input[type="date"]');
	assert.equal(inputs.length, 2);
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	assert.ok(setter);
	await act(() => {
		for (const [index, value] of ["2026-01-14", "2026-01-16"].entries()) {
			setter.call(inputs[index], value);
			inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
	await click(view, ".quickEntryPanel button.ok");
	const filter = quickFilter();
	assert.ok(filter, "the Filter button applies a quick filter");
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
	await select(view, "select.actionName", "append");
	const input = view.container.querySelector<HTMLInputElement>("input.newTask");
	assert.ok(input);
	input.value = "new task";
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
	assert.equal(opened.container.querySelector<HTMLSelectElement>("select.actionName")?.value, "filter");
	assert.deepEqual(
		[...opened.container.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((input) => input.value),
		["2026-01-14", "2026-01-16"],
	);
});

test("quick entry still clears the quick filter", async (t) => {
	const h = pluginHarness(t);
	const plugin = await h.load();
	const opened = await h.command(plugin);
	writeEntries(h);
	await applyFilter(opened);
	await quickEntry(opened);
	assert.equal(quickFilter(), undefined, "quick entry clears the applied filter");
	assert.deepEqual(rows(opened).sort(), ["hidden", "new task", "visible"]);
	assert.match(h.vault.contentOf("Inbox.md") ?? "", /- \[ \] new task/);
	await act(() => opened.view.onReloadTasks());
	assert.equal(quickFilter(), undefined, "the reload keeps the filter cleared");
	assert.deepEqual(rows(opened).sort(), ["hidden", "new task", "visible"]);
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

// Brief-derived: a filter clear and the written list must be visible in the same commit.
test("quick entry clears the filter and shows the new list in one commit", async (t) => {
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
					if (recording && props.quickFilter === undefined) commits.push(rows(opened));
				},
			},
			rendered,
		),
	);
	const opened = await h.command(plugin);
	writeEntries(h);
	await applyFilter(opened);
	const frames: (string | undefined)[][] = [];
	const observer = new window.MutationObserver(() => {
		if (quickFilter() === undefined) frames.push(rows(opened));
	});
	observer.observe(opened.container, { subtree: true, attributes: true, childList: true, characterData: true });
	try {
		recording = true;
		await quickEntry(opened);
	} finally {
		recording = false;
		observer.disconnect();
	}
	assert.equal(quickFilter(), undefined);
	assert.ok(frames.length > 0, "MutationObserver sees the cleared filter's list");
	assert.ok(commits.length > 0, "the commit probe sees the cleared filter's list");
	for (const frame of [...frames, ...commits])
		assert.deepEqual(
			frame.slice().sort(),
			["hidden", "new task", "visible"],
			"no unfiltered old list is committed",
		);
});
