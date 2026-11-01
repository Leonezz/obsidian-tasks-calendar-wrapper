import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred, flush, writerHarness } from "./writer-harness";

const explanation =
	"Nothing was written. If you completed this task in the dialog: Tasks returns nothing for a task set to delete itself, so use the checkbox to complete it.";

test("edit dialog that never settles locks nothing", async () => {
	const h = writerHarness({ "a.md": "- [ ] A\n- [ ] B" });
	let calls = 0;
	const w = h.create({
		tasksDialog: () => ({
			kind: "edit",
			edit: () => {
				calls++;
				return deferred<string>().promise;
			},
		}),
	});
	const listeners = h.modifyListeners();
	void w.editInTasksDialog(() => h.target());
	void w.editInTasksDialog(() => h.target());
	await flush();
	assert.equal(calls, 2);
	assert.equal(h.clock.count(), 0);
	assert.equal(h.modifyListeners(), listeners);
	assert.equal(h.holds.size, 0);
	assert.equal(h.events.length, 0);
	assert.equal((await h.write(h.target(1))).kind, "written");
	assert.ok(h.events.every((event) => event.line === 1));
	await h.clock.advance(0);
	w.dispose();
	assert.equal(h.clock.count(), 0);
});

test("empty result writes nothing", async () => {
	const h = writerHarness();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "" }) });
	assert.deepEqual(await w.editInTasksDialog(() => h.target()), { kind: "cancelled" });
	assert.equal(h.text(), "- [ ] A");
	assert.equal(h.events.length, 0);
	assert.deepEqual(h.notices, []);
	assert.deepEqual(h.processCalls, []);
	w.dispose();
});

test("🏁 delete with empty result explains", async () => {
	const h = writerHarness({ "a.md": "- [ ] A 🏁 delete" });
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "" }) });
	assert.deepEqual(await w.editInTasksDialog(() => h.target()), { kind: "cancelled" });
	assert.deepEqual(h.notices, [explanation]);
	assert.equal(h.events.length, 0);
	assert.deepEqual(h.writes, []);
	w.dispose();
});

test("pending only after Apply", async () => {
	const h = writerHarness();
	const apply = deferred<string>();
	let reads = 0;
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: () => apply.promise }) });
	const pending = w.editInTasksDialog(() => {
		reads++;
		return h.target();
	});
	await flush();
	assert.equal(reads, 1);
	assert.equal(h.events.length, 0);
	assert.equal(h.clock.count(), 0);
	assert.equal(h.holds.size, 0);
	apply.resolve("- [ ] A edited");
	assert.equal((await pending).kind, "written");
	assert.equal(h.events[0]?.kind, "pending");
	w.dispose();
});

test("edit is checked against the dialog input", async () => {
	const h = writerHarness();
	const apply = deferred<string>();
	const original = h.target();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: () => apply.promise }) });
	const pending = w.editInTasksDialog(() => original);
	h.put("a.md", "- [ ] A changed elsewhere");
	apply.resolve("- [ ] A edited");
	const result = await pending;
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "line-changed");
	assert.equal(h.text(), "- [ ] A changed elsewhere");
	assert.equal(h.unsavedEdits[0]?.editedLine, "- [ ] A edited");
	w.dispose();
});

test("two dialogs on one task", async () => {
	const h = writerHarness();
	const replies = [deferred<string>(), deferred<string>()];
	let calls = 0;
	const target = h.target();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: () => replies[calls++].promise }) });
	const first = w.editInTasksDialog(() => target);
	const second = w.editInTasksDialog(() => target);
	replies[0].resolve("- [ ] First edit");
	assert.equal((await first).kind, "written");
	await h.deliver();
	replies[1].resolve("- [ ] Second edit");
	const result = await second;
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "line-changed");
	assert.equal(h.text(), "- [ ] First edit");
	assert.equal(h.unsavedEdits[0]?.editedLine, "- [ ] Second edit");
	w.dispose();
});

test("dialog rejection", async () => {
	for (const output of ["not a task", "- [ ] One\n- [ ] Two\n- [ ] Three", 42]) {
		const h = writerHarness();
		const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => output as never }) });
		const result = await w.editInTasksDialog(() => h.target());
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, "bad-output");
		assert.equal(h.refusals[0]?.reason, "bad-output");
		assert.equal(h.unsavedEdits.length, 1);
		if (typeof output === "string") assert.equal(h.unsavedEdits[0]?.editedLine, output);
		assert.equal(h.events.length, 0);
		assert.deepEqual(h.writes, []);
		w.dispose();
	}
});

