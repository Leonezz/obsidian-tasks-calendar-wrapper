import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createShiftLedger, type UndoRecord, type WriteResult } from "../timeline/src/taskwriter";
import { createNoticePresenter } from "../timeline/src/notices";
import { FakeElement, Notice } from "./stubs/obsidian";
import { deferred, flush, writerHarness } from "./writer-harness";

function undoRecord(result: WriteResult): UndoRecord {
	assert.equal(result.kind, "written");
	if (result.kind !== "written" || !result.undo) throw new Error("expected an undo record");
	return result.undo;
}

const documentStub = {
	createDocumentFragment: () => new FakeElement("#fragment"),
	createElement: (tag: string) => new FakeElement(tag),
	createTextNode: (text: string) => new FakeElement("#text", { text }),
} as unknown as Document;

test("undo of a plain completion restores byte-exact; Tasks called once", async () => {
	for (const source of [false, true]) {
		const original = "\uFEFF- [ ] A  \n  continuation\n  - [ ] subtask";
		const h = writerHarness({ "a.md": original });
		const view = source ? h.view("a.md", "source") : undefined;
		let calls = 0;
		const writer = h.create({
			tasks: () => ({
				kind: "toggle",
				toggle: (line) => {
					assert.equal(line, "- [ ] A  ");
					calls++;
					return "- [x] A ✅ 2026-10-31  ";
				},
			}),
		});
		const record = undoRecord(await h.write());
		assert.equal(record.original, "- [ ] A  ");
		const result = await h.write(h.target(), { kind: "undo", record });
		assert.equal(result.kind, "written");
		if (result.kind !== "written") throw new Error("expected written");
		assert.equal(result.delta, 0);
		assert.equal(result.undo, undefined);
		assert.equal(h.text(), original);
		assert.equal(calls, 1);
		assert.deepEqual(h.notices, ["Undid the change to “A”."]);
		assert.equal(h.peak(), 2);
		await h.deliver();
		await result.indexed;
		assert.equal(h.holds.get("a.md"), 0);
		if (view) {
			assert.equal(h.processCalls.length, 0);
			assert.equal(view.transactions.length, 2);
			assert.equal(view.transactions[1].origin, "tasks-calendar-wrapper");
		}
		writer.dispose();
	}
	const original = "\uFEFF- [ ] A\r\nnext\r\n";
	const h = writerHarness({ "a.md": original });
	const writer = h.create();
	const record = undoRecord(await h.write());
	assert.equal((await h.write(h.target(), { kind: "undo", record })).kind, "written");
	assert.equal(h.text(), original);
	writer.dispose();
});

test("undo of a recurring completion removes the new occurrence, delta −1, Tasks not called", async () => {
	for (const source of [false, true]) {
		const task = "- [ ] A 🔁 every day";
		const original = `header\n${task}\nfooter`;
		const h = writerHarness({ "a.md": original });
		const view = source ? h.view("a.md", "source") : undefined;
		let calls = 0;
		const writer = h.create({
			tasks: () => ({
				kind: "toggle",
				toggle: () => {
					calls++;
					return `${task}\n- [x] A 🔁 every day ✅ 2026-10-31`;
				},
			}),
		});
		const record = undoRecord(await h.write(h.target(1)));
		const result = await h.write(h.target(1), { kind: "undo", record });
		assert.equal(result.kind, "written");
		if (result.kind !== "written") throw new Error("expected written");
		assert.equal(result.delta, -1);
		assert.equal(result.undo, undefined);
		assert.equal(calls, 1);
		assert.equal(h.text(), original);
		if (view) {
			assert.deepEqual(view.transactions[1], {
				transaction: {
					changes: [
						{
							from: { line: 1, ch: 0 },
							to: { line: 2, ch: "- [x] A 🔁 every day ✅ 2026-10-31".length },
							text: task,
						},
					],
				},
				origin: "tasks-calendar-wrapper",
			});
		}
		writer.dispose();
	}
});

