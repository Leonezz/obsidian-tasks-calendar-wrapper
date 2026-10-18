/**
 * Parses the tasks of a note from its content and the metadata Obsidian computed for it. Adapted from the task line
 * parsing of the Obsidian Tasks plugin and from Dataview, see NOTICE.
 *
 * Parsing is synchronous and uses nothing but the note: no clock and no setting. Its steps run in the order the
 * plugin's parser chain ran them (utils/taskmapable.ts), each returning new values; what depends on the clock or the
 * settings, such as the status or the daily note's date, is left to resolveTasks.
 */
import { parseLooseDate, parseStrictDate, type DateValue, type MomentFactory } from "./dates";
import { fileLink, outlink, sectionLink } from "./links";
import { copyJsonValue, deepFreeze } from "./options";
import {
	TaskRegularExpressions,
	TasksPriorityNameToLabel,
	TasksPrioritySymbolToLabel,
	type PriorityLabel,
	type TasksPrioritySymbol,
} from "./syntax";
import type {
	LinkRef,
	ListItemInfo,
	NoteInfo,
	NoteMetadata,
	NoteSnapshot,
	ParsedNote,
	ParseWarning,
	SectionInfo,
	Task,
	TaskDates,
	TextRange,
} from "./task";

/** Parses every task of a note. Throws where the plugin's parser threw, for frontmatter tags that are not text. */
export function parseNote(snapshot: NoteSnapshot, moment: MomentFactory): ParsedNote {
	const metadata = snapshot.metadata ?? undefined;
	const note = noteInfo(snapshot.path, metadata);
	const context = noteContext(snapshot, note, metadata);
	const tasks: Task[] = [];
	const warnings: ParseWarning[] = [];
	for (const item of metadata?.listItems ?? []) {
		const task = taskOfItem(item, context, moment, warnings);
		if (task) tasks.push(task);
	}
	return Object.freeze({ note, tasks: Object.freeze(tasks), warnings: deepFreeze(warnings) });
}

/** Parses one task line as if it were a note of its own, starting at column `col`. For tests and quick checks. */
export function parseTaskLine(
	line: string,
	options: { moment: MomentFactory; path?: string; col?: number },
): Task | null {
	const col = options.col ?? 0;
	const position = { start: { line: 0, col, offset: col }, end: { line: 0, col: line.length, offset: line.length } };
	const parsed = parseNote(
		{
			path: options.path ?? "Inbox.md",
			content: line,
			metadata: { listItems: [{ task: " ", parent: -1, position }] },
		},
		options.moment,
	);
	return parsed.tasks[0] ?? null;
}

function noteInfo(path: string, metadata: NoteMetadata | undefined): NoteInfo {
	return deepFreeze({
		path,
		frontmatter: copyJsonValue(metadata?.frontmatter ?? {}),
		tags: (metadata?.tags ?? []).map((tag) => tag.tag),
	});
}

interface NoteContext {
	readonly path: string;
	readonly content: string;
	readonly note: NoteInfo;
	readonly link: LinkRef;
	readonly metadata: NoteMetadata | undefined;
	/** The frontmatter's tags, worked out on the note's first task, so a note without tasks never fails on them. */
	readonly frontmatterTags: () => readonly string[];
}

function noteContext(snapshot: NoteSnapshot, note: NoteInfo, metadata: NoteMetadata | undefined): NoteContext {
	let frontmatterTags: readonly string[] | undefined;
	return {
		path: snapshot.path,
		content: snapshot.content,
		note,
		link: fileLink(snapshot.path),
		metadata,
		frontmatterTags: () => (frontmatterTags ??= tagsOfFrontmatter(snapshot.path, note.frontmatter)),
	};
}

/**
 * The tags the frontmatter gives every task of the note: `tag` when it is text, and each item of `tags`, with a "#"
 * in front. An item that already starts with "#" gives "", as it always has. A `tags` that is a list with an item
 * that is not text, or an object, is an error: the plugin's parser threw a TypeError on it.
 */
