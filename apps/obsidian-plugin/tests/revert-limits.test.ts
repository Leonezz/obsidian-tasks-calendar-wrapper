import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRevertCheck, DEFERRED_CHECKS_MAX } from "../timeline/src/revertcheck";
import { writeSnapshot, type WriteRecord } from "../timeline/src/writerholds";
import { flush, writerHarness } from "./writer-harness";

function entry(id: number, before: string, after: string, at = id): WriteRecord {
	return {
		id,
		target: { path: "a.md", line: 0, sourceLine: before },
		context: { path: "a.md", line: 0, text: before },
		edit: { kind: "toggle" },
		lines: [after],
		keys: [before, after],
		status: "written",
		before: writeSnapshot(before),
		after: writeSnapshot(after),
		delta: 0,
		resultAt: at,
		writtenAt: at,
		windowEnd: at + 5000,
		released: true,
		invalidated: false,
		indexed: true,
		slow: false,
		rechecked: false,
		indexedPromise: Promise.resolve(),
		resolveIndexed: () => {},
	};
}

test("5a keeps at most 16 distinct deferred checks, an equal C keeps its first time", () => {
	assert.equal(DEFERRED_CHECKS_MAX, 16);
	const rule = createRevertCheck();
	const writes = Array.from({ length: 17 }, (_, i) => entry(i + 1, `- [ ] Task ${i}`, `- [x] Task ${i}`));
	for (const write of writes) rule.result(write, "a.md", write.resultAt);
	rule.begin("a.md");
	for (let i = 0; i < writes.length; i++) {
		const current = writes.map((write, j) => (j === i ? write.target.sourceLine : write.lines[0])).join("\n");
		assert.deepEqual(rule.check("a.md", current, 100 + i), []);
		// Repeated observations must not consume a slot needed by a later distinct C.
		assert.deepEqual(rule.check("a.md", current, 200 + i), []);
	}
	assert.deepEqual(
		rule.result(undefined, "a.md", 1000).flatMap((report) => report.lost.map((write) => write.id)),
		writes.slice(0, 16).map((write) => write.id),
	);
	assert.equal(writes[16].status, "written");

	const firstTime = createRevertCheck();
	const write = entry(1, "- [ ] A", "- [x] A", 0);
	firstTime.result(write, "a.md", 0);
	firstTime.begin("a.md");
	firstTime.check("a.md", "- [ ] A", 4900);
	firstTime.check("a.md", "- [ ] A", 5100);
	assert.deepEqual(
		firstTime.result(undefined, "a.md", 65_000).flatMap((report) => report.lost.map((item) => item.id)),
		[1],
	);
});

test("more than 50 records: the group whose newest record is oldest is dropped; with one group its oldest records go", () => {
	const dropped: number[] = [];
	const rule = createRevertCheck((records) => dropped.push(...records.map((record) => record.id)));
	const writes = [
		entry(1, "- [ ] A0", "- [ ] A1"),
		entry(2, "- [ ] B0", "- [ ] B1"),
		entry(3, "- [ ] A1", "- [ ] A2"),
		...Array.from({ length: 48 }, (_, i) => entry(i + 4, `- [ ] C${i}`, `- [ ] C${i + 1}`)),
	];
	for (const write of writes) rule.result(write, "a.md", write.resultAt);
	assert.deepEqual(dropped, [2]);
	assert.equal(rule.retained("a.md").length, 50);
	assert.ok(rule.retained("a.md").includes(writes[0]));
	assert.ok(rule.retained("a.md").includes(writes[2]));

	const singleDropped: number[] = [];
	const single = createRevertCheck((records) => singleDropped.push(...records.map((record) => record.id)));
	for (let i = 0; i < 52; i++) single.result(entry(i + 1, `- [ ] A${i}`, `- [ ] A${i + 1}`), "a.md", i + 1);
	assert.deepEqual(singleDropped, [1, 2]);
	assert.deepEqual(
		single.retained("a.md").map((write) => write.id),
		Array.from({ length: 50 }, (_, i) => i + 3),
	);
});