test("undo records follow the line shifts of own later writes", async () => {
	const repeating = "- [ ] repeat 🔁 every day";
	const h = writerHarness({ "a.md": `${repeating}\n- [ ] B\nfooter` });
	const writer = h.create({
		tasks: () => ({
			kind: "toggle",
			toggle: (line) =>
				line === repeating ? `${repeating}\n- [x] repeat 🔁 every day ✅ 2026-10-31` : "- [x] B",
		}),
	});
	const record = undoRecord(await h.write(h.target(1)));
	const above = undoRecord(await h.write(h.target(0)));
	assert.equal(Object.isFrozen(record), true);
	assert.equal(record.line, 1);
	assert.equal((await h.write(h.target(1), { kind: "undo", record })).kind, "written");
	assert.equal(h.text().split("\n")[2], "- [ ] B");
	assert.equal((await h.write(h.target(0), { kind: "undo", record: above })).kind, "written");
	assert.equal(h.text(), `${repeating}\n- [ ] B\nfooter`);
	writer.dispose();
});

test('after Ctrl+Z in the editor restored the line, Undo → unchanged with alreadyUndone, the 4 s "is already back" notice, nothing written; after Ctrl+Z then another edit of that line, Undo → refused undo-changed, message exact; undo after the note was deleted → refused', async () => {
	for (const action of ["restored", "edited", "deleted", "moved"]) {
		Notice.instances = [];
		const h = writerHarness({ "a.md": "above\n- [ ] A\nbelow" });
		const view = h.view("a.md", "source");
		const notices = createNoticePresenter(h.app as never, { document: documentStub });
		const writer = h.create({ notices });
		const record = undoRecord(await h.write(h.target(1)));
		await h.deliver();
		if (action === "deleted") h.remove();
		else if (action === "moved") h.rename("a.md", "b.md");
		else {
			view.type(`above\n- [ ] A${action === "edited" ? " edited" : ""}\nbelow`);
			await view.save();
			await h.deliver();
		}
		const writes = h.writes.length;
		const transactions = view.transactions.length;
		const result = await h.write({ path: "a.md", line: 1, sourceLine: "- [ ] A" }, { kind: "undo", record });
		if (action === "restored") {
			assert.deepEqual(result, { kind: "unchanged", alreadyUndone: true });
			assert.equal(Notice.instances.at(-1)?.message, "“A” in a is already back to how it was.");
			assert.equal(Notice.instances.at(-1)?.duration, 4000);
		} else {
			assert.equal(result.kind, "refused");
			if (result.kind !== "refused") throw new Error("expected refused");
			assert.equal(result.reason, action === "edited" ? "undo-changed" : "moved-or-deleted");
			assert.equal(
				result.message,
				action === "edited"
					? "Could not undo: “A” in a changed or moved after the timeline wrote it. Nothing was written."
					: "Could not undo: a was moved or deleted. Nothing was written.",
			);
			if (action === "edited") {
				assert.ok(h.dirty.includes("a.md"));
				await h.clock.advance(2000);
				assert.ok(h.events.some((event) => event.kind === "recheck"));
				assert.equal(Notice.instances.at(-1)?.duration, 8000);
				const buttons = (Notice.instances.at(-1)?.message as FakeElement).children.filter(
					(child): child is FakeElement => child instanceof FakeElement && child.tag === "button",
				);
				assert.deepEqual(
					buttons.map((button) => button.textContent),
					["Open note"],
				);
			}
		}
		assert.equal(h.writes.length, writes);
		assert.equal(view.transactions.length, transactions);
		writer.dispose();
		notices.dispose();
	}
});

test("two lines both `- [ ] Take pill 🏁 delete`: complete line 3 (deleted, line 4 moves up), Undo → re-inserted normally, not already-undone", async () => {
	for (const source of [false, true]) {
		const task = "- [ ] Take pill 🏁 delete";
		const original = `one\ntwo\nthree\n${task}\n${task}\nfooter`;
		const h = writerHarness({ "a.md": original });
		if (source) h.view("a.md", "source");
		const writer = h.create();
		const record = undoRecord(await h.write(h.target(3)));
		const result = await h.write(h.target(3), { kind: "undo", record });
		assert.equal(result.kind, "written");
		assert.equal(h.text(), original);
		assert.equal(h.writes.length, 2);
		writer.dispose();
	}
});

