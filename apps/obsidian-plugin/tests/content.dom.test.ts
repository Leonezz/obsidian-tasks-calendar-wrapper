// Pins row content markup, markdown render frequency, and the render owner across Content's move to packages/ui.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { HostContext, type UiHost, Content, type ContentProps } from "@tasks-calendar-wrapper/ui";
import { MarkdownRenderer, Component } from "obsidian";
import { TasksTimelineView } from "../src/views";
import { defaultUserOptions } from "../src/useroptions";
import { createTaskIndex } from "../timeline/src/taskindex";
import { moment } from "../utils/moment";
import { parseKeyOf } from "../utils/parsekey";
import { mountView } from "./component-harness";
import { metadataOf } from "./fakevault";
import { notesApp, unusedNotices, unusedWriter } from "./view-harness";

type RenderCall = { sourcePath: string; markdown: string; owner: Component };

function mockMarkdown(t: TestContext) {
	const calls: RenderCall[] = [];
	const render = (markdown: string, el: object, sourcePath: string, owner: Component) => {
		calls.push({ sourcePath, markdown, owner });
		const html = markdown
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/!\[\[Note\]\]/g, '<span class="internal-embed" src="Note">Note</span>')
			.replace(/\[\[Note\]\]/g, '<span class="internal-link">Note</span>')
			.replace(/`x`/g, "<code>x</code>");
		Object.defineProperty(el, "firstElementChild", {
			value: { innerHTML: html },
			configurable: true,
		});
		return Promise.resolve();
	};
	t.mock.method(MarkdownRenderer, "renderMarkdown", render);
	return { calls, render };
}

function stateOf(component: Component) {
	return component as unknown as { readonly loaded: boolean; readonly children: readonly Component[] };
}

/** Adds the render children Obsidian normally attaches to the supplied owner. */
function mockMarkdownChildren(t: TestContext) {
	const calls: { sourcePath: string; markdown: string; owner: Component | null; child: Component | undefined }[] = [];
	t.mock.method(
		MarkdownRenderer,
		"renderMarkdown",
		(markdown: string, el: object, sourcePath: string, owner: Component | null) => {
			const child = typeof owner?.addChild === "function" ? owner.addChild(new Component()) : undefined;
			calls.push({ sourcePath, markdown, owner, child });
			const html = markdown
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/!\[\[Note\]\]/g, '<span class="internal-embed" src="Note">Note</span>')
				.replace(/\[\[Note\]\]/g, '<span class="internal-link">Note</span>')
				.replace(/`x`/g, "<code>x</code>");
			Object.defineProperty(el, "firstElementChild", {
				value: { innerHTML: html },
				configurable: true,
			});
			return Promise.resolve();
		},
	);
	return { calls };
}

test("content markup equals the detached render", async (t) => {
	const { calls, render } = mockMarkdown(t);
	const notes = {
		"Content/Link.md": "- [ ] [[Note]]",
		"Content/Embed.md": "- [ ] ![[Note]]",
		"Content/Code.md": "- [ ] `x`",
		"Content/Specials.md": '- [ ] <b> & "q"',
		"Content/Whitespace.md": "- [ ] #one    [due:: 2024-01-02] #two",
	};
	const fixture = await mountView(t, {
		app: notesApp(notes),
		options: {
			...structuredClone(defaultUserOptions),
			defaultFilters: "",
			defaultTodayFocus: false,
			filterEmpty: false,
		},
	});
	const mountedCalls = calls.slice();
	const rows = fixture.container.querySelectorAll(".task");
	assert.equal(rows.length, Object.keys(notes).length);
	assert.equal(mountedCalls.length, rows.length);
	const whitespace = mountedCalls.find(({ sourcePath }) => sourcePath === "Content/Whitespace.md");
	assert.ok(whitespace);
	assert.equal(whitespace.markdown, "    ");
	const paths: string[] = [];
	for (const row of rows) {
		const path = row.querySelector("a.file")?.getAttribute("aria-label");
		assert.ok(path);
		paths.push(path);
		const rowCalls = mountedCalls.filter(({ sourcePath }) => sourcePath === path);
		assert.equal(rowCalls.length, 1, path);
		const { markdown, owner } = rowCalls[0];
		const detached = {} as { firstElementChild: { innerHTML: string } };
		await render(markdown, detached, path, owner);
		const content = row.querySelector(".lines > .content");
		assert.ok(content, path);
		assert.equal(content.innerHTML, "<a>" + detached.firstElementChild.innerHTML + "</a>", path);
	}
	assert.deepEqual(paths.sort(), Object.keys(notes).sort());
});

