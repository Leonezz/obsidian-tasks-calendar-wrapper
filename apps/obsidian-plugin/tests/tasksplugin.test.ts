import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import moment from "moment";
import "moment/locale/fa";
import { canEditInTasksDialog, getTasksDialog, getTasksToggle } from "../timeline/src/tasksplugin";
import { writerHarness } from "./writer-harness";

/** Only the private registry is needed by the capability reader. */
function appWith(apiV1: unknown): App {
	return { plugins: { plugins: { "obsidian-tasks-plugin": { apiV1 } } } } as unknown as App;
}

test("the dialog accessor reads none, too-old, error and edit afresh each call", () => {
	const registry: Record<string, unknown> = {};
	const app = { plugins: { plugins: registry } } as unknown as App;
	assert.deepEqual(getTasksDialog(app), { kind: "none" });
	registry["obsidian-tasks-plugin"] = { apiV1: {} };
	assert.deepEqual(getTasksDialog(app), { kind: "too-old" });
	for (const value of [undefined, null, false, "edit", 1]) {
		registry["obsidian-tasks-plugin"] = { apiV1: { editTaskLineModal: value } };
		const dialog = getTasksDialog(app);
		assert.equal(dialog.kind, "error");
		if (dialog.kind === "error") {
			assert.equal(
				String(dialog.error),
				"Error: Malformed Tasks plugin API: editTaskLineModal is not a function.",
			);
		}
	}
	registry["obsidian-tasks-plugin"] = { apiV1: { editTaskLineModal: () => Promise.resolve("") } };
	const dialog = getTasksDialog(app);
	assert.equal(dialog.kind, "edit");
	assert.equal(Object.isFrozen(dialog), true);
	delete registry["obsidian-tasks-plugin"];
	assert.deepEqual(getTasksDialog(app), { kind: "none" });
});

test("the dialog accessor reports a throwing API or method getter", () => {
	const error = new Error("dialog unavailable");
	const throws = {
		get: () => {
			throw error;
		},
	};
	const entry = Object.defineProperty({}, "apiV1", throws);
	const app = { plugins: { plugins: { "obsidian-tasks-plugin": entry } } } as unknown as App;
	assert.deepEqual(getTasksDialog(app), { kind: "error", error });
	assert.deepEqual(getTasksDialog(appWith(Object.defineProperty({}, "editTaskLineModal", throws))), {
		kind: "error",
		error,
	});
});

test("the dialog edit calls apiV1 as a method with the line and returns its promise", async () => {
	const answer = Promise.resolve("- [ ] Edited");
	const calls: unknown[][] = [];
	const api = {
		editTaskLineModal(line: string): Promise<string> {
			calls.push([this, line]);
			return answer;
		},
	};
	const dialog = getTasksDialog(appWith(api));
	if (dialog.kind !== "edit") assert.fail("edit capability expected");
	assert.equal(dialog.edit("- [ ] Original"), answer);
	assert.deepEqual(calls, [[api, "- [ ] Original"]]);
	assert.equal(await answer, "- [ ] Edited");
});

test("a synchronous throw from the dialog edit propagates to its caller", () => {
	const error = new Error("could not open");
	const dialog = getTasksDialog(
		appWith({
			editTaskLineModal: () => {
				throw error;
			},
		}),
	);
	if (dialog.kind !== "edit") assert.fail("edit capability expected");
	assert.throws(
		() => dialog.edit("- [ ] A"),
		(caught) => caught === error,
	);
});

test('app.plugins missing, a malformed entry, apiV1 not an object or the function not a function → explicit refusal, never "not installed"', async () => {
	const malformed = [
		{},
		{ plugins: null },
		{ plugins: [] },
		{ plugins: {} },
		{ plugins: { plugins: null } },
		{ plugins: { plugins: [] } },
		{ plugins: { plugins: { "obsidian-tasks-plugin": null } } },
		{ plugins: { plugins: { "obsidian-tasks-plugin": undefined } } },
		{ plugins: { plugins: { "obsidian-tasks-plugin": false } } },
		{ plugins: { plugins: { "obsidian-tasks-plugin": [] } } },
		appWith(undefined),
		appWith(null),
		appWith([]),
		appWith("api"),
		appWith({ executeToggleTaskDoneCommand: undefined, editTaskLineModal: undefined }),
		appWith({ executeToggleTaskDoneCommand: null, editTaskLineModal: null }),
		appWith({ executeToggleTaskDoneCommand: "toggle", editTaskLineModal: "edit" }),
	];
	for (const candidate of malformed) {
		const app = candidate as App;
		const toggle = getTasksToggle(app, moment);
		const edit = canEditInTasksDialog(app);
		assert.equal(toggle.kind, "error");
		assert.equal(edit.kind, "error");
		if (toggle.kind === "error") assert.match(String(toggle.error), /Malformed Tasks plugin API:/);
		const h = writerHarness();
		const writer = h.create({ tasks: () => getTasksToggle(app, moment) });
		const result = await h.write();
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, "tasks-error");
		assert.equal(h.processCalls.length, 0);
		assert.equal(h.text(), "- [ ] A");
		writer.dispose();
	}
});

