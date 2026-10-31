import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred, flush, writerHarness } from "./writer-harness";

test("Tasks disabled after rendering opens the task without a notice", async () => {
	const h = writerHarness({ "a.md": "header\n- [ ] A" });
	const w = h.create();
	assert.deepEqual(await w.editInTasksDialog(() => h.target(1)), { kind: "cancelled" });
	assert.deepEqual(h.opened, [{ path: "a.md", line: 1 }]);
	assert.deepEqual(h.notices, []);
	assert.equal(h.events.length, 0);
	w.dispose();
});

test("a failed dialog fallback reports the usual open-note failure", async () => {
	for (const kind of ["none", "too-old"] as const) {
		const h = writerHarness();
		const error = new Error("note unavailable");
		const w = h.create({
			tasksDialog: () => ({ kind }),
			openNote: () => {
				throw error;
			},
		});
		assert.deepEqual(await w.editInTasksDialog(() => h.target()), { kind: "failed", unknownOutcome: false, error });
		assert.equal(h.errors.length, 1);
		assert.deepEqual(h.notices, ["Could not write to a: note unavailable"]);
		assert.equal(h.events.length, 0);
		assert.deepEqual(h.unsavedEdits, []);
		w.dispose();
	}
});

test("dispose prevents both a new dialog and a late Apply", async () => {
	const h = writerHarness();
	const apply = deferred<string>();
	let calls = 0;
	const w = h.create({
		tasksDialog: () => {
			calls++;
			return { kind: "edit", edit: () => apply.promise };
		},
	});
	const pending = w.editInTasksDialog(() => h.target());
	w.dispose();
	apply.resolve("- [ ] A edited");
	for (const result of [await pending, await w.editInTasksDialog(() => h.target())]) {
		assert.equal(result.kind, "failed");
		if (result.kind === "failed") {
			assert.equal(result.unknownOutcome, false);
			assert.equal((result.error as Error).message, "The plugin unloaded.");
		}
	}
	assert.equal(calls, 1);
	assert.equal(h.events.length, 0);
	assert.deepEqual(h.writes, []);
	assert.equal(h.clock.count(), 0);
	assert.equal(h.modifyListeners(), 0);
});

test("dispose removes dependency timers and listener and settles the wait", async () => {
	const h = writerHarness();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "- [ ] A 🆔 abc123" }) });
	const pending = w.editInTasksDialog(() => h.target());
	await flush();
	assert.equal(h.clock.count(), 2);
	w.dispose();
	const result = await pending;
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal((result.error as Error).message, "The plugin unloaded.");
	assert.equal(h.clock.count(), 0);
	assert.equal(h.modifyListeners(), 0);
	assert.equal(h.events.length, 0);
	assert.deepEqual(h.writes, []);
});

test("dependency quiet wait reaches its five-second cap while the note keeps changing", async () => {
	const h = writerHarness();
	const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => "- [ ] A ⛔ abc123" }) });
	const pending = w.editInTasksDialog(() => h.target());
	for (let second = 0; second < 4; second++) {
		await h.clock.advance(1000);
		h.app.vault.trigger("modify", h.app.vault.getFileByPath("a.md"));
	}
	await h.clock.advance(999);
	assert.deepEqual(h.processCalls, []);
	await h.clock.advance(1);
	assert.equal((await pending).kind, "written");
	assert.equal(h.processCalls.length, 1);
	w.dispose();
});

test("dependency changes in emoji and Dataview forms wait outside the note queue", async () => {
	for (const marker of [
		"🆔️ abc123",
		"⛔️ abc123, def456",
		"[ id :: abc123 ]",
		"(id:: abc123)",
		"[dependsOn:: abc123, def456]",
		"( dependsOn :: abc123 )",
	]) {
		const h = writerHarness({ "a.md": "- [ ] A\n- [ ] B" });
		const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => `- [ ] A ${marker}` }) });
		const pending = w.editInTasksDialog(() => h.target());
		await flush();
		assert.deepEqual(h.processCalls, []);
		assert.equal((await h.write(h.target(1))).kind, "written");
		assert.ok(h.events.every((event) => event.line === 1));
		await h.clock.advance(1500);
		assert.equal((await pending).kind, "written");
		w.dispose();
	}
});

test("dependency quiet wait starts after confirmation and ignores other notes", async () => {
	const h = writerHarness({ "a.md": "- [ ] A 🔁 every day", "b.md": "- [ ] B" });
	const confirm = deferred<boolean>();
	const w = h.create({
		tasksDialog: () => ({ kind: "edit", edit: async () => "- [ ] A ⛔ abc123" }),
		confirm: () => confirm.promise,
	});
	const pending = w.editInTasksDialog(() => h.target());
	await h.clock.advance(8000);
	assert.equal(h.events.length, 0);
	assert.equal(h.clock.count(), 0);
	confirm.resolve(true);
	await h.clock.advance(1400);
	h.app.vault.trigger("modify", h.app.vault.getFileByPath("b.md"));
	await h.clock.advance(100);
	assert.equal((await pending).kind, "written");
	w.dispose();
});

test("unchanged dependency values and commented markers do not delay edits", async () => {
	for (const [before, after] of [
		["- [ ] A 🆔 abc123 ⛔ def456", "- [ ] A edited 🆔 abc123 ⛔ def456"],
		["- [ ] A", "- [ ] A edited %% 🆔 abc123 ⛔ def456 %%"],
	]) {
		const h = writerHarness({ "a.md": before });
		const w = h.create({ tasksDialog: () => ({ kind: "edit", edit: async () => after }) });
		assert.equal((await w.editInTasksDialog(() => h.target())).kind, "written");
		assert.equal(h.clock.now, 0);
		w.dispose();
	}
});

test("the dialog receives a BOM-free line and can repair an impossible date", async () => {
	const h = writerHarness({ "a.md": "\uFEFF- [ ] A 📅 2026-02-30" });
	let input = "";
	const w = h.create({
		tasksDialog: () => ({
			kind: "edit",
			edit: async (line) => {
				input = line;
				return "- [ ] A 📅 2026-02-28";
			},
		}),
	});
	assert.equal((await w.editInTasksDialog(() => h.target())).kind, "written");
	assert.equal(input, "- [ ] A 📅 2026-02-30");
	assert.equal(h.text(), "\uFEFF- [ ] A 📅 2026-02-28");
	w.dispose();
});