test("undo of a 🏁 delete re-inserts in place for a middle, first and last line; refused when neighbours changed", async () => {
	for (const source of [false, true]) {
		for (const line of [0, 1, 2]) {
			for (const change of ["none", "above", "below"]) {
				const original = ["above", "middle", "below"]
					.map((text, i) => (i === line ? "- [ ] A 🏁 delete" : text))
					.join("\n");
				const h = writerHarness({ "a.md": original });
				const view = source ? h.view("a.md", "source") : undefined;
				const writer = h.create();
				const record = undoRecord(await h.write(h.target(line)));
				await h.deliver();
				if (change !== "none") {
					const lines = h.text().split("\n");
					if (change === "above") {
						if (line === 0) lines.unshift("new above");
						else lines[line - 1] = "changed above";
					} else if (line === 2) lines.push("new below");
					else lines[line] = "changed below";
					h.put("a.md", lines.join("\n"));
					view?.type(lines.join("\n"));
				}
				const writes = h.writes.length;
				const result = await h.write(h.target(line), { kind: "undo", record });
				assert.equal(result.kind, change === "none" ? "written" : "refused");
				if (change === "none") {
					assert.equal(h.text(), original);
					if (view && line < 2) {
						assert.deepEqual(view.transactions[1], {
							transaction: {
								changes: [{ from: { line, ch: 0 }, to: { line, ch: 0 }, text: "- [ ] A 🏁 delete\n" }],
							},
							origin: "tasks-calendar-wrapper",
						});
					}
				} else {
					assert.equal(h.writes.length, writes);
					if (result.kind === "refused") assert.equal(result.reason, "undo-changed");
				}
				writer.dispose();
			}
		}
	}
});

test("after quick entry inserts at line 1, a row read at line 3 targets line 4", async () => {
	const h = writerHarness({ "a.md": "header\none\ntwo\n- [ ] B" });
	const writer = h.create();
	const ledger = createShiftLedger();
	const result = await writer.insert("a.md", (text) => text.replace("header\n", "header\n- [ ] new\n"));
	assert.equal(result.kind, "written");
	if (result.kind !== "written") throw new Error("expected written");
	assert.equal(result.delta, 1);
	assert.equal(result.undo, undefined);
	const event = h.events.find((item) => item.kind === "written");
	assert.equal(event?.line, 1);
	ledger.record("a.md", event!.line, result.delta, writer.releaseSeq() + 1);
	assert.equal(
		(
			await writer.write(() => ({ path: "a.md", line: ledger.shift("a.md", 3), sourceLine: "- [ ] B" }), {
				kind: "toggle",
			})
		).kind,
		"written",
	);
	assert.equal(h.text().split("\n")[4], "- [x] B ✅ 2026-10-31");
	writer.dispose();
});

test("an undo record shifts with a quick entry above it", async () => {
	const h = writerHarness({ "a.md": "header\none\ntwo\n- [ ] B" });
	const writer = h.create();
	const record = undoRecord(await h.write(h.target(3)));
	assert.equal(
		(await writer.insert("a.md", (text) => text.replace("header\n", "header\n- [ ] new\n"))).kind,
		"written",
	);
	assert.equal(
		(await h.write({ path: "a.md", line: 3, sourceLine: "- [ ] B" }, { kind: "undo", record })).kind,
		"written",
	);
	assert.equal(h.text(), "header\n- [ ] new\none\ntwo\n- [ ] B");
	assert.equal(record.line, 3);
	writer.dispose();
});

