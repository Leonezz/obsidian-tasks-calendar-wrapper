import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/store";

// A store holds one immutable state at a time and tells its listeners when it is replaced, as React's
// useSyncExternalStore expects: getSnapshot returns the same object until the state changes.

test("the snapshot is the state set last, and stays the same object until a new one is set", () => {
	const first = { count: 0 };
	const store = createStore(first);
	assert.equal(store.getSnapshot(), first);
	assert.equal(store.getSnapshot(), store.getSnapshot());
	const second = { count: 1 };
	store.setState(second);
	assert.equal(store.getSnapshot(), second);
	store.setState((state) => ({ count: state.count + 1 }));
	assert.deepEqual(store.getSnapshot(), { count: 2 });
});

test("setting the same state again tells no one", () => {
	const state = { count: 0 };
	const store = createStore(state);
	let calls = 0;
	store.subscribe(() => (calls += 1));
	store.setState(state);
	store.setState((current) => current);
	assert.equal(calls, 0);
	store.setState({ count: 0 });
	assert.equal(calls, 1, "an equal but new state is a new state");
});

test("listeners hear of each change in the order they subscribed, until they unsubscribe", () => {
	const store = createStore(0);
	const heard: string[] = [];
	const unsubscribeA = store.subscribe(() => heard.push(`a${store.getSnapshot()}`));
	store.subscribe(() => heard.push(`b${store.getSnapshot()}`));
	store.setState(1);
	unsubscribeA();
	unsubscribeA();
	store.setState(2);
	assert.deepEqual(heard, ["a1", "b1", "b2"]);
});

test("the same function subscribed twice is called twice, and each unsubscribe takes off one", () => {
	const store = createStore(0);
	let calls = 0;
	const listener = () => (calls += 1);
	const off = store.subscribe(listener);
	store.subscribe(listener);
	store.setState(1);
	assert.equal(calls, 2);
	off();
	store.setState(2);
	assert.equal(calls, 3);
});

test("a state set while the listeners are told waits until all of them have heard of the one before", () => {
	const store = createStore(0);
	const heard: string[] = [];
	store.subscribe(() => {
		heard.push(`a${store.getSnapshot()}`);
		if (store.getSnapshot() === 1) store.setState(2);
	});
	store.subscribe(() => heard.push(`b${store.getSnapshot()}`));
	store.setState(1);
	// Both heard of 1 before either heard of 2; b reads the snapshot when it is told, which is 2 by then.
	assert.deepEqual(heard, ["a1", "b2", "a2", "b2"]);
	assert.equal(store.getSnapshot(), 2);
});

test("a listener subscribed or taken off while the listeners are told counts from the next change", () => {
	const store = createStore(0);
	const heard: string[] = [];
	let offB = () => {};
	store.subscribe(() => {
		heard.push("a");
		offB();
		store.subscribe(() => heard.push("c"));
	});
	offB = store.subscribe(() => heard.push("b"));
	store.setState(1);
	assert.deepEqual(heard, ["a", "b"]);
	// At the next change b is off, and the c subscribed during the first is told; the c subscribed now is not yet.
	store.setState(2);
	assert.deepEqual(heard, ["a", "b", "a", "c"]);
});

test("a listener that throws does not keep the others from hearing, and its error is thrown after them", () => {
	const store = createStore(0);
	const heard: string[] = [];
	store.subscribe(() => {
		throw new Error("first");
	});
	store.subscribe(() => heard.push("b"));
	assert.throws(() => store.setState(1), /first/);
	assert.deepEqual(heard, ["b"]);
	assert.equal(store.getSnapshot(), 1);
	store.subscribe(() => {
		throw new Error("second");
	});
	assert.throws(
		() => store.setState(2),
		(error: unknown) =>
			error instanceof AggregateError && error.errors.map((e: Error) => e.message).join() === "first,second",
	);
	assert.deepEqual(heard, ["b", "b"]);
});
