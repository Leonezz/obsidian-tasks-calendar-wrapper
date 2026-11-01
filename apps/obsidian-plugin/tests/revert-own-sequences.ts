import assert from "node:assert/strict";
import type { DayKey } from "@tasks-calendar-wrapper/core";
import type { ModelRunOptions, ModelStepContext, RevertStep } from "./revert-model";
import { deferred, flush } from "./writer-harness";

export interface NamedRevertSequence {
	readonly name: string;
	readonly variant?: string;
	readonly initial?: readonly string[];
	readonly options?: ModelRunOptions;
	readonly steps: readonly RevertStep[];
}

const original = "- [ ] A";
const done = "- [x] A ✅ 2026-10-31";
const date = (value: number): RevertStep => ({ kind: "due", value });
const toggle: RevertStep = { kind: "toggle" };
const changed: RevertStep = { kind: "changed" };
const stale: RevertStep = { kind: "stale", at: 0 };
const undo = (at = 0): RevertStep => ({ kind: "undo", at });
const time = (ms: number): RevertStep => ({ kind: "time", ms });
const custom = (label: string, run: (context: ModelStepContext) => Promise<void>): RevertStep => ({
	kind: "custom",
	label,
	custom: run,
});

function expect(
	writes: number,
	lost: readonly number[],
	text?: string,
	extra?: (ctx: ModelStepContext) => void,
): RevertStep {
	return custom("fixed assertions", async (ctx) => {
		const written = ctx.h.events.filter((event) => event.kind === "written");
		assert.equal(written.length, writes, "the sequence performed its own writes");
		assert.deepEqual(
			ctx.h.events.filter((event) => event.kind === "overwritten").map((event) => event.id),
			lost.map((at) => written[at].id),
		);
		if (text !== undefined) assert.equal(ctx.currentText(ctx.note), text);
		extra?.(ctx);
		ctx.count("fixed:asserted");
	});
}

const undoAfterSecond =
	"chain ending in Undo: A→B→C, Undo the second, then a stale save restores A → notice naming only the first";
const returning =
	'returning chains: Due today → Due tomorrow → Remove due date → no notice; a three-state custom status cycle back to " " → no notice; third step a dialog edit restoring the line → no modal';
const identical = "identical lines: toggle both, Undo one → no notice; toggle both, stale save → notice naming both";
const ownUntoggle = "you un-toggle in the note within 5 s → notice; Redo re-toggles; without Redo it stays un-toggled";
const redoVariants =
	"Redo across midnight (✅ is the new day) → redone; lost writes include an Undo → no Redo, only Open note; report → Redo → a stale save back to the middle state → reported again";