test("content renders markdown once per display change", async (t) => {
	const { calls } = mockMarkdown(t);
	const notes = {
		"Content/Edit.md": "- [ ] First task 📅 2026-01-15",
		"Content/Other.md": "- [ ] Other task 📅 2026-01-16",
		"Content/Unplanned.md": "- [ ] Unplanned task",
	};
	const fixture = await mountView(t, { app: notesApp(notes) });
	assert.equal(fixture.container.querySelectorAll(".task").length, Object.keys(notes).length);
	assert.equal(calls.length, Object.keys(notes).length, "mount total");
	for (const [sourcePath, markdown] of [
		["Content/Edit.md", "First task"],
		["Content/Other.md", "Other task"],
		["Content/Unplanned.md", "Unplanned task"],
	]) {
		assert.equal(
			calls.filter((call) => call.sourcePath === sourcePath && call.markdown === markdown).length,
			1,
			JSON.stringify([sourcePath, markdown]),
		);
	}

	let before = calls.length;
	await fixture.reload();
	assert.equal(calls.length - before, 0, "reload with the list unchanged");

	before = calls.length;
	assert.ok(fixture.container.querySelector('[aria-label="due at Thursday, Jan, 15"]'));
	await fixture.pushOptions({ ...fixture.options(), dateFormat: "YYYY/MM/DD" });
	assert.ok(fixture.container.querySelector('[aria-label="due at 2026/01/15"]'));
	assert.equal(calls.length - before, 0, "settings push with different options");

	before = calls.length;
	notes["Content/Edit.md"] = "- [ ] Changed task 📅 2026-01-15";
	fixture.edited("Content/Edit.md");
	await fixture.reload();
	assert.deepEqual(
		calls.slice(before).map(({ sourcePath, markdown }) => ({ sourcePath, markdown })),
		[{ sourcePath: "Content/Edit.md", markdown: "Changed task" }],
		"reload with one display changed",
	);

	for (const [operation, selector] of [
		["counter click", "#todo"],
		["Focus on today click", '[aria-label="Focus today"]'],
	]) {
		before = calls.length;
		const target = fixture.container.querySelector<HTMLElement>(selector);
		assert.ok(target, selector);
		await act(() => target.click());
		assert.equal(calls.length - before, 0, operation);
	}
});

test("rows render their markdown with the static view as the owner", async (t) => {
	const { calls } = mockMarkdown(t);
	const notes = { "Content/Owner.md": "- [ ] Original task" };
	const app = notesApp(notes);
	const fixture = await mountView(t, { app });
	const index = createTaskIndex({ app: app as never, moment, parseKey: () => parseKeyOf(moment) });
	const other = new TasksTimelineView({ app } as never, index, unusedWriter, unusedNotices);
	try {
		assert.equal(TasksTimelineView.view, other);
		const before = calls.length;
		notes["Content/Owner.md"] = "- [ ] Changed owner task";
		fixture.edited("Content/Owner.md");
		await fixture.reload();
		assert.equal(calls.length - before, 1);
		const call = calls[before];
		assert.equal(call.sourcePath, "Content/Owner.md");
		assert.equal(call.markdown, "Changed owner task");
		assert.equal(call.owner, TasksTimelineView.view);
		assert.equal(call.owner, other);
		assert.notEqual(call.owner, fixture.view);
	} finally {
		await other.onClose();
	}
});

test("two views each own their markdown children", async (t) => {
	const { calls } = mockMarkdownChildren(t);
	const notesA = { "Content/A.md": "- [ ] A at mount" };
	const notesB = { "Content/B.md": "- [ ] B at mount" };
	const fixtureA = await mountView(t, { app: notesApp(notesA) });
	const fixtureB = await mountView(t, { app: notesApp(notesB) });
	notesA["Content/A.md"] = "- [ ] A after B opens";
	fixtureA.edited("Content/A.md");
	await fixtureA.reload();

	const callsA = calls.filter(({ sourcePath }) => sourcePath === "Content/A.md");
	const callsB = calls.filter(({ sourcePath }) => sourcePath === "Content/B.md");
	assert.equal(callsA.length, 2, "A renders at mount and after B opens");
	assert.equal(callsB.length, 1, "B renders at mount");
	const ownerA = callsA[0].owner;
	const ownerB = callsB[0].owner;
	assert.ok(ownerA instanceof Component);
	assert.ok(ownerB instanceof Component);
	for (const call of callsA) assert.ok(call.owner === ownerA, "A's renders keep the same markdown owner");
	for (const call of callsB) assert.ok(call.owner === ownerB, "B's renders keep the same markdown owner");
	assert.notEqual(ownerA, ownerB, "each view has its own markdown owner");
	for (const [fixture, owner] of [
		[fixtureA, ownerA],
		[fixtureB, ownerB],
	] as const) {
		assert.notEqual(owner, fixture.view, "the markdown owner is separate from its view");
		assert.ok(stateOf(fixture.view).children.includes(owner), "the view owns its markdown component");
		assert.equal(stateOf(owner).loaded, true, "the markdown owner is loaded");
	}
	for (const { owner, child } of calls) {
		assert.ok(owner);
		assert.ok(child);
		assert.ok(stateOf(owner).children.includes(child), "each render child belongs to its view's owner");
		assert.equal(stateOf(child).loaded, true, "each render child is loaded");
	}
});