test("Undo after the undo notice was hovered > 60 s → undoes normally; after the record was pushed out by the 51st → too long ago", async () => {
	const h = writerHarness(Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`${i}.md`, `- [ ] task ${i}`])));
	const writer = h.create();
	const hovered = undoRecord(await h.write(h.target(0, "0.md")));
	await h.deliver();
	await h.clock.advance(61_000);
	assert.equal((await h.write(h.target(0, "0.md"), { kind: "undo", record: hovered })).kind, "written");
	const oldest = undoRecord(await h.write(h.target(0, "1.md")));
	for (let i = 2; i <= 51; i++) undoRecord(await h.write(h.target(0, `${i}.md`)));
	const writes = h.writes.length;
	const result = await h.write(h.target(0, "1.md"), { kind: "undo", record: oldest });
	assert.equal(result.kind, "refused");
	if (result.kind === "refused")
		assert.equal(result.message, "Could not undo: the change to “task 1” was too long ago. Nothing was written.");
	assert.equal(h.writes.length, writes);
	writer.dispose();
});

test("undo records are pushed out at the 51st and their notice is hidden", async () => {
	Notice.instances = [];
	const h = writerHarness(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`${i}.md`, `- [ ] task ${i}`])));
	const notices = createNoticePresenter(h.app as never, { document: documentStub });
	const writer = h.create({ notices });
	const first = undoRecord(await h.write(h.target(0, "0.md")));
	const notice = notices.undo({ path: "0.md", line: 0, text: "task 0" }, { kind: "complete" }, () => {});
	const gone: UndoRecord[] = [];
	const unsubscribe = writer.onUndoGone((record) => {
		gone.push(record);
		if (record === first) notice.hide();
	});
	for (let i = 1; i < 50; i++) undoRecord(await h.write(h.target(0, `${i}.md`)));
	assert.equal(Notice.instances[0].hidden, false);
	assert.deepEqual(gone, []);
	undoRecord(await h.write(h.target(0, "50.md")));
	assert.equal(Notice.instances[0].hidden, true);
	assert.deepEqual(gone, [first]);
	writer.forgetUndo(first);
	assert.deepEqual(gone, [first]);
	unsubscribe();
	writer.dispose();
	notices.dispose();
});

test("undo of a dialog edit adds the dialog sentence", async () => {
	Notice.instances = [];
	const h = writerHarness();
	const notices = createNoticePresenter(h.app as never, { document: documentStub });
	const writer = h.create({ notices });
	const record = undoRecord(
		await h.write(h.target(), { kind: "replace", expected: "- [ ] A", lines: ["- [ ] edited"] }),
	);
	assert.equal((await h.write(h.target(), { kind: "undo", record })).kind, "written");
	assert.equal(
		Notice.instances.at(-1)?.message,
		"Undid the change to “A”. Changes the Tasks dialog made to other tasks are not undone.",
	);
	assert.equal(Notice.instances.at(-1)?.duration, 4000);
	assert.equal(h.text(), "- [ ] A");
	writer.dispose();
	notices.dispose();
});

test("Undo 1 s after a toggle, Obsidian drops the first write's metadata task → no \"Saved in…\" at 10 s, no not-reread, no extra reload; the first write's token is released once, a second release does not change the count", async () => {
	const h = writerHarness();
	const writer = h.create();
	const record = undoRecord(await h.write());
	h.pending.splice(0);
	await h.clock.advance(1000);
	const result = await h.write(h.target(), { kind: "undo", record });
	assert.equal(result.kind, "written");
	await h.deliver();
	if (result.kind === "written") await result.indexed;
	assert.equal(h.releases.length, 2);
	assert.equal(h.holds.get("a.md"), 0);
	const sequence = writer.releaseSeq();
	h.changed();
	await flush();
	assert.equal(h.releases.length, 2);
	assert.equal(writer.releaseSeq(), sequence);
	await h.clock.advance(10_000);
	assert.deepEqual(h.notices, ["Undid the change to “A”."]);
	assert.equal(
		h.events.some(
			(event) =>
				event.kind === "recheck" ||
				event.kind === "overwritten" ||
				event.kind === "slow" ||
				event.reason === "not-reread",
		),
		false,
	);
	assert.equal(h.events.filter((event) => event.kind === "released" && event.id === record.id).length, 1);
	assert.equal((await h.write()).kind, "written");
	writer.dispose();
});

