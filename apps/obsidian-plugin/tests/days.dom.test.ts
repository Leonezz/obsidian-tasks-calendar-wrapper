// A quick filter change renders only the days whose props change; moving days into packages/ui must keep this.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderedDays, rendersOf, resetRenderCounts } from "@tasks-calendar-wrapper/ui";
import { defaultUserOptions } from "../src/useroptions";
import { mountBridge } from "./component-harness";
import { notesApp, openView } from "./view-harness";

/** The view's bridge mounted in a real DOM, with its store already loaded. */
async function mountTimeline(t: TestContext, notes: Record<string, string>) {
	const app = notesApp(notes);
	Object.assign(app.vault, { getFileByPath: (path: string) => (path in notes ? { path } : null) });
	const opened = openView(app);
	await opened.view.onUpdateOptions({ ...defaultUserOptions });
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	const { bridge, element } = mountBridge({ plugin: { app } as never, store: opened.store, writer: opened.writer });
	await act(() => root.render(element));
	return { container, bridge };
}

test("a quick filter change renders exactly the days whose props change", async (t) => {
	const { container, bridge } = await mountTimeline(t, {
		"Today.md": "- [ ] today #work 📅 2026-01-15",
		"A.md": "- [ ] alpha #work 📅 2026-01-20",
		"B.md": "- [ ] beta kept #work 📅 2026-01-25",
		"C.md": "- [ ] beta removed #home 📅 2026-01-25",
		"D.md": "- [ ] gamma #home 📅 2026-01-27",
	});
	const texts = () => [...container.querySelectorAll(".task .content")].map((row) => row.textContent);
	assert.deepEqual(texts(), ["today", "alpha", "beta kept", "beta removed", "gamma"]);

	resetRenderCounts();
	await act(() => bridge.current!.handleFilterEnable(undefined, undefined, [], ["#work"]));
	assert.deepEqual(texts(), ["today", "alpha", "beta kept"]);
	assert.deepEqual(renderedDays(), ["2026-01-15", "2026-01-25"]);
	assert.equal(rendersOf("TaskItemView"), 0);
	// January 20 still lists alpha with the same task object, so its props compare equal despite the context change.
	assert.ok(!renderedDays().includes("2026-01-20"));

	resetRenderCounts();
	await act(() => bridge.current!.handleFilterEnable(undefined, undefined, [], []));
	assert.deepEqual(texts(), ["today", "alpha", "beta kept", "beta removed", "gamma"]);
	assert.deepEqual(renderedDays(), ["2026-01-15", "2026-01-25", "2026-01-27"]);
	assert.equal(rendersOf("TaskItemView"), 2);
	assert.ok(!renderedDays().includes("2026-01-20"));
});
