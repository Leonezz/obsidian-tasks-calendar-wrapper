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
