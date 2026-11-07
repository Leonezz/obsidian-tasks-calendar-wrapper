// Pins handlers-context changes to one TaskRow render per row and no TaskItemView render.
// Merging the row components into one TaskItem must preserve these counts.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { parseTaskLine } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions } from "../src/useroptions";
import { TaskItemEventHandlersContext } from "@tasks-calendar-wrapper/ui";
import { createPendingWrites } from "../timeline/src/pendingwrites";
import { moment } from "../utils/moment";
import { countRenders, mountView, timelineElement } from "./component-harness";
import { notesApp } from "./view-harness";

test("a new handlers value re-renders every TaskRow once and records no TaskItemView render", async (t) => {
	const counts = countRenders(t);
	// snapshot() also requires the bridge's QuickEntry provider record.
	const view = await mountView(t, { app: notesApp({}) });
	await view.unmount();
	const tasks = ["alpha", "beta"].map((name) => {
		const task = parseTaskLine(`- [ ] ${name} 📅 2026-01-20`, { moment, path: `${name}.md` });
		assert.ok(task);
		return task;
	});
	const userOptions = { ...defaultUserOptions, hideStatusTasks: [] };
	const pendingWrites = createPendingWrites();
	const callbacks = {
		handleOpenFile: () => {},
		handleCompleteTask: () => {},
		handleTagClick: () => {},
		handleModifyTask: undefined,
		handleRowMenu: undefined,
		handleDateBadge: undefined,
	};
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		await act(() => root.unmount());
		container.remove();
	});
	const timeline = timelineElement({ tasks, userOptions, pendingWrites });
	const render = (value: typeof callbacks) =>
		root.render(createElement(TaskItemEventHandlersContext.Provider, { value }, timeline));
	await act(() => render(callbacks));
	assert.equal(container.querySelectorAll(".task").length, 2);

	counts.reset();
	await act(() => render({ ...callbacks }));
	const renders: Record<string, number> = counts.snapshot().renders;
	assert.equal(renders.TaskRow, 2);
	assert.equal(renders.TaskItemView, 0);
	assert.equal(renders.DateView, 0);
});
