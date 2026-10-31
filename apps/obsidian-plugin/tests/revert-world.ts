import assert from "node:assert/strict";
import type { DayKey } from "@tasks-calendar-wrapper/core";
import { flush as flushHarness, writerHarness } from "./writer-harness";
import type { ModelRunOptions, NoteModel } from "./revert-steps";

/** The real writer's fake world exposes actual timer/reader activity without changing the identity oracle. */
export function createRevertWorld(notes: readonly NoteModel[], options: ModelRunOptions, count: (key: string) => void) {
	const h = writerHarness(
		Object.fromEntries(notes.map((note) => [note.path, note.lines.map((line) => line.text).join("\n")])),
	);
	let today = "2026-10-31" as DayKey;
	const scheduled = new Map<number, number>();
	const reads = (note: NoteModel): number =>
		h.readCalls.filter((path) => path === note.path).length +
		h.views.filter((view) => view.file?.path === note.path).reduce((sum, view) => sum + view.reads.length, 0);
	async function flush(): Promise<void> {
		let previous = -1;
		let stable = 0;
		for (let attempt = 0; attempt < 100; attempt++) {
			await flushHarness();
			const progress = h.events.length + notes.reduce((sum, note) => sum + reads(note), 0);
			stable = progress === previous ? stable + 1 : 0;
			if (stable === 2) return;
			previous = progress;
		}
		assert.fail("the writer did not settle after draining its queued reads");
	}
	const writer = h.create({
		setTimeout: (run, delay) => {
			const id = h.clock.setTimeout(() => {
				scheduled.delete(id);
				run();
			}, delay);
			scheduled.set(id, h.clock.now + delay);
			return id;
		},
		clearTimeout: (id) => {
			scheduled.delete(id);
			h.clock.clearTimeout(id);
		},
		today: () => today,
		tasks: () => ({
			kind: "toggle",
			toggle: (source) => {
				if (options.toggle) return options.toggle(source, today);
				if (source.includes("🏁 delete") && source.startsWith("- [ ]")) {
					count("tasks:bang-delete");
					return "";
				}
				if (source.startsWith("- [x]"))
					return source.replace("- [x]", "- [ ]").replace(/ ✅ \d{4}-\d{2}-\d{2}/u, "");
				if (source.includes("🔁 every day")) {
					count("tasks:recurring-two-lines");
					const next = source.replace(
						/📅 (\d{4}-\d{2}-\d{2})/u,
						(_, day: string) => `📅 ${new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)}`,
					);
					return `${next}\n${source.replace("- [ ]", "- [x]")} ✅ ${today}`;
				}
				return source.replace("- [ ]", "- [x]") + ` ✅ ${today}`;
			},
		}),
	});
	return {
		h,
		writer,
		scheduled,
		reads,
		flush,
		today: () => today,
		setToday: (day: DayKey) => {
			today = day;
		},
	};
}
