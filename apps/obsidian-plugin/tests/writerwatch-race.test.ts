import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { dayKey } from "@tasks-calendar-wrapper/core";
import type { TaskEdit, WriteResult } from "../timeline/src/taskwriter";
import { deferred, flush, writerHarness, type WriterHarness } from "./writer-harness";

const original = "- [ ] A";
const due = (day: string): TaskEdit => ({ kind: "date", field: "due", day: dayKey(moment(day)) });
const lost = (h: WriterHarness) => h.events.filter((event) => event.kind === "overwritten").map((event) => event.id);
function writtenId(result: WriteResult): number {
	assert.equal(result.kind, "written");
	if (result.kind !== "written" || !result.undo) throw new Error("expected an undo record");
	return result.undo.id;
}
function holdNextRead(h: WriterHarness) {
	const gate = deferred<string>();
	const read = h.app.vault.cachedRead;
	let waiting = true;
	h.app.vault.cachedRead = (file) => {
		if (waiting) {
			waiting = false;
			return gate.promise;
		}
		return read(file);
	};
	return gate;
}

test("a rename during the editor save reports the toggle written and its Undo follows the note", async (t) => {
	const before = "one\n- [ ] A\nend";
	const h = writerHarness({ "a.md": before });
	const view = h.view("a.md", "source");
	const writer = h.create();
	t.after(() => writer.dispose());
	view.beforeSave = () => h.rename("a.md", "b.md");
	const result = await h.write(h.target(1));
	assert.equal(result.kind, "written");
	assert.ok(result.kind === "written" && result.undo);
	assert.equal(result.undo.path, "b.md");
	assert.deepEqual(h.refusals, []);
	assert.equal(h.text("b.md"), `one\n- [x] A ✅ ${h.deps.today()}\nend`);
	assert.equal(view.editorText, h.text("b.md"));
	assert.equal(h.holds.get("a.md"), 0);
	assert.ok(h.dirty.includes("a.md") && h.dirty.includes("b.md"));
	assert.ok(h.events.some((event) => event.kind === "written" && event.path === "b.md"));
	view.beforeSave = undefined;
	assert.equal((await h.write(h.target(1, "b.md"), { kind: "undo", record: result.undo })).kind, "written");
	assert.equal(h.text("b.md"), before);
	assert.equal(view.editorText, before);
});

test("a rename after process applied the write reports it written", async (t) => {
	const h = writerHarness();
	const writer = h.create();
	t.after(() => writer.dispose());
	h.afterProcess(() => h.rename("a.md", "b.md"));
	const result = await h.write();
	assert.equal(result.kind, "written");
	assert.ok(result.kind === "written" && result.undo);
	assert.equal(result.undo.path, "b.md");
	assert.deepEqual(h.refusals, []);
	assert.equal(h.text("b.md"), `- [x] A ✅ ${h.deps.today()}`);
	assert.equal(h.holds.get("a.md"), 0);
	assert.ok(h.dirty.includes("a.md") && h.dirty.includes("b.md"));
	h.afterProcess();
	assert.equal((await h.write(h.target(0, "b.md"), { kind: "undo", record: result.undo })).kind, "written");
	assert.equal(h.text("b.md"), original);
});

test("a delete after the write was applied reports it written", async (t) => {
	const h = writerHarness();
	const writer = h.create();
	t.after(() => writer.dispose());
	h.afterProcess(() => h.remove());
	const result = await h.write();
	assert.equal(result.kind, "written");
	assert.ok(result.kind === "written" && result.undo);
	assert.deepEqual(h.writes, ["a.md"]);
	assert.equal(h.app.vault.getFileByPath("a.md"), null);
	assert.equal(h.holds.get("a.md"), 0);
	assert.ok(h.notices.every((text) => !text.includes("Nothing was written")));
	h.afterProcess();
	const undone = await h.write(h.target(), { kind: "undo", record: result.undo });
	assert.equal(undone.kind, "refused");
	assert.ok(undone.kind === "refused" && undone.reason === "moved-or-deleted");
});

