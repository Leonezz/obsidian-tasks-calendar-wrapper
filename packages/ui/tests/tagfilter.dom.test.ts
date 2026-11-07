// Brief-derived tests for the tag filter's applied draft and mount-time suggestion subscription.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import type { QuickFilter } from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext } from "../src/contexts";
import { TagFilter } from "../src/entry/TagFilter";

type Handlers = ContextType<typeof QuickEntryHandlerContext>;
type FilterCall = Parameters<Handlers["handleFilterEnable"]>;

function filterHarness(t: TestContext, suggestTags?: Handlers["suggestTags"]) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
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
					createElement(TagFilter, { applied, tags }),
				),
			),
		);
	};
	const input = () => {
		const element = container.querySelector<HTMLInputElement>(".tagFilterBar input");
		assert.ok(element);
		return element;
	};
	return { render, input, calls, handlers, unmount };
}

async function edit(input: HTMLInputElement, value: string) {
	await act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		setter.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function enter(input: HTMLInputElement) {
	await act(() => input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })));
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
