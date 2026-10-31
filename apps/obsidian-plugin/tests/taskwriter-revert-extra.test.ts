import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { dayKey } from "@tasks-calendar-wrapper/core";
import type { TaskEdit, UndoRecord, WriteResult } from "../timeline/src/taskwriter";
import { deferred, flush, writerHarness, type WriterHarness } from "./writer-harness";

const original = "- [ ] A";
const due = (day: string): TaskEdit => ({ kind: "date", field: "due", day: dayKey(moment(day)) });
const lost = (h: WriterHarness) => h.events.filter((event) => event.kind === "overwritten").map((event) => event.id);
function record(result: WriteResult): UndoRecord {
	assert.equal(result.kind, "written");
	if (result.kind !== "written" || !result.undo) throw new Error("expected undo record");
	return result.undo;
}
async function stale(h: WriterHarness, text: string): Promise<void> {
	h.put("a.md", text);
	h.changed("a.md", text);
	await flush();
}

test("W2 starts 150 ms after W1 and hangs 60 s, W1's changed at 0.3 s, a stale copy at 2 s → report W1; same when W2 is written at 5.5 s", async () => {
	for (const timeout of [false, true]) {
		const initial = `${original}\n- [ ] B`;
		const h = writerHarness({ "a.md": initial });
		const writer = h.create();
		const first = record(await h.write());
		const written = h.text();
		await h.clock.advance(150);
		const gate = deferred();
		h.onProcess(() => gate.promise);
		const second = h.write(h.target(1));
		await flush();
		await h.clock.advance(150);
		h.changed("a.md", written);
		await flush();
		await h.clock.advance(1700);
		await stale(h, initial);
		assert.deepEqual(lost(h), []);
		await h.clock.advance(timeout ? 58_150 : 3500);
		if (!timeout) gate.resolve();
		await second;
		await flush();
		assert.deepEqual(lost(h), [first.id]);
		assert.equal(h.reverts.length, 1);
		gate.resolve();
		writer.dispose();
	}
});

test("timer-triggered checks judge the window at the scheduled moment (late timer)", async () => {
	const h = writerHarness();
	const writer = h.create();
	const write = record(await h.write());
	await h.deliver();
	await h.clock.advance(4900);
	h.put("a.md", original);
	h.clock.elapse(6000);
	await h.clock.advance(0);
	assert.deepEqual(lost(h), [write.id]);
	writer.dispose();
});

test("an Undo that re-inserted a 🏁 line, then that line changed and toggled again (deleted) → its P no longer matches by neighbours", async () => {
	const task = "- [ ] A 🏁 delete";
	const h = writerHarness({ "a.md": `above\n${task}\nbelow` });
	const writer = h.create({ tasks: () => ({ kind: "toggle", toggle: () => "" }) });
	const first = record(await h.write(h.target(1)));
	await h.write(h.target(1), { kind: "undo", record: first });
	await h.deliver();
	await h.write(h.target(1), due("2026-11-01"));
	await h.write(h.target(1));
	await h.deliver();
	assert.equal(h.text(), "above\nbelow");
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("with two source views read the one the writer used; differing getValue() skips and retries after 50 ms", async () => {
	const h = writerHarness();
	const used = h.view("a.md", "source");
	const split = h.view("a.md", "source");
	const writer = h.create();
	const write = record(await h.write());
	assert.equal(used.transactions.length, 1);
	assert.equal(split.transactions.length, 0);
	h.changed("a.md", original);
	await flush();
	assert.deepEqual(lost(h), []);
	used.type(original);
	h.cache.set("a.md", original);
	await h.clock.advance(49);
	assert.deepEqual(lost(h), []);
	await h.clock.advance(1);
	assert.deepEqual(lost(h), [write.id]);
	assert.ok(used.reads.includes("getValue"));
	assert.ok(split.reads.includes("getValue"));
	writer.dispose();
});

test("an editor write counts as indexed only when a changed brings the counts back to expected", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const write = record(await h.write());
	view.mode = "preview";
	await h.clock.advance(8000);
	h.put("a.md", `${original}\nexternal`);
	h.changed("a.md", `${original}\nexternal`);
	await flush();
	assert.deepEqual(lost(h), []);
	await h.clock.advance(2000);
	assert.deepEqual(lost(h), [write.id]);
	writer.dispose();
	const ok = writerHarness();
	const source = ok.view("a.md", "source");
	const w = ok.create();
	const done = record(await ok.write());
	ok.changed("a.md", `${ok.text()}\nexternal`);
	await flush();
	source.mode = "preview";
	await stale(ok, original);
	assert.deepEqual(lost(ok), [done.id]);
	w.dispose();
});

test("changed with some P's text while cachedRead also has that P releases as other text", async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write();
	await h.clock.advance(70_000);
	await stale(h, original);
	assert.equal(h.holds.get("a.md"), 0);
	assert.equal(h.releases.length, 1);
	writer.dispose();
});