test("recurrence removed, confirmed / declined", async () => {
	for (const confirmed of [true, false]) {
		const expected = "- [ ] A 🔁 every day";
		const h = writerHarness({ "a.md": expected });
		let confirms = 0;
		const w = h.create({
			tasksDialog: () => ({ kind: "edit", edit: async () => "- [ ] A edited" }),
			confirm: async (options) => {
				confirms++;
				assert.deepEqual(options, {
					title: "Remove recurrence?",
					message: `The edited task no longer repeats. If you cleared Recurs, save it. If you did not, Tasks could not read the rule in “${expected}” and dropped it.`,
					confirmText: "Save without recurrence",
					focusCancel: true,
				});
				assert.equal(h.events.length, 0);
				return confirmed;
			},
		});
		assert.equal((await w.editInTasksDialog(() => h.target())).kind, confirmed ? "written" : "cancelled");
		assert.equal(confirms, 1);
		assert.equal(h.text(), confirmed ? "- [ ] A edited" : expected);
		assert.equal(h.unsavedEdits.length, confirmed ? 0 : 1);
		if (!confirmed) {
			assert.equal(h.unsavedEdits[0]?.editedLine, "- [ ] A edited");
			assert.equal(h.events.length, 0);
		}
		w.dispose();
	}
});

test("dependency edit waits for quiet", async () => {
	const h = writerHarness();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "- [ ] A ⛔ abc123" }) });
	const listeners = h.modifyListeners();
	const pending = w.editInTasksDialog(() => h.target());
	await h.clock.advance(1400);
	assert.deepEqual(h.processCalls, []);
	assert.equal(h.events.length, 0);
	assert.equal(h.holds.size, 0);
	h.app.vault.trigger("modify", h.app.vault.getFileByPath("a.md"));
	await h.clock.advance(1499);
	assert.deepEqual(h.processCalls, []);
	await h.clock.advance(1);
	assert.equal((await pending).kind, "written");
	assert.equal(h.processCalls.length, 1);
	assert.equal(h.modifyListeners(), listeners);
	w.dispose();
});

test("native digits from the dialog are refused", async () => {
	const h = writerHarness();
	const output = "- [ ] A 📅 ۲۰۲۶-۱۱-۰۱";
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => output }), locale: () => "fa" });
	const result = await w.editInTasksDialog(() => h.target());
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") {
		assert.equal(result.reason, "unreadable-date");
		assert.equal(
			result.message,
			"“A” would get a date the timeline cannot read back (“۲۰۲۶-۱۱-۰۱”). Nothing was written. Tasks wrote it in the digits of Obsidian's language (fa).",
		);
	}
	assert.equal(h.unsavedEdits[0]?.editedLine, output);
	assert.equal(h.events.length, 0);
	assert.deepEqual(h.writes, []);
	w.dispose();
});

test("dialog throws on open", async () => {
	for (const rejected of [false, true]) {
		const h = writerHarness();
		const error = new Error("cannot open");
		const w = h.create({
			tasksDialog: () => ({
				kind: "edit",
				edit: () => {
					if (rejected) return Promise.reject(error);
					throw error;
				},
			}),
		});
		assert.deepEqual(await w.editInTasksDialog(() => h.target()), { kind: "failed", unknownOutcome: false, error });
		assert.deepEqual(h.notices, ["Tasks' edit dialog failed: cannot open"]);
		assert.equal(h.errors.length, 1);
		assert.deepEqual(h.unsavedEdits, []);
		assert.equal(h.events.length, 0);
		assert.deepEqual(h.writes, []);
		w.dispose();
	}
});

test("failed dialog write opens Edit not saved", async () => {
	for (const failure of ["process", "save"]) {
		const h = writerHarness();
		const fail = () => {
			throw new Error("disk unavailable");
		};
		if (failure === "process") h.onProcess(fail);
		else {
			const view = h.view();
			view.type("- [ ] A\nunsaved text");
			view.beforeSave = fail;
		}
		const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "- [ ] A edited" }) });
		assert.equal((await w.editInTasksDialog(() => h.target())).kind, "failed");
		assert.equal(h.unsavedEdits[0]?.editedLine, "- [ ] A edited");
		assert.deepEqual(h.notices, ["Could not write to a: disk unavailable"]);
		w.dispose();
	}
});

