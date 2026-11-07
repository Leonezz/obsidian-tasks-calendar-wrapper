import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { createStore } from "@tasks-calendar-wrapper/core";
import { HostContext, useHost, useStore, type UiHost } from "../src";

function mountRoot(t: TestContext) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	return { container, root };
}

test("useStore re-renders only on a changed selection", async (t) => {
	const store = createStore({ a: 1, b: 1, obj: { value: "unchanged" } });
	const selectA = (state: ReturnType<typeof store.getSnapshot>) => state.a;
	let renders = 0;
	function Value() {
		const a = useStore(store, selectA);
		renders++;
		return createElement("span", null, a);
	}
	const first = mountRoot(t);
	await act(() => first.root.render(createElement(Value)));
	assert.equal(renders, 1);
	assert.equal(first.container.textContent, "1");
	await act(() => store.setState((state) => ({ ...state, b: 2 })));
	assert.equal(renders, 1);
	await act(() => store.setState((state) => ({ ...state, a: 2 })));
	assert.equal(renders, 2);
	assert.equal(first.container.textContent, "2");

	const selectObject = (state: ReturnType<typeof store.getSnapshot>) => ({ x: state.a });
	const equalObject = (left: { x: number }, right: { x: number }) => left.x === right.x;
	let objectRenders = 0;
	let selected: { x: number } | undefined;
	function ObjectValue() {
		selected = useStore(store, selectObject, equalObject);
		objectRenders++;
		return createElement("span", null, selected.x);
	}
	const second = mountRoot(t);
	await act(() => second.root.render(createElement(ObjectValue)));
	assert.equal(objectRenders, 1);
	assert.ok(selected);
	const before = selected;
	await act(() => store.setState((state) => ({ ...state, b: 3 })));
	assert.equal(objectRenders, 1);
	assert.equal(selected, before);
	assert.equal(second.container.textContent, "2");
	await act(() => second.root.render(createElement(ObjectValue)));
	assert.equal(objectRenders, 2);
	assert.equal(selected, before);
});

test("useStore catches a change between render and subscribe", async (t) => {
	const store = createStore({ value: "before" });
	const select = (state: { value: string }) => state.value;
	function ChangeOnMount() {
		useLayoutEffect(() => {
			store.setState({ value: "after" });
		}, []);
		return null;
	}
	function Value() {
		const value = useStore(store, select);
		return createElement("div", null, value, createElement(ChangeOnMount));
	}
	const { root, container } = mountRoot(t);
	await act(() => root.render(createElement(Value)));
	assert.equal(container.textContent, "after");
});

test("listener errors surface", async (t) => {
	const store = createStore({ value: 1 });
	const select = (state: { value: number }) => state.value;
	function Value() {
		return createElement("span", null, useStore(store, select));
	}
	const { root, container } = mountRoot(t);
	await act(() => root.render(createElement(Value)));
	const boom = new Error("boom");
	t.after(
		store.subscribe(() => {
			throw boom;
		}),
	);
	let caught: unknown;
	await act(() => {
		try {
			store.setState({ value: 2 });
		} catch (error) {
			caught = error;
		}
	});
	assert.equal(caught, boom);
	assert.equal(container.textContent, "2");

	const another = new Error("another boom");
	t.after(
		store.subscribe(() => {
			throw another;
		}),
	);
	let aggregate: unknown;
	await act(() => {
		try {
			store.setState({ value: 3 });
		} catch (error) {
			aggregate = error;
		}
	});
	assert.ok(aggregate instanceof AggregateError);
	assert.equal(aggregate.errors.length, 2);
	assert.equal(aggregate.errors[0], boom);
	assert.equal(aggregate.errors[1], another);
	assert.equal(container.textContent, "3");
});

test("useHost throws outside a HostContext provider", async (t) => {
	t.mock.method(console, "error", () => {});
	let selected: UiHost | undefined;
	function Host() {
		selected = useHost();
		return createElement("span", null, "host");
	}
	const outside = mountRoot(t);
	await assert.rejects(
		async () => {
			await act(() => outside.root.render(createElement(Host)));
		},
		{ message: "useHost needs a HostContext provider around the timeline" },
	);
	const host: UiHost = {
		isMobile: false,
		now: () => assert.fail("useHost does not read the clock"),
		moment: Object.assign(() => assert.fail("useHost does not create a moment"), { locale: () => "en" }),
		renderMarkdown: (markdown) => markdown,
	};
	const inside = mountRoot(t);
	await act(() => inside.root.render(createElement(HostContext.Provider, { value: host }, createElement(Host))));
	assert.equal(selected, host);
	assert.equal(inside.container.textContent, "host");
});