test("closing a view unloads its children and not the other view's", async (t) => {
	const { calls } = mockMarkdownChildren(t);
	const notesA = { "Content/A.md": "- [ ] A at mount" };
	const notesB = { "Content/B.md": "- [ ] B at mount" };
	const fixtureA = await mountView(t, { app: notesApp(notesA) });
	const fixtureB = await mountView(t, { app: notesApp(notesB) });
	notesA["Content/A.md"] = "- [ ] A after B opens";
	fixtureA.edited("Content/A.md");
	await fixtureA.reload();

	const callsA = calls.filter(({ sourcePath }) => sourcePath === "Content/A.md");
	const callsB = calls.filter(({ sourcePath }) => sourcePath === "Content/B.md");
	assert.equal(callsA.length, 2, "A renders at mount and after B opens");
	assert.equal(callsB.length, 1, "B renders at mount");
	const ownerA = callsA[0].owner;
	const ownerB = callsB[0].owner;
	assert.ok(ownerA instanceof Component);
	assert.ok(ownerB instanceof Component);

	await fixtureB.unmount();
	assert.equal(stateOf(ownerB).loaded, false, "closing B unloads ownerB");
	for (const { child } of callsB) {
		assert.ok(child);
		assert.equal(stateOf(child).loaded, false, "closing B unloads every B render child");
	}
	assert.equal(stateOf(ownerA).loaded, true, "closing B keeps ownerA loaded");
	for (const { owner, child } of callsA) {
		assert.ok(owner === ownerA, "closing B preserves ownerA for every A render");
		assert.ok(child);
		assert.equal(stateOf(child).loaded, true, "closing B keeps every A render child loaded");
	}

	const before = calls.length;
	notesA["Content/A.md"] = "- [ ] A after B closes";
	fixtureA.edited("Content/A.md");
	await fixtureA.reload();
	const reloaded = calls.slice(before);
	assert.equal(reloaded.length, 1, "A renders again after B closes");
	const call = reloaded[0];
	assert.equal(call.sourcePath, "Content/A.md");
	assert.equal(call.markdown, "A after B closes");
	assert.ok(call.owner === ownerA, "A still renders with ownerA after B closes");
	assert.equal(stateOf(ownerA).loaded, true);
	assert.ok(call.child);
	assert.ok(stateOf(ownerA).children.includes(call.child));
	assert.equal(stateOf(call.child).loaded, true);
	const content = fixtureA.container.querySelector(".lines > .content");
	assert.ok(content);
	assert.equal(content.innerHTML, "<a>A after B closes</a>");

	await fixtureA.unmount();
	assert.equal(stateOf(ownerA).loaded, false, "closing A unloads ownerA");
	for (const { child } of calls.filter(({ sourcePath }) => sourcePath === "Content/A.md")) {
		assert.ok(child);
		assert.equal(stateOf(child).loaded, false, "closing A unloads every A render child");
	}
});

// Brief-derived: direct close and the stub lifecycle behind the owner checks.
test("onClose alone unloads the view's markdown owner", async (t) => {
	const { calls } = mockMarkdownChildren(t);
	const fixture = await mountView(t, { app: notesApp({ "Content/A.md": "- [ ] A at mount" }) });
	assert.equal(calls.length, 1);
	const ownerA = calls[0].owner;
	assert.ok(ownerA instanceof Component);
	assert.equal(stateOf(ownerA).loaded, true);
	assert.ok(calls[0].child);
	assert.equal(stateOf(calls[0].child).loaded, true);
	try {
		await act(() => fixture.view.onClose());
		assert.equal(stateOf(ownerA).loaded, false, "onClose alone unloads the markdown owner");
		for (const { child } of calls) {
			assert.ok(child);
			assert.equal(stateOf(child).loaded, false, "onClose alone unloads every render child");
		}
	} finally {
		await assert.doesNotReject(fixture.unmount(), "unload and a second onClose do not throw");
	}
});

