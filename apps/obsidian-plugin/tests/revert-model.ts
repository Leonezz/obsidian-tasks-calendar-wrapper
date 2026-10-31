import "./setup";
import assert from "node:assert/strict";
import type { DayKey } from "@tasks-calendar-wrapper/core";
import type { TaskEdit, WriteEvent } from "../timeline/src/taskwriter";
import { deferred } from "./writer-harness";
import { createRevertWorld } from "./revert-world";
import { classify, RevertOracle, type ModelLine, type ModelWrite } from "./revert-oracle";

import {
	generateReverts,
	type RevertStep,
	type NoteModel,
	type ModelRunOptions,
	type ModelFailure,
} from "./revert-steps";
export { generateReverts };
export type { RevertStep, NoteModel, ModelRunOptions, ModelFailure, ModelStepContext } from "./revert-steps";

const textOf = (lines: readonly ModelLine[]): string => lines.map((line) => line.text).join("\n");
const task = (line: ModelLine): boolean => /^- \[[^\]]\] /u.test(line.text);
const days = ["2026-10-31", "2026-11-01", "2026-11-02"] as const;
const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
	a.length === b.length && a.every((id, i) => id === b[i]);

/** Drives the public writer against fake Obsidian, while the oracle watches identity-bearing note states. */
export async function runReverts(
	steps: readonly RevertStep[],
	options: ModelRunOptions = {},
): Promise<ModelFailure | null> {
	let nextIdentity = 0;
	let fresh = 0;
	const line = (text: string): ModelLine => ({ id: ++nextIdentity, text });
	const count = (key: string): void => options.count?.(key);
	const initial = options.initial ?? [
		"header",
		"- [ ] A",
		`- [ ] ${options.duplicated ? "A" : "B"}`,
		"- [ ] Recurring 🔁 every day 📅 2026-10-31",
		`- [ ] ${options.duplicated ? "Recurring" : "Repeat"} 🔁 every day 📅 2026-10-31`,
		"- [ ] Finish 🏁 delete",
		`- [ ] ${options.duplicated ? "Finish" : "Delete"} 🏁 delete`,
		"footer",
	];
	const notes = [initial, ["other header", "- [ ] C", "other footer"]].map((texts, i): NoteModel => {
		const lines = texts.map(line);
		return {
			path: i ? "b.md" : "a.md",
			lines,
			oracle: new RevertOracle(lines),
			snapshots: [lines],
			undo: new Map(),
			ownStack: [],
			retained: new Set(),
			pruned: new Set(),
			pending: false,
			revision: 0,
		};
	});
	const { h, writer, scheduled, reads, flush, today, setToday } = createRevertWorld(notes, options, count);
	const lastOwnText = new Map<NoteModel, string>();
	const releases = new Map<number, number>();
	const reported = new Set<number>();
	const eventCursors = new Map<NoteModel, number>();
	const triggeredNotes = new Set<NoteModel>();
	let delivery: "delayed" | "dropped" | "delivered" = "delayed";
	let stepIndex = 0;
	let failure: ModelFailure | null = null;
	const off = writer.onWrite((event) => {
		if (event.kind === "released") releases.set(event.id, h.clock.now);
	});
	const metadataRef = h.app.metadataCache.on("changed", (file, text) => {
		if (
			typeof file !== "object" ||
			file === null ||
			!("path" in file) ||
			typeof file.path !== "string" ||
			typeof text !== "string"
		)
			return;
		const note = notes.find((note) => note.path === file.path);
		if (note) triggeredNotes.add(note);
		if (!note?.latestEditor) return;
		const group = retainedGroups(note).find((group) => group.includes(note.latestEditor!));
		if (!group) return;
		const keys = [...new Set(group.flatMap((write) => write.keys))];
		const lastWritten = group.findLastIndex((write) => !write.unknown);
		const accepted = group
			.slice(Math.max(0, lastWritten))
			.flatMap((write) =>
				write.unknown
					? [note.oracle.history[write.before].lines.map((line) => line.text), write.expected ?? []]
					: [note.oracle.history[write.after].lines.map((line) => line.text)],
			);
		const current = text.split("\n");
		if (
			accepted.some((expected) =>
				keys.every(
					(key) =>
						expected.filter((text) => text === key).length ===
						current.filter((text) => text === key).length,
				),
			)
		)
			note.editorReady = true;
	});

	function syncViews(note: NoteModel): void {
		for (const view of h.views.filter((view) => view.file?.path === note.path)) {
			if (view.saving) continue;
			view.data = textOf(note.lines);
			view.editorText = view.data;
			view.lastSavedData = view.data;
		}
	}
	function currentText(note: NoteModel): string {
		const source = h.views.find(
			(view) =>
				view.file?.path === note.path && view.mode === "source" && h.leaves.some((leaf) => leaf.view === view),
		);
		return source?.editorText ?? h.text(note.path);
	}
	function mode(note: NoteModel, value: RevertStep["mode"]): void {
		if (!value) return;
		const existing = h.views.find(
			(view) => view.file?.path === note.path && h.leaves.some((leaf) => leaf.view === view),
		);
		if (existing?.mode === value) return;
		if (existing?.mode === "source" && currentText(note) !== h.text(note.path)) {
			const saved = [...note.snapshots].reverse().find((snapshot) => textOf(snapshot) === h.text(note.path));
			assert.ok(saved, "closing an unsaved editor returns to a recorded disk state");
			observe(note, saved, "foreign");
		}
		for (let i = h.leaves.length - 1; i >= 0; i--) {
			const view = h.leaves[i].view;
			if (h.views.some((candidate) => candidate === view && candidate.file?.path === note.path))
				h.leaves.splice(i, 1);
		}
		if (value !== "closed") h.view(note.path, value);
		count(`path:${value === "source" ? "editor" : "process"}`);
	}
	function observe(
		note: NoteModel,
		next: readonly ModelLine[],
		source: "own" | "user" | "foreign" | "ctrlz",
		changed: readonly number[] = [],
	): void {
		if (source !== "own") {
			note.beforeForeign = note.lines;
			note.revision++;
		}
		note.lines = next.length ? next : [line("")];
		note.oracle.observe(note.lines, source, changed);
		note.snapshots.push(note.lines);
		if (source === "user" || source === "foreign") note.ownStack.length = 0;
	}
	function releaseWindows(note: NoteModel): void {
		for (const write of note.oracle.writes) {
			const at = releases.get(write.id);
			if (at === undefined || write.releasedAt !== undefined) continue;
			write.releasedAt = at;
			write.windowEnd = Math.max(write.resultAt + 5000, at + 3000);
		}
	}
	function retainedGroups(note: NoteModel): ModelWrite[][] {
		let groups: ModelWrite[][] = [];
		for (const write of note.oracle.writes.filter((write) => note.retained.has(write.id))) {
			const hit = groups.filter((group) =>
				group.some((member) => member.keys.some((key) => write.keys.includes(key))),
			);
			groups = [
				...groups.filter((group) => !hit.includes(group)),
				[...hit.flat(), write].sort((a, b) => a.id - b.id),
			];
		}
		return groups;
	}
	function prune(note: NoteModel): void {
		// Retention and editor indexing use retained key groups; the truth's identity history is never truncated.
		let groups = retainedGroups(note).filter(
			(group) =>
				h.clock.now - group[group.length - 1].resultAt < 60000 ||
				group.some(
					(write) => write.releasedAt === undefined || (write.active && write.windowEnd >= h.clock.now),
				),
		);
		while (groups.flat().length > 50) {
			if (groups.length === 1) groups = [groups[0].slice(-50)];
			else
				groups.splice(
					groups.reduce(
						(oldest, group, i) => (group[group.length - 1].id < groups[oldest].at(-1)!.id ? i : oldest),
						0,
					),
					1,
				);
		}
		const keep = new Set(groups.flat().map((write) => write.id));
		for (const id of note.retained)
			if (!keep.has(id)) {
				note.retained.delete(id);
				note.pruned.add(id);
			}
	}
	function compare(note: NoteModel, actual: number[], expected: number[], trigger: string): void {
		count("checks");
		for (const id of actual) {
			assert.ok(!reported.has(id), `a revert was reported twice: ${id}`);
			reported.add(id);
		}
		const redo = actual.length
			? h.reverts.filter((report) => report.context.path === note.path).at(-1)?.redo
			: undefined;
		if (redo && note.beforeForeign) {
			const lostIdentities = new Set(
				note.oracle.writes
					.filter((write) => actual.includes(write.id))
					.flatMap((write) => [...write.identities]),
			);
			const affected = note.oracle
				.groups()
				.filter((group) => [...group.identities].some((id) => lostIdentities.has(id)));
			const identities = new Set(affected.flatMap((group) => [...group.identities]));
			const lastWritten = (writes: readonly ModelWrite[]) =>
				writes.filter((write) => !write.unknown && write.before !== write.after).at(-1)!;
			// Redo replays timeline writes, not an external edit undone by the same stale copy (seed 222).
			const ownStateBeforeRevert = affected.every(
				(group) =>
					JSON.stringify(
						note
							.beforeForeign!.filter((line) => group.identities.has(line.id))
							.map((line) => line.text)
							.sort(),
					) === JSON.stringify(note.oracle.state(lastWritten(group.writes).after, group.identities)),
			);
			note.redoTarget = {
				revision: note.revision,
				ownStateBeforeRevert,
				lastOwnIds: affected.map((group) => lastWritten(group.writes).id),
				actions: actual.length,
				day: today(),
				identities,
				texts: note.beforeForeign
					.filter((line) => identities.has(line.id))
					.map((line) => line.text)
					.sort(),
				redo,
			};
		}
		if (sameIds(actual, expected)) {
			count(actual.length ? "agreement:report" : "agreement:silence");
			return;
		}
		const classes = classify(note.oracle, actual, expected, note.pruned, note.lines);
		const signatures = (ids: readonly number[]): string[] =>
			ids.map((id) => note.oracle.writes.find((write) => write.id === id)?.signature ?? `missing:${id}`).sort();
		if (
			classes.includes("identical") &&
			JSON.stringify(signatures(actual)) === JSON.stringify(signatures(expected))
		) {
			count("disagreement:identical");
			failure = {
				step: stepIndex,
				actual,
				expected,
				classes: ["identical"],
				message: `${trigger}: same text, different identities`,
			};
			return;
		}
		for (const reason of classes) count(`disagreement:${reason}`);
		failure = {
			step: stepIndex,
			actual,
			expected,
			classes,
			message: `${trigger}: writer [${actual}] versus truth [${expected}]`,
		};
	}
	function check(
		trigger: string,
		undone?: number,
		expectedOverride?: Map<NoteModel, number[]>,
		checked?: ReadonlySet<NoteModel>,
	): void {
		const selected =
			checked ??
			new Set([
				...triggeredNotes,
				...notes.filter((note) =>
					h.events.slice(eventCursors.get(note) ?? 0).some((event) => event.path === note.path),
				),
			]);
		for (const note of notes) {
			if (!selected.has(note)) continue;
			const events = h.events.slice(eventCursors.get(note) ?? 0);
			eventCursors.set(note, h.events.length);
			triggeredNotes.delete(note);
			releaseWindows(note);
			prune(note);
			const actual = events
				.filter((event) => event.kind === "overwritten" && event.path === note.path)
				.map((event) => event.id)
				.sort((a, b) => a - b);
			if (trigger === "changed" || trigger === "timer") {
				const ownState = note.oracle.groups().every((group) => {
					const keys = new Set(group.writes.flatMap((write) => write.keys));
					const after = note.oracle.history[group.writes.at(-1)!.after].lines;
					return [...keys].every(
						(key) =>
							note.lines.filter((line) => line.text === key).length ===
							after.filter((line) => line.text === key).length,
					);
				});
				// Unwritten identical lines can change a group's counts; an unrelated own write can carry stale text.
				if (ownState && textOf(note.lines) === lastOwnText.get(note))
					assert.deepEqual(actual, [], "the unchanged last own note and group states cannot be a revert");
				if (note.oracle.writes.every((write) => !write.active || write.windowEnd < h.clock.now))
					assert.deepEqual(actual, [], "a current check after every window ended cannot report");
			}
			const lastEditor = note.latestEditor;
			const source = h.views.some(
				(view) =>
					view.file?.path === note.path &&
					view.mode === "source" &&
					h.leaves.some((leaf) => leaf.view === view),
			);
			const deferredEditor =
				trigger !== "unchanged" &&
				lastEditor &&
				!note.editorReady &&
				!source &&
				h.clock.now < lastEditor.resultAt + 10000;
			const expected = deferredEditor
				? []
				: (expectedOverride?.get(note) ?? note.oracle.evaluate(h.clock.now, undone));
			compare(note, actual, expected, trigger);
			note.pending = false;
			if (failure) break;
		}
	}
	async function changed(note: NoteModel): Promise<void> {
		h.changed(note.path, textOf(note.lines));
		await flush();
		check("changed", undefined, undefined, new Set([note]));
	}
	async function advance(ms: number): Promise<void> {
		const end = h.clock.now + ms;
		do {
			const moments = [...scheduled.values()].filter((at) => at <= end);
			const next = moments.length ? Math.max(h.clock.now, Math.min(...moments)) : end;
			const beforeReads = new Map(notes.map((note) => [note, reads(note)]));
			await h.clock.advance(next - h.clock.now);
			if (delivery === "delivered" || moments.some((at) => at <= next)) await flush();
			// Observe actual callbacks: indexed/reported records can have cancelled their historical timers.
			const checked = new Set(notes.filter((note) => reads(note) > beforeReads.get(note)!));
			for (const note of triggeredNotes) checked.add(note);
			if (checked.size) check("timer", undefined, undefined, checked);
		} while (!failure && h.clock.now < end);
	}
	async function external(
		note: NoteModel,
		next: readonly ModelLine[],
		source: "user" | "foreign" | "ctrlz",
		deliver: boolean,
		changedIds: readonly number[] = [],
	): Promise<void> {
		observe(note, next, source, changedIds);
		note.pending = true;
		h.put(note.path, textOf(note.lines));
		syncViews(note);
		if (deliver) await changed(note);
	}
	function pickTask(note: NoteModel, at = 0): number | undefined {
		const positions = note.lines.flatMap((line, i) => (task(line) ? [i] : []));
		return positions.length ? positions[at % positions.length] : undefined;
	}
	function ownResult(
		note: NoteModel,
		event: WriteEvent,
		before: readonly ModelLine[],
		beforePosition: number,
		edit: TaskEdit,
		original: ModelLine,
		validate = true,
	): void {
		const undoing = edit.kind === "undo" ? note.undo.get(edit.record.id) : undefined;
		const removed = edit.kind === "undo" ? edit.record.span.expected.length : 1;
		const replacement = event.lines.map((text): ModelLine => ({
			id: undoing ? undoing.original.id : event.lines.length === 1 ? original.id : ++nextIdentity,
			text,
		}));
		const next = [...before.slice(0, event.line), ...replacement, ...before.slice(event.line + removed)];
		if (next.length === 0 && currentText(note) === "") next.push(line(""));
		if (validate && textOf(next) !== currentText(note)) {
			// Deleting the final line leaves the physical empty line that Obsidian's editor owns.
			if (textOf(next) + "\n" === currentText(note)) next.push(line(""));
			else assert.equal(textOf(next), currentText(note), "identity application follows the real writer output");
		}
		observe(note, next, "own");
		lastOwnText.set(note, textOf(note.lines));
		const write: ModelWrite = {
			id: event.id,
			identities: new Set([
				...before.slice(event.line, event.line + removed).map((line) => line.id),
				...replacement.map((line) => line.id),
				original.id,
			]),
			before: beforePosition,
			after: note.oracle.position,
			resultAt: h.clock.now,
			active: true,
			windowEnd: Infinity,
			undoOf: edit.kind === "undo" ? edit.record.id : undefined,
			signature: JSON.stringify([edit.kind === "undo" ? "undo" : "write", original.text, event.lines]),
			keys: [...(edit.kind === "undo" ? edit.record.span.expected : [original.text]), ...event.lines],
			neighbours:
				edit.kind === "undo" && edit.record.span.expected.length === 0
					? [edit.record.above, edit.record.below]
					: undefined,
		};
		prune(note);
		note.oracle.writes.push(write);
		const source = h.views.find(
			(view) =>
				view.file?.path === note.path && view.mode === "source" && h.leaves.some((leaf) => leaf.view === view),
		);
		if (source?.transactions.at(-1)?.origin === "tasks-calendar-wrapper") {
			note.ownStack.push({ view: source, before, after: textOf(next) });
			note.latestEditor = write;
			note.editorReady = false;
		}
		note.retained.add(write.id);
		releaseWindows(note);
	}
	async function own(note: NoteModel, step: RevertStep): Promise<void> {
		mode(note, step.mode);
		const at = pickTask(note, step.at);
		const undoRecords = [...note.undo.values()];
		const undo =
			step.kind === "undo" && undoRecords.length ? undoRecords[(step.at ?? 0) % undoRecords.length] : undefined;
		if (at === undefined && !undo) return;
		const index = at ?? 0;
		const original = undo?.original ?? note.lines[index];
		let edit: TaskEdit;
		if (undo) edit = { kind: "undo", record: undo.record };
		else if (step.kind === "undo") return;
		else if (step.kind === "toggle" || step.kind === "timeout") edit = { kind: "toggle" };
		else if (step.kind === "replace")
			edit = {
				kind: "replace",
				expected: original.text,
				lines: [step.text ?? original.text.replace(/A/u, "A edited")],
			};
		else {
			let day: DayKey | null =
				step.kind === "remove-due" ? null : (days[(step.value ?? 0) % days.length] as DayKey);
			if (step.kind === "set-back") {
				const previous = [...note.snapshots]
					.reverse()
					.flatMap((snapshot) =>
						snapshot.filter((line) => line.id === original.id && line.text !== original.text),
					)[0];
				day = (previous?.text.match(/📅 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null) as DayKey | null;
			}
			edit = { kind: "date", field: "due", day };
		}
		const before = note.lines;
		const beforePosition = note.oracle.position;
		const eventsAt = h.events.length;
		const result = await h.write({ path: note.path, line: index, sourceLine: original.text }, edit);
		await flush();
		const event = h.events.slice(eventsAt).find((event) => event.kind === "written");
		if (result.kind === "written" && event) {
			ownResult(note, event, before, beforePosition, edit, original);
			if (result.undo) note.undo.set(result.undo.id, { record: result.undo, original });
			if (undo) note.undo.delete(undo.record.id);
			while (note.undo.size > 50) note.undo.delete(note.undo.keys().next().value!);
			count(edit.kind === "undo" ? "undo:written" : "own:written");
		} else if (result.kind === "unchanged") {
			const unchanged = h.events.slice(eventsAt).find((event) => event.kind === "unchanged");
			if (unchanged) {
				const expected = new Map([
					[note, note.oracle.evaluate(h.clock.now, result.alreadyUndone ? undo?.record.id : undefined)],
				]);
				prune(note);
				note.oracle.writes.push({
					id: unchanged.id,
					identities: new Set([original.id]),
					before: beforePosition,
					after: beforePosition,
					undoOf: undo?.record.id,
					resultAt: h.clock.now,
					releasedAt: h.clock.now,
					windowEnd: -Infinity,
					active: true,
					signature: JSON.stringify(["unchanged", original.text]),
					keys: [...(undo?.record.span.expected ?? []), original.text],
				});
				note.retained.add(unchanged.id);
				check("unchanged", undefined, expected, new Set([note]));
				count(result.alreadyUndone ? "undo:already" : "own:unchanged");
				return;
			}
		} else count(`own:${result.kind}`);
		syncViews(note);
		const checked = new Set(
			notes.filter((item) => h.events.slice(eventsAt).some((event) => event.path === item.path)),
		);
		check("own-result", undefined, undefined, checked);
		if (delivery === "delivered") {
			await h.clock.advance(0);
			check("indexed");
		}
	}

	let drainedWrites = 0;
	try {
		for (stepIndex = 0; stepIndex < steps.length; stepIndex++) {
			if (h.writes.length !== drainedWrites) {
				await advance(0);
				drainedWrites = h.writes.length;
				if (failure) return failure;
			}
			const step = steps[stepIndex];
			const note = notes[(step.note ?? 0) % notes.length];
			const at = step.at ?? 0;
			const value = step.value ?? 0;
			count(`step:${step.label ?? step.kind}`);
			if (step.kind === "custom")
				await step.custom?.({
					h,
					writer,
					note,
					notes,
					own,
					changed,
					advance,
					external,
					observe,
					ownResult,
					check,
					syncViews,
					currentText,
					line,
					setToday,
					count,
				});
			else if (["toggle", "due", "remove-due", "set-back", "undo", "replace"].includes(step.kind))
				await own(note, step);
			else if (step.kind === "time") await advance(step.ms ?? 1000);
			else if (step.kind === "view") mode(note, step.mode ?? "source");
			else if (step.kind === "delivery") {
				delivery = (["delayed", "dropped", "delivered"] as const)[value % 3];
				h.setDelivery(delivery);
				count(`delivery:${delivery}`);
			} else if (step.kind === "changed") {
				await h.deliver();
				await flush();
				await changed(note);
				if (!failure && triggeredNotes.size) check("delivered");
			} else if (step.kind === "rename") {
				const previous = note.path;
				note.path = `${previous.slice(0, -3)}-renamed.md`;
				h.rename(previous, note.path);
				await flush();
				check("rename", undefined, new Map(notes.map((item) => [item, []])));
			} else if (step.kind === "quick-entry") {
				mode(note, "closed");
				const addition = line(`- [ ] quick ${++fresh}`);
				const result = await writer.insert(note.path, (content) => content + "\n" + addition.text);
				if (result.kind === "written") observe(note, [...note.lines, addition], "user", [addition.id]);
				await flush();
				check("quick-entry-result", undefined, undefined, new Set([note]));
			} else if (step.kind === "redo") {
				const report = note.redoTarget;
				if (report) {
					const beforeEvents = h.events.length;
					// Replaying older actions also preserves a newer own action on those lines.
					const noNewOwn = note.oracle
						.groups()
						.filter((group) => [...group.identities].some((id) => report.identities.has(id)))
						.every((group) =>
							report.lastOwnIds.includes(
								group.writes.filter((write) => !write.unknown && write.before !== write.after).at(-1)!
									.id,
							),
						);
					await report.redo();
					for (const event of h.events.slice(beforeEvents).filter((event) => event.kind === "written")) {
						const original = note.lines[event.line];
						if (original)
							ownResult(
								note,
								event,
								note.lines,
								note.oracle.position,
								{ kind: "toggle" },
								original,
								false,
							);
					}
					if (
						h.events
							.slice(beforeEvents)
							.filter((event) => event.kind === "written" || event.kind === "unchanged").length ===
						report.actions
					) {
						// This assertion applies only when no external edit intervened after the report.
						if (
							report.revision === note.revision &&
							report.ownStateBeforeRevert &&
							noNewOwn &&
							report.day === today()
						)
							assert.deepEqual(
								note.lines
									.filter((line) =>
										note.oracle
											.groups()
											.some(
												(group) =>
													[...group.identities].some((id) => report.identities.has(id)) &&
													group.identities.has(line.id),
											),
									)
									.map((line) => line.text)
									.sort(),
								report.texts,
							);
						count("redo:written");
					}
					note.redoTarget = undefined;
					syncViews(note);
					await flush();
					if (
						h.events
							.slice(beforeEvents)
							.some((event) => ["written", "unchanged", "refused", "failed"].includes(event.kind))
					)
						check("redo-result", undefined, undefined, new Set([note]));
				}
			} else if (step.kind === "timeout" || step.kind === "concurrent") {
				mode(note, "closed");
				const index = pickTask(note, at);
				if (index !== undefined) {
					const gate = deferred();
					const calls = h.processCalls.length;
					h.onProcess(() => gate.promise);
					const eventsAt = h.events.length;
					const pending = h.write({ path: note.path, line: index, sourceLine: note.lines[index].text });
					await flush();
					let expected: Map<NoteModel, number[]> | undefined;
					if (step.kind === "concurrent") {
						await h.clock.advance(2000);
						const other = notes[(notes.indexOf(note) + 1) % notes.length];
						observe(other, other.snapshots[0], "foreign");
						h.put(other.path, textOf(other.lines));
						syncViews(other);
						h.changed(other.path);
						await flush();
						expected = new Map(notes.map((item) => [item, item.oracle.evaluate(h.clock.now)]));
					}
					await h.clock.advance(60000);
					const result = await pending;
					if (h.processCalls.length > calls) assert.equal(result.kind, "failed");
					else assert.equal(result.kind, "refused");
					const event = h.events.slice(eventsAt).find((event) => event.kind === "failed");
					prune(note);
					if (event)
						note.oracle.writes.push({
							id: event.id,
							identities: new Set([note.lines[index].id]),
							before: note.oracle.position,
							after: note.oracle.position,
							resultAt: h.clock.now,
							releasedAt: h.clock.now,
							windowEnd: -Infinity,
							active: false,
							unknown: true,
							signature: "unknown",
							keys: [note.lines[index].text, ...event.lines],
							expected: [
								...note.lines.slice(0, index).map((line) => line.text),
								...event.lines,
								...note.lines.slice(index + 1).map((line) => line.text),
							],
						});
					if (event) note.retained.add(event.id);
					gate.resolve();
					h.onProcess();
					await flush();
					check("timeout-result", undefined, expected);
				}
			} else if (step.kind === "save-again") {
				mode(note, "source");
				const view = h.views.find(
					(view) =>
						view.file?.path === note.path &&
						view.mode === "source" &&
						h.leaves.some((leaf) => leaf.view === view),
				)!;
				const gate = deferred();
				view.type(textOf(note.lines) + "\nplain pending save");
				observe(note, [...note.lines, line("plain pending save")], "user");
				view.beforeSave = () => gate.promise;
				const saving = view.save();
				await own(note, { kind: "toggle", at });
				gate.resolve();
				await saving;
				view.beforeSave = undefined;
				await h.deliver();
				await flush();
				check("saveAgain");
			} else {
				let next = [...note.lines];
				let source: "user" | "foreign" | "ctrlz" = "user";
				let changedIds: number[] = [];
				const index = pickTask(note, at);
				if (step.kind === "insert-plain") next.splice(at % (next.length + 1), 0, line(`plain ${++fresh}`));
				else if (step.kind === "delete-plain") {
					const positions = next.flatMap((item, i) => (task(item) ? [] : [i]));
					if (positions.length) next.splice(positions[at % positions.length], 1);
				} else if (step.kind === "move" && next.length) {
					const block = next.splice(at % next.length, 1 + (value % 3));
					next.splice(value % (next.length + 1), 0, ...block);
				} else if (step.kind === "edit-task" && index !== undefined) {
					changedIds = [next[index].id];
					next[index] = { ...next[index], text: `- [ ] edited ${++fresh}` };
				} else if (step.kind === "insert-task") {
					const added = line(`- [ ] inserted ${++fresh}`);
					changedIds = [added.id];
					next.splice(at % (next.length + 1), 0, added);
				} else if (step.kind === "delete-task" && index !== undefined) {
					changedIds = [next[index].id];
					next.splice(index, 1);
				} else if (step.kind === "stale") {
					source = "foreign";
					next = [...note.snapshots[at % note.snapshots.length]];
				} else if (step.kind === "revert-line" && index !== undefined) {
					source = "foreign";
					const old = note.snapshots.flat().filter((item) => item.id === next[index].id);
					if (old.length) next[index] = old[value % old.length];
				} else if (step.kind === "ctrlz") {
					const transaction = note.ownStack.at(-1);
					if (
						!transaction ||
						transaction.view.mode !== "source" ||
						!h.leaves.some((leaf) => leaf.view === transaction.view) ||
						transaction.view.editorText !== transaction.after
					)
						continue;
					note.ownStack.pop();
					observe(note, transaction.before, "ctrlz");
					transaction.view.type(textOf(note.lines));
					note.pending = true;
					count("ctrlz:own-editor-transaction");
					if (step.save ?? step.deliver !== false) {
						await transaction.view.save();
						count("ctrlz:saved");
						if (step.deliver !== false) await changed(note);
					} else count("ctrlz:unsaved");
					if (failure) return failure;
					continue;
				}
				await external(note, next, source, step.deliver !== false, changedIds);
			}
			if (failure) return failure;
		}
		return null;
	} finally {
		off();
		h.app.metadataCache.offref(metadataRef);
		writer.dispose();
	}
}

/** Deletes chunks while preserving an unclassified disagreement, producing a replayable small sequence. */
export async function shrinkReverts(
	steps: readonly RevertStep[],
	options: ModelRunOptions,
): Promise<readonly RevertStep[]> {
	let result = [...steps];
	for (let size = Math.max(1, Math.floor(result.length / 2)); size >= 1; size = Math.floor(size / 2)) {
		for (let at = 0; at + size <= result.length;) {
			const candidate = [...result.slice(0, at), ...result.slice(at + size)];
			const failure = await runReverts(candidate, options);
			if (failure?.classes.includes("other")) result = candidate;
			else at += size;
		}
	}
	return result;
}
