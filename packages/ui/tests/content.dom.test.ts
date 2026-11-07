// Pins Content's host delegation, markup and memo boundary.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { HostContext, type UiHost } from "../src";
import { Content } from "../src/row/Content";

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

function countingHost() {
	const calls: { markdown: string; sourcePath: string }[] = [];
	const host: UiHost = {
		isMobile: false,
		now: () => assert.fail("Content does not read the clock"),
		moment: Object.assign(() => assert.fail("Content does not create a moment"), { locale: () => "en" }),
		renderMarkdown(markdown, sourcePath) {
			calls.push({ markdown, sourcePath });
			return "<b>" + markdown + "@" + sourcePath + "</b>";
		},
	};
	return { host, calls };
}

test("Content renders the host's HTML in a bare a", async (t) => {
	const { container, root } = mountRoot(t);
	const { host, calls } = countingHost();
	await act(() =>
		root.render(
			createElement(
				HostContext.Provider,
				{ value: host },
				createElement(Content, { display: "x", fileName: "N.md" }),
			),
		),
	);
	assert.equal(container.innerHTML, "<a><b>x@N.md</b></a>");
	assert.deepEqual(calls, [{ markdown: "x", sourcePath: "N.md" }]);
});

test("Content renders again only when display or fileName changes", async (t) => {
	const { container, root } = mountRoot(t);
	const { host, calls } = countingHost();
	const props = { display: "x", fileName: "N.md" };
	const render = async (next: typeof props) => {
		await act(() =>
			root.render(createElement(HostContext.Provider, { value: host }, createElement(Content, next))),
		);
	};
	await render(props);
	assert.equal(calls.length, 1, "mount");
	for (const [next, expected, label] of [
		[props, 0, "same props"],
		[{ ...props }, 0, "new props object with equal strings"],
		[{ ...props, display: "y" }, 1, "changed display"],
		[{ display: "y", fileName: "Other.md" }, 1, "changed fileName"],
	] as const) {
		const before: number = calls.length;
		await render(next);
		assert.equal(calls.length - before, expected, label);
	}
	assert.deepEqual(calls, [
		{ markdown: "x", sourcePath: "N.md" },
		{ markdown: "y", sourcePath: "N.md" },
		{ markdown: "y", sourcePath: "Other.md" },
	]);
	assert.equal(container.innerHTML, "<a><b>y@Other.md</b></a>");
});

test("Content outside a HostContext provider throws useHost's error", async (t) => {
	t.mock.method(console, "error", () => {});
	const { root } = mountRoot(t);
	await assert.rejects(
		async () => {
			await act(() => root.render(createElement(Content, { display: "x", fileName: "N.md" })));
		},
		{ message: "useHost needs a HostContext provider around the timeline" },
	);
});
