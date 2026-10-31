import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DayKey } from "@tasks-calendar-wrapper/core";
import { runReverts, type RevertStep, type ModelStepContext, type ModelRunOptions } from "./revert-model";
import { deferred, flush } from "./writer-harness";

const original = "- [ ] A";
const lost = ({ h }: ModelStepContext): number[] =>
	h.events.filter((event) => event.kind === "overwritten").map((event) => event.id);
const custom = (label: string, run: (context: ModelStepContext) => Promise<void>): RevertStep => ({
	kind: "custom",
	label,
	custom: run,
});
interface Sequence {
	readonly name: string;
	readonly initial: readonly string[];
	readonly steps: readonly RevertStep[];
	readonly toggle?: ModelRunOptions["toggle"];
}

const sequences: Sequence[] = [
	{
		name: "Undo after the undo notice was hovered > 60 s → undoes normally; after the record was pushed out by the 51st → too long ago",
		initial: Array.from({ length: 52 }, (_, i) => `- [ ] Task ${i}`),
		steps: [
			{ kind: "toggle" },
			{ kind: "changed" },
			{ kind: "time", ms: 61_000 },
			{ kind: "undo" },
			custom("hover-and-51st-eviction", async (c) => {
				assert.equal(c.note.lines[0].text, "- [ ] Task 0");
				assert.match(c.h.notices[0], /Undid the change/);
				await c.own(c.note, { kind: "toggle", at: 1 });
				const oldest = [...c.note.undo.values()].at(-1)!.record;
				for (let at = 2; at < 52; at++) await c.own(c.note, { kind: "toggle", at });
				const result = await c.h.write(c.h.target(1), { kind: "undo", record: oldest });
				assert.equal(result.kind, "refused");
				if (result.kind === "refused") assert.match(result.message, /too long ago/);
				c.check("51st-eviction");
				assert.deepEqual(lost(c), []);
			}),
		],
	},
	{
		name: "Redo across midnight (✅ is the new day) → redone",
		initial: [original],
		steps: [
			{ kind: "toggle" },
			{ kind: "due", value: 2 },
			{ kind: "stale", at: 0 },
			custom("midnight", async (c) => {
				assert.deepEqual(lost(c), [1, 2]);
				c.setToday("2026-11-01" as DayKey);
			}),
			{ kind: "redo" },
			custom("midnight-redo-output", async (c) => {
				assert.equal(c.h.text(), "- [x] A ✅ 2026-11-01 📅 2026-11-02");
				assert.equal(c.h.reverts.length, 1);
				assert.equal(c.note.oracle.writes.length, 4);
			}),
		],
	},
	{
		name: "two timelines open receive one overwritten event each and one shared revert notice",
		initial: [original],
		steps: [
			custom("two-timelines", async (c) => {
				const first: number[] = [],
					second: number[] = [];
				const subscribe = (events: number[]) =>
					c.writer.onWrite((event) => {
						if (event.kind === "overwritten") events.push(event.id);
					});
				const offFirst = subscribe(first),
					offSecond = subscribe(second);
				try {
					await c.own(c.note, { kind: "toggle" });
					await c.external(c.note, c.note.snapshots[0], "foreign", true);
					assert.deepEqual(first, [1]);
					assert.deepEqual(second, [1]);
					assert.equal(c.h.reverts.length, 1);
					await c.changed(c.note);
					assert.equal(c.h.reverts.length, 1);
				} finally {
					offFirst();
					offSecond();
				}
			}),
		],
	},
];

for (const completedFirst of [false, true])
	sequences.push({
		name: `two-line Redo carries the actual ${completedFirst ? "first" : "second"} completed output into the next write`,
		initial: ["- [ ] A 🔁 every day 📅 2026-10-31"],
		toggle: (source, today) => {
			const next = source.replace(
				/📅 \d{4}-\d{2}-\d{2}/u,
				`📅 ${today === "2026-10-31" ? "2026-11-01" : "2026-11-02"}`,
			);
			const completed = source.replace("- [ ]", "- [x]") + ` ✅ ${today}`;
			return (completedFirst ? [completed, next] : [next, completed]).join("\n");
		},
		steps: [
			{ kind: "toggle" },
			{ kind: "due", at: completedFirst ? 0 : 1, value: 2 },
			{ kind: "stale", at: 0 },
			custom("two-line-redo-midnight", async (c) => {
				assert.deepEqual(lost(c), [1, 2]);
				c.setToday("2026-11-01" as DayKey);
			}),
			{ kind: "redo" },
			custom("two-line-redo-output", async (c) => {
				const lines = c.h.text().split("\n");
				assert.equal(lines.length, 2);
				assert.equal(lines[completedFirst ? 0 : 1], "- [x] A 🔁 every day 📅 2026-11-02 ✅ 2026-11-01");
				assert.equal(lines[completedFirst ? 1 : 0], "- [ ] A 🔁 every day 📅 2026-11-02");
				assert.equal(c.h.reverts.length, 1);
				assert.equal(c.note.oracle.writes.length, 4);
			}),
		],
	});

