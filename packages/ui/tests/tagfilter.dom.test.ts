// Brief-derived tests for the tag filter's applied draft and mount-time suggestion subscription.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import type { QuickFilter } from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext } from "../src/contexts";
import { createTagFilterDraft, TagFilter } from "../src/entry/TagFilter";

type Handlers = ContextType<typeof QuickEntryHandlerContext>;
type FilterCall = Parameters<Handlers["handleFilterEnable"]>;

function filterHarness(t: TestContext, suggestTags?: Handlers["suggestTags"]) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	const draft = createTagFilterDraft();
	let mounted = true;
	const unmount = async () => {
		if (!mounted) return;
		mounted = false;
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	};
	t.after(unmount);
	const calls: FilterCall[] = [];
	const handlers: Handlers = {
		handleCreateNewTask: async () => false,
		handleFilterEnable: (...args) => calls.push(args),
		suggestTags,
	};
	const render = async (applied?: QuickFilter, tags: readonly string[] = [], callback = handlers) => {
		await act(() =>
			root.render(
				createElement(
					QuickEntryHandlerContext.Provider,
					{ value: callback },
					createElement(TagFilter, { applied, tags, draft }),
				),
			),
		);
	};
	const input = () => {
		const element = container.querySelector<HTMLInputElement>(".tagFilterBar input");
		assert.ok(element);
		return element;
	};
	const remount = async (applied?: QuickFilter, tags: readonly string[] = [], callback = handlers) => {
		await act(() => root.render(null));
		await render(applied, tags, callback);
	};
	return { render, remount, input, calls, handlers, unmount, draft };
}

async function edit(input: HTMLInputElement, value: string) {
	await act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		setter.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function enter(input: HTMLInputElement) {
	await act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}

test("a newly applied filter shows its own tag; the same filter keeps the typed text", async (t) => {
	const filter = filterHarness(t);
	const applied: QuickFilter = { priorities: [], tags: ["#home"] };
	await filter.render(applied);
	assert.equal(filter.input().value, "#home");
	await edit(filter.input(), " home ");
	await filter.render(applied);
	assert.equal(filter.input().value, " home ");
	await filter.render({ ...applied, priorities: [...applied.priorities], tags: [...applied.tags!] });
	assert.equal(filter.input().value, "#home");
	await filter.render({ priorities: [], tags: ["#work"] });
	assert.equal(filter.input().value, "#work");
	await filter.render(undefined);
	assert.equal(filter.input().value, "");
	await filter.render(applied);
	await edit(filter.input(), "unfinished");
	await filter.render(undefined);
	assert.equal(filter.input().value, "");
	await filter.render(applied);
	assert.equal(filter.input().value, "#home");
	assert.deepEqual(filter.calls, []);
});

test("Enter applies the typed tag with the applied dates and priorities", async (t) => {
	const filter = filterHarness(t);
	const applied: QuickFilter = { from: "2026-01-10", to: "2026-01-20", priorities: ["1"] };
	await filter.render(applied);
	await edit(filter.input(), "#home");
	assert.deepEqual(filter.calls, []);
	await enter(filter.input());
	assert.deepEqual(filter.calls, [["2026-01-10", "2026-01-20", ["1"], ["#home"]]]);
	assert.notEqual(filter.calls[0][2], applied.priorities);
	await edit(filter.input(), "##home");
	await enter(filter.input());
	assert.deepEqual(filter.calls[1], ["2026-01-10", "2026-01-20", ["1"], ["#home"]]);
});

test("emptying the box clears the tag", async (t) => {
	const filter = filterHarness(t);
	const applied: QuickFilter = {
		from: "2026-01-10",
		to: "2026-01-20",
		priorities: ["1"],
		tags: ["#home"],
	};
	await filter.render(applied);
	await edit(filter.input(), "#work");
	assert.deepEqual(filter.calls, []);
	await edit(filter.input(), "  ");
	assert.deepEqual(filter.calls, [["2026-01-10", "2026-01-20", ["1"], []]]);
	await edit(filter.input(), "another");
	assert.equal(filter.calls.length, 1);
});

test("Enter applies multiple tags once each while retaining nested and Chinese tag spelling", async (t) => {
	const filter = filterHarness(t);
	const applied: QuickFilter = { from: "2026-01-10", to: "2026-01-20", priorities: ["High", "Low"] };
	await filter.render(applied);
	await edit(filter.input(), " ##home #Work #home work #项目/阶段 #项目/阶段 # ");
	await enter(filter.input());
	assert.deepEqual(filter.calls, [["2026-01-10", "2026-01-20", ["High", "Low"], ["#home", "#Work", "#项目/阶段"]]]);
});

test("IME confirmation does not apply a partial multi-tag filter", async (t) => {
	const filter = filterHarness(t);
	await filter.render();
	await edit(filter.input(), "#home #项目/阶");
	await act(() => {
		filter.input().dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
		filter.input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
	});
	assert.deepEqual(filter.calls, []);
	await act(() => filter.input().dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true })));
	await edit(filter.input(), "#home #项目/阶段");
	await enter(filter.input());
	assert.deepEqual(filter.calls, [[undefined, undefined, [], ["#home", "#项目/阶段"]]]);
});

