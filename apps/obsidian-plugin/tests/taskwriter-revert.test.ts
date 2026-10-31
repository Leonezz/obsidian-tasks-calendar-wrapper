import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { dayKey } from "@tasks-calendar-wrapper/core";
import type { TaskEdit, UndoRecord, WriteResult } from "../timeline/src/taskwriter";
import { deferred, flush, writerHarness, type WriterHarness } from "./writer-harness";

const A = "2026-10-30";
const B = "2026-10-31";
const C = "2026-11-01";
const original = "- [ ] A";
const due = (day: string | null): TaskEdit => ({
	kind: "date",
	field: "due",
	day: day === null ? null : dayKey(moment(day)),
});
const lost = (h: WriterHarness) => h.events.filter((event) => event.kind === "overwritten").map((event) => event.id);
function record(result: WriteResult): UndoRecord {
	assert.equal(result.kind, "written");
	if (result.kind !== "written" || !result.undo) throw new Error("expected undo record");
	return result.undo;
}
async function stale(h: WriterHarness, text: string, path = "a.md"): Promise<void> {
	h.put(path, text);
	for (const view of h.views) if (view.file?.path === path && view.mode === "source") view.type(text);
	h.changed(path, text);
	await flush();
}

test("after a write, a running save writes the old text back → the revert notice (text exact, Redo and Open note, no auto-hide), markDirty once, hold released, overwritten event", async () => {
	const h = writerHarness();
	const view = h.view();
	const gate = deferred();
	view.lastSavedData = "";
	view.beforeSave = () => gate.promise;
	const save = view.save();
	const writer = h.create();
	const write = record(await h.write());
	h.dirty.length = 0;
	gate.resolve();
	await save;
	h.changed();
	await flush();
	assert.deepEqual(lost(h), [write.id]);
	assert.equal(h.reverts.length, 1);
	assert.equal(typeof h.reverts[0].redo, "function");
	assert.equal(
		h.notices[0],
		"“A” in a is back to how it was before the timeline changed it (another save, a sync, or a change made in the note). Redo?",
	);
	assert.equal(h.holds.get("a.md"), 0);
	assert.equal(h.dirty.filter((path) => path === "a.md").length, 1);
	assert.equal(h.events.filter((event) => event.kind === "recheck").length, 1);
	await h.clock.advance(10_000);
	assert.equal(
		h.notices.some((text) => text.startsWith("Saved in")),
		false,
	);
	writer.dispose();
});

test("revert without changed: found by the check at indexed, at 10 s or at window end; same notice", async () => {
	for (const trigger of ["indexed", "10 s", "window end"]) {
		const h = writerHarness();
		const writer = h.create();
		const write = record(await h.write());
		const written = h.text();
		if (trigger === "window end") await h.deliver();
		h.put("a.md", original);
		if (trigger === "indexed") {
			h.changed("a.md", written);
			await flush();
		} else await h.clock.advance(trigger === "10 s" ? 10_000 : 5_000);
		assert.deepEqual(lost(h), [write.id], trigger);
		assert.equal(h.reverts.length, 1, trigger);
		writer.dispose();
	}
});

test("changed with old text but cachedRead already new → no notice", async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write();
	h.changed("a.md", original);
	await flush();
	assert.deepEqual(lost(h), []);
	assert.equal(h.reverts.length, 0);
	writer.dispose();
});

test("timing: indexed at 100 ms, old text back at 2000 ms → notice; indexed 100 ms, back at 5100 ms → none; indexed 4000 ms, back 6500 ms → notice, 7100 ms → none", async () => {
	for (const [indexed, reverted, count] of [
		[100, 2000, 1],
		[100, 5100, 0],
		[4000, 6500, 1],
		[4000, 7100, 0],
	]) {
		const h = writerHarness();
		const writer = h.create();
		await h.write();
		await h.clock.advance(indexed);
		await h.deliver();
		await h.clock.advance(reverted - indexed);
		await stale(h, original);
		assert.equal(h.reverts.length, count, `${indexed}/${reverted}`);
		writer.dispose();
	}
});