test("the obsidian stub's Component loads and unloads its children", (t) => {
	const parent = new Component();
	const before = new Component();
	const after = new Component();
	const removed = new Component();
	const lifecycle: string[] = [];
	t.mock.method(parent, "onload", () => lifecycle.push("parent load"));
	t.mock.method(before, "onload", () => lifecycle.push("before load"));
	t.mock.method(after, "onload", () => lifecycle.push("after load"));
	t.mock.method(before, "onunload", () => lifecycle.push("before unload"));
	t.mock.method(after, "onunload", () => lifecycle.push("after unload"));
	parent.register(() => lifecycle.push("cleanup"));
	t.mock.method(parent, "onunload", () => {
		assert.equal(stateOf(before).loaded, false, "children unload before their parent's onunload");
		assert.equal(stateOf(after).loaded, false);
		assert.deepEqual(stateOf(parent).children, [], "unload removes children from the parent");
		lifecycle.push("parent unload");
	});

	assert.equal(parent.addChild(before), before, "addChild returns its argument");
	assert.equal(stateOf(before).loaded, false, "a child waits for its parent to load");
	parent.load();
	assert.equal(stateOf(before).loaded, true, "a child added before load loads with the parent");
	assert.equal(parent.addChild(after), after);
	assert.equal(stateOf(after).loaded, true, "a child added to a loaded parent loads at once");
	parent.addChild(removed);
	assert.equal(stateOf(removed).loaded, true);
	assert.equal(parent.removeChild(removed), removed, "removeChild returns its argument");
	assert.equal(stateOf(removed).loaded, false, "removeChild unloads that child");
	assert.ok(!stateOf(parent).children.includes(removed));
	assert.equal(stateOf(parent).loaded, true);
	assert.equal(stateOf(before).loaded, true, "removeChild leaves the other children loaded");
	assert.equal(stateOf(after).loaded, true);

	parent.unload();
	assert.equal(stateOf(parent).loaded, false);
	assert.deepEqual(lifecycle, [
		"parent load",
		"before load",
		"after load",
		"after unload",
		"before unload",
		"cleanup",
		"parent unload",
	]);
});

/** A second root remounts Content between commits of the real view. */
function contentRoot(t: TestContext, host: UiHost, props: ContentProps) {
	const container = document.body.appendChild(document.createElement("div"));
	let root: ReturnType<typeof createRoot> | undefined;
	const unmount = async () => {
		await act(() => root?.unmount());
		root = undefined;
	};
	t.after(async () => {
		await unmount();
		container.remove();
	});
	return {
		container,
		mount: async () => {
			root = createRoot(container);
			await act(() =>
				root!.render(createElement(HostContext.Provider, { value: host }, createElement(Content, props))),
			);
		},
		unmount,
	};
}

test("a remount after a commit renders again", async (t) => {
	const { calls } = mockMarkdown(t);
	const notes = { "Content/View.md": "- [ ] View task" };
	const fixture = await mountView(t, { app: notesApp(notes) });
	const props = { display: "Remounted task", fileName: "Content/Remount.md" };
	const content = contentRoot(t, fixture.host, props);
	const renderCount = () =>
		calls.filter(({ markdown, sourcePath }) => markdown === props.display && sourcePath === props.fileName).length;
	await content.mount();
	assert.equal(renderCount(), 1);
	await content.unmount();
	const clear = t.mock.method(fixture.host, "clearMarkdownCache");
	notes["Content/View.md"] = "- [ ] Changed view task";
	fixture.edited("Content/View.md");
	await fixture.reload();
	assert.equal(clear.mock.callCount(), 1, "the reload clears the view's cache once");
	await content.mount();
	assert.equal(renderCount(), 2);
});

test("a remount without a commit hits the cache", async (t) => {
	const { calls } = mockMarkdown(t);
	const fixture = await mountView(t, { app: notesApp({ "Content/View.md": "- [ ] View task" }) });
	const props = { display: "Cached task", fileName: "Content/Cache.md" };
	const content = contentRoot(t, fixture.host, props);
	const renderCount = () =>
		calls.filter(({ markdown, sourcePath }) => markdown === props.display && sourcePath === props.fileName).length;
	await content.mount();
	assert.equal(renderCount(), 1);
	const html = content.container.innerHTML;
	await content.unmount();
	await content.mount();
	assert.equal(renderCount(), 1);
	assert.equal(content.container.innerHTML, html);
});

