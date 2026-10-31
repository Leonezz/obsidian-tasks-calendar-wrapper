import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { dayKey } from "@tasks-calendar-wrapper/core";
import { createShiftLedger } from "../timeline/src/taskwriter";
import { createSharedTaskIndex } from "../timeline/src/sharedindex";
import { parseKeyOf } from "../utils/parsekey";
import { writerHarness, deferred, flush } from "./writer-harness";

test("a stale editor buffer in reading view does not block a write", async () => {
	const h = writerHarness();
	const view = h.view();
	view.editorText = "old buffer";
	const writer = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.deepEqual(view.reads, []);
	assert.equal(h.text(), "- [x] A ✅ 2026-10-31");
	writer.dispose();
});

test("in reading view complete then un-complete both write", async () => {
	const h = writerHarness();
	const view = h.view();
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	await h.clock.advance(0);
	assert.equal((await h.write()).kind, "written");
	assert.equal(h.text(), "- [ ] A");
	assert.deepEqual(view.reads, []);
	assert.equal(h.processCalls.length, 2);
	w.dispose();
});

test('an unsaved toggle in reading view (getViewData already "- [x] A") is refused', async () => {
	const h = writerHarness();
	h.view().type("- [x] A");
	const w = h.create();
	assert.deepEqual(await h.write({ path: "a.md", line: 0, sourceLine: "- [ ] A" }), {
		kind: "refused",
		reason: "line-changed",
		message:
			"“A” changed in a since the timeline read it. Nothing was written. The timeline updates once Obsidian has re-read the note; then try again.",
	});
	assert.equal(h.processCalls.length, 0);
	assert.deepEqual(h.dirty, ["a.md"]);
	w.dispose();
});

test("unsaved typing in a source view is refused", async () => {
	const h = writerHarness();
	const v = h.view("a.md", "source");
	v.type("- [ ] A typing");
	const w = h.create();
	const result = await h.write({ path: "a.md", line: 0, sourceLine: "- [ ] A" });
	assert.equal(result.kind, "refused");
	assert.equal(v.transactions.length, 0);
	assert.deepEqual(v.reads, []);
	w.dispose();
});

test("consistent after saving → writes", async () => {
	const h = writerHarness({ "a.md": "- [ ] A\nold text" });
	const v = h.view();
	v.type("- [ ] A\nnew text");
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.equal(v.saves, 1);
	assert.equal(h.text(), "- [x] A ✅ 2026-10-31\nnew text");
	w.dispose();
});

test("views of other notes are untouched", async () => {
	const h = writerHarness({ "a.md": "- [ ] A", "b.md": "- [ ] B" });
	const v = h.view("b.md", "source");
	v.type("edited B");
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.equal(v.saves, 0);
	assert.deepEqual(v.reads, []);
	assert.equal(h.text("b.md"), "- [ ] B");
	w.dispose();
});

test("target line past the view's line count is refused", async () => {
	const h = writerHarness();
	const v = h.view();
	const w = h.create();
	const result = await h.write({ path: "a.md", line: 9, sourceLine: "- [ ] A" });
	assert.equal(result.kind, "refused");
	assert.equal(h.processCalls.length, 0);
	assert.deepEqual(v.reads, []);
	w.dispose();
});

test("a CRLF note stays CRLF after a write in reading view", async () => {
	const h = writerHarness({ "a.md": "header\r\n- [ ] A\r\nnext" });
	h.view();
	const w = h.create();
	assert.equal((await h.write(h.target(1))).kind, "written");
	assert.equal(h.text(), "header\r\n- [x] A ✅ 2026-10-31\r\nnext");
	w.dispose();
});

test("an unchanged CRLF note is not saved first", async () => {
	const h = writerHarness({ "a.md": "- [ ] A\r\nnext" });
	const v = h.view();
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.equal(v.saves, 0);
	w.dispose();
});

test("save throws → failed with a notice, process not called", async () => {
	const h = writerHarness();
	const v = h.view();
	v.type("- [ ] A\nextra");
	v.beforeSave = () => {
		throw new Error("disk unavailable");
	};
	const w = h.create();
	const result = await h.write();
	assert.equal(result.kind, "failed");
	assert.equal(h.processCalls.length, 0);
	assert.deepEqual(h.notices, ["Could not write to a: disk unavailable"]);
	assert.equal(h.errors.length, 1);
	w.dispose();
});

test("only MarkdownViews with the same file.path: file null, deferred leaves and other notes' views excluded", async () => {
	const h = writerHarness({ "a.md": "- [ ] A", "b.md": "- [ ] B" });
	const absent = h.view();
	absent.file = null;
	const other = h.view("b.md");
	h.leaves.push(
		{ view: null },
		{
			view: {
				file: { path: "a.md" },
				getViewData: () => {
					throw new Error("not MarkdownView");
				},
			},
		},
	);
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.equal(absent.saves + other.saves, 0);
	assert.deepEqual(absent.reads.concat(other.reads), []);
	w.dispose();
});