test("a group is kept whole while its newest result is under 60 s old or any record is unreleased or in its window", () => {
	for (const reason of ["newest", "unreleased", "window"] as const) {
		const rule = createRevertCheck();
		const first = entry(1, "- [ ] A0", "- [ ] A1", 0);
		const second = entry(2, "- [ ] A1", "- [ ] A2", reason === "newest" ? 59_000 : 1);
		if (reason === "unreleased") first.released = false;
		if (reason === "window") first.windowEnd = 100_000;
		rule.result(first, "a.md", first.resultAt);
		rule.result(second, "a.md", second.resultAt);
		const at = reason === "newest" ? 118_999 : 100_000;
		assert.deepEqual(rule.check("a.md", "- [ ] A2", at), []);
		assert.deepEqual(rule.retained("a.md"), [first, second], reason);
		first.released = true;
		assert.deepEqual(rule.check("a.md", "- [ ] A2", at + 1), []);
		assert.deepEqual(rule.retained("a.md"), [], reason);
	}
});

test("an in-flight own write prevents retention pruning until its result", () => {
	const rule = createRevertCheck();
	const write = entry(1, "- [ ] A", "- [x] A", 0);
	rule.result(write, "a.md", 0);
	rule.begin("a.md");
	rule.prune("a.md", 120_000);
	assert.deepEqual(rule.retained("a.md"), [write]);
	rule.result(undefined, "a.md", 120_000);
	assert.deepEqual(rule.retained("a.md"), []);
});

test("unchanged and already-undone records take no hold and their window has ended", async () => {
	for (const mode of ["source", "preview"] as const) {
		const h = writerHarness();
		const view = h.view("a.md", mode);
		let acquired = 0;
		const writer = h.create({
			index: {
				...h.index,
				hold: (path) => {
					acquired++;
					return h.index.hold(path);
				},
			},
		});
		assert.deepEqual(await h.write(h.target(), { kind: "date", field: "due", day: null }), { kind: "unchanged" });
		assert.equal(acquired, 0, mode);
		const written = await h.write();
		assert.equal(written.kind, "written");
		if (written.kind !== "written" || !written.undo) throw new Error("expected an Undo record");
		await h.deliver();
		view.type("- [ ] A");
		h.put("a.md", "- [ ] A");
		assert.deepEqual(await h.write(h.target(), { kind: "undo", record: written.undo }), {
			kind: "unchanged",
			alreadyUndone: true,
		});
		assert.equal(acquired, 1, mode);
		assert.equal(h.holds.get("a.md"), 0, mode);
		assert.equal(h.reverts.length, 0, mode);
		writer.dispose();
	}
	for (const status of ["unchanged", "already-undone"] as const) {
		const rule = createRevertCheck();
		const write = { ...entry(1, "- [ ] A", "- [ ] A", 10), status, released: false, windowEnd: Infinity };
		rule.result(write, "a.md", 10, status === "already-undone", "- [ ] A");
		assert.equal(write.token, undefined);
		assert.equal(write.released, true);
		assert.equal(write.windowEnd, write.resultAt);
		assert.deepEqual(rule.check("a.md", "", 10), []);
		rule.prune("a.md", 60_010);
		assert.deepEqual(rule.retained("a.md"), []);
	}
});

test("a late 10 s timer judges the window at its scheduled moment", async () => {
	const h = writerHarness();
	const view = h.view("a.md", "source");
	const timers = new Map<number, { run: () => void; at: number }>();
	const writer = h.create({
		setTimeout: (run, delay) => {
			const id = h.clock.setTimeout(run, delay);
			timers.set(id, { run, at: h.clock.now + delay });
			return id;
		},
		clearTimeout: (id) => {
			timers.delete(id);
			h.clock.clearTimeout(id);
		},
	});
	const written = await h.write();
	assert.equal(written.kind, "written");
	if (written.kind !== "written" || !written.undo) throw new Error("expected an Undo record");
	view.mode = "preview";
	await h.clock.advance(8000);
	// Other text releases the hold, but does not expected-index the editor write: its window ends at 11 s.
	h.put("a.md", "- [ ] External");
	h.changed("a.md", "- [ ] External");
	await flush();
	assert.equal(h.holds.get("a.md"), 0);
	assert.equal(h.reverts.length, 0);
	await h.clock.advance(1000);
	h.put("a.md", "- [ ] A");
	const scheduled = [...timers.values()].filter((timer) => timer.at === 10_000);
	assert.equal(scheduled.length, 1);
	h.clock.elapse(3000);
	// Dispatch only the late 10 s callback, before the separate window-end callback can mask its decision.
	scheduled[0].run();
	await flush();
	assert.deepEqual(
		h.events.filter((event) => event.kind === "overwritten").map((event) => event.id),
		[written.undo.id],
	);
	assert.equal(h.reverts.length, 1);
	writer.dispose();
});
