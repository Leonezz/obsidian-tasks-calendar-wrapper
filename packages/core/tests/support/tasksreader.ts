/**
 * Ported from Obsidian Tasks 8.6.0 (https://github.com/obsidian-tasks-group/obsidian-tasks, tag 8.6.0), MIT License, Copyright (c) 2021 Clare Macrae, Ilyas Landikov and Martin Schenck
 * Source files: src/Task/Task.ts, src/Task/TaskRegularExpressions.ts,
 * src/TaskSerializer/DefaultTaskSerializer.ts, src/TaskSerializer/DataviewTaskSerializer.ts,
 * src/lib/PriorityTools.ts and src/Task/OnCompletion.ts. See the root NOTICE for the MIT license text.
 *
 * This test-only reader returns captured date text instead of window.moment(text, "YYYY-MM-DD") objects.
 * It returns recurrence rule text instead of parsing with rrule: Tasks drops an unreadable rule, which this
 * reader cannot determine. There is no global filter, status registry (status is the raw symbol), or fallback date.
 */

export type TasksFormat = "emoji" | "dataview";
type Priority = "highest" | "high" | "medium" | "none" | "low" | "lowest";

export interface TasksLine {
	indentation: string;
	listMarker: string;
	status: string;
	body: string;
	blockLink: string;
	description: string;
	priority: Priority;
	startDate: string | null;
	createdDate: string | null;
	scheduledDate: string | null;
	dueDate: string | null;
	doneDate: string | null;
	cancelledDate: string | null;
	recurrenceRule: string;
	onCompletion: "" | "keep" | "delete";
	id: string;
	dependsOn: string[];
	tags: string[];
}

const indentationRegex = /^([\s\t>]*)/;
const listMarkerRegex = /([-*+]|[0-9]+[.)])/;
const checkboxRegex = /\[(.)\]/u;
const afterCheckboxRegex = / *(.*)/u;
const taskRegex = new RegExp(
	indentationRegex.source + listMarkerRegex.source + " +" + checkboxRegex.source + afterCheckboxRegex.source,
	"u",
);
const blockLinkRegex = / \^[a-zA-Z0-9-]+$/u;
const hashTags = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+/g;
const hashTagsFromEnd = new RegExp(hashTags.source + "$");
const taskIdRegex = /[a-zA-Z0-9-_]+/;
const taskIdSequenceRegex = new RegExp(taskIdRegex.source + "( *, *" + taskIdRegex.source + " *)*");

function dateFieldRegex(symbols: string): RegExp {
	return fieldRegex(symbols, "(\\d{4}-\\d{2}-\\d{2})");
}

function fieldRegex(symbols: string, valueRegexString: string): RegExp {
	let source = symbols + "\uFE0F?";
	if (valueRegexString !== "") source += " *" + valueRegexString;
	source += "$";
	// Tasks 8.6.0 deliberately omits the u flag for iPadOS/iOS compatibility.
	return new RegExp(source);
}

const DEFAULT_SYMBOLS = {
	prioritySymbols: {
		Highest: "🔺",
		High: "⏫",
		Medium: "🔼",
		Low: "🔽",
		Lowest: "⏬",
		None: "",
	},
	startDateSymbol: "🛫",
	createdDateSymbol: "➕",
	scheduledDateSymbol: "⏳",
	dueDateSymbol: "📅",
	doneDateSymbol: "✅",
	cancelledDateSymbol: "❌",
	recurrenceSymbol: "🔁",
	onCompletionSymbol: "🏁",
	dependsOnSymbol: "⛔",
	idSymbol: "🆔",
	TaskFormatRegularExpressions: {
		priorityRegex: fieldRegex("(🔺|⏫|🔼|🔽|⏬)", ""),
		startDateRegex: dateFieldRegex("🛫"),
		createdDateRegex: dateFieldRegex("➕"),
		scheduledDateRegex: dateFieldRegex("(?:⏳|⌛)"),
		dueDateRegex: dateFieldRegex("(?:📅|📆|🗓)"),
		doneDateRegex: dateFieldRegex("✅"),
		cancelledDateRegex: dateFieldRegex("❌"),
		recurrenceRegex: fieldRegex("🔁", "([a-zA-Z0-9, !]+)"),
		onCompletionRegex: fieldRegex("🏁", "([a-zA-Z]+)"),
		dependsOnRegex: fieldRegex("⛔", "(" + taskIdSequenceRegex.source + ")"),
		idRegex: fieldRegex("🆔", "(" + taskIdRegex.source + ")"),
	},
} as const;

function toInlineFieldRegex(innerFieldRegex: RegExp): RegExp {
	const fieldRegex = (
		[
			"(?:",
			/(?=[^\]]+\])\[/,
			"|",
			/(?=[^)]+\))\(/,
			")",
			/ */,
			innerFieldRegex,
			/ */,
			/[)\]]/,
			/(?: *,)?/,
			/$/,
		] as const
	)
		.map((val) => (val instanceof RegExp ? val.source : val))
		.join("");
	return new RegExp(fieldRegex, innerFieldRegex.flags);
}

