// Pins the existing mobile menu, accessible names and absence of long-press handling.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { copy, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { HostContext, type UiHost } from "../src";
import { TaskRow } from "../src/row/TaskRow";

type TaskRowProps = ComponentProps<typeof TaskRow>;

const model: TaskRowModel = {
	display: "A task",
	path: "Tasks.md",
	sourceLine: "- [ ] A task",
	position: { start: { line: 2, col: 0, offset: 10 }, end: { line: 2, col: 12, offset: 22 } },
	line: 2,
	col: 12,
	link: "Tasks.md#Work",
	isDailyNote: false,
	color: "#123456",
	fileTitle: "Tasks",
	subPath: "Work",
	statusMarker: " ",
	status: "due",
	useBuiltinStyle: true,
	badges: [],
	tags: [],
};
const callbacks: TaskRowProps["callbacks"] = {
	handleOpenFile: () => {},
	handleCompleteTask: () => {},
	handleTagClick: () => {},
	handleModifyTask: () => {},
	handleRowMenu: () => {},
	handleDateBadge: undefined,
};
const props: TaskRowProps = { model, callbacks, clock: { lastListChangeAt: -Infinity } };

function rowHarness(t: TestContext, isMobile: boolean) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	const host: UiHost = {
		isMobile,
		now: () => assert.fail("TaskRow does not read the clock"),
		moment: Object.assign(() => assert.fail("TaskRow does not create a moment"), { locale: () => "en" }),
		renderMarkdown: (markdown) => markdown,
	};
	const render = async (next: TaskRowProps) => {
		await act(() =>
			root.render(createElement(HostContext.Provider, { value: host }, createElement(TaskRow, next))),
		);
	};
	return { container, render };
}

test("with host.isMobile the row shows ⋯ and without it does not", async (t) => {
	for (const isMobile of [true, false]) {
		const row = rowHarness(t, isMobile);
		await row.render(props);
		const menus = row.container.querySelectorAll("a.menu");
		assert.equal(menus.length, isMobile ? 1 : 0, `mobile=${isMobile}`);
		if (isMobile) {
			assert.equal(menus[0].getAttribute("role"), "button");
			assert.equal(menus[0].textContent, "⋯");
		}
		await row.render({ ...props, callbacks: { ...callbacks, handleRowMenu: undefined } });
		assert.equal(row.container.querySelectorAll("a.menu").length, 0, "no row menu callback");
	}
});

test("on mobile ✏️ and ⋯ have accessible names", async (t) => {
	const row = rowHarness(t, true);
	await row.render(props);
	for (const [selector, name] of [
		["a.modify", copy.row.modifyAria],
		["a.menu", copy.row.menuAria],
	]) {
		const control = row.container.querySelector(selector);
		assert.ok(control, selector);
		assert.ok(name.trim(), `${selector} has a non-empty name`);
		assert.equal(control.getAttribute("aria-label"), name, selector);
	}
});

test("the row has no long-press handler", () => {
	const sources = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((name) => /\.tsx?$/.test(name));
	assert.ok(sources.length > 0);
	for (const name of sources) {
		const source = readFileSync(path.join("src", name), "utf8");
		assert.doesNotMatch(source, /\b(?:onTouchStart|onTouchEnd|onPointerDown|onPointerUp)\b/, name);
		assert.doesNotMatch(source, /long[\s_-]?press|\b(?:press|hold)(?:Timer|Timeout)\b/i, name);
	}
});
