/**
 * How tasks are written in a note: the priority symbols and names of the Tasks plugin and of dataview,
 * the date symbols, and the regular expressions that read a task line.
 */

enum TasksPriorityLabel {
	Highest = "Highest",
	High = "High",
	Medium = "Medium",
	None = "No",
	Low = "Low",
	Lowest = "Lowest",
}

export const TasksPrioritySymbolToLabel = {
	"🔺": TasksPriorityLabel.Highest,
	"⏫": TasksPriorityLabel.High,
	"🔼": TasksPriorityLabel.Medium,
	"🔽": TasksPriorityLabel.Low,
	"": TasksPriorityLabel.None,
	"⏬": TasksPriorityLabel.Lowest,
};

export type TasksPrioritySymbol = keyof typeof TasksPrioritySymbolToLabel;
export type PriorityLabel = string;

/** Priority names as the dataview format writes them, e.g. `[priority:: high]`. */
export const TasksPriorityNameToLabel: Record<string, PriorityLabel> = {
	highest: TasksPriorityLabel.Highest,
	high: TasksPriorityLabel.High,
	medium: TasksPriorityLabel.Medium,
	none: TasksPriorityLabel.None,
	low: TasksPriorityLabel.Low,
	lowest: TasksPriorityLabel.Lowest,
};

/** Sort order of the priorities, highest first. Tasks without a priority sit in the middle. */
export const TasksPriorityRank: Record<PriorityLabel, number> = {
	[TasksPriorityLabel.Highest]: 0,
	[TasksPriorityLabel.High]: 1,
	[TasksPriorityLabel.Medium]: 2,
	[TasksPriorityLabel.None]: 3,
	"": 3,
	[TasksPriorityLabel.Low]: 4,
	[TasksPriorityLabel.Lowest]: 5,
};

export const recurrenceSymbol = "🔁";
export const startDateSymbol = "🛫";
export const scheduledDateSymbol = "⏳";
export const dueDateSymbol = "📅";
export const doneDateSymbol = "✅";

export const innerDateFormat = "YYYY-MM-DD";

export class TaskRegularExpressions {
	public static readonly dateFormat = "YYYY-MM-DD";

	// Matches indentation before a list marker (including > for potentially nested blockquotes or Obsidian callouts)
	public static readonly indentationRegex = /^([\s\t>]*)/;

	// Matches - or * list markers, or numbered list markers (eg 1.)
	public static readonly listMarkerRegex = /([-*]|[0-9]+\.)/;

	// Matches a checkbox and saves the status character inside
	public static readonly checkboxRegex = /\[(.)\]/u;

	// Matches the rest of the task after the checkbox.
	public static readonly afterCheckboxRegex = / *(.*)/u;

	// Main regex for parsing a line. It matches the following:
	// - Indentation
	// - List marker
	// - Status character
	// - Rest of task after checkbox markdown
	public static readonly taskRegex = new RegExp(
		TaskRegularExpressions.indentationRegex.source +
			TaskRegularExpressions.listMarkerRegex.source +
			" +" +
			TaskRegularExpressions.checkboxRegex.source +
			TaskRegularExpressions.afterCheckboxRegex.source,
		"u",
	);

	// Match on block link at end.
	public static readonly blockLinkRegex = / \^[a-zA-Z0-9-]+/u;

	// The following regex's are matched anywhere in the task, not only at its end,
	// so that unknown content after a field (e.g. `⏫ ➕ 2026-09-14` or trailing text)
	// does not prevent the field from being parsed.
	public static readonly priorityRegex = RegExp(
		"([" +
			Object.keys(TasksPrioritySymbolToLabel)
				.filter((s) => s.length > 0)
				.join("") +
			"])",
		"u",
	);

	// U+FE0F (emoji presentation selector) may follow the emoji, as Tasks 8.6.0 allows.
	public static readonly createdDateRegex = /➕\uFE0F? *(\d{4}-\d{2}-\d{2})/u;

	public static readonly startDateRegex = /🛫\uFE0F? *(\d{4}-\d{2}-\d{2})/u;
	public static readonly scheduledDateRegex = /(?:⏳|⌛)\uFE0F? *(\d{4}-\d{2}-\d{2})/u;
	public static readonly dueDateRegex = /(?:📅|📆|🗓)\uFE0F? *(\d{4}-\d{2}-\d{2})/u;
	public static readonly doneDateRegex = /✅\uFE0F? *(\d{4}-\d{2}-\d{2})/u;
	public static readonly recurrenceRegex = /🔁\uFE0F? ?([a-zA-Z0-9, !]+)/iu;

	// [[a::b]] => a, b
	public static readonly keyValueRegex = /\[+([^\]]+)::([^\]]+)\]/g;

	/** Obsidian comments, e.g. `%% not shown %%`. */
	public static readonly commentRegex = /%%[\s\S]*?%%/g;
	public static readonly remainderRegex =
		/⏰ *(\d{4}-\d{2}-\d{2}) *(\d{2}:\d{2})|⏰ *(\d{4}-\d{2}-\d{2})|(\(@(\d{4}-\d{2}-\d{2}) *(\d{2}:\d{2})\))|(\(@(\d{4}-\d{2}-\d{2})\))/;
	// Regex to match all hash tags, basically hash followed by anything but the characters in the negation.
	// To ensure URLs are not caught it is looking of beginning of string tag and any
	// tag that has a space in front of it. Any # that has a character in front
	// of it will be ignored.
	// EXAMPLE:
	// description: '#dog #car http://www/ddd#ere #house'
	// matches: #dog, #car, #house
	public static readonly hashTags = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]*/g;
	public static readonly hashTagsFromEnd = new RegExp(this.hashTags.source + "$");
}
