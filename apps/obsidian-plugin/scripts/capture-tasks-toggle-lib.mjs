import { TASKS_PARITY_VAULT, tasksParityCases } from "./tasks-parity-notes.mjs";

export { TASKS_PARITY_VAULT };

export const PROBE_LINES = [
	"- [ ] probe",
	"- [ ] probe 🔁 every day 📅 2026-01-01",
	"- [ ] probe 🔁 every day ⏳ 2026-01-01 📅 2026-01-02",
	"- [ ] #task probe",
	"- [?] probe",
];

function status(symbol, name, nextStatusSymbol, type, availableAsCommand = false) {
	return { symbol, name, nextStatusSymbol, availableAsCommand, type };
}

// These signatures avoid the current day, so readiness does not depend on when the capture starts.
// apiV1 exists before loadSettings finishes; the probes distinguish the new settings from the previous group.
export const SETTINGS_GROUPS = [
	{
		name: "default",
		settings: {},
		signature: {
			emojiDone: true,
			dataviewDone: false,
			completedIndex: 1,
			newCreated: false,
			newScheduled: true,
			taggedDone: true,
			questionStatus: "x",
		},
	},
	{
		name: "dataview",
		settings: { taskFormat: "dataview" },
		signature: {
			emojiDone: false,
			dataviewDone: true,
			completedIndex: 0,
			newCreated: false,
			newScheduled: false,
			taggedDone: true,
			questionStatus: "x",
		},
	},
	{
		name: "next-line",
		settings: { recurrenceOnNextLine: true },
		signature: {
			emojiDone: true,
			dataviewDone: false,
			completedIndex: 0,
			newCreated: false,
			newScheduled: true,
			taggedDone: true,
			questionStatus: "x",
		},
	},
	{
		name: "remove-scheduled",
		settings: { removeScheduledDateOnRecurrence: true },
		signature: {
			emojiDone: true,
			dataviewDone: false,
			completedIndex: 1,
			newCreated: false,
			newScheduled: false,
			taggedDone: true,
			questionStatus: "x",
		},
	},
	{
		name: "no-done-cancelled-dates",
		settings: { setDoneDate: false, setCancelledDate: false },
		signature: {
			emojiDone: false,
			dataviewDone: false,
			completedIndex: 1,
			newCreated: false,
			newScheduled: true,
			taggedDone: false,
			questionStatus: "x",
		},
	},
	{
		name: "created-date",
		settings: { setCreatedDate: true },
		signature: {
			emojiDone: true,
			dataviewDone: false,
			completedIndex: 1,
			newCreated: true,
			newScheduled: true,
			taggedDone: true,
			questionStatus: "x",
		},
	},
	{
		name: "global-filter",
		settings: { globalFilter: "#task", removeGlobalFilter: false },
		signature: {
			emojiDone: false,
			dataviewDone: false,
			completedIndex: 0,
			newCreated: false,
			newScheduled: false,
			taggedDone: true,
			questionStatus: " ",
		},
	},
	{
		name: "custom-statuses",
		settings: {
			statusSettings: {
				coreStatuses: [status(" ", "Todo", "x", "TODO", true), status("x", "Done", " ", "DONE", true)],
				customStatuses: [
					status("/", "In Progress", "x", "IN_PROGRESS"),
					status("-", "Cancelled", " ", "CANCELLED"),
					status("!", "Important", "x", "TODO"),
					status("?", "Question", "!", "TODO"),
					status("D", "Done (custom)", " ", "DONE"),
					status("c", "Cancelled (custom)", " ", "CANCELLED"),
					status("h", "On hold", " ", "ON_HOLD"),
					status("n", "Not a task", " ", "NON_TASK"),
				],
			},
		},
		signature: {
			emojiDone: true,
			dataviewDone: false,
			completedIndex: 1,
			newCreated: false,
			newScheduled: true,
			taggedDone: true,
			questionStatus: "!",
		},
	},
];

// Kept self-contained so the capture can send this function into Obsidian's evaluate job.
export function probeSignature(outputs) {
	if (outputs.length !== 5 || outputs.some((output) => typeof output !== "string"))
		throw new Error("the Tasks settings probes must return five strings");
	const [plain, recurring, scheduled, tagged, question] = outputs;
	const newLine = (output) => output.split("\n").find((line) => line.startsWith("- [ ]")) ?? "";
	return {
		emojiDone: plain.includes("✅ "),
		dataviewDone: plain.includes("[completion:: "),
		completedIndex: recurring.split("\n").findIndex((line) => line.startsWith("- [x]")),
		newCreated: newLine(recurring).includes("➕ "),
		newScheduled: newLine(scheduled).includes("⏳ "),
		taggedDone: tagged.includes("✅ ") || tagged.includes("[completion:: "),
		questionStatus: /^- \[(.)\]/u.exec(question)?.[1] ?? "",
	};
}

export function captureCases() {
	return tasksParityCases();
}

// UTF-16 offsets match string.slice in both the capture and the fixture loader, including a retained BOM.
export function diffNote(before, after) {
	let prefix = 0;
	while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	)
		suffix++;
	return { prefix, suffix, text: after.slice(prefix, after.length - suffix) };
}

export function applyNoteDiff(before, diff) {
	return before.slice(0, diff.prefix) + diff.text + before.slice(before.length - diff.suffix);
}

function sorted(value) {
	if (Array.isArray(value)) return value.map(sorted);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sorted(value[key])]),
		);
	return value;
}

export function stableStringify(value) {
	return JSON.stringify(sorted(value), null, "\t") + "\n";
}