test('source view: transaction called exactly once with changes `{ from: { line: 3, ch: 0 }, to: { line: 3, ch: S.length }, text: W }`, origin "tasks-calendar-wrapper"; save awaited; process not called', async () => {
	const source = "- [ ] A";
	const written = "- [x] A ✅ 2026-10-31";
	const h = writerHarness({ "a.md": `one\ntwo\nthree\n${source}` });
	const v = h.view("a.md", "source");
	const gate = deferred();
	v.beforeSave = () => gate.promise;
	const w = h.create();
	let settled = false;
	const pending = h.write(h.target(3)).then((result) => {
		settled = true;
		return result;
	});
	await flush();
	assert.equal(settled, false);
	assert.deepEqual(v.transactions, [
		{
			transaction: { changes: [{ from: { line: 3, ch: 0 }, to: { line: 3, ch: source.length }, text: written }] },
			origin: "tasks-calendar-wrapper",
		},
	]);
	assert.equal(h.processCalls.length, 0);
	gate.resolve();
	assert.equal((await pending).kind, "written");
	assert.equal(h.text(), `one\ntwo\nthree\n${written}`);
	w.dispose();
});

test("two source views still one transaction", async () => {
	const h = writerHarness();
	const first = h.view("a.md", "source");
	const second = h.view("a.md", "source");
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.equal(first.transactions.length + second.transactions.length, 1);
	assert.deepEqual(second.reads, []);
	w.dispose();
});

test("only a reading view, or a deferred leaf → process", async () => {
	for (const reading of [true, false]) {
		const h = writerHarness();
		if (reading) h.view();
		else h.leaves.push({ view: { getViewType: () => "markdown" } });
		const w = h.create();
		assert.equal((await h.write()).kind, "written");
		assert.equal(h.processCalls.length, 1);
		w.dispose();
	}
});

test("line differs in the source view → refused, nothing written", async () => {
	const h = writerHarness();
	const v = h.view("a.md", "source");
	v.editorText = "- [ ] changed only in editor";
	const w = h.create();
	const result = await h.write();
	assert.equal(result.kind, "refused");
	assert.equal(v.transactions.length, 0);
	assert.equal(h.writes.length, 0);
	w.dispose();
});

test("🏁 delete on the last line leaves an empty line", async () => {
	for (const source of [false, true]) {
		const h = writerHarness({ "a.md": "header\n- [ ] A 🏁 delete" });
		if (source) h.view("a.md", "source");
		const w = h.create();
		const result = await h.write(h.target(1));
		assert.equal(result.kind, "written");
		assert.equal(h.text(), "header\n");
		w.dispose();
	}
});

test("save throws after the transaction: written lines still in the editor → one reverse transaction (same origin), failed; lines changed → failed with unknownOutcome, queue blocked", async () => {
	for (const changed of [false, true]) {
		const h = writerHarness();
		const v = h.view("a.md", "source");
		v.beforeSave = () => {
			if (changed) v.type("- [x] changed afterwards");
			throw new Error("save failed");
		};
		const w = h.create();
		const result = await h.write();
		assert.equal(result.kind, "failed");
		if (result.kind !== "failed") throw new Error("expected failed");
		assert.equal(result.unknownOutcome, changed);
		assert.equal(v.transactions.length, changed ? 1 : 2);
		assert.ok(v.transactions.every((tx) => tx.origin === "tasks-calendar-wrapper"));
		if (changed) {
			assert.equal(
				h.notices[0],
				"a may not have been saved: Obsidian could not save it, and the line changed in its editor afterwards. The change is still in the open note and is saved with it. Check the note before trying again.",
			);
			const next = await h.write();
			assert.equal(next.kind, "refused");
			if (next.kind === "refused") assert.equal(next.reason, "queue-blocked");
		} else {
			assert.equal(v.editorText, "- [ ] A");
			assert.equal(h.notices[0], "Could not write to a: save failed");
		}
		w.dispose();
	}
});

test("a reading view and a source view open: only the source view's editor is used; the reading view's editor is never read", async () => {
	const h = writerHarness();
	const reading = h.view();
	const source = h.view("a.md", "source");
	const w = h.create();
	assert.equal((await h.write()).kind, "written");
	assert.deepEqual(reading.reads, []);
	assert.equal(source.transactions.length, 1);
	w.dispose();
});

test("refusal in fn → released once before write returns, no markDirty; process throws → released and markDirty", async () => {
	for (const fail of [false, true]) {
		const h = writerHarness();
		const w = h.create();
		h.onProcess(() => {
			if (fail) throw new Error("process failed");
			h.bytes.set("a.md", new TextEncoder().encode("- [ ] changed"));
		});
		const result = await h.write({ path: "a.md", line: 0, sourceLine: "- [ ] A" });
		assert.equal(result.kind, fail ? "failed" : "refused");
		assert.deepEqual(h.releases, [{ path: "a.md", markDirty: fail }]);
		assert.equal(w.releaseSeq(), 1);
		w.dispose();
		assert.equal(h.releases.length, 1);
	}
});

test("changed with the pre-write text does not release; with the written text releases and indexed. A BOM note also gets indexed", async () => {
	for (const bom of ["", "\uFEFF"]) {
		const h = writerHarness({ "a.md": `${bom}- [ ] A` });
		const w = h.create();
		const result = await h.write();
		assert.equal(result.kind, "written");
		if (result.kind !== "written") throw new Error("expected written");
		let indexed = false;
		void result.indexed.then(() => {
			indexed = true;
		});
		h.changed("a.md", `${bom}- [ ] A`);
		await flush();
		assert.equal(h.releases.length, 0);
		assert.equal(indexed, false);
		h.changed();
		await flush();
		assert.equal(indexed, true);
		assert.equal(h.releases.length, 1);
		assert.equal(w.releaseSeq(), 1);
		assert.equal(h.events.filter((e) => e.kind === "indexed").length, 1);
		w.dispose();
	}
});