test("a rename before the write still refuses moved-or-deleted", async (t) => {
	for (const boundary of ["cachedRead", "process"]) {
		const h = writerHarness();
		const writer = h.create();
		t.after(() => writer.dispose());
		if (boundary === "cachedRead") {
			const read = h.app.vault.cachedRead;
			h.app.vault.cachedRead = async (file) => {
				const text = await read(file);
				h.rename("a.md", "b.md");
				return text;
			};
		} else h.onProcess(() => h.rename("a.md", "b.md"));
		const result = await h.write();
		assert.equal(result.kind, "refused");
		assert.ok(result.kind === "refused" && result.reason === "moved-or-deleted");
		assert.equal(h.text("b.md"), original);
		assert.deepEqual(h.writes, []);
	}
});

test("an applied dialog edit follows a rename into the revert check", async (t) => {
	const h = writerHarness();
	let notSaved = 0;
	const writer = h.create({ notices: { ...h.deps.notices, editNotSaved: () => notSaved++ } });
	t.after(() => writer.dispose());
	h.afterProcess(() => h.rename("a.md", "b.md"));
	const result = await h.write(h.target(), { kind: "replace", expected: original, lines: ["- [ ] edited"] });
	const id = writtenId(result);
	assert.equal(notSaved, 0);
	await h.clock.advance(1000);
	h.put("b.md", original);
	h.changed("b.md", original);
	await flush();
	assert.deepEqual(lost(h), [id]);
	assert.equal(h.recoveries[0]?.context.path, "b.md");
	assert.equal(h.recoveries[0]?.editedLine, "- [ ] edited");
});

test("an applied write renamed while awaiting completion still times out with an unknown outcome", async (t) => {
	for (const source of [false, true]) {
		const h = writerHarness();
		const gate = deferred();
		const writer = h.create();
		t.after(() => writer.dispose());
		const wait = () => {
			h.rename("a.md", "b.md");
			return gate.promise;
		};
		if (source) h.view("a.md", "source").beforeSave = wait;
		else h.afterProcess(wait);
		const pending = h.write();
		await flush();
		await h.clock.advance(60_000);
		const result = await pending;
		assert.equal(result.kind, "failed");
		assert.ok(result.kind === "failed" && result.unknownOutcome);
		gate.resolve();
		await flush();
		assert.ok(h.events.every((event) => event.kind !== "written"));
		assert.deepEqual(h.refusals, []);
	}
});

test("a cachedRead check overlapped by a completed own write runs before that write updates expected", async () => {
	const h = writerHarness();
	const writer = h.create();
	const first = writtenId(await h.write(h.target(), due("2026-11-01")));
	await h.deliver();
	await h.clock.advance(1000);
	const gate = holdNextRead(h);
	h.changed("a.md", "metadata from another save");
	await flush();
	await h.write(h.target(), due("2026-11-02"));
	assert.deepEqual(lost(h), []);
	gate.resolve(original);
	await flush();
	assert.deepEqual(lost(h), [first]);
	assert.equal(h.reverts.length, 1);
	assert.match(h.text(), /2026-11-02/);
	writer.dispose();
});

test("a following own write waits for the preceding result's deferred check while another note can write", async () => {
	const h = writerHarness({ "a.md": original, "b.md": "- [ ] B" });
	const writer = h.create();
	const first = writtenId(await h.write(h.target(), due("2026-11-01")));
	await h.deliver();
	const gate = holdNextRead(h);
	h.changed("a.md", "metadata from another save");
	await flush();
	await h.write(h.target(), due("2026-11-02"));
	const next = h.write(h.target(), due("2026-11-03"));
	await flush();
	assert.equal(h.processCalls.filter((path) => path === "a.md").length, 2);
	assert.equal((await h.write(h.target(0, "b.md"))).kind, "written");
	gate.resolve(original);
	await next;
	await flush();
	assert.deepEqual(lost(h), [first]);
	assert.match(h.text(), /2026-11-03/);
	writer.dispose();
});

test("a rejected cachedRead cannot strand an overlapping write's result or the next write", async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write(h.target(), due("2026-11-01"));
	await h.deliver();
	const gate = holdNextRead(h);
	h.changed("a.md", "metadata from another save");
	await flush();
	await h.write(h.target(), due("2026-11-02"));
	const next = h.write(h.target(), due("2026-11-03"));
	gate.reject(new Error("cache unavailable"));
	assert.equal((await next).kind, "written");
	await flush();
	assert.deepEqual(lost(h), []);
	writer.dispose();
});