test("Undo with unknown outcome (save never returns, 60 s) → only may-not-have-been-saved, no revert notice", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const writer = h.create();
	const record = undoRecord(await h.write());
	await h.deliver();
	const save = deferred();
	view.beforeSave = () => save.promise;
	const pending = h.write(h.target(), { kind: "undo", record });
	await h.clock.advance(60_000);
	const result = await pending;
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
	assert.deepEqual(h.notices, [
		"a may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.",
	]);
	assert.equal(
		h.events.some((event) => event.kind === "overwritten"),
		false,
	);
	assert.equal(h.holds.get("a.md"), 0);
	save.resolve();
	await flush();
	writer.dispose();
});

test("a forgotten undo record refuses without writing", async () => {
	const h = writerHarness();
	const writer = h.create();
	const record = undoRecord(await h.write());
	writer.forgetUndo(record);
	const writes = h.writes.length;
	const result = await h.write(h.target(), { kind: "undo", record });
	assert.equal(result.kind, "refused");
	if (result.kind === "refused")
		assert.equal(result.message, "Could not undo: the change to “A” was too long ago. Nothing was written.");
	assert.equal(h.writes.length, writes);
	writer.dispose();
});

test("Undo clicked before its notice disappears still runs after forgetUndo", async () => {
	const h = writerHarness();
	const writer = h.create();
	const record = undoRecord(await h.write());
	const undo = h.write(h.target(), { kind: "undo", record });
	writer.forgetUndo(record);
	assert.equal((await undo).kind, "written");
	assert.equal(h.text(), "- [ ] A");
	assert.deepEqual(h.notices, ["Undid the change to “A”."]);
	writer.dispose();
});

test("a clicked Undo keeps following queued line shifts after its notice disappears", async () => {
	const h = writerHarness({ "a.md": "header\n- [ ] A" });
	const writer = h.create();
	const record = undoRecord(await h.write(h.target(1)));
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const insert = writer.insert("a.md", (text) => "another header\n" + text);
	await flush();
	const undo = h.write(h.target(1), { kind: "undo", record });
	writer.forgetUndo(record);
	gate.resolve();
	assert.equal((await insert).kind, "written");
	assert.equal((await undo).kind, "written");
	assert.equal(h.text(), "another header\nheader\n- [ ] A");
	writer.dispose();
});

test("undo checks every written line in every open view", async () => {
	const task = "- [ ] A 🔁 every day";
	const h = writerHarness({ "a.md": task });
	const writer = h.create({
		tasks: () => ({ kind: "toggle", toggle: () => `${task}\n- [x] A 🔁 every day ✅ 2026-10-31` }),
	});
	const record = undoRecord(await h.write());
	await h.deliver();
	const source = h.view("a.md", "source");
	const view = h.view();
	view.type(`${task}\n- [x] another task`);
	view.save = async () => {};
	const writes = h.writes.length;
	const result = await h.write(h.target(), { kind: "undo", record });
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") assert.equal(result.reason, "undo-changed");
	assert.equal(h.writes.length, writes);
	assert.equal(source.transactions.length, 0);
	writer.dispose();
});

test("undo restores an unreadable original date without running replacement checks or Tasks", async () => {
	const original = "- [ ] A 📅 2026-02-30";
	const h = writerHarness({ "a.md": original });
	const writer = h.create({
		tasks: () => {
			throw new Error("undo must not consult Tasks");
		},
	});
	const record = undoRecord(await h.write(h.target(), { kind: "date", field: "due", day: null }));
	assert.equal((await h.write(h.target(), { kind: "undo", record })).kind, "written");
	assert.equal(h.text(), original);
	writer.dispose();
});