test("you change the line after the write → no notice", async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write();
	await stale(h, "- [x] A with new text ✅ 2026-10-31");
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test('two reverts in one note merge into one "2 timeline changes in Home are back to how they were before…" notice; Redo redoes in the original order', async () => {
	const initial = "- [ ] A\n- [ ] B";
	const h = writerHarness({ "Home.md": initial });
	const writer = h.create();
	const first = record(await h.write(h.target(0, "Home.md")));
	const second = record(await h.write(h.target(1, "Home.md")));
	const written = h.text("Home.md");
	await stale(h, initial, "Home.md");
	assert.deepEqual(lost(h), [first.id, second.id]);
	assert.equal(h.reverts.length, 1);
	assert.equal(
		h.notices[0],
		"2 timeline changes in Home are back to how they were before (another save, a sync, or a change made in the note). Redo?",
	);
	await h.reverts[0].redo?.();
	assert.equal(h.text("Home.md"), written);
	assert.deepEqual(
		h.events
			.filter((event) => event.kind === "written")
			.slice(-2)
			.map((event) => event.line),
		[0, 1],
	);
	writer.dispose();
});

test("a reverted dialog edit opens the Edit changed back modal, no Redo", async () => {
	const h = writerHarness();
	const writer = h.create();
	const edited = "- [ ] A edited";
	const write = record(await h.write(h.target(), { kind: "replace", expected: original, lines: [edited] }));
	await stale(h, original);
	assert.deepEqual(lost(h), [write.id]);
	assert.equal(h.reverts[0].redo, undefined);
	assert.equal(h.recoveries[0].editedLine, edited);
	writer.dispose();
});

test("Undo 1 s after a write → no overwritten event, no notice; for a dialog edit no modal either", async () => {
	for (const edit of [
		{ kind: "toggle" },
		{ kind: "replace", expected: original, lines: ["- [ ] A edited"] },
	] as const) {
		const h = writerHarness();
		const writer = h.create();
		const write = record(await h.write(h.target(), edit));
		await h.clock.advance(1000);
		assert.equal((await h.write(h.target(), { kind: "undo", record: write })).kind, "written");
		await h.deliver();
		assert.deepEqual(lost(h), []);
		assert.equal(h.reverts.length, 0);
		assert.equal(h.recoveries.length, 0);
		writer.dispose();
	}
});

test("un-toggle then re-toggle within the window; due A→B→A within 2 s → no notice", async () => {
	for (const dates of [false, true]) {
		const initial = dates ? `${original} 📅 ${A}` : "- [x] A ✅ 2026-10-31";
		const h = writerHarness({ "a.md": initial });
		const writer = h.create();
		await h.write(h.target(), dates ? due(B) : { kind: "toggle" });
		await h.clock.advance(1000);
		await h.write(h.target(), dates ? due(A) : { kind: "toggle" });
		await h.deliver();
		assert.equal(h.text(), initial);
		assert.deepEqual(lost(h), []);
		writer.dispose();
	}
});

test("editor path: a save in progress, later saveAgain writes the change → no notice", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const gate = deferred();
	view.type(`${original}\ntext`);
	view.beforeSave = () => gate.promise;
	const save = view.save();
	await flush();
	await h.write();
	assert.equal(view.saveAgain, true);
	gate.resolve();
	await save;
	await h.deliver();
	assert.match(h.text(), /\[x\]/);
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("chain ending in Undo: A→B→C, Undo the second, then a stale save restores A → notice naming only the first", async () => {
	const initial = `${original} 📅 ${A}`;
	const h = writerHarness({ "a.md": initial });
	const writer = h.create();
	const first = record(await h.write(h.target(), due(B)));
	const second = record(await h.write(h.target(), due(C)));
	await h.write(h.target(), { kind: "undo", record: second });
	await stale(h, initial);
	assert.deepEqual(lost(h), [first.id]);
	writer.dispose();
});

test("same but menu sets C back to B → notice naming only the first", async () => {
	const initial = `${original} 📅 ${A}`;
	const h = writerHarness({ "a.md": initial });
	const writer = h.create();
	const first = record(await h.write(h.target(), due(B)));
	await h.write(h.target(), due(C));
	await h.write(h.target(), due(B));
	await stale(h, initial);
	assert.deepEqual(lost(h), [first.id]);
	writer.dispose();
});

test("toggle → set date → Undo the date, then a stale save restores pre-toggle → notice naming the toggle", async () => {
	const h = writerHarness();
	const writer = h.create();
	const first = record(await h.write());
	const second = record(await h.write(h.target(), due(B)));
	await h.write(h.target(), { kind: "undo", record: second });
	await stale(h, original);
	assert.deepEqual(lost(h), [first.id]);
	writer.dispose();
});

test("A→B→C→D, then a save restores B → notice naming the last two", async () => {
	const h = writerHarness({ "a.md": `${original} 📅 ${A}` });
	const writer = h.create();
	await h.write(h.target(), due(B));
	const stateB = h.text();
	const second = record(await h.write(h.target(), due(C)));
	const third = record(await h.write(h.target(), due(null)));
	await stale(h, stateB);
	assert.deepEqual(lost(h), [second.id, third.id]);
	writer.dispose();
});

test('returning chains: Due today → Due tomorrow → Remove due date → no notice; a three-state custom status cycle back to " " → no notice; third step a dialog edit restoring the line → no modal', async () => {
	for (const kind of ["date", "status", "dialog"]) {
		const h = writerHarness();
		const writer = h.create(
			kind === "status"
				? {
						tasks: () => ({
							kind: "toggle",
							toggle: (line) =>
								line.replace(
									/\[([ /x])\]/,
									(_, status: string) => `[${status === " " ? "/" : status === "/" ? "x" : " "}]`,
								),
						}),
					}
				: {},
		);
		await h.write(h.target(), kind === "status" ? { kind: "toggle" } : due(B));
		await h.write(h.target(), kind === "status" ? { kind: "toggle" } : due(C));
		await h.write(
			h.target(),
			kind === "status"
				? { kind: "toggle" }
				: kind === "dialog"
					? { kind: "replace", expected: h.text(), lines: [original] }
					: due(null),
		);
		await h.deliver();
		assert.equal(h.text(), original);
		assert.deepEqual(lost(h), []);
		assert.equal(h.recoveries.length, 0);
		writer.dispose();
	}
});

test("line moved externally: own write, external insert above, re-read, set the date back → no notice", async () => {
	const initial = `${original} 📅 ${A}`;
	const h = writerHarness({ "a.md": initial });
	const writer = h.create();
	await h.write(h.target(), due(B));
	await stale(h, `heading\n${h.text()}`);
	await h.write(h.target(1), due(A));
	await h.deliver();
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("identical lines: toggle both, Undo one → no notice; toggle both, stale save → notice naming both", async () => {
	for (const undo of [false, true]) {
		const initial = `${original}\n${original}`;
		const h = writerHarness({ "a.md": initial });
		const writer = h.create();
		const first = record(await h.write(h.target(0)));
		const second = record(await h.write(h.target(1)));
		if (undo) {
			await h.write(h.target(0), { kind: "undo", record: first });
			await h.deliver();
		} else await stale(h, initial);
		assert.deepEqual(lost(h), undo ? [] : [first.id, second.id]);
		writer.dispose();
	}
});

test("two different tasks written once each, an external change reverts only one → notice naming only that one (by group)", async () => {
	const h = writerHarness({ "a.md": `${original}\n- [ ] B` });
	const writer = h.create();
	const first = record(await h.write());
	await h.write(h.target(1));
	await stale(h, `${original}\n${h.text().split("\n")[1]}`);
	assert.deepEqual(lost(h), [first.id]);
	writer.dispose();
});

test("recurring completion, then un-complete the completed copy, then a stale save restores only the original line → notice", async () => {
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
	const first = record(await h.write());
	const second = record(await h.write(h.target(1)));
	await stale(h, task);
	assert.deepEqual(lost(h), [first.id, second.id]);
	writer.dispose();
});

test("toggle → set date, an external change goes back to before the toggle, Redo → both redone, line as after the date change", async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write();
	await h.write(h.target(), due(C));
	const written = h.text();
	await stale(h, original);
	assert.equal(h.reverts[0].count, 2);
	await h.reverts[0].redo?.();
	assert.equal(h.text(), written);
	assert.equal(h.reverts.length, 1);
	writer.dispose();
});

test("editor-path write then switch to reading view, then an external save → notice (check reads cachedRead)", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const write = record(await h.write());
	await h.deliver();
	view.mode = "preview";
	await stale(h, original);
	assert.deepEqual(lost(h), [write.id]);
	writer.dispose();
});

test("you un-toggle in the note within 5 s → notice; Redo re-toggles; without Redo it stays un-toggled", async () => {
	for (const redo of [false, true]) {
		const h = writerHarness();
		const writer = h.create();
		await h.write();
		const written = h.text();
		await stale(h, original);
		assert.equal(h.reverts.length, 1);
		if (redo) await h.reverts[0].redo?.();
		assert.equal(h.text(), redo ? written : original);
		writer.dispose();
	}
});

test('Undo finds the original already in place (Ctrl+Z in editor) → already-undone, "is already back" notice, no revert notice', async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const write = record(await h.write());
	await h.deliver();
	view.type(original);
	const result = await h.write(h.target(), { kind: "undo", record: write });
	assert.deepEqual(result, { kind: "unchanged", alreadyUndone: true });
	assert.equal(h.notices.at(-1), "“A” in a is already back to how it was.");
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("after a write, set due to its current value (unchanged) → a later external revert is still reported", async () => {
	const h = writerHarness();
	const writer = h.create();
	const write = record(await h.write(h.target(), due(B)));
	assert.equal((await h.write(h.target(), due(B))).kind, "unchanged");
	await stale(h, original);
	assert.deepEqual(lost(h), [write.id]);
	writer.dispose();
});

test("editor path: set date, Ctrl+Z in the editor not yet autosaved, pick the same date again → line-changed (not unchanged), and the revert notice", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const write = record(await h.write(h.target(), due(B)));
	await h.deliver();
	const at = h.target();
	view.editorText = original;
	const result = await h.write(at, due(B));
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "line-changed");
	assert.deepEqual(lost(h), [write.id]);
	writer.dispose();
});

test("toggle → set date → stale save back to before toggle → Undo of the toggle (already-undone) → notice names the date change", async () => {
	const h = writerHarness();
	const writer = h.create();
	const first = record(await h.write());
	const second = record(await h.write(h.target(), due(B)));
	h.put("a.md", original);
	const result = await h.write(h.target(), { kind: "undo", record: first });
	assert.deepEqual(result, { kind: "unchanged", alreadyUndone: true });
	assert.deepEqual(lost(h), [second.id]);
	writer.dispose();
});

test("while another group's write hangs 60 s, an external revert at 2 s → reported at 60 s; revert at 4.9 s while an own write runs 4.8–5.2 s → reported", async () => {
	for (const timeout of [false, true]) {
		const h = writerHarness({ "a.md": `${original}\n- [ ] B` });
		const writer = h.create();
		const first = record(await h.write());
		await h.deliver();
		await h.clock.advance(timeout ? 0 : 4800);
		const gate = deferred();
		if (timeout) h.onProcess(() => gate.promise);
		else {
			const process = h.app.vault.process;
			h.app.vault.process = async (file, fn) => {
				const result = await process(file, fn);
				await gate.promise;
				return result;
			};
		}
		const second = h.write(h.target(1));
		await flush();
		await h.clock.advance(timeout ? 2000 : 100);
		await stale(h, `${original}\n${h.text().split("\n")[1]}`);
		assert.deepEqual(lost(h), []);
		await h.clock.advance(timeout ? 58_000 : 300);
		if (!timeout) gate.resolve();
		await second;
		await flush();
		assert.deepEqual(lost(h), [first.id]);
		gate.resolve();
		writer.dispose();
	}
});

test("a single write whose process times out without writing → only may-not-have-been-saved, no revert notice", async () => {
	const h = writerHarness();
	const writer = h.create();
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const write = h.write();
	await flush();
	await h.clock.advance(60_000);
	const result = await write;
	assert.equal(result.kind, "failed");
	assert.equal(h.reverts.length, 0);
	assert.equal(h.notices.length, 1);
	assert.match(h.notices[0], /may not have been saved/);
	gate.resolve();
	writer.dispose();
});

test("Redo across midnight (✅ is the new day) → redone; lost writes include an Undo → no Redo, only Open note; report → Redo → a stale save back to the middle state → reported again", async () => {
	const h = writerHarness();
	let today = B;
	const writer = h.create({ today: () => dayKey(moment(today)) });
	const first = record(await h.write());
	const toggled = h.text();
	await h.write(h.target(), due(C));
	await stale(h, original);
	today = C;
	await h.reverts[0].redo?.();
	assert.match(h.text(), /✅ 2026-11-01/);
	await stale(h, h.text().replace(` 📅 ${C}`, ""));
	assert.equal(h.reverts.length, 2);
	writer.dispose();
	const u = writerHarness();
	const uw = u.create();
	const handle = record(await u.write());
	await u.write(u.target(), { kind: "undo", record: handle });
	await stale(u, toggled);
	assert.equal(u.reverts.length, 1);
	assert.equal(u.reverts[0].redo, undefined);
	assert.notEqual(lost(u)[0], first.id);
	uw.dispose();
});

test("write, wait 5.1 s, write again, then a stale save back to before the first → reported (records kept 60 s)", async () => {
	const h = writerHarness();
	const writer = h.create();
	const first = record(await h.write(h.target(), due(B)));
	await h.deliver();
	await h.clock.advance(5100);
	const second = record(await h.write(h.target(), due(C)));
	await stale(h, original);
	assert.deepEqual(lost(h), [first.id, second.id]);
	writer.dispose();
});

test("after a report the note returns to the timeline's last written state → no further report; a later revert to the same earlier state → the same writes are not reported again", async () => {
	const h = writerHarness();
	const writer = h.create();
	const write = record(await h.write());
	const written = h.text();
	await stale(h, original);
	await stale(h, written);
	await stale(h, original);
	assert.deepEqual(lost(h), [write.id]);
	assert.equal(h.reverts.length, 1);
	writer.dispose();
});

test("Undo that re-inserted a 🏁 line, then you edit that line → no report", async () => {
	const task = "- [ ] A 🏁 delete";
	const h = writerHarness({ "a.md": `above\n${task}\nbelow` });
	const writer = h.create({ tasks: () => ({ kind: "toggle", toggle: () => "" }) });
	const write = record(await h.write(h.target(1)));
	await h.write(h.target(1), { kind: "undo", record: write });
	await stale(h, "above\n- [ ] A edited 🏁 delete\nbelow");
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test("editor-path write then immediately reading view (saveAgain running) → no false report", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const gate = deferred();
	view.type(`${original}\ntext`);
	view.beforeSave = () => gate.promise;
	const save = view.save();
	await flush();
	await h.write();
	view.mode = "preview";
	h.changed("a.md", original);
	await flush();
	assert.deepEqual(lost(h), []);
	gate.resolve();
	await save;
	await h.deliver();
	assert.deepEqual(lost(h), []);
	writer.dispose();
});

test('the existing "a running save writes the old text back → notice" case still passes', async () => {
	const h = writerHarness();
	const writer = h.create();
	await h.write();
	await stale(h, original);
	assert.equal(h.reverts.length, 1);
	writer.dispose();
});