test('at 10 s the "Saved in a. The timeline will show…" notice and a slow event, no release, no reload; writing the same line then refuses not-reread without calling process; a later changed releases', async () => {
	const h = writerHarness();
	const w = h.create();
	const target = h.target();
	await h.write(target);
	await h.clock.advance(10_000);
	assert.deepEqual(h.notices, ["Saved in a. The timeline will show the change once Obsidian has re-read the note."]);
	assert.equal(h.events.filter((e) => e.kind === "slow").length, 1);
	assert.equal(h.releases.length, 0);
	assert.equal(h.events.filter((e) => e.kind === "recheck").length, 0);
	const again = await h.write(target);
	assert.equal(again.kind, "refused");
	if (again.kind === "refused") {
		assert.equal(again.reason, "not-reread");
		assert.equal(
			again.message,
			"Obsidian hasn't re-read a yet, so the timeline can't change “A” again. Try again in a moment.",
		);
	}
	assert.equal(h.processCalls.length, 1);
	h.changed();
	await flush();
	assert.equal(h.releases.length, 1);
	w.dispose();
});

test("120 s without events → release, markDirty, console.warn, each view reloads once and hands the bridge new tasks, overlay cleared, the next click can write", async () => {
	const h = writerHarness();
	const w = h.create();
	await h.write();
	await h.clock.advance(120_000);
	assert.equal(h.releases.length, 1);
	assert.deepEqual(h.dirty, ["a.md"]);
	assert.equal(h.warnings.length, 1);
	assert.equal(h.events.filter((e) => e.kind === "recheck").length, 1);
	assert.equal(h.events.filter((e) => e.kind === "released").length, 1);
	assert.equal((await h.write()).kind, "written");
	w.dispose();
});

test("the writer's own 60 s timer: a fake process that never returns → failed (unknownOutcome) at 60 s, queue blocked; when process later reaches fn it returns unchanged because abandoned, nothing written", async () => {
	const h = writerHarness();
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const w = h.create();
	const pending = h.write();
	await flush();
	await h.clock.advance(60_000);
	const result = await pending;
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
	assert.equal(
		h.notices[0],
		"a may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.",
	);
	assert.equal(h.releases.length, 1);
	const blocked = await h.write();
	assert.equal(blocked.kind, "refused");
	if (blocked.kind === "refused") assert.equal(blocked.reason, "queue-blocked");
	gate.resolve();
	await flush();
	assert.equal(h.writes.length, 0);
	assert.equal(h.text(), "- [ ] A");
	w.dispose();
});

test("5 writes to one note 200 ms apart → peak count > 1; index updates meanwhile give the Task objects from before the first write (===); re-read only after the 5th indexed, exactly once", async () => {
	const lines = Array.from({ length: 5 }, (_, n) => `- [ ] task ${n}`);
	const h = writerHarness({ "a.md": lines.join("\n") });
	const shared = createSharedTaskIndex({ app: h.app as never, moment, parseKey: () => parseKeyOf(moment) });
	const reader = shared.openReader();
	const first = await reader.update({});
	const index = {
		markDirty: (paths: readonly string[]) => {
			h.index.markDirty(paths);
			shared.markDirty(paths);
		},
		hold: (path: string) => {
			const spy = h.index.hold(path);
			const real = shared.hold(path);
			return {
				release(options?: { markDirty?: boolean }) {
					spy.release(options);
					real.release(options);
				},
			};
		},
	};
	const w = h.create({ index });
	for (let n = 0; n < 5; n++) {
		assert.equal((await h.write(h.target(n))).kind, "written");
		const reads = h.readCalls.length;
		const update = await reader.update({});
		assert.equal(h.readCalls.length, reads);
		assert.deepEqual(update.pinned, ["a.md"]);
		update.tasks.forEach((task, i) => assert.equal(task, first.tasks[i]));
		await h.clock.advance(200);
	}
	assert.ok(h.peak() > 1);
	const reads = h.readCalls.length;
	h.changed();
	await flush();
	assert.equal(h.events.filter((e) => e.kind === "indexed").length, 5);
	assert.equal(h.releases.length, 5);
	const final = await reader.update({});
	await reader.update({});
	assert.equal(h.readCalls.length - reads, 1);
	assert.deepEqual(final.pinned, []);
	assert.notEqual(final.tasks[0], first.tasks[0]);
	reader.close();
	shared.dispose();
	w.dispose();
});

test("line-changed refusal: changed within 500 ms → no recheck; no event → 1 recheck at 2000 ms; another write pins the note → no recheck", async () => {
	for (const mode of ["changed", "none", "pinned"]) {
		const h = writerHarness({ "a.md": "- [ ] A\n- [ ] B" });
		const w = h.create();
		await h.write({ path: "a.md", line: 0, sourceLine: "- [ ] stale" });
		await h.clock.advance(500);
		if (mode === "changed") h.changed();
		if (mode === "pinned") await h.write(h.target(1));
		await h.clock.advance(1500);
		assert.equal(h.events.filter((e) => e.kind === "recheck").length, mode === "none" ? 1 : 0);
		w.dispose();
	}
});