test("quick entry holds until metadata, has no undo record, and shows Saved in after 10 s", async () => {
	const h = writerHarness();
	const writer = h.create();
	const result = await writer.insert("a.md", (text) => `${text}\n- [ ] B`);
	assert.equal(result.kind, "written");
	if (result.kind !== "written") throw new Error("expected written");
	assert.equal(result.delta, 1);
	assert.equal(result.undo, undefined);
	assert.equal(h.holds.get("a.md"), 1);
	let indexed = false;
	void result.indexed.then(() => {
		indexed = true;
	});
	await h.clock.advance(9999);
	assert.deepEqual(h.notices, []);
	assert.equal(indexed, false);
	await h.clock.advance(1);
	assert.deepEqual(h.notices, ["Saved in a. The timeline will show the change once Obsidian has re-read the note."]);
	await h.deliver();
	await result.indexed;
	assert.equal(h.holds.get("a.md"), 0);
	assert.equal(h.releases.length, 1);
	writer.dispose();
	assert.equal(h.releases.length, 1);
});

test("quick entry times out at 60 s and blocks that note's queue until modify", async () => {
	const h = writerHarness({ "a.md": "- [ ] A", "b.md": "- [ ] B" });
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const writer = h.create();
	const pending = writer.insert("a.md", (text) => `${text}\n- [ ] inserted`);
	await flush();
	assert.equal(h.holds.get("a.md"), 1);
	await h.clock.advance(60_000);
	const result = await pending;
	assert.equal(result.kind, "failed");
	if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
	assert.deepEqual(h.notices, [
		"a may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.",
	]);
	assert.equal(h.holds.get("a.md"), 0);
	h.onProcess();
	const refused = await writer.insert("a.md", (text) => `${text}\n- [ ] again`);
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.reason, "queue-blocked");
	assert.equal(h.processCalls.length, 1);
	assert.equal((await writer.insert("b.md", (text) => `${text}\n- [ ] allowed`)).kind, "written");
	gate.resolve();
	await flush();
	assert.equal(h.text(), "- [ ] A");
	h.app.vault.trigger("modify", h.app.vault.getFileByPath("a.md"));
	assert.equal((await writer.insert("a.md", (text) => `${text}\n- [ ] retry`)).kind, "written");
	assert.equal(h.text(), "- [ ] A\n- [ ] retry");
	writer.dispose();
});

test("a quick entry delta contributes to the ambiguity window", async () => {
	const h = writerHarness({ "a.md": "header\n- [ ] A\n- [ ] A" });
	const writer = h.create();
	assert.equal(
		(await writer.insert("a.md", (text) => text.replace("header\n", "header\n- [ ] new\n"))).kind,
		"written",
	);
	const result = await h.write(h.target(2));
	assert.equal(result.kind, "refused");
	if (result.kind === "refused") {
		assert.equal(result.reason, "ambiguous");
		assert.equal(
			result.message,
			"“A” appears more than once near here in a, and the timeline can't tell which one you clicked. Nothing was written.",
		);
	}
	assert.equal(h.writes.length, 1);
	writer.dispose();
});

test("quick entry refuses a note that disappears while queued", async () => {
	const h = writerHarness();
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const writer = h.create();
	const running = h.write();
	await flush();
	const queued = writer.insert("a.md", (text) => `${text}\n- [ ] new`);
	h.remove();
	gate.resolve();
	await running;
	const result = await queued;
	assert.deepEqual(result, {
		kind: "refused",
		reason: "moved-or-deleted",
		message: "a was moved or deleted. Nothing was written.",
	});
	assert.equal(h.processCalls.length, 1);
	assert.deepEqual(h.writes, []);
	writer.dispose();
});

test("quick entry shifts an undo record and a stale row at the first displaced line", async () => {
	const h = writerHarness({ "a.md": "## Tasks\n- [ ] A\n" });
	const writer = h.create();
	const ledger = createShiftLedger();
	const record = undoRecord(await h.write(h.target(1)));
	const result = await writer.insert("a.md", (text) => text.replace("## Tasks\n", "## Tasks\n- [ ] new\n"));
	assert.equal(result.kind, "written");
	if (result.kind !== "written") throw new Error("expected written");
	const event = h.events.filter((item) => item.kind === "written").at(-1);
	assert.equal(event?.line, 1);
	assert.equal(event?.insertBefore, true);
	ledger.record("a.md", event!.line, result.delta, writer.releaseSeq() + 1, event!.insertBefore);
	assert.equal(ledger.shift("a.md", 1), 2);
	assert.equal((await h.write(h.target(1), { kind: "undo", record })).kind, "written");
	assert.equal(h.text(), "## Tasks\n- [ ] new\n- [ ] A\n");
	writer.dispose();
});