test("a read that throws is a refusal showing the error", async () => {
	const error = new Error("private registry unavailable");
	for (const depth of ["plugins", "registry", "entry", "apiV1", "method"]) {
		const app = { plugins: { plugins: { "obsidian-tasks-plugin": { apiV1: {} } } } };
		const objects: Record<string, [object, string]> = {
			plugins: [app, "plugins"],
			registry: [app.plugins, "plugins"],
			entry: [app.plugins.plugins, "obsidian-tasks-plugin"],
			apiV1: [app.plugins.plugins["obsidian-tasks-plugin"], "apiV1"],
			method: [app.plugins.plugins["obsidian-tasks-plugin"].apiV1, "executeToggleTaskDoneCommand"],
		};
		const [object, key] = objects[depth];
		Object.defineProperty(object, key, {
			get: () => {
				throw error;
			},
		});
		assert.deepEqual(getTasksToggle(app as unknown as App, moment), { kind: "error", error });
		if (depth !== "method") assert.deepEqual(canEditInTasksDialog(app as unknown as App), { kind: "error", error });
		const h = writerHarness();
		const writer = h.create({ tasks: () => getTasksToggle(app as unknown as App, moment) });
		const result = await h.write();
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, "tasks-error");
		assert.deepEqual(h.notices, ["Tasks could not change “A”: private registry unavailable. Nothing was written."]);
		assert.equal(h.processCalls.length, 0);
		writer.dispose();
	}
	const api = Object.defineProperty({}, "editTaskLineModal", {
		get: () => {
			throw error;
		},
	});
	assert.deepEqual(canEditInTasksDialog(appWith(api)), { kind: "error", error });
});

test("Tasks without executeToggleTaskDoneCommand is too old: the note opens at the task with the notice", async () => {
	assert.deepEqual(getTasksToggle(appWith({}), moment), { kind: "too-old" });
	assert.deepEqual(canEditInTasksDialog(appWith({})), { kind: "too-old" });
	const h = writerHarness();
	const writer = h.create({ tasks: () => getTasksToggle(appWith({}), moment) });
	const result = await h.write();
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "tasks-too-old");
	assert.deepEqual(h.opened, [{ path: "a.md", line: 0 }]);
	assert.deepEqual(h.notices, [
		"Completing from the timeline needs Tasks 7.2.0 or newer, so the note was opened at the task.",
	]);
	assert.equal(h.processCalls.length, 0);
	writer.dispose();
});

test("capabilities are read fresh, absent Tasks is none, and version numbers do not decide", () => {
	const registry: Record<string, unknown> = {};
	const app = { plugins: { plugins: registry } } as unknown as App;
	assert.deepEqual(getTasksToggle(app, moment), { kind: "none" });
	assert.deepEqual(canEditInTasksDialog(app), { kind: "none" });
	registry["obsidian-tasks-plugin"] = {
		manifest: { version: "0.0.1" },
		apiV1: { executeToggleTaskDoneCommand: () => "- [x] A", editTaskLineModal: () => "" },
	};
	const toggle = getTasksToggle(app, moment);
	assert.equal(toggle.kind, "toggle");
	assert.equal(Object.isFrozen(toggle), true);
	assert.deepEqual(canEditInTasksDialog(app), { kind: "edit" });
	if (toggle.kind === "toggle") assert.equal(toggle.toggle("- [ ] A", "a.md"), "- [x] A");
	registry["obsidian-tasks-plugin"] = { apiV1: {}, manifest: { version: "999.0.0" } };
	assert.deepEqual(getTasksToggle(app, moment), { kind: "too-old" });
	delete registry["obsidian-tasks-plugin"];
	assert.deepEqual(getTasksToggle(app, moment), { kind: "none" });
});

test("with moment.locale('fa') the fake Tasks sees locale 'en', writes ASCII, locale restored to 'fa'; restored also when Tasks throws", () => {
	const previous = moment.locale();
	try {
		moment.locale("fa");
		const calls: unknown[][] = [];
		const api = {
			executeToggleTaskDoneCommand(line: string, path: string): string {
				calls.push([this, line, path, moment.locale()]);
				return `- [x] A ✅ ${moment("2026-10-24").format("YYYY-MM-DD")}`;
			},
		};
		const capability = getTasksToggle(appWith(api), moment);
		assert.equal(capability.kind, "toggle");
		if (capability.kind !== "toggle") assert.fail("toggle capability expected");
		assert.equal(capability.toggle("- [ ] A", "Home/a.md"), "- [x] A ✅ 2026-10-24");
		assert.deepEqual(calls, [[api, "- [ ] A", "Home/a.md", "en"]]);
		assert.equal(moment.locale(), "fa");
		const error = new Error("Tasks failed");
		const throwing = getTasksToggle(
			appWith({
				executeToggleTaskDoneCommand: () => {
					assert.equal(moment.locale(), "en");
					throw error;
				},
			}),
			moment,
		);
		assert.equal(throwing.kind, "toggle");
		if (throwing.kind !== "toggle") assert.fail("toggle capability expected");
		assert.throws(
			() => throwing.toggle("- [ ] A", "a.md"),
			(caught) => caught === error,
		);
		assert.equal(moment.locale(), "fa");
	} finally {
		moment.locale(previous);
	}
});