test("deleted and rename both release; rename marks both paths dirty", async () => {
	for (const renamed of [false, true]) {
		const h = writerHarness();
		const w = h.create();
		await h.write();
		if (renamed) h.rename("a.md", "b.md");
		else h.remove();
		await flush();
		assert.equal(h.releases.length, 1);
		if (renamed) {
			assert.ok(h.dirty.includes("a.md"));
			assert.ok(h.dirty.includes("b.md"));
		}
		w.dispose();
	}
});

test("GBK, Latin-1, Shift-JIS notes refused: bytes unchanged, 0 writes, process 1, readBinary 1, no markDirty, hold released", async () => {
	for (const tail of [[0xd6, 0xd0], [0xe9], [0x82, 0xa0]]) {
		const bytes = Uint8Array.from([...new TextEncoder().encode("- [ ] A "), ...tail]);
		const h = writerHarness({ "a.md": bytes });
		const w = h.create();
		const result = await h.write();
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, "not-utf8");
		assert.deepEqual(h.bytes.get("a.md"), bytes);
		assert.equal(h.writes.length, 0);
		assert.equal(h.processCalls.length, 1);
		assert.equal(h.binaryCalls.length, 1);
		assert.deepEqual(h.dirty, []);
		assert.deepEqual(h.releases, [{ path: "a.md", markDirty: false }]);
		w.dispose();
	}
});

test("UTF-8 note with a real U+FFFD writes: readBinary 1, process 2. No U+FFFD → no byte read", async () => {
	for (const replacement of ["", " �"]) {
		const h = writerHarness({ "a.md": `- [ ] A${replacement}` });
		const w = h.create();
		assert.equal((await h.write()).kind, "written");
		assert.equal(h.binaryCalls.length, replacement ? 1 : 0);
		assert.equal(h.processCalls.length, replacement ? 2 : 1);
		assert.equal(h.text(), `- [x] A${replacement} ✅ 2026-10-31`);
		w.dispose();
	}
});

test("BOM kept; a task on line 0 can be written", async () => {
	const h = writerHarness({ "a.md": "\uFEFF- [ ] A\n- [ ] B" });
	let received = "";
	const w = h.create({
		tasks: () => ({
			kind: "toggle",
			toggle: (line) => {
				received = line;
				return "- [x] A";
			},
		}),
	});
	assert.equal((await h.write()).kind, "written");
	assert.equal(received, "- [ ] A");
	assert.equal(h.text(), "\uFEFF- [x] A\n- [ ] B");
	assert.equal(h.binaryCalls.length, 0);
	w.dispose();
});

test("BOM + real U+FFFD UTF-8 note writes; CRLF + real U+FFFD note writes in a source view (both sides BOM-stripped and line-ending normalised)", async () => {
	for (const source of [false, true]) {
		const h = writerHarness({ "a.md": "\uFEFF- [ ] A �\r\nnext" });
		if (source) {
			const v = h.view("a.md", "source");
			v.data = v.data.replace(/^\uFEFF/, "");
			v.editorText = v.data;
			v.lastSavedData = v.data;
		}
		const w = h.create();
		assert.equal((await h.write()).kind, "written");
		assert.equal(h.binaryCalls.length, 1);
		assert.match(h.text(), /- \[x\] A � ✅ 2026-10-31/);
		w.dispose();
	}
});

test("GBK note open in a view with unsaved typing: not-utf8, view.save never called, bytes unchanged", async () => {
	const bytes = Uint8Array.from([...new TextEncoder().encode("- [ ] A "), 0xd6, 0xd0]);
	const h = writerHarness({ "a.md": bytes });
	const v = h.view();
	v.type(v.data + " typing");
	const w = h.create();
	const result = await h.write();
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "not-utf8");
	assert.equal(v.saves, 0);
	assert.deepEqual(h.bytes.get("a.md"), bytes);
	assert.equal(h.processCalls.length, 0);
	w.dispose();
});

test("note becomes non-UTF-8 between the byte read and the second process → line-changed. readBinary fails → failed", async () => {
	for (const fail of [false, true]) {
		const h = writerHarness({ "a.md": "- [ ] A �" });
		h.onBinary(
			() => {
				if (fail) throw new Error("binary unavailable");
			},
			() => {
				if (!fail) h.bytes.set("a.md", Uint8Array.from([...new TextEncoder().encode("- [ ] changed "), 0xff]));
			},
		);
		const w = h.create();
		const result = await h.write();
		assert.equal(result.kind, fail ? "failed" : "refused");
		if (result.kind === "refused") assert.equal(result.reason, "line-changed");
		assert.equal(h.writes.length, 0);
		assert.equal(h.binaryCalls.length, 1);
		assert.equal(h.processCalls.length, fail ? 1 : 2);
		w.dispose();
	}
});