test("delete marker is matched in any case and in Dataview form", async () => {
	for (const marker of [
		"🏁 DELETE",
		"🏁️\tDeLeTe",
		"🏁delete",
		"[ onCompletion :: DELETE ]",
		"( onCompletion :: delete )",
		"%% 🏁 delete %%",
		"%%[onCompletion:: delete]%%",
	]) {
		const h = writerHarness({ "a.md": `- [ ] A ${marker}` });
		const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "" }) });
		assert.deepEqual(await w.editInTasksDialog(() => h.target()), { kind: "cancelled" });
		assert.deepEqual(h.notices, marker.startsWith("%%") ? [] : [explanation]);
		assert.equal(h.events.length, 0);
		w.dispose();
	}
});

test("certain refusals are checked before the dialog opens", async () => {
	for (const reason of ["queue-blocked", "not-reread", "moved-or-deleted", "not-task-line"] as const) {
		const h = writerHarness();
		let calls = 0;
		const w = h.create({
			tasksDialog: () => ({
				kind: "edit",
				edit: async () => {
					calls++;
					return "- [ ] edit";
				},
			}),
		});
		if (reason === "queue-blocked") {
			h.onProcess(() => deferred().promise);
			const write = h.write();
			await h.clock.advance(60_000);
			await write;
		} else if (reason === "not-reread") {
			await h.write();
			await h.clock.advance(10_000);
		} else if (reason === "moved-or-deleted") h.remove();
		const events = h.events.length;
		const dirty = h.dirty.length;
		const result = await w.editInTasksDialog(() =>
			h.target(0, "a.md", reason === "not-task-line" ? "plain text" : "- [ ] A"),
		);
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, reason);
		assert.equal(calls, 0);
		assert.equal(h.refusals.at(-1)?.context.action, "replace");
		assert.equal(h.events.length, events);
		assert.equal(h.dirty.length, dirty);
		assert.deepEqual(h.unsavedEdits, []);
		w.dispose();
	}
});

test("Tasks older than 7.21 opens the note and says so", async () => {
	const h = writerHarness({ "a.md": "header\n- [ ] A" });
	const w = h.create({ tasksDialog: () => ({ kind: "too-old" }) });
	assert.deepEqual(await w.editInTasksDialog(() => h.target(1)), {
		kind: "refused",
		reason: "tasks-too-old",
		message: "Tasks 7.21 or later edits here",
	});
	assert.deepEqual(h.opened, [{ path: "a.md", line: 1 }]);
	assert.deepEqual(h.notices, ["Tasks 7.21 or later edits here"]);
	assert.equal(h.events.length, 0);
	w.dispose();
});

test("unreachable Tasks API reports the error", async () => {
	const h = writerHarness();
	const error = new Error("getter failed");
	const w = h.create({ tasksDialog: () => ({ kind: "error", error }) });
	assert.deepEqual(await w.editInTasksDialog(() => h.target()), {
		kind: "refused",
		reason: "tasks-error",
		message: "Could not reach the Tasks plugin: getter failed",
	});
	assert.deepEqual(h.notices, ["Could not reach the Tasks plugin: getter failed"]);
	assert.equal(h.errors.length, 1);
	assert.equal(h.events.length, 0);
	assert.deepEqual(h.opened, []);
	w.dispose();
});

test("a replace whose latest target differs from expected is refused line-changed", async () => {
	const h = writerHarness();
	const w = h.create();
	const result = await w.write(() => h.target(0, "a.md", "- [ ] latest model"), {
		kind: "replace",
		expected: "- [ ] A",
		lines: ["- [ ] edited"],
	});
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "line-changed");
	assert.equal(h.unsavedEdits[0]?.editedLine, "- [ ] edited");
	assert.deepEqual(h.processCalls, []);
	assert.equal(h.text(), "- [ ] A");
	w.dispose();
});

test("a written dialog edit's pending event has action replace", async () => {
	const h = writerHarness();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "- [x] A edited" }) });
	assert.equal((await w.editInTasksDialog(() => h.target())).kind, "written");
	assert.equal(h.events.find((event) => event.kind === "pending")?.action, "replace");
	w.dispose();
});