const DATAVIEW_SYMBOLS = {
	prioritySymbols: {
		Highest: "priority:: highest",
		High: "priority:: high",
		Medium: "priority:: medium",
		Low: "priority:: low",
		Lowest: "priority:: lowest",
		None: "",
	},
	startDateSymbol: "start::",
	createdDateSymbol: "created::",
	scheduledDateSymbol: "scheduled::",
	dueDateSymbol: "due::",
	doneDateSymbol: "completion::",
	cancelledDateSymbol: "cancelled::",
	recurrenceSymbol: "repeat::",
	onCompletionSymbol: "onCompletion::",
	idSymbol: "id::",
	dependsOnSymbol: "dependsOn::",
	TaskFormatRegularExpressions: {
		priorityRegex: toInlineFieldRegex(/priority:: *(highest|high|medium|low|lowest)/),
		startDateRegex: toInlineFieldRegex(/start:: *(\d{4}-\d{2}-\d{2})/),
		createdDateRegex: toInlineFieldRegex(/created:: *(\d{4}-\d{2}-\d{2})/),
		scheduledDateRegex: toInlineFieldRegex(/scheduled:: *(\d{4}-\d{2}-\d{2})/),
		dueDateRegex: toInlineFieldRegex(/due:: *(\d{4}-\d{2}-\d{2})/),
		doneDateRegex: toInlineFieldRegex(/completion:: *(\d{4}-\d{2}-\d{2})/),
		cancelledDateRegex: toInlineFieldRegex(/cancelled:: *(\d{4}-\d{2}-\d{2})/),
		recurrenceRegex: toInlineFieldRegex(/repeat:: *([a-zA-Z0-9, !]+)/),
		onCompletionRegex: toInlineFieldRegex(/onCompletion:: *([a-zA-Z]+)/),
		dependsOnRegex: toInlineFieldRegex(new RegExp("dependsOn:: *(" + taskIdSequenceRegex.source + ")")),
		idRegex: toInlineFieldRegex(new RegExp("id:: *(" + taskIdRegex.source + ")")),
	},
} as const;

function priorityValue(priority: string): Priority {
	switch (priority.toLowerCase()) {
		case "lowest":
			return "lowest";
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "highest":
			return "highest";
		default:
			return "none";
	}
}

function parsePriority(value: string, format: TasksFormat): Priority {
	if (format === "dataview") return priorityValue(value);
	const symbols = DEFAULT_SYMBOLS.prioritySymbols;
	switch (value) {
		case symbols.Lowest:
			return "lowest";
		case symbols.Low:
			return "low";
		case symbols.Medium:
			return "medium";
		case symbols.High:
			return "high";
		case symbols.Highest:
			return "highest";
		default:
			return "none";
	}
}

function parseOnCompletionValue(value: string): TasksLine["onCompletion"] {
	const onCompletion = value.trim().toLowerCase();
	return onCompletion === "keep" || onCompletion === "delete" ? onCompletion : "";
}

interface ParsingState {
	line: string;
	matched: boolean;
}

function extractField(state: ParsingState, regex: RegExp, setter: (match: RegExpMatchArray) => void): void {
	const match = state.line.match(regex);
	if (match !== null) {
		setter(match);
		state.line = state.line.replace(regex, "").trim();
		state.matched = true;
	}
}

/** Reads the two Tasks formats without importing production code or the reference checkout. */
export function readTasksLine(line: string, format: TasksFormat): TasksLine | null {
	const match = line.match(taskRegex);
	if (match === null) return null;
	let body = match[4].trim();
	const blockLink = body.match(blockLinkRegex)?.[0] ?? "";
	if (blockLink !== "") body = body.replace(blockLinkRegex, "").trim();
	const task: TasksLine = {
		indentation: match[1],
		listMarker: match[2],
		status: match[3],
		body,
		blockLink,
		description: "",
		priority: "none",
		startDate: null,
		createdDate: null,
		scheduledDate: null,
		dueDate: null,
		doneDate: null,
		cancelledDate: null,
		recurrenceRule: "",
		onCompletion: "",
		id: "",
		dependsOn: [],
		tags: [],
	};
	const regexes = (format === "emoji" ? DEFAULT_SYMBOLS : DATAVIEW_SYMBOLS).TaskFormatRegularExpressions;
	const state: ParsingState = { line: body, matched: false };
	let trailingTags = "";
	const maxRuns = 20;
	let runs = 0;
	do {
		state.matched = false;
		extractField(state, regexes.priorityRegex, (m) => (task.priority = parsePriority(m[1], format)));
		extractField(state, regexes.doneDateRegex, (m) => (task.doneDate = m[1]));
		extractField(state, regexes.cancelledDateRegex, (m) => (task.cancelledDate = m[1]));
		extractField(state, regexes.dueDateRegex, (m) => (task.dueDate = m[1]));
		extractField(state, regexes.scheduledDateRegex, (m) => (task.scheduledDate = m[1]));
		extractField(state, regexes.startDateRegex, (m) => (task.startDate = m[1]));
		extractField(state, regexes.createdDateRegex, (m) => (task.createdDate = m[1]));
		extractField(state, regexes.recurrenceRegex, (m) => (task.recurrenceRule = m[1].trim()));
		extractField(state, regexes.onCompletionRegex, (m) => (task.onCompletion = parseOnCompletionValue(m[1])));
		extractField(state, hashTagsFromEnd, (m) => {
			const tagName = m[0].trim();
			trailingTags = trailingTags.length > 0 ? [tagName, trailingTags].join(" ") : tagName;
		});
		extractField(state, regexes.idRegex, (m) => (task.id = m[1].trim()));
		extractField(state, regexes.dependsOnRegex, (m) => {
			task.dependsOn = m[1]
				.replace(/ /g, "")
				.split(",")
				.filter((item) => item !== "");
		});
		runs++;
	} while (state.matched && runs <= maxRuns);
	if (trailingTags.length > 0) state.line += (state.line.length > 0 ? " " : "") + trailingTags;
	task.description = state.line;
	task.tags = state.line.match(hashTags)?.map((tag) => tag.trim()) ?? [];
	return task;
}