test("BOM chain: after a write refused in fn on a BOM note, the note's parsed tasks are unchanged (no shifted text); retrying the line-0 task writes a file with exactly one BOM", async () => {
	const h = writerHarness({ "a.md": "\uFEFF- [ ] A\n- [ ] B" });
	const shared = createSharedTaskIndex({ app: h.app as never, moment, parseKey: () => parseKeyOf(moment) });
	const reader = shared.openReader();
	const initial = await reader.update({});
	assert.equal(initial.tasks.length, 2);
	const w = h.create({ index: shared });
	const refused = await h.write({ path: "a.md", line: 0, sourceLine: "- [ ] stale" });
	assert.equal(refused.kind, "refused");
	reader.rereadAll();
	const after = await reader.update({});
	assert.deepEqual(after.tasks, initial.tasks);
	assert.equal((await h.write()).kind, "written");
	assert.equal(h.text(), "\uFEFF- [x] A ✅ 2026-10-31\n- [ ] B");
	assert.equal([...h.text()].filter((ch) => ch === "\uFEFF").length, 1);
	w.dispose();
	reader.close();
	shared.dispose();
});

test("an impossible date is refused before calling Tasks, with or without Tasks, same message", async () => {
	for (const tasks of [false, true]) {
		let called = 0;
		const h = writerHarness({ "a.md": "- [ ] A 📅 2026-02-30" });
		const w = h.create({
			tasks: () =>
				tasks
					? {
							kind: "toggle",
							toggle: () => {
								called++;
								return "- [x] A";
							},
						}
					: { kind: "none" },
		});
		const result = await h.write();
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") {
			assert.equal(result.reason, "impossible-date");
			assert.equal(
				result.message,
				"“A” has a due date that does not exist (2026-02-30). Nothing was written. Fix it in the note.",
			);
		}
		assert.equal(called, 0);
		assert.equal(h.processCalls.length, 0);
		w.dispose();
	}
});

test('Tasks returning "Fecha inválida" is refused', async () => {
	const h = writerHarness();
	const w = h.create({ tasks: () => ({ kind: "toggle", toggle: () => "- [x] A ✅ Fecha inválida" }) });
	const result = await h.write();
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") {
		assert.equal(result.reason, "unreadable-date");
		assert.equal(
			result.message,
			"Tasks returned a date the timeline cannot read back (“Fecha”) for “A”. Nothing was written.",
		);
	}
	assert.equal(h.processCalls.length, 0);
	w.dispose();
});

test("after a recurring completion (delta +1), clicking b below with its pre-write line targets line 2", async () => {
	const first = "- [ ] a 🔁 every day";
	const h = writerHarness({ "a.md": `${first}\n- [ ] b` });
	const ledger = createShiftLedger();
	const w = h.create({
		tasks: () => ({
			kind: "toggle",
			toggle: (line) => (line === first ? "- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-31" : "- [x] b"),
		}),
	});
	const result = await h.write();
	assert.equal(result.kind, "written");
	if (result.kind !== "written") throw new Error("expected written");
	assert.equal(result.delta, 1);
	ledger.record("a.md", 0, result.delta, w.releaseSeq() + 1);
	const second = await w.write(() => ({ path: "a.md", line: ledger.shift("a.md", 1), sourceLine: "- [ ] b" }), {
		kind: "toggle",
	});
	assert.equal(second.kind, "written");
	assert.equal(h.text().split("\n")[2], "- [x] b");
	ledger.clearThrough(w.releaseSeq() + 1);
	assert.equal(ledger.shift("a.md", 1), 1);
	w.dispose();
});

test("identical line nearby → refused (ambiguous)", async () => {
	const first = "- [ ] a 🔁 every day";
	const h = writerHarness({ "a.md": `${first}\n- [ ] b\n- [ ] b` });
	const w = h.create({
		tasks: () => ({ kind: "toggle", toggle: () => "- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-31" }),
	});
	await h.write();
	const result = await h.write(h.target(2));
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") {
		assert.equal(result.reason, "ambiguous");
		assert.equal(
			result.message,
			"“b” appears more than once near here in a, and the timeline can't tell which one you clicked. Nothing was written.",
		);
	}
	assert.equal(h.processCalls.length, 1);
	w.dispose();
});