test("closing a popout while a write is held does not lose the writer's timers", async () => {
	const h = writerHarness();
	h.view("a.md", "source");
	const writer = h.create();
	await h.write();
	h.leaves.length = 0;
	h.views.length = 0;
	await h.clock.advance(10_000);
	assert.ok(h.notices.some((text) => text.startsWith("Saved in a.")));
	assert.equal(h.holds.get("a.md"), 1);
	await h.clock.advance(110_000);
	assert.equal(h.holds.get("a.md"), 0);
	assert.equal(h.warnings.length, 1);
	writer.dispose();
});

test("Undo checks the written lines first, already-undone only when they are not in place; three identical 🏁 lines", async () => {
	const task = "- [ ] Take pill 🏁 delete";
	const initial = `above\n${task}\n${task}\n${task}\nbelow`;
	const h = writerHarness({ "a.md": initial });
	const writer = h.create({ tasks: () => ({ kind: "toggle", toggle: () => "" }) });
	const handle = record(await h.write(h.target(2)));
	const result = await h.write(h.target(2), { kind: "undo", record: handle });
	assert.equal(result.kind, "written");
	assert.equal(h.text(), initial);
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("review case (a)", async () => {
	const initial = `${original} 📅 2026-10-30\nx`;
	const h = writerHarness({ "a.md": initial });
	const writer = h.create();
	const first = record(await h.write(h.target(), due("2026-10-31")));
	await h.deliver();
	await h.clock.advance(5500);
	const second = record(await h.write(h.target(), due("2026-11-01")));
	await stale(h, initial);
	assert.deepEqual(lost(h), [first.id, second.id]);
	writer.dispose();
});

test("review case (a2)", async () => {
	const initial = `${original} 📅 2026-10-30\n- [ ] B\nx`;
	const h = writerHarness({ "a.md": initial });
	const writer = h.create();
	await h.write(h.target(), due("2026-10-31"));
	await h.deliver();
	await h.clock.advance(5500);
	const second = record(await h.write(h.target(1)));
	await stale(h, initial);
	assert.deepEqual(lost(h), [second.id]);
	writer.dispose();
});

test("review case (b)", async () => {
	const initial = `${original} 📅 2026-10-30\nx`;
	const h = writerHarness({ "a.md": initial });
	const view = h.view("a.md", "source");
	const writer = h.create();
	const first = record(await h.write(h.target(), due("2026-10-31")));
	await h.deliver();
	const target = h.target();
	view.editorText = initial;
	const result = await h.write(target, due("2026-10-31"));
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "line-changed");
	assert.deepEqual(lost(h), [first.id]);
	writer.dispose();
});

test("review case (c)", async () => {
	const initial = "- [ ] A 🏁 delete\nx";
	const h = writerHarness({ "a.md": initial });
	const writer = h.create({ tasks: () => ({ kind: "toggle", toggle: () => "" }) });
	await h.write(h.target(), due("2026-11-01"));
	await h.deliver();
	await h.clock.advance(6000);
	const deletion = record(await h.write());
	await h.deliver();
	await h.clock.advance(4500);
	await h.write(h.target(), { kind: "undo", record: deletion });
	await stale(h, initial);
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("H8: 0 s set due, 65 s toggle, then a stale copy back to before 0 s", async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write(h.target(), due("2026-10-31"));
	await h.deliver();
	await h.clock.advance(65_000);
	await h.write();
	await stale(h, original);
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("the 61 s recurring case", async () => {
	const task = "- [ ] A 🔁 every day 📅 2026-10-31";
	const h = writerHarness({ "a.md": task });
	const writer = h.create({
		tasks: () => ({
			kind: "toggle",
			toggle: (line) =>
				line.startsWith("- [x]")
					? line.replace("[x]", "[ ]").replace(" ✅ 2026-10-31", "")
					: "- [ ] A 🔁 every day 📅 2026-11-01\n- [x] A 🔁 every day 📅 2026-10-31 ✅ 2026-10-31",
		}),
	});
	await h.write();
	await h.deliver();
	await h.clock.advance(61_000);
	await h.write(h.target(1));
	await stale(h, task);
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("no changed, a stale copy at 70 s → report (records whose window has not ended are not dropped)", async () => {
	const h = writerHarness();
	const writer = h.create();
	const write = record(await h.write());
	await h.clock.advance(70_000);
	await stale(h, original);
	assert.deepEqual(lost(h), [write.id]);
	writer.dispose();
});

test("Redo refuses a source line duplicated anywhere in the note and stops the remaining changes", async () => {
	const h = writerHarness({ "a.md": `${original}\n- [ ] B` });
	const writer = h.create();
	await h.write();
	await h.write(h.target(1));
	await stale(h, `${original}\n- [ ] B`);
	h.put("a.md", `${original}\n- [ ] B\n${"plain\n".repeat(12)}${original}`);
	const calls = h.processCalls.length;
	await h.reverts[0].redo?.();
	assert.equal(h.processCalls.length, calls);
	assert.ok(h.notices.some((text) => text.includes("appears more than once")));
	assert.equal(h.text().split("\n")[1], "- [ ] B");
	writer.dispose();
});

test("Redo of a two-line recurring write feeds its actual completed line to the next Redo", async () => {
	const task = "- [ ] A 🔁 every day 📅 2026-10-31";
	const h = writerHarness({ "a.md": task });
	const writer = h.create({
		tasks: () => ({
			kind: "toggle",
			toggle: () => "- [ ] A 🔁 every day 📅 2026-11-01\n- [x] A 🔁 every day 📅 2026-10-31 ✅ 2026-10-31",
		}),
	});
	await h.write();
	await h.write(h.target(1), due("2026-11-02"));
	const written = h.text();
	await stale(h, task);
	await h.reverts[0].redo?.();
	assert.equal(h.text(), written);
	writer.dispose();
});

test("quick-entry results trigger the revert check and an in-flight insert defers it", async () => {
	for (const during of [false, true]) {
		const h = writerHarness();
		const writer = h.create();
		const first = record(await h.write());
		const gate = deferred();
		if (during) h.onProcess(() => gate.promise);
		else h.put("a.md", original);
		const insert = writer.insert("a.md", (text) => `${text}\n- [ ] Entry`);
		await flush();
		if (during) {
			await stale(h, original);
			assert.deepEqual(lost(h), []);
			gate.resolve();
		}
		await insert;
		await flush();
		assert.deepEqual(lost(h), [first.id]);
		assert.equal(h.reverts[0].count, 1);
		writer.dispose();
	}
});

test("records follow a rename and two timeline subscribers receive one revert notice", async () => {
	const h = writerHarness();
	const writer = h.create();
	const a: number[] = [];
	const b: number[] = [];
	writer.onWrite((event) => {
		if (event.kind === "overwritten") a.push(event.id);
	});
	writer.onWrite((event) => {
		if (event.kind === "overwritten") b.push(event.id);
	});
	const first = record(await h.write());
	h.rename("a.md", "renamed.md");
	h.put("renamed.md", original);
	h.changed("renamed.md", original);
	await flush();
	assert.deepEqual(a, [first.id]);
	assert.deepEqual(b, [first.id]);
	assert.equal(h.reverts.length, 1);
	assert.equal(h.reverts[0].context.path, "renamed.md");
	writer.dispose();
});

test("an externally renamed 🏁 line later deleted still matches the older deletion T (fuzz5 known limit)", async () => {
	const task = "- [ ] A 🏁 delete";
	const h = writerHarness({ "a.md": `above\n${task}\nbelow` });
	const writer = h.create({ tasks: () => ({ kind: "toggle", toggle: () => "" }) });
	const first = record(await h.write(h.target(1)));
	await h.write(h.target(1), { kind: "undo", record: first });
	const undoId = h.events.filter((event) => event.kind === "written").at(-1)!.id;
	await h.deliver();
	await stale(h, "above\n- [ ] New task 🏁 delete\nbelow");
	await h.write(h.target(1));
	await h.deliver();
	assert.deepEqual(lost(h), [undoId]);
	writer.dispose();
});

test("already-undone removes its write after returning runs (new_cases.py fixed sequence)", async () => {
	const initial = "- [x] A ✅ 2026-10-31";
	const h = writerHarness({ "a.md": initial });
	const writer = h.create();
	const first = record(await h.write());
	const second = record(await h.write(h.target(), due("2026-10-30")));
	await h.write(h.target(), { kind: "date", field: "due", day: null });
	await stale(h, initial);
	assert.deepEqual(lost(h), [first.id]);
	const fourth = record(await h.write(h.target(), due("2026-10-30")));
	await stale(h, original);
	assert.deepEqual(lost(h), [first.id, fourth.id]);
	assert.deepEqual(await h.write(h.target(), { kind: "undo", record: second }), {
		kind: "unchanged",
		alreadyUndone: true,
	});
	assert.deepEqual(lost(h), [first.id, fourth.id]);
	writer.dispose();
});
