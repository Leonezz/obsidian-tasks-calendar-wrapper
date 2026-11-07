import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Component, MarkdownRenderer, Platform } from "obsidian";
import { createUiHost } from "../src/uihost";
import { moment } from "../utils/moment";

function detachedElements() {
	const elements: HTMLElement[] = [];
	return {
		elements,
		createElement: () => {
			const element = { firstElementChild: null } as unknown as HTMLElement;
			elements.push(element);
			return element;
		},
	};
}

test("renderMarkdown returns the detached element's firstElementChild.innerHTML", (t) => {
	const render = t.mock.method(MarkdownRenderer, "renderMarkdown");
	const owner = new Component();
	const { elements, createElement } = detachedElements();
	const host = createUiHost({ owner: () => owner, createElement });
	const markdown = "a <b> & [[Note]]";

	assert.equal(host.renderMarkdown(markdown, "Notes/Day.md"), "a &lt;b&gt; &amp; [[Note]]");
	assert.equal(render.mock.callCount(), 1);
	assert.equal(elements.length, 1);
	const args = render.mock.calls[0].arguments;
	assert.equal(args.length, 4);
	assert.equal(args[0], markdown);
	assert.equal(args[1], elements[0]);
	assert.equal(args[2], "Notes/Day.md");
	assert.equal(args[3], owner);
});

test("cache hit returns the same string without rendering", (t) => {
	const render = t.mock.method(MarkdownRenderer, "renderMarkdown");
	const owner = new Component();
	const { elements, createElement } = detachedElements();
	const host = createUiHost({ owner: () => owner, createElement });

	const first = host.renderMarkdown("same", "Notes/Day.md");
	assert.equal(host.renderMarkdown("same", "Notes/Day.md"), first);
	assert.equal(render.mock.callCount(), 1);
	assert.equal(elements.length, 1);
	assert.equal(host.renderMarkdown("same", "Notes/Other.md"), first);
	assert.equal(render.mock.callCount(), 2);

	assert.equal(host.renderMarkdown("bc", "a"), "bc");
	assert.equal(host.renderMarkdown("c", "ab"), "c");
	assert.equal(render.mock.callCount(), 4);
	assert.equal(host.renderMarkdown("bc", "a"), "bc");
	assert.equal(host.renderMarkdown("c", "ab"), "c");
	assert.equal(render.mock.callCount(), 4);
	assert.equal(elements.length, 4);
});

test("cache is cleared on list commit", (t) => {
	const render = t.mock.method(MarkdownRenderer, "renderMarkdown");
	const owner = new Component();
	const { elements, createElement } = detachedElements();
	const host = createUiHost({ owner: () => owner, createElement });

	const first = host.renderMarkdown("same", "Notes/Day.md");
	host.clearMarkdownCache();
	assert.equal(host.renderMarkdown("same", "Notes/Day.md"), first);
	assert.equal(render.mock.callCount(), 2);
	assert.equal(elements.length, 2);
	assert.notEqual(elements[0], elements[1]);
});

test("the least recently used render is evicted at capacity", (t) => {
	const render = t.mock.method(MarkdownRenderer, "renderMarkdown");
	const owner = new Component();
	const { createElement } = detachedElements();
	const host = createUiHost({ owner: () => owner, createElement, capacity: 2 });
	const callsFor = (markdown: string) => render.mock.calls.filter((call) => call.arguments[0] === markdown).length;

	host.renderMarkdown("A", "Notes/Day.md");
	host.renderMarkdown("B", "Notes/Day.md");
	host.renderMarkdown("A", "Notes/Day.md");
	assert.equal(callsFor("A"), 1);
	host.renderMarkdown("C", "Notes/Day.md");
	assert.equal(callsFor("C"), 1);
	// Check A before the miss for B inserts it and changes the eviction order again.
	host.renderMarkdown("A", "Notes/Day.md");
	assert.equal(callsFor("A"), 1);
	host.renderMarkdown("B", "Notes/Day.md");
	assert.equal(callsFor("B"), 2);
	assert.equal(render.mock.callCount(), 4);
});

test("a capacity that is not a positive integer is refused", () => {
	const owner = new Component();
	for (const capacity of [0, -1, 1.5, NaN]) {
		assert.throws(() => createUiHost({ owner: () => owner, capacity }), {
			name: "Error",
			message: `the markdown cache capacity must be a positive integer, got ${capacity}`,
		});
	}
});

test("the host reports the platform and the time", () => {
	const owner = new Component();
	const host = createUiHost({ owner: () => owner });

	assert.equal(host.isMobile, Platform.isMobile);
	const now = host.now();
	assert.equal(now.isValid(), true);
	assert.ok(Math.abs(now.valueOf() - Date.now()) < 1000);
	assert.equal(host.moment, moment);
});

test("a render that leaves no element throws as Content did and caches nothing", (t) => {
	const render = t.mock.method(MarkdownRenderer, "renderMarkdown", () => Promise.resolve());
	const owner = new Component();
	const { elements, createElement } = detachedElements();
	const host = createUiHost({ owner: () => owner, createElement });

	for (let attempt = 1; attempt <= 2; attempt++) {
		assert.throws(() => host.renderMarkdown("", "Notes/Empty.md"), {
			name: "TypeError",
			message: /innerHTML/,
		});
		assert.equal(render.mock.callCount(), attempt);
		assert.equal(elements.length, attempt);
	}
});

test("the render's promise is neither awaited nor caught", (t) => {
	const calls: string[] = [];
	const thenable = {
		then() {
			calls.push("then");
			return Promise.resolve();
		},
		catch() {
			calls.push("catch");
			return Promise.resolve();
		},
		finally() {
			calls.push("finally");
			return Promise.resolve();
		},
	};
	t.mock.method(MarkdownRenderer, "renderMarkdown", (_markdown: string, el: object) => {
		Object.defineProperty(el, "firstElementChild", {
			value: { innerHTML: "rendered" },
			configurable: true,
		});
		return thenable as unknown as Promise<void>;
	});
	const owner = new Component();
	const { createElement } = detachedElements();
	const host = createUiHost({ owner: () => owner, createElement });

	assert.equal(host.renderMarkdown("same", "Notes/Day.md"), "rendered");
	assert.deepEqual(calls, []);
});