test("suggestions start once at mount and stop at unmount", async (t) => {
	let starts = 0;
	let stops = 0;
	let suggestedInput: HTMLInputElement | undefined;
	let tagsOf: (() => readonly string[]) | undefined;
	const filter = filterHarness(t, (input, tags) => {
		starts++;
		suggestedInput = input;
		tagsOf = tags;
		return () => stops++;
	});
	const initialTags = ["#home"];
	await filter.render(undefined, initialTags);
	assert.equal(starts, 1);
	assert.equal(suggestedInput, filter.input());
	assert.ok(tagsOf);
	assert.equal(tagsOf(), initialTags);
	const latestTags = ["#work", "#errands"];
	await filter.render(undefined, latestTags);
	assert.equal(starts, 1);
	assert.equal(stops, 0);
	assert.equal(tagsOf(), latestTags);
	await filter.render(undefined, latestTags, {
		...filter.handlers,
		suggestTags: () => assert.fail("the suggester is chosen only at mount"),
	});
	assert.equal(starts, 1);
	assert.equal(stops, 0);
	await filter.unmount();
	assert.equal(stops, 1);
});

test("a picked suggestion applies with the latest filter", async (t) => {
	let pick: ((tag: string) => void) | undefined;
	const filter = filterHarness(t, (_input, _tags, onPick) => {
		pick = onPick;
		return () => {};
	});
	await filter.render({ from: "2026-01-10", to: "2026-01-20", priorities: ["1"], tags: ["#home"] });
	assert.ok(pick);
	const applied: QuickFilter = {
		from: "2026-02-10",
		to: "2026-02-20",
		priorities: ["2"],
		tags: ["#work"],
	};
	const latestCalls: FilterCall[] = [];
	const latestHandlers: Handlers = {
		...filter.handlers,
		handleFilterEnable: (...args) => latestCalls.push(args),
		suggestTags: () => assert.fail("a new context does not restart suggestions"),
	};
	await filter.render(applied, ["#picked"], latestHandlers);
	await act(() => pick!("#picked"));
	assert.deepEqual(filter.calls, []);
	assert.deepEqual(latestCalls, [["2026-02-10", "2026-02-20", ["2"], ["#picked"]]]);
	assert.notEqual(latestCalls[0][2], applied.priorities);
	assert.equal(filter.input().value, "#picked");
	await filter.render(applied, ["#picked"], latestHandlers);
	assert.equal(filter.input().value, "#picked");
});

test("a picked continuation retains its text and caret when its filter remounts the editor", async (t) => {
	let pick: ((text: string) => void) | undefined;
	const filter = filterHarness(t, (_input, _tags, onPick) => {
		pick = onPick;
		return () => {};
	});
	const applied: QuickFilter = {
		from: "2026-01-10",
		to: "2026-01-20",
		priorities: ["High"],
		tags: ["#home"],
	};
	await filter.render(applied);
	const original = filter.input();
	const text = "#home  #项目/阶段 ";
	await act(() => {
		original.focus();
		original.value = text;
		original.setSelectionRange(text.length, text.length);
		pick!(text);
	});
	const next = { ...applied, tags: ["#home", "#项目/阶段"] };
	await filter.remount(next);
	assert.notEqual(filter.input(), original);
	assert.equal(filter.input().value, text);
	assert.equal(filter.input().selectionStart, text.length);
	assert.equal(filter.input().selectionEnd, text.length);
	assert.equal(document.activeElement, filter.input());
	assert.deepEqual(filter.calls, [["2026-01-10", "2026-01-20", ["High"], next.tags]]);
	await edit(filter.input(), text + "#third");
	await enter(filter.input());
	assert.deepEqual(filter.calls[1], ["2026-01-10", "2026-01-20", ["High"], [...next.tags, "#third"]]);
	await filter.render({ ...next, priorities: ["Low"] });
	assert.equal(filter.input().value, "#home #项目/阶段", "an external filter replaces an unfinished continuation");
});

test("a stale suggestion callback cannot apply after its editor unmounts", async (t) => {
	let pick: ((text: string) => void) | undefined;
	const filter = filterHarness(t, (_input, _tags, onPick) => {
		pick = onPick;
		return () => {};
	});
	await filter.render();
	await filter.unmount();
	pick!("#stale ");
	assert.deepEqual(filter.calls, []);
	assert.equal(filter.draft.getSnapshot().text, "");
});

test("focused Enter and clear restore the editor through remount without stealing programmatic focus", async (t) => {
	const filter = filterHarness(t);
	const applied: QuickFilter = { priorities: [], tags: ["#home"] };
	await filter.render(applied);
	await edit(filter.input(), "#home #work");
	await act(() => {
		filter.input().focus();
		filter.input().setSelectionRange(7, 7);
	});
	await enter(filter.input());
	const next = { priorities: [], tags: ["#home", "#work"] };
	await filter.remount(next);
	assert.equal(document.activeElement, filter.input());
	assert.equal(filter.input().selectionStart, 7);
	await edit(filter.input(), "");
	await filter.remount(undefined);
	assert.equal(document.activeElement, filter.input());
	assert.equal(filter.input().selectionStart, 0);
	assert.equal(filter.input().value, "");
	filter.input().blur();
	await edit(filter.input(), "#other");
	await enter(filter.input());
	await filter.remount({ priorities: [], tags: ["#other"] });
	assert.notEqual(document.activeElement, filter.input());
});