sequences.push({
	name: "quick-entry results trigger a check without a revert record or Undo",
	initial: [original],
	steps: [
		{ kind: "toggle" },
		{ kind: "stale", at: 0, deliver: false },
		{ kind: "quick-entry" },
		custom("quick-entry-trigger", async (c) => {
			assert.deepEqual(lost(c), [1]);
			assert.equal(c.note.oracle.writes.length, 1);
			assert.equal(c.note.undo.size, 1);
			assert.equal(c.h.reverts.length, 1);
		}),
	],
});

sequences.push({
	name: "an in-flight quick entry defers the same note's revert check until its result",
	initial: [original],
	steps: [
		{ kind: "toggle" },
		{ kind: "changed" },
		custom("quick-entry-5a", async (c) => {
			const gate = deferred();
			c.h.onProcess(() => gate.promise);
			const added = c.line("- [ ] Entry");
			const inserting = c.writer.insert(c.note.path, (text) => text + "\n" + added.text);
			await flush();
			await c.h.clock.advance(2000);
			c.observe(c.note, c.note.snapshots[0], "foreign");
			c.h.put(c.note.path, original);
			c.h.changed(c.note.path);
			await flush();
			assert.deepEqual(lost(c), []);
			const expected = c.note.oracle.evaluate(c.h.clock.now);
			gate.resolve();
			assert.equal((await inserting).kind, "written");
			c.observe(c.note, [...c.note.lines, added], "user", [added.id]);
			await flush();
			c.check("quick-entry-5a", undefined, new Map([[c.note, expected]]), new Set([c.note]));
			assert.deepEqual(lost(c), [1]);
			assert.equal(c.note.oracle.writes.length, 1);
			assert.equal(c.h.reverts.length, 1);
			c.h.onProcess();
		}),
	],
});

for (const trigger of ["10s", "indexed"] as const)
	sequences.push({
		name: `a revert without changed is found by the ${trigger} trigger`,
		initial: [original],
		steps: [
			{ kind: "toggle" },
			custom(`trigger-${trigger}`, async (c) => {
				const written = c.h.text();
				await c.external(c.note, c.note.snapshots[0], "foreign", false);
				if (trigger === "10s") await c.advance(10_000);
				else {
					c.h.changed(c.note.path, written);
					await flush();
					c.check("indexed", undefined, undefined, new Set([c.note]));
				}
				assert.deepEqual(lost(c), [1]);
				assert.equal(c.h.reverts.length, 1);
			}),
		],
	});

for (const timeout of [true, false])
	sequences.push({
		name:
			"while another group's write hangs 60 s, an external revert at 2 s → reported at 60 s; revert at 4.9 s while an own write runs 4.8–5.2 s → reported" +
			(timeout ? " (60 s)" : " (4.8–5.2 s)"),
		initial: [original, "- [ ] B"],
		steps: [
			{ kind: "toggle" },
			{ kind: "changed" },
			custom(timeout ? "same-note-5a-timeout" : "same-note-5a-written", async (c) => {
				const { h, note } = c;
				await c.advance(timeout ? 0 : 4800);
				const gate = deferred();
				const process = h.app.vault.process;
				if (timeout) h.onProcess(() => gate.promise);
				else
					h.app.vault.process = async (file, fn) => {
						const result = await process(file, fn);
						await gate.promise;
						return result;
					};
				const before = note.lines,
					beforePosition = note.oracle.position;
				const pending = h.write(h.target(1));
				await flush();
				if (!timeout) {
					// fn has written T; only process's response is delayed, as in the approved 4.8–5.2 s case.
					const event = h.events.filter((event) => event.kind === "pending").at(-1)!;
					c.ownResult(note, event, before, beforePosition, { kind: "toggle" }, before[1]);
				}
				await h.clock.advance(timeout ? 2000 : 100);
				const current = [note.snapshots[0][0], note.lines[1]];
				c.observe(note, current, "foreign");
				h.put(note.path, current.map((line) => line.text).join("\n"));
				h.changed(note.path);
				await flush();
				const expected = note.oracle.evaluate(h.clock.now);
				assert.deepEqual(expected, [1]);
				assert.deepEqual(lost(c), []);
				await h.clock.advance(timeout ? 58_000 : 300);
				if (!timeout) gate.resolve();
				const result = await pending;
				assert.equal(result.kind, timeout ? "failed" : "written");
				if (timeout) {
					const event = h.events.find((event) => event.kind === "failed")!;
					note.oracle.writes.push({
						id: event.id,
						identities: new Set([before[1].id]),
						before: note.oracle.position,
						after: note.oracle.position,
						resultAt: h.clock.now,
						releasedAt: h.clock.now,
						windowEnd: -Infinity,
						active: false,
						unknown: true,
						signature: "unknown",
						keys: [before[1].text, ...event.lines],
					});
					note.retained.add(event.id);
				} else {
					// H records fn's physical write before the stale copy; the window starts at the later result.
					const index = note.oracle.writes.findIndex((write) => write.id === 2);
					note.oracle.writes[index] = { ...note.oracle.writes[index], resultAt: h.clock.now };
				}
				await flush();
				c.check("deferred-trigger-time", undefined, new Map([[note, expected]]), new Set([note]));
				assert.deepEqual(lost(c), [1]);
				assert.equal(h.reverts.length, 1);
				gate.resolve();
				h.onProcess();
				h.app.vault.process = process;
				await flush();
				await c.changed(note);
				await c.advance(10_000);
				assert.deepEqual(lost(c), [1]);
			}),
		],
	});