test("TZ America/Los_Angeles, clock 2026-10-24T23:59:30-07:00: completion without Tasks writes ✅ 2026-10-24; TZ Asia/Shanghai, clock 2026-10-25T00:00:30+08:00 writes ✅ 2026-10-25", async () => {
	const previous = process.env.TZ;
	try {
		for (const [zone, instant, day] of [
			["America/Los_Angeles", "2026-10-24T23:59:30-07:00", "2026-10-24"],
			["Asia/Shanghai", "2026-10-25T00:00:30+08:00", "2026-10-25"],
		]) {
			process.env.TZ = zone;
			const now = Date.parse(instant);
			const date = new Date(now);
			const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
			const h = writerHarness();
			const w = h.create({ now: () => now, today: () => dayKey(moment(local, "YYYY-MM-DD")) });
			assert.equal((await h.write()).kind, "written");
			assert.equal(h.text(), `- [x] A ✅ ${day}`);
			w.dispose();
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test('process rejects with "File system operation timed out." → may-not-have-been-saved notice; the next write to that note does not call process before a fake modify; other notes unaffected', async () => {
	const h = writerHarness({ "a.md": "- [ ] A", "b.md": "- [ ] B" });
	h.onProcess(() => {
		throw new Error("File system operation timed out.");
	});
	const w = h.create();
	const result = await h.write();
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
	assert.equal(
		h.notices[0],
		"a may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.",
	);
	h.onProcess();
	const next = await h.write();
	assert.equal(next.kind, "refused");
	if (next.kind === "refused") assert.equal(next.reason, "queue-blocked");
	assert.equal(h.processCalls.length, 1);
	assert.equal((await h.write(h.target(0, "b.md"))).kind, "written");
	h.app.vault.trigger("modify", h.app.vault.getFileByPath("a.md"));
	assert.equal((await h.write()).kind, "written");
	w.dispose();
});

test("save-first (check 5) never returns → may-not-have-been-saved at 60 s, overlay cleared, queue blocked", async () => {
	const h = writerHarness();
	const v = h.view();
	v.type("- [ ] A\nunsaved");
	const gate = deferred();
	v.beforeSave = () => gate.promise;
	const w = h.create();
	const pending = h.write();
	await flush();
	await h.clock.advance(60_000);
	const result = await pending;
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
	assert.equal(
		h.notices[0],
		"a may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.",
	);
	assert.equal(h.events.filter((e) => e.kind === "failed" && e.unknownOutcome).length, 1);
	assert.equal(h.events.filter((e) => e.kind === "released").length, 1);
	const blocked = await h.write();
	assert.equal(blocked.kind, "refused");
	if (blocked.kind === "refused") assert.equal(blocked.reason, "queue-blocked");
	assert.equal(h.processCalls.length, 0);
	w.dispose();
	gate.resolve();
	await flush();
});

test('toggle → un-toggle → toggle within 2 s, one changed each → all three indexed, no "Saved in…"', async () => {
	const h = writerHarness();
	const w = h.create();
	for (let i = 0; i < 3; i++) {
		const result = await h.write();
		assert.equal(result.kind, "written");
		h.changed();
		await flush();
		if (result.kind === "written") await result.indexed;
		await h.clock.advance(500);
	}
	await h.clock.advance(10_000);
	assert.equal(h.events.filter((e) => e.kind === "indexed").length, 3);
	assert.equal(h.releases.length, 3);
	assert.deepEqual(h.notices, []);
	assert.equal(w.releaseSeq(), 3);
	w.dispose();
});

test("date edits refuse date-ambiguous, date-unreadable and date-style-mixed with their texts", async () => {
	const cases = [
		[
			"- [ ] A 📅 2026-11-01 📅 2026-11-02",
			"date-ambiguous",
			"“A” has more than one due date (2026-11-01 and 2026-11-02). Nothing was changed. Keep one of them in the note, then try again.",
		],
		[
			"- [ ] A [due:: tomorrow]",
			"date-unreadable",
			"“A” has its due date written as tomorrow, which the timeline cannot change. Nothing was changed. Edit it in the note.",
		],
		[
			"- [ ] A (due:: 2026-11-01)",
			"date-unreadable",
			"“A (due:: 2026-11-01)” has its due date written as (due:: 2026-11-01), which the timeline cannot change. Nothing was changed. Edit it in the note.",
		],
		[
			"- [ ] A ⏳ 2026-11-01 [start:: 2026-11-01]",
			"date-style-mixed",
			"“A” uses both emoji dates and [key:: value] fields, so the timeline cannot tell which style to add. Nothing was changed. Add the due date in the note.",
		],
	];
	for (const [sourceLine, reason, message] of cases) {
		const h = writerHarness({ "a.md": sourceLine });
		const w = h.create();
		const result = await h.write(h.target(), { kind: "date", field: "due", day: dayKey(moment("2026-11-03")) });
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") {
			assert.equal(result.reason, reason);
			assert.equal(result.message, message);
		}
		assert.equal(h.processCalls.length, 0);
		w.dispose();
	}
});

test("a replace (dialog Apply) is checked with origin edit and written", async () => {
	const original = "- [ ] A 🔁 every day 📅 2026-02-30";
	const h = writerHarness({ "a.md": original });
	let tasks = 0;
	const w = h.create({
		tasks: () => {
			tasks++;
			return { kind: "none" };
		},
	});
	const result = await h.write(h.target(), { kind: "replace", expected: original, lines: ["- [ ] edited A"] });
	assert.equal(result.kind, "written");
	assert.equal(h.text(), "- [ ] edited A");
	assert.equal(tasks, 0);
	if (result.kind === "written") assert.ok(result.undo);
	w.dispose();
});

test("a source save in progress uses saveAgain and eventually saves the writer's transaction", async () => {
	const h = writerHarness();
	const v = h.view("a.md", "source");
	const gate = deferred();
	v.type("- [ ] A\nunsaved");
	v.beforeSave = () => gate.promise;
	const saving = v.save();
	await flush();
	const w = h.create();
	const result = await h.write();
	assert.equal(result.kind, "written");
	assert.equal(v.saveAgain, true);
	assert.equal(h.writes.length, 0);
	gate.resolve();
	await saving;
	assert.equal(h.text(), "- [x] A ✅ 2026-10-31\nunsaved");
	h.changed();
	await flush();
	if (result.kind === "written") await result.indexed;
	w.dispose();
});

test("per-note queues read target when its turn comes and leave other notes independent", async () => {
	const h = writerHarness({ "a.md": "- [ ] A", "b.md": "- [ ] B" });
	const gate = deferred();
	let calls = 0;
	h.onProcess(() => (++calls === 1 ? gate.promise : undefined));
	const w = h.create();
	const first = h.write();
	await flush();
	let target = h.target();
	const second = w.write(() => target, { kind: "toggle" });
	assert.equal((await h.write(h.target(0, "b.md"))).kind, "written");
	target = { ...target, sourceLine: "- [x] A ✅ 2026-10-31" };
	gate.resolve();
	assert.equal((await first).kind, "written");
	assert.equal((await second).kind, "written");
	assert.equal(h.text(), "- [ ] A");
	w.dispose();
});

test("changed with P also present in cachedRead releases as other text", async () => {
	const h = writerHarness();
	const w = h.create();
	await h.write();
	h.cache.set("a.md", "- [ ] A");
	h.changed("a.md", "- [ ] A");
	await flush();
	assert.equal(h.releases.length, 1);
	w.dispose();
});

test("closing a popout keeps main-window timers, and dispose releases each hold and cancels them", async () => {
	const h = writerHarness();
	h.view();
	const w = h.create();
	await h.write();
	h.leaves.splice(0);
	await h.clock.advance(10_000);
	assert.equal(h.events.filter((e) => e.kind === "slow").length, 1);
	w.dispose();
	w.dispose();
	assert.equal(h.releases.length, 1);
	assert.equal(h.clock.count(), 0);
});

test("the queue block expires after two minutes without modify", async () => {
	const h = writerHarness();
	h.onProcess(() => {
		throw new Error("File system operation timed out.");
	});
	const w = h.create();
	await h.write();
	h.onProcess();
	await h.clock.advance(120_000);
	assert.equal((await h.write()).kind, "written");
	w.dispose();
});

test("preflight rejects nested markers, missing notes, recurrence loss and malformed output before writing", async () => {
	for (const source of ["- - [ ] foo", "1. - [ ] foo"]) {
		const h = writerHarness({ "a.md": source });
		const w = h.create();
		const result = await h.write();
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, "not-task-line");
		assert.equal(h.processCalls.length, 0);
		w.dispose();
	}
	for (const source of ["  > - [ ] foo", "1) [ ] foo"]) {
		const h = writerHarness({ "a.md": source });
		const w = h.create();
		assert.equal((await h.write()).kind, "written");
		w.dispose();
	}
	for (const [source, output, reason] of [
		["- [ ] A", "not a task", "bad-output"],
		["- [ ] A 🔁 every day", "- [x] A", "recurrence-lost"],
	]) {
		const h = writerHarness({ "a.md": source });
		const w = h.create({ tasks: () => ({ kind: "toggle", toggle: () => output }) });
		const result = await h.write();
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") assert.equal(result.reason, reason);
		assert.equal(h.processCalls.length, 0);
		w.dispose();
	}
	const h = writerHarness();
	const w = h.create();
	h.remove();
	const result = await h.write({ path: "a.md", line: 0, sourceLine: "- [ ] A" });
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.message, "a was moved or deleted. Nothing was written.");
	w.dispose();
});

test("date writes and removals use the selected style and do not call Tasks; unchanged checks open views", async () => {
	const h = writerHarness();
	const w = h.create({
		newDateStyle: () => "dataview",
		tasks: () => {
			throw new Error("date must not consult Tasks");
		},
	});
	const day = dayKey(moment("2026-11-02"));
	assert.equal((await h.write(h.target(), { kind: "date", field: "due", day })).kind, "written");
	assert.equal(h.text(), "- [ ] A  [due:: 2026-11-02]");
	assert.equal((await h.write(h.target(), { kind: "date", field: "due", day })).kind, "unchanged");
	assert.equal((await h.write(h.target(), { kind: "date", field: "due", day: null })).kind, "written");
	assert.equal(h.text(), "- [ ] A");
	const v = h.view("a.md", "source");
	v.editorText = "- [ ] A typed in editor";
	const result = await h.write(h.target(), { kind: "date", field: "due", day: null });
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "line-changed");
	w.dispose();
	const impossible = writerHarness({ "a.md": "- [ ] A 📅 2026-02-30" });
	const fixed = impossible.create();
	assert.equal((await impossible.write(impossible.target(), { kind: "date", field: "due", day })).kind, "written");
	assert.equal(impossible.text(), "- [ ] A 📅 2026-11-02");
	fixed.dispose();
});

