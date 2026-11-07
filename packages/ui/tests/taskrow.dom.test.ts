// Pins TaskRow's memo truth table and mobile menu placement.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { TaskRowModel } from "@tasks-calendar-wrapper/core";
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
	badges: [{ kind: "due", ariaLabel: "due at 2026-11-08", label: "Today" }],
	tags: [{ tag: "#work", color: "#654321" }],
};
const callbacks: TaskRowProps["callbacks"] = {
	handleOpenFile: () => {},
	handleCompleteTask: () => {},
	handleTagClick: () => {},
	handleModifyTask: () => {},
	handleRowMenu: () => {},
	handleDateBadge: undefined,
};
const overlay = { dimmed: true, marker: "x", status: "done" };
const props: TaskRowProps = { model, callbacks, overlay, clock: { lastListChangeAt: -Infinity } };

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

function rowHarness(t: TestContext, isMobile = false) {
	const { container, root } = mountRoot(t);
	let renders = 0;
	const host: UiHost = {
		get isMobile() {
			renders++;
			return isMobile;
		},
		now: () => assert.fail("TaskRow does not read the clock"),
		moment: Object.assign(() => assert.fail("TaskRow does not create a moment"), { locale: () => "en" }),
		renderMarkdown: (markdown) => markdown,
	};
	const render = async (next: TaskRowProps) => {
		await act(() =>
			root.render(createElement(HostContext.Provider, { value: host }, createElement(TaskRow, next))),
		);
	};
	return { container, render, renders: () => renders };
}

test("TaskRow renders again when any model field changes", async (t) => {
	const changes: [string, TaskRowModel][] = [
		["display", { ...model, display: "Another task" }],
		["path", { ...model, path: "Other.md" }],
		["sourceLine", { ...model, sourceLine: "- [ ] Another task" }],
		["line", { ...model, line: 3 }],
		["col", { ...model, col: 13 }],
		["link", { ...model, link: "Tasks.md#Other" }],
		["isDailyNote", { ...model, isDailyNote: true }],
		["color", { ...model, color: "#abcdef" }],
		["fileTitle", { ...model, fileTitle: "Other" }],
		["subPath", { ...model, subPath: "Other" }],
		["statusMarker", { ...model, statusMarker: "x" }],
		["status", { ...model, status: "done" }],
		["useBuiltinStyle", { ...model, useBuiltinStyle: false }],
		["badges length", { ...model, badges: [] }],
		["badge kind", { ...model, badges: [{ ...model.badges[0], kind: "start" }] }],
		["badge ariaLabel", { ...model, badges: [{ ...model.badges[0], ariaLabel: "due tomorrow" }] }],
		["badge label", { ...model, badges: [{ ...model.badges[0], label: "Tomorrow" }] }],
		["tags length", { ...model, tags: [] }],
		["tag tag", { ...model, tags: [{ ...model.tags[0], tag: "#other" }] }],
		["tag color", { ...model, tags: [{ ...model.tags[0], color: "#abcdef" }] }],
	];
	for (const end of ["start", "end"] as const) {
		for (const field of ["line", "col", "offset"] as const) {
			changes.push([
				`position.${end}.${field}`,
				{
					...model,
					position: {
						...model.position,
						[end]: { ...model.position[end], [field]: model.position[end][field] + 1 },
					},
				},
			]);
		}
	}
	for (const [field, next] of changes) {
		await t.test(field, async (t) => {
			const row = rowHarness(t);
			await row.render(props);
			assert.equal(row.renders(), 1, "mount");
			const before = row.renders();
			await row.render({ ...props, model: next });
			assert.equal(row.renders() - before, 1, field);
		});
	}
});

test("TaskRow does not render for an equal model", async (t) => {
	const row = rowHarness(t);
	await row.render(props);
	assert.equal(row.renders(), 1, "mount");
	const equalModel: TaskRowModel = {
		...model,
		position: { start: { ...model.position.start }, end: { ...model.position.end } },
		badges: model.badges.map((badge) => ({ ...badge })),
		tags: model.tags.map((tag) => ({ ...tag })),
	};
	for (const [label, next] of [
		["same object", model],
		["new objects with equal values", equalModel],
	] as const) {
		const before = row.renders();
		await row.render({ ...props, model: next });
		assert.equal(row.renders() - before, 0, label);
	}
});

test("TaskRow renders again for a new callbacks, overlay or clock object", async (t) => {
	const changes: [string, TaskRowProps, TaskRowProps][] = [
		["callbacks", props, { ...props, callbacks: { ...callbacks } }],
		["equal overlay", props, { ...props, overlay: { ...overlay } }],
		["undefined to overlay", { ...props, overlay: undefined }, props],
		["clock", props, { ...props, clock: { ...props.clock } }],
	];
	for (const [label, initial, next] of changes) {
		await t.test(label, async (t) => {
			const row = rowHarness(t);
			await row.render(initial);
			assert.equal(row.renders(), 1, "mount");
			const before = row.renders();
			await row.render(next);
			assert.equal(row.renders() - before, 1, label);
		});
	}
});

test("TaskRow shows ⋯ only with a row menu on a mobile host", async (t) => {
	for (const isMobile of [false, true]) {
		for (const hasRowMenu of [false, true]) {
			await t.test(`mobile=${isMobile}, row menu=${hasRowMenu}`, async (t) => {
				const row = rowHarness(t, isMobile);
				await row.render({
					...props,
					callbacks: { ...callbacks, handleRowMenu: hasRowMenu ? callbacks.handleRowMenu : undefined },
				});
				const menu = row.container.querySelector(".info .menu");
				assert.equal(menu !== null, isMobile && hasRowMenu);
				if (menu) {
					assert.equal(menu.textContent, "⋯");
					assert.equal(menu.previousElementSibling, row.container.querySelector(".info .modify"));
				}
			});
		}
	}
});