function tagsOfFrontmatter(path: string, frontmatter: Readonly<Record<string, unknown>>): readonly string[] {
	const tags: string[] = [];
	const tag = frontmatter["tag"];
	if (tag && typeof tag === "string") tags.push((tag.startsWith("#") ? "" : "#") + tag);
	const list = frontmatter["tags"];
	if (list && typeof list === "object") {
		if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) {
			throw new TypeError(
				`${path}: the frontmatter "tags" must be a list of text, but it is ${JSON.stringify(list)}`,
			);
		}
		for (const item of list as string[]) tags.push(item.startsWith("#") ? "" : "#" + item);
	}
	return Object.freeze(tags);
}

const slice = (content: string, range: TextRange) => content.slice(range.start.offset, range.end.offset);

/** The section a list item is in: the section on its parent's line, or else the closest heading above it. */
function parentSection(item: ListItemInfo, sections: readonly SectionInfo[] | undefined): SectionInfo | null {
	if (!sections) return null;
	if (item.parent > 0) {
		for (const section of sections) {
			if (section.position.start.line === item.parent) return section;
		}
		return null;
	}
	let above = -1;
	let heading: SectionInfo | null = null;
	for (const section of sections) {
		const line = section.position.start.line;
		if (section.type === "heading" && line > above && line < item.position.start.line) {
			heading = section;
			above = line;
		}
	}
	return heading;
}