test("a link target created then reload shows the resolved display", async (t) => {
	const targets = new Set<string>();
	const calls: RenderCall[] = [];
	const unresolved = '<a class="internal-link is-unresolved">New</a>';
	const resolved = '<a class="internal-link">New</a>';
	t.mock.method(
		MarkdownRenderer,
		"renderMarkdown",
		(markdown: string, el: object, sourcePath: string, owner: Component) => {
			calls.push({ markdown, sourcePath, owner });
			Object.defineProperty(el, "firstElementChild", {
				value: { innerHTML: targets.has("New") ? resolved : unresolved },
				configurable: true,
			});
			return Promise.resolve();
		},
	);
	const props = { display: "[[New]]", fileName: "Content/Link.md" };
	const notes = { [props.fileName]: "- [ ] [[New]]" };
	const fixture = await mountView(t, { app: notesApp(notes) });
	const content = contentRoot(t, fixture.host, props);
	const renderCount = () =>
		calls.filter(({ markdown, sourcePath }) => markdown === props.display && sourcePath === props.fileName).length;
	const viewContent = fixture.container.querySelector(".task .lines > .content");
	assert.ok(viewContent);
	assert.equal(viewContent.innerHTML, "<a>" + unresolved + "</a>");
	// The view's own row cached this display at mount, so the probe reads that entry.
	await content.mount();
	assert.equal(content.container.innerHTML, "<a>" + unresolved + "</a>");
	assert.equal(renderCount(), 1);
	targets.add("New");
	await content.unmount();
	await content.mount();
	assert.equal(content.container.innerHTML, "<a>" + unresolved + "</a>");
	assert.equal(renderCount(), 1);
	await content.unmount();
	// Changed metadata makes reload commit while preserving the row's display and position in its day.
	notes[props.fileName] = "- [ ] [[New]] [priority:: high]";
	fixture.edited(props.fileName);
	await fixture.reload();
	await content.mount();
	assert.equal(content.container.innerHTML, "<a>" + resolved + "</a>");
	assert.equal(renderCount(), 2);
	// As with PureComponent, an unchanged mounted row keeps its copied HTML on reload.
	assert.equal(fixture.container.querySelector(".task .lines > .content"), viewContent);
	assert.equal(viewContent.innerHTML, "<a>" + unresolved + "</a>");
});

test("a row that remounts in a reload's render shows a link target created before it", async (t) => {
	const targets = new Set<string>();
	const unresolved = '<a class="internal-link is-unresolved">B</a>';
	const resolved = '<a class="internal-link">B</a>';
	const props = { display: "see [[B]]", fileName: "Content/Day.md" };
	t.mock.method(MarkdownRenderer, "renderMarkdown", (markdown: string, el: object) => {
		Object.defineProperty(el, "firstElementChild", {
			value: { innerHTML: markdown === props.display ? (targets.has("B") ? resolved : unresolved) : markdown },
			configurable: true,
		});
		return Promise.resolve();
	});
	const notes = { [props.fileName]: "- [ ] a\n- [ ] " + props.display };
	const app = notesApp(notes);
	t.mock.method(app.metadataCache, "getFileCache", (file: { path: string }) => metadataOf(notes[file.path]));
	const fixture = await mountView(t, {
		app,
		options: {
			...structuredClone(defaultUserOptions),
			defaultFilters: "",
			defaultTodayFocus: false,
			filterEmpty: false,
		},
	});
	assert.equal(fixture.container.querySelectorAll(".task").length, 2);
	const viewContent = fixture.container.querySelector(".task .internal-link")?.closest(".lines > .content");
	assert.ok(viewContent);
	assert.equal(viewContent.innerHTML, "<a>" + unresolved + "</a>");
	// A quick-filter remount can cache this display between reloads.
	const content = contentRoot(t, fixture.host, props);
	await content.mount();
	assert.equal(content.container.innerHTML, "<a>" + unresolved + "</a>");
	await content.unmount();
	targets.add("B");
	notes[props.fileName] = "- [ ] top\n" + notes[props.fileName];
	fixture.edited(props.fileName);
	await fixture.reload();
	const reloadedContent = fixture.container.querySelector(".task .internal-link")?.closest(".lines > .content");
	assert.ok(reloadedContent);
	assert.notEqual(reloadedContent, viewContent, "the shifted task id remounts the row during reload");
	assert.equal(reloadedContent.innerHTML, "<a>" + resolved + "</a>");
});