test("recurring without Tasks refuses with its text and leaves continuation lines untouched", async () => {
	const h = writerHarness({ "a.md": "- [ ] A 🔁 every day\n  continuation\n  - [ ] subtask" });
	const w = h.create();
	const result = await h.write();
	assert.equal(result.kind, "refused");
	if (result.kind === "refused")
		assert.equal(result.message, "Recurring tasks need the Tasks plugin. Nothing was written.");
	assert.equal(h.writes.length, 0);
	w.dispose();
	const plain = writerHarness({ "a.md": "- [ ] A\n  continuation\n  - [ ] subtask" });
	const wp = plain.create();
	assert.equal((await plain.write()).kind, "written");
	assert.equal(plain.text(), "- [x] A ✅ 2026-10-31\n  continuation\n  - [ ] subtask");
	wp.dispose();
});

test("written results, pending lines and release events are frozen and ordered", async () => {
	const h = writerHarness();
	const w = h.create();
	const result = await h.write();
	assert.ok(Object.isFrozen(result));
	const pending = h.events.find((event) => event.kind === "pending");
	assert.ok(pending);
	assert.ok(Object.isFrozen(pending));
	assert.ok(Object.isFrozen(pending.lines));
	assert.deepEqual(pending.lines, ["- [x] A ✅ 2026-10-31"]);
	assert.equal(h.events[0].kind, "pending");
	h.changed();
	await flush();
	const released = h.events.filter((event) => event.kind === "released");
	assert.equal(released.length, 1);
	assert.equal(released[0].releaseSeq, w.releaseSeq());
	w.dispose();
});