/** The whole line a position starts on, without its line ending. */
function lineAt(content: string, range: TextRange): string {
	const lineEnd = content.indexOf("\n", range.start.offset);
	const line = content.slice(range.start.offset - range.start.col, lineEnd < 0 ? content.length : lineEnd);
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function copyRange(range: TextRange): TextRange {
	const point = ({ line, col, offset }: TextRange["start"]) => ({ line, col, offset });
	return deepFreeze({ start: point(range.start), end: point(range.end) });
}

function taskOfItem(
	item: ListItemInfo,
	context: NoteContext,
	moment: MomentFactory,
	warnings: ParseWarning[],
): Task | null {
	if (!item.task) return null;
	const { content, metadata } = context;
	const position = item.position;
	const section = parentSection(item, metadata?.sections);
	const line = position.start.line;
	return taskOfLine(slice(content, position), {
		context,
		position,
		section: section ? sectionLink(context.link, section, slice(content, section.position)) : context.link,
		outlinks: (metadata?.links ?? []).filter((link) => link.position.start.line === line).map(outlink),
		lineTags: (metadata?.tags ?? []).filter((tag) => tag.position.start.line === line).map((tag) => tag.tag),
		moment,
		warn: (message) => warnings.push({ path: context.path, line, message }),
	});
}

interface LineInput {
	readonly context: NoteContext;
	readonly position: TextRange;
	readonly section: LinkRef;
	readonly outlinks: readonly LinkRef[];
	readonly lineTags: readonly string[];
	readonly moment: MomentFactory;
	readonly warn: (message: string) => void;
}

/** Builds the task of a list item's text, or null if the text is not a task. */
function taskOfLine(text: string, input: LineInput): Task | null {
	const match = text.match(TaskRegularExpressions.taskRegex);
	if (match === null) return null;
	const symbol = match[2];
	const statusMarker = match[3];
	let description = match[4].trim();
	const blockLink = description.match(TaskRegularExpressions.blockLinkRegex);
	if (blockLink !== null && blockLink[0] !== "")
		description = description.replace(TaskRegularExpressions.blockLinkRegex, "").trim();

	const { context, position, moment } = input;
	const baseTags = [...new Set([...input.lineTags, ...context.frontmatterTags()])];
	const withoutComments = stripComments(description.trim());
	const emoji = readEmojiFields(withoutComments, moment);
	const inline = readInlineFields(emoji.visual, emoji.priority, emoji.dates, moment, input.warn);
	const hashtags = takeHashtags(inline.visual, baseTags);

	return deepFreeze({
		id: `${context.path}:${position.start.line}`,
		note: context.note,
		path: context.path,
		line: position.start.line,
		lineCount: position.end.line - position.start.line + 1,
		position: copyRange(position),
		sourceLine: lineAt(context.content, position),
		text: stripReminder(text),
		symbol,
		statusMarker,
		completed: statusMarker === "x",
		fullyCompleted: statusMarker !== " ",
		checked: emoji.checked,
		isTasksTask: emoji.isTasksTask,
		visual: hashtags.visual,
		priority: inline.priority,
		recurrence: emoji.recurrence,
		tags: hashtags.tags,
		dates: inline.dates,
		extraDates: inline.extraDates,
		section: input.section,
		outlinks: Object.freeze([...input.outlinks]),
	});
}

/** Removes Obsidian comments, so that neither their content nor their markers show up in the task, see #125 and #100. */
function stripComments(visual: string): string {
	return (visual || "").replace(TaskRegularExpressions.commentRegex, "").trim();
}

interface EmojiFields {
	readonly visual: string;
	readonly priority: PriorityLabel;
	readonly recurrence: string;
	readonly isTasksTask: boolean;
	readonly checked: boolean;
	readonly dates: TaskDates;
}

/**
 * Reads the Tasks plugin's emoji fields: priority, the start, scheduled, due and done dates, and the recurrence,
 * which it removes from the text. Taken from the Tasks plugin's fromLine.
 */
function readEmojiFields(visual: string, moment: MomentFactory): EmojiFields {
	// Dates such as 2024-02-31 match the regex but are not real days, see #105 and #140.
	const parseDate = (value: string) => parseStrictDate(moment, value, TaskRegularExpressions.dateFormat);
	let description = visual || "";
	// Keep matching and removing special strings from the end of the description in any order. The loop runs once
	// when the strings come in the expected order after the description.
	let matched: boolean;
	let priority: PriorityLabel = "";
	let start: DateValue | undefined;
	let scheduled: DateValue | undefined;
	let due: DateValue | undefined;
	let done: DateValue | undefined;
	let recurrence = "";
	// Tags taken off the end while parsing, mixed with the other fields (e.g. #tag1 <due date> #tag2), go back onto
	// the end of the description afterwards.
	let trailingTags = "";
	// A "max runs" failsafe, so the loop can never run forever.
	const maxRuns = 20;
	let runs = 0;
	do {
		matched = false;
		const priorityMatch = description.match(TaskRegularExpressions.priorityRegex);
		if (priorityMatch !== null) {
			priority = TasksPrioritySymbolToLabel[priorityMatch[1] as TasksPrioritySymbol];
			description = description.replace(TaskRegularExpressions.priorityRegex, "").trim();
			matched = true;
		}
		const doneMatch = description.match(TaskRegularExpressions.doneDateRegex);
		if (doneMatch !== null) {
			done = parseDate(doneMatch[1]);
			description = description.replace(TaskRegularExpressions.doneDateRegex, "").trim();
			matched = true;
		}
		const dueMatch = description.match(TaskRegularExpressions.dueDateRegex);
		if (dueMatch !== null) {
			due = parseDate(dueMatch[1]);
			description = description.replace(TaskRegularExpressions.dueDateRegex, "").trim();
			matched = true;
		}
		const scheduledMatch = description.match(TaskRegularExpressions.scheduledDateRegex);
		if (scheduledMatch !== null) {
			scheduled = parseDate(scheduledMatch[1]);
			description = description.replace(TaskRegularExpressions.scheduledDateRegex, "").trim();
			matched = true;
		}
		const startMatch = description.match(TaskRegularExpressions.startDateRegex);
		if (startMatch !== null) {
			start = parseDate(startMatch[1]);
			description = description.replace(TaskRegularExpressions.startDateRegex, "").trim();
			matched = true;
		}
		// The created date is only removed: placing the task on it would add an extra entry for it in the timeline.
		if (TaskRegularExpressions.createdDateRegex.test(description)) {
			description = description.replace(TaskRegularExpressions.createdDateRegex, "").trim();
			matched = true;
		}
		const recurrenceMatch = description.match(TaskRegularExpressions.recurrenceRegex);
		if (recurrenceMatch !== null) {
			recurrence = recurrenceMatch[1].trim();
			description = description.replace(TaskRegularExpressions.recurrenceRegex, "").trim();
			matched = true;
		}
		const tagsMatch = description.match(TaskRegularExpressions.hashTagsFromEnd);
		if (tagsMatch != null) {
			description = description.replace(TaskRegularExpressions.hashTagsFromEnd, "").trim();
			matched = true;
			const tagName = tagsMatch[0].trim();
			// Added to the left, because matching runs from the right.
			trailingTags = trailingTags.length > 0 ? [tagName, trailingTags].join(" ") : tagName;
		}
		runs++;
	} while (matched && runs <= maxRuns);

	if (trailingTags.length > 0) description += " " + trailingTags;
	return {
		visual: description,
		priority,
		recurrence,
		isTasksTask: [start, scheduled, due, done].some((date) => !!date),
		// Only the first space is removed, as the plugin's parser has always done.
		checked: description.replace(" ", "").length !== 0,
		dates: { due, scheduled, start, completion: done },
	};
}

/**
 * Date fields understood in the dataview format, e.g. `[due:: 2024-01-31]`. `completion` and `created` are what the
 * Tasks plugin writes.
 */
const dataviewDateFields = ["due", "scheduled", "start", "done", "complete", "completion", "created", "unplanned"];

interface InlineFields {
	readonly visual: string;
	readonly priority: PriorityLabel;
	readonly dates: TaskDates;
	readonly extraDates: Task["extraDates"];
}

/** Reads dataview inline fields, `[key:: value]`, for the priority and the dates, and removes every field from the text. */
function readInlineFields(
	visual: string,
	priority: PriorityLabel,
	dates: TaskDates,
	moment: MomentFactory,
	warn: (message: string) => void,
): InlineFields {
	let text = visual || "";
	const fields = text.match(TaskRegularExpressions.keyValueRegex);
	if (!fields) return { visual, priority, dates: Object.freeze({ ...dates }), extraDates: Object.freeze([]) };
	let { due, scheduled, start, completion } = dates;
	const extra = new Map<string, DateValue>();
	for (const field of fields) {
		// The regex is global, so its lastIndex keeps its state between calls.
		TaskRegularExpressions.keyValueRegex.lastIndex = 0;
		const [whole, key, value] = TaskRegularExpressions.keyValueRegex.exec(field)!;
		text = text.replace(whole, "");
		if (key.trim() === "priority") {
			const label = TasksPriorityNameToLabel[value.trim().toLowerCase()];
			if (label) priority = label;
			continue;
		}
		const name = key.trim();
		if (!dataviewDateFields.includes(name)) continue;
		// Like the ➕ emoji, a created date is only removed: it would add an extra entry for the task in the timeline.
		if (name === "created") continue;
		const date = parseLooseDate(moment, value);
		if (!date) {
			warn(`could not read the date "${value}" of [${name}:: ]`);
			continue;
		}
		switch (name) {
			case "due":
				due = date;
				break;
			case "scheduled":
				scheduled = date;
				break;
			case "start":
				start = date;
				break;
			case "complete":
			case "completion":
			case "done":
				completion = date;
				break;
			default:
				extra.set(name, date);
				break;
		}
	}
	return {
		visual: text.trim(),
		priority,
		dates: Object.freeze({ due, scheduled, start, completion }),
		extraDates: Object.freeze([...extra].map((entry) => Object.freeze(entry))),
	};
}

/** Takes the hashtags out of the text and adds them to the tags; duplicates are kept. */
function takeHashtags(
	visual: string,
	tags: readonly string[],
): { readonly visual: string; readonly tags: readonly string[] } {
	const found = visual.match(TaskRegularExpressions.hashTags);
	if (!found) return { visual, tags: Object.freeze([...tags]) };
	let rest = visual;
	for (const tag of found) rest = rest.replace(tag, "");
	return { visual: rest, tags: Object.freeze([...tags, ...found.map((tag) => tag.trim())]) };
}

/** Removes the first ⏰ reminder from the task's text. */
function stripReminder(text: string): string {
	const match = text.match(TaskRegularExpressions.remainderRegex);
	return match ? text.replace(match[0], "") : text;
}