/** The brief's fixed cases use exactly the same step runner and identity oracle as generated sequences. */
export const ownWriteSequences: readonly NamedRevertSequence[] = [
	...([false, true] as const).map((dialog): NamedRevertSequence => ({
		name: "Undo 1 s after a write → no overwritten event, no notice; for a dialog edit no modal either",
		variant: dialog ? "dialog edit" : "toggle",
		steps: [
			dialog ? { kind: "replace", text: "- [ ] A edited" } : toggle,
			time(1000),
			undo(),
			changed,
			expect(2, [], original, ({ h }) => assert.equal(h.recoveries.length, 0)),
		],
	})),
	{
		name: "un-toggle then re-toggle within the window; due A→B→A within 2 s → no notice",
		variant: "toggle",
		initial: [done],
		steps: [toggle, time(1000), toggle, changed, expect(2, [], done)],
	},
	{
		name: "un-toggle then re-toggle within the window; due A→B→A within 2 s → no notice",
		variant: "date",
		initial: [`${original} 📅 2026-10-31`],
		steps: [date(1), time(1000), date(0), changed, expect(2, [], `${original} 📅 2026-10-31`)],
	},
	{
		name: "editor path: a save in progress, later saveAgain writes the change → no notice",
		steps: [
			{ kind: "save-again" },
			expect(1, [], `${done}\nplain pending save`, ({ h }) =>
				assert.ok(h.views.some((view) => view.transactions.length === 1 && view.saves >= 3)),
			),
		],
	},
	{
		name: undoAfterSecond,
		initial: [`${original} 📅 2026-10-31`],
		steps: [date(1), date(2), undo(1), stale, expect(3, [0], `${original} 📅 2026-10-31`)],
	},
	{
		name: "same but menu sets C back to B → notice naming only the first",
		initial: [`${original} 📅 2026-10-31`],
		steps: [date(1), date(2), date(1), stale, expect(3, [0])],
	},
	{
		name: "toggle → set date → Undo the date, then a stale save restores pre-toggle → notice naming the toggle",
		steps: [toggle, date(1), undo(1), stale, expect(3, [0], original)],
	},
	{
		name: "A→B→C→D, then a save restores B → notice naming the last two",
		initial: [`${original} 📅 2026-10-31`],
		steps: [
			date(1),
			date(2),
			{ kind: "remove-due" },
			{ kind: "stale", at: 1 },
			expect(3, [1, 2], `${original} 📅 2026-11-01`),
		],
	},
	...([false, true] as const).map((dialog): NamedRevertSequence => ({
		name: returning,
		variant: dialog ? "dialog restores original" : "remove date",
		steps: [
			date(0),
			date(1),
			dialog ? { kind: "replace", text: original } : { kind: "remove-due" },
			changed,
			expect(3, [], original, ({ h }) => assert.equal(h.recoveries.length, 0)),
		],
	})),
	{
		name: returning,
		variant: "custom status cycle",
		options: {
			toggle: (source) =>
				source.replace(
					/\[([ /x])\]/u,
					(_, status: string) => `[${status === " " ? "/" : status === "/" ? "x" : " "}]`,
				),
		},
		steps: [toggle, toggle, toggle, changed, expect(3, [], original)],
	},
	{
		name: "line moved externally: own write, external insert above, re-read, set the date back → no notice",
		initial: [`${original} 📅 2026-10-31`],
		steps: [
			date(1),
			{ kind: "insert-plain", at: 0 },
			changed,
			date(0),
			expect(2, [], `plain 1\n${original} 📅 2026-10-31`),
		],
	},
	...([false, true] as const).map((undone): NamedRevertSequence => ({
		name: identical,
		variant: undone ? "Undo one" : "stale copy",
		initial: [original, original],
		steps: [
			toggle,
			{ kind: "toggle", at: 1 },
			undone ? undo() : stale,
			changed,
			expect(undone ? 3 : 2, undone ? [] : [0, 1], undone ? `${original}\n${done}` : `${original}\n${original}`),
		],
	})),
	{
		name: "two different tasks written once each, an external change reverts only one → notice naming only that one (by group)",
		initial: [original, "- [ ] B"],
		steps: [
			toggle,
			{ kind: "toggle", at: 1 },
			{ kind: "revert-line", at: 0, value: 0 },
			expect(2, [0], `${original}\n- [x] B ✅ 2026-10-31`),
		],
	},
	{
		name: "recurring completion, then un-complete the completed copy, then a stale save restores only the original line → notice",
		initial: ["- [ ] A 🔁 every day 📅 2026-10-31"],
		steps: [toggle, { kind: "toggle", at: 1 }, stale, expect(2, [0, 1], "- [ ] A 🔁 every day 📅 2026-10-31")],
	},
	{
		name: "toggle → set date, an external change goes back to before the toggle, Redo → both redone, line as after the date change",
		steps: [
			toggle,
			date(2),
			stale,
			{ kind: "redo" },
			changed,
			expect(4, [0, 1], `${done} 📅 2026-11-02`, ({ h }) => assert.equal(h.reverts.length, 1)),
		],
	},
	{
		name: "editor-path write then switch to reading view, then an external save → notice (check reads cachedRead)",
		steps: [
			{ kind: "toggle", mode: "source" },
			changed,
			{ kind: "view", mode: "preview" },
			stale,
			expect(1, [0], original, ({ h }) => assert.ok(h.readCalls.length > 0)),
		],
	},
	...([false, true] as const).map((redo): NamedRevertSequence => ({
		name: ownUntoggle,
		variant: redo ? "Redo" : "leave it un-toggled",
		steps: [
			toggle,
			stale,
			...(redo ? [{ kind: "redo" } as RevertStep] : []),
			expect(redo ? 2 : 1, [0], redo ? done : original),
		],
	})),
	{
		name: 'Undo finds the original already in place (Ctrl+Z in editor) → already-undone, "is already back" notice, no revert notice',
		steps: [
			{ kind: "toggle", mode: "source" },
			changed,
			{ kind: "ctrlz", save: false, deliver: false },
			undo(),
			expect(1, [], original, ({ h }) => {
				assert.ok(h.events.some((event) => event.kind === "unchanged"));
				assert.equal(h.notices.at(-1), "“A” in a is already back to how it was.");
			}),
		],
	},
	{
		name: "Undo with unknown outcome (save never returns, 60 s) → only may-not-have-been-saved, no revert notice",
		steps: [
			{ kind: "toggle", mode: "source" },
			changed,
			custom("Undo save timeout", async (ctx) => {
				const { h, note } = ctx;
				const record = [...note.undo.values()][0].record;
				const view = h.views.at(-1)!;
				const before = note.oracle.position;
				const gate = deferred();
				view.beforeSave = () => gate.promise;
				const pending = h.write(h.target(), { kind: "undo", record });
				await h.clock.advance(60000);
				const result = await pending;
				assert.equal(result.kind, "failed");
				if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
				assert.equal(h.reverts.length, 0);
				assert.equal(h.notices.length, 1);
				assert.match(h.notices[0], /may not have been saved/u);
				gate.resolve();
				await flush();
				ctx.observe(note, note.snapshots[0], "own");
				const failed = h.events.find((event) => event.kind === "failed");
				assert.ok(failed);
				note.oracle.writes.push({
					id: failed.id,
					identities: new Set(note.lines.map((line) => line.id)),
					before,
					after: note.oracle.position,
					undoOf: record.id,
					resultAt: h.clock.now,
					releasedAt: h.clock.now,
					windowEnd: -Infinity,
					active: false,
					unknown: true,
					signature: "unknown Undo",
					keys: [original, done],
				});
				ctx.check("unknown Undo result");
				ctx.count("fixed:undo-unknown");
			}),
		],
	},
	{
		name: "save-first (check 5) never returns → may-not-have-been-saved at 60 s, overlay cleared, queue blocked",
		steps: [
			{ kind: "view", mode: "source" },
			custom("save-first timeout", async (ctx) => {
				const { h, note } = ctx;
				const view = h.views.at(-1)!;
				view.type(`${original}\nunsaved`);
				ctx.observe(note, [...note.lines, ctx.line("unsaved")], "user");
				const gate = deferred();
				view.beforeSave = () => gate.promise;
				const pending = h.write();
				await h.clock.advance(60000);
				const result = await pending;
				assert.equal(result.kind, "failed");
				if (result.kind === "failed") assert.equal(result.unknownOutcome, true);
				assert.equal(h.events.filter((event) => event.kind === "released").length, 1);
				const refused = await h.write();
				assert.equal(refused.kind, "refused");
				if (refused.kind === "refused") assert.equal(refused.reason, "queue-blocked");
				assert.equal(h.processCalls.length, 0);
				assert.equal(h.reverts.length, 0);
				ctx.check("save-first unknown result");
				gate.resolve();
				await flush();
				ctx.count("fixed:save-first-unknown");
			}),
		],
	},
	{
		name: "Undo 1 s after a toggle, Obsidian drops the first write's metadata task → no \"Saved in…\" at 10 s, no not-reread, no extra reload; the first write's token is released once, a second release does not change the count",
		steps: [
			toggle,
			custom("drop first changed", async ({ h }) => {
				h.pending.splice(0);
			}),
			time(1000),
			undo(),
			changed,
			changed,
			time(10000),
			expect(2, [], original, ({ h, writer }) => {
				assert.equal(h.releases.length, 2);
				assert.equal(writer.releaseSeq(), 2);
				assert.equal(
					h.events.some(
						(event) => event.kind === "recheck" || event.kind === "slow" || event.reason === "not-reread",
					),
					false,
				);
				assert.deepEqual(h.notices, ["Undid the change to “A”."]);
			}),
		],
	},
	{
		name: "after a write, set due to its current value (unchanged) → a later external revert is still reported",
		steps: [
			date(1),
			date(1),
			stale,
			expect(1, [0], original, ({ h }) => assert.ok(h.events.some((event) => event.kind === "unchanged"))),
		],
	},
	{
		name: "editor path: set date, Ctrl+Z in the editor not yet autosaved, pick the same date again → line-changed (not unchanged), and the revert notice",
		steps: [
			{ kind: "due", value: 1, mode: "source" },
			changed,
			{ kind: "ctrlz", save: false, deliver: false },
			custom("same date on stale row", async (ctx) => {
				const result = await ctx.h.write(
					{ path: ctx.note.path, line: 0, sourceLine: `${original} 📅 2026-11-01` },
					{ kind: "date", field: "due", day: "2026-11-01" as DayKey },
				);
				assert.equal(result.kind, "refused");
				if (result.kind === "refused") assert.equal(result.reason, "line-changed");
				ctx.check("stale-row refusal");
			}),
			expect(1, [0], original),
		],
	},
	{
		name: "toggle → set date → stale save back to before toggle → Undo of the toggle (already-undone) → notice names the date change",
		steps: [
			toggle,
			date(1),
			{ kind: "stale", at: 0, deliver: false },
			undo(),
			expect(2, [1], original, ({ h }) => assert.ok(h.events.some((event) => event.kind === "unchanged"))),
		],
	},
	{
		name: "a single write whose process times out without writing → only may-not-have-been-saved, no revert notice",
		steps: [
			{ kind: "timeout" },
			expect(0, [], original, ({ h }) => {
				assert.equal(h.notices.length, 1);
				assert.match(h.notices[0], /may not have been saved/u);
			}),
		],
	},
	{
		name: 'toggle → un-toggle → toggle within 2 s, one changed each → all three indexed, no "Saved in…"',
		steps: [
			toggle,
			changed,
			time(500),
			toggle,
			changed,
			time(500),
			toggle,
			changed,
			time(10000),
			expect(3, [], done, ({ h }) => {
				assert.equal(h.events.filter((event) => event.kind === "indexed").length, 3);
				assert.deepEqual(h.notices, []);
			}),
		],
	},
	{
		name: redoVariants,
		variant: "Undo cannot be redone",
		steps: [
			toggle,
			undo(),
			{ kind: "stale", at: 1 },
			expect(2, [1], done, ({ h }) => assert.equal(h.reverts[0].redo, undefined)),
		],
	},
	{
		name: redoVariants,
		variant: "Redo followed by intermediate stale copy",
		steps: [
			toggle,
			date(1),
			stale,
			{ kind: "redo" },
			{ kind: "stale", at: 1 },
			expect(4, [0, 1, 3], done, ({ h }) => assert.equal(h.reverts.length, 2)),
		],
	},
	{
		name: "write, wait 5.1 s, write again, then a stale save back to before the first → reported (records kept 60 s)",
		steps: [date(1), changed, time(5100), date(2), stale, expect(2, [0, 1], original)],
	},
	{
		name: "after a report the note returns to the timeline's last written state → no further report; a later revert to the same earlier state → the same writes are not reported again",
		steps: [
			toggle,
			stale,
			{ kind: "stale", at: 1 },
			stale,
			expect(1, [0], original, ({ h }) => assert.equal(h.reverts.length, 1)),
		],
	},
	{
		name: "Undo that re-inserted a 🏁 line, then you edit that line → no report",
		initial: ["above", "- [ ] A 🏁 delete", "below"],
		steps: [toggle, undo(), { kind: "edit-task" }, expect(2, [], "above\n- [ ] edited 1\nbelow")],
	},
	{
		name: "editor-path write then immediately reading view (saveAgain running) → no false report",
		steps: [
			custom("source to reading during saveAgain", async (ctx) => {
				const { h, note } = ctx;
				const view = h.view(note.path, "source");
				const gate = deferred();
				view.type(`${original}\nplain pending save`);
				ctx.observe(note, [...note.lines, ctx.line("plain pending save")], "user");
				view.beforeSave = () => gate.promise;
				const save = view.save();
				await flush();
				await ctx.own(note, toggle);
				view.mode = "preview";
				h.changed(note.path, original);
				await flush();
				assert.equal(h.reverts.length, 0);
				gate.resolve();
				await save;
				await ctx.changed(note);
			}),
			expect(1, [], `${done}\nplain pending save`),
		],
	},
	{
		name: 'the existing "a running save writes the old text back → notice" case still passes',
		steps: [toggle, stale, expect(1, [0], original)],
	},
	{
		name: "Redo of a two-line recurring write feeds its actual completed line to the next Redo",
		initial: ["- [ ] A 🔁 every day 📅 2026-10-31"],
		options: {
			toggle: () => "- [ ] A 🔁 every day 📅 2026-11-01\n- [x] A 🔁 every day 📅 2026-10-31 ✅ 2026-10-31",
		},
		steps: [
			toggle,
			{ kind: "due", at: 1, value: 2 },
			stale,
			{ kind: "redo" },
			changed,
			expect(4, [0, 1], "- [ ] A 🔁 every day 📅 2026-11-01\n- [x] A 🔁 every day 📅 2026-11-02 ✅ 2026-10-31"),
		],
	},
	{
		name: "Ctrl+Z of the timeline's own editor Undo reports that Undo once",
		steps: [
			{ kind: "toggle", mode: "source" },
			undo(),
			changed,
			{ kind: "ctrlz", save: true },
			changed,
			expect(2, [1], done),
		],
	},
	{
		name: "seed 187: a partial Redo stops at its ambiguous second source without restoring that task",
		initial: [original, "- [ ] R 🔁 every day 📅 2026-10-31", "- [ ] R 🔁 every day 📅 2026-10-31"],
		steps: [
			date(0),
			{ kind: "toggle", at: 1 },
			stale,
			{ kind: "redo" },
			expect(
				3,
				[0, 1],
				`${original} 📅 2026-10-31\n- [ ] R 🔁 every day 📅 2026-10-31\n- [ ] R 🔁 every day 📅 2026-10-31`,
				({ h }) => {
					assert.deepEqual(
						h.refusals.map(({ reason }) => reason),
						["ambiguous"],
					);
					assert.equal(
						h.events.some((event) => event.kind === "refused"),
						false,
					);
				},
			),
		],
	},
];