sequences.push({
	name: "one check at a time in the note queue, including a write starting while cachedRead is awaited (5a)",
	initial: [original],
	steps: [
		{ kind: "due", value: 1 },
		{ kind: "changed" },
		custom("cachedRead-write-overlap", async (c) => {
			const { h, note } = c;
			await c.advance(1000);
			const before = note.lines;
			await c.external(note, note.snapshots[0], "foreign", false);
			const expected = note.oracle.evaluate(h.clock.now);
			const gate = deferred<string>();
			const read = h.app.vault.cachedRead;
			let first = true,
				active = 0,
				peak = 0,
				reads = 0;
			h.app.vault.cachedRead = async (file) => {
				reads++;
				active++;
				peak = Math.max(peak, active);
				try {
					if (first) {
						first = false;
						const captured = await read(file);
						await gate.promise;
						return captured;
					}
					return await read(file);
				} finally {
					active--;
				}
			};
			h.changed(note.path, "metadata from a stale save");
			await flush();
			assert.equal(reads, 1);
			h.changed(note.path, "another check queued behind the pending cachedRead");
			await flush();
			assert.equal(reads, 1, "the next check cannot read before the first check completes");
			// The read captured a real stale copy. Restore the written text before W2 reads its P.
			await c.external(note, before, "foreign", false);
			const position = note.oracle.position;
			const second = await h.write(h.target(), { kind: "date", field: "due", day: "2026-11-02" as DayKey });
			assert.equal(second.kind, "written");
			const event = h.events.filter((event) => event.kind === "written").at(-1)!;
			c.ownResult(
				note,
				event,
				before,
				position,
				{ kind: "date", field: "due", day: "2026-11-02" as DayKey },
				before[0],
			);
			const third = h.write(h.target(), { kind: "date", field: "due", day: "2026-10-31" as DayKey });
			await flush();
			assert.equal(h.processCalls.length, 2);
			await c.own(c.notes[1], { kind: "toggle" });
			assert.deepEqual(lost(c), []);
			gate.resolve(original);
			const thirdResult = await third;
			assert.equal(thirdResult.kind, "written");
			await flush();
			const last = h.events.filter((event) => event.kind === "written" && event.path === note.path).at(-1)!;
			c.ownResult(
				note,
				last,
				note.lines,
				note.oracle.position,
				{ kind: "date", field: "due", day: "2026-10-31" as DayKey },
				note.lines[0],
			);
			c.check("cachedRead-5a", undefined, new Map([[note, expected]]), new Set([note]));
			assert.deepEqual(lost(c), [1]);
			// One outstanding check read plus each own write's preflight read is allowed.
			assert.ok(peak <= 2);
			assert.equal(active, 0);
			h.app.vault.cachedRead = read;
		}),
	],
});

for (const sequence of sequences)
	test(`model fixed: ${sequence.name}`, async (t) => {
		const coverage = new Map<string, number>();
		for (const duplicated of [false, true]) {
			const result = await runReverts(sequence.steps, {
				initial: sequence.initial,
				duplicated,
				toggle: sequence.toggle,
				count: (key) => coverage.set(key, (coverage.get(key) ?? 0) + 1),
			});
			assert.equal(result, null, JSON.stringify(result));
		}
		t.diagnostic("coverage: " + [...coverage].map(([key, value]) => `${key}=${value}`).join(", "));
	});