test("undo checks the bytes again when a note became non-UTF-8 after the write", async () => {
	for (const source of [false, true]) {
		const h = writerHarness();
		const writer = h.create();
		const record = undoRecord(await h.write());
		await h.deliver();
		const bytes = new Uint8Array([...new TextEncoder().encode(h.text() + "\n"), 0xff]);
		h.bytes.set("a.md", bytes);
		h.cache.set("a.md", new TextDecoder().decode(bytes));
		const view = source ? h.view("a.md", "source") : undefined;
		const writes = h.writes.length;
		const result = await h.write(h.target(), { kind: "undo", record });
		assert.equal(result.kind, "refused");
		if (result.kind === "refused") {
			assert.equal(result.reason, "not-utf8");
			assert.equal(
				result.message,
				"a is not saved as UTF-8. Nothing was written: writing would replace its unreadable characters (shown as �) for good. Convert the note to UTF-8 to edit its tasks from the timeline.",
			);
		}
		assert.deepEqual(h.bytes.get("a.md"), bytes);
		assert.equal(h.writes.length, writes);
		assert.equal(h.binaryCalls.length, 1);
		if (view) assert.equal(view.saves, 0);
		writer.dispose();
	}
});

test("undo records the neighbours from the process callback's content", async () => {
	const h = writerHarness({ "a.md": "old above\n- [ ] A\nold below" });
	let first = true;
	h.onProcess(() => {
		if (first) {
			first = false;
			h.put("a.md", "actual above\n- [ ] A\nactual below");
		}
	});
	const writer = h.create();
	const record = undoRecord(await h.write(h.target(1)));
	assert.equal(record.above, "actual above");
	assert.equal(record.below, "actual below");
	h.put("a.md", "actual above\n- [ ] A\nactual below");
	const writes = h.writes.length;
	assert.deepEqual(await h.write(h.target(1), { kind: "undo", record }), { kind: "unchanged", alreadyUndone: true });
	assert.equal(h.writes.length, writes);
	writer.dispose();
});

test("undo queues by its record's note even when the supplied target names another note", async () => {
	const h = writerHarness({ "a.md": "- [ ] A\n- [ ] B", "b.md": "- [ ] other" });
	const writer = h.create();
	const record = undoRecord(await h.write(h.target(0)));
	const gate = deferred();
	h.onProcess(() => gate.promise);
	const running = h.write(h.target(1));
	await flush();
	const undo = h.write(h.target(0, "b.md"), { kind: "undo", record });
	await flush();
	assert.equal(h.processCalls.length, 2);
	gate.resolve();
	assert.equal((await running).kind, "written");
	assert.equal((await undo).kind, "written");
	assert.deepEqual(h.processCalls, ["a.md", "a.md", "a.md"]);
	assert.equal(h.text(), "- [ ] A\n- [x] B ✅ 2026-10-31");
	assert.equal(h.text("b.md"), "- [ ] other");
	writer.dispose();
});

test("source undo of a first-line deletion preserves a U+FEFF owned by the following line", async () => {
	for (const bom of ["", "\uFEFF"]) {
		const original = `${bom}- [ ] A 🏁 delete\n\uFEFFnext`;
		const h = writerHarness({ "a.md": original });
		const view = h.view("a.md", "source");
		const writer = h.create();
		const record = undoRecord(await h.write());
		assert.equal(h.text(), `${bom}\uFEFFnext`);
		assert.equal((await h.write(h.target(), { kind: "undo", record })).kind, "written");
		assert.equal(h.text(), original);
		assert.deepEqual(view.transactions[1], {
			transaction: {
				changes: [
					{ from: { line: 0, ch: bom.length }, to: { line: 0, ch: bom.length }, text: "- [ ] A 🏁 delete\n" },
				],
			},
			origin: "tasks-calendar-wrapper",
		});
		writer.dispose();
	}
});