test("other metadata text, deletion and rename release without a later slow notice or row block", async () => {
	for (const reason of ["other", "deleted", "renamed"]) {
		const h = writerHarness();
		const w = h.create();
		await h.write();
		if (reason === "other") h.changed("a.md", "- [ ] external edit");
		else if (reason === "deleted") h.remove();
		else h.rename("a.md", "b.md");
		await flush();
		await h.clock.advance(10_000);
		assert.equal(h.releases.length, 1);
		assert.deepEqual(h.notices, []);
		assert.equal(h.events.filter((event) => event.kind === "slow").length, 0);
		w.dispose();
	}
});

test("an old P read finishing after newer metadata cannot release a later write", async () => {
	const h = writerHarness();
	const w = h.create();
	await h.write();
	const originalRead = h.app.vault.cachedRead;
	const gate = deferred<string>();
	let wait = true;
	h.app.vault.cachedRead = async (file) => {
		if (wait) {
			wait = false;
			return gate.promise;
		}
		return originalRead(file);
	};
	h.changed("a.md", "- [ ] A");
	await flush();
	h.changed();
	await flush();
	assert.equal(h.releases.length, 1);
	assert.equal(
		(await h.write(h.target(), { kind: "date", field: "due", day: dayKey(moment("2026-11-02")) })).kind,
		"written",
	);
	gate.resolve("- [ ] A");
	await flush();
	assert.equal(h.releases.length, 1);
	assert.equal(h.holds.get("a.md"), 1);
	w.dispose();
});

test("delete, rename or dispose during save-first cannot acquire a late hold", async () => {
	for (const action of ["delete", "rename", "dispose"]) {
		const h = writerHarness();
		const view = h.view();
		view.type("- [ ] A\nunsaved");
		const gate = deferred();
		view.beforeSave = () => gate.promise;
		const w = h.create();
		const pending = h.write();
		await flush();
		if (action === "delete") h.remove();
		else if (action === "rename") h.rename("a.md", "b.md");
		else w.dispose();
		gate.resolve();
		const result = await pending;
		assert.notEqual(result.kind, "written");
		assert.equal(h.processCalls.length, 0);
		assert.equal(h.holds.size, 0);
		assert.equal(h.releases.length, 0);
		w.dispose();
	}
});

test("the hold cap counts from acquisition even when process takes 59 seconds", async () => {
	const h = writerHarness();
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const w = h.create();
	const pending = h.write();
	await flush();
	await h.clock.advance(59_000);
	gate.resolve();
	assert.equal((await pending).kind, "written");
	await h.clock.advance(61_000);
	assert.equal(h.releases.length, 1);
	assert.equal(h.warnings.length, 1);
	assert.equal(h.events.filter((event) => event.kind === "recheck").length, 1);
	w.dispose();
});

test("a queued replace snapshots caller input without freezing the caller's edit or lines", async () => {
	const h = writerHarness();
	const gate = deferred();
	let calls = 0;
	h.onProcess(() => (++calls === 1 ? gate.promise : undefined));
	const w = h.create();
	const first = h.write();
	await flush();
	const lines = ["- [ ] edited A"];
	const edit = { kind: "replace" as const, expected: "- [x] A ✅ 2026-10-31", lines };
	const second = w.write(() => ({ path: "a.md", line: 0, sourceLine: "- [x] A ✅ 2026-10-31" }), edit);
	lines[0] = "- [ ] later mutation";
	edit.expected = "- [ ] changed expectation";
	gate.resolve();
	await first;
	assert.equal((await second).kind, "written");
	assert.equal(h.text(), "- [ ] edited A");
	assert.equal(Object.isFrozen(edit), false);
	assert.equal(Object.isFrozen(lines), false);
	lines.push("still caller-owned");
	w.dispose();
});

test("date ambiguity names actual fields rather than commented dates or a calendar in the description", async () => {
	const h = writerHarness({ "a.md": "- [ ] A %% 📅 1999-01-01 %% 📅 calendar 📅 2026-11-01 📅 2026-11-02" });
	const w = h.create();
	const result = await h.write(h.target(), { kind: "date", field: "due", day: dayKey(moment("2026-11-03")) });
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") {
		assert.equal(result.reason, "date-ambiguous");
		assert.ok(result.message.includes("has more than one due date (2026-11-01 and 2026-11-02)."));
	}
	w.dispose();
});

test("a read failing during the ambiguity check reports a certain failure without another process", async () => {
	const h = writerHarness({ "a.md": "- [ ] A 🔁 every day\n- [ ] B" });
	const w = h.create({
		tasks: () => ({ kind: "toggle", toggle: () => "- [ ] A 🔁 every day\n- [x] A 🔁 every day ✅ 2026-10-31" }),
	});
	assert.equal((await h.write()).kind, "written");
	h.app.vault.cachedRead = async () => {
		throw new Error("cache unavailable");
	};
	const result = await h.write(h.target(2));
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.unknownOutcome, false);
	assert.deepEqual(h.notices, ["Could not write to a: cache unavailable"]);
	assert.equal(h.errors.length, 1);
	assert.equal(h.processCalls.length, 1);
	w.dispose();
});
