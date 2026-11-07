import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { createStore } from "@tasks-calendar-wrapper/core";
import { useTransitionedStore } from "../src";

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

test("applies list changes in a transition (an urgent update during it is not blocked)", async (t) => {
	const oldList: readonly string[] = ["old"];
	const newList: readonly string[] = ["new"];
	const store = createStore({ list: oldList });
	const selectList = (state: { list: readonly string[] }) => state.list;
	const renders: [number, readonly string[]][] = [];
	let setUrgent: Dispatch<SetStateAction<number>> | undefined;
	function List() {
		const [urgent, updateUrgent] = useState(0);
		setUrgent = updateUrgent;
		const list = useTransitionedStore(store, selectList);
		renders.push([urgent, list]);
		return createElement("div", null, `${urgent}: ${list.join(", ")}`);
	}
	const { root, container } = mountRoot(t);
	await act(() => root.render(createElement(List)));
	assert.ok(setUrgent);
	const updateUrgent = setUrgent;
	renders.length = 0;
	await act(() => {
		store.setState({ list: newList });
		updateUrgent(1);
	});
	const urgentBeforeList = renders.findIndex(([urgent, list]) => urgent === 1 && list === oldList);
	const urgentWithList = renders.findIndex(([urgent, list]) => urgent === 1 && list === newList);
	assert.ok(urgentBeforeList >= 0, "the urgent update renders with the old list");
	assert.ok(urgentWithList > urgentBeforeList, "the new list renders after the urgent update");
	const last = renders[renders.length - 1];
	assert.equal(last[0], 1);
	assert.equal(last[1], newList);
	assert.equal(container.textContent, "1: new");
});

test("catches a change between render and subscribe", async (t) => {
	const store = createStore<{ list: readonly string[] }>({ list: ["before"] });
	const selectList = (state: { list: readonly string[] }) => state.list;
	const newList = ["after", "mount"];
	function ChangeOnMount() {
		useLayoutEffect(() => {
			store.setState({ list: newList });
		}, []);
		return null;
	}
	function List() {
		const list = useTransitionedStore(store, selectList);
		return createElement("div", null, list.join(", "), createElement(ChangeOnMount));
	}
	const { root, container } = mountRoot(t);
	await act(() => root.render(createElement(List)));
	assert.equal(container.textContent, "after, mount");
});
