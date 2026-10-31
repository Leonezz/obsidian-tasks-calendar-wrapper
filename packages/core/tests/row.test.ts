import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/zh-cn";

import type { MomentFactory } from "../src/dates";
import { parseNote, parseTaskLine } from "../src/parse";
import { resolveTasks, type ResolvedTask, type ResolveSettings } from "../src/resolve";
import { sameRowModel, taskRowModel, type RowOptions, type TaskRowModel } from "../src/row";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

// Ported from the plugin's tests/taskrow.test.ts. Issue #63: every save re-rendered every row of the timeline. A row
// is now skipped when the data it shows is unchanged, so that data has to cover everything the row displays and nothing
// else.

const today = moment("2026-10-12", "YYYY-MM-DD", true);
const options: RowOptions = { dateFormat: "YYYY-MM-DD", hideTags: [], tagPalette: {}, useBuiltinStyle: true };
const noWarning = (message: string) => assert.fail(`unexpected warning: ${message}`);
const env = (now = today) => ({ now, moment, warn: noWarning });

const line = "- [ ] write the report #work #home ⏫ 🔁 every week ⏳ 2026-10-11 📅 2026-10-13";

function resolved(text: string, path = "Inbox.md", settings: ResolveSettings = {}): ResolvedTask {
	const parsed = parseTaskLine(text, { moment, path });
	assert.ok(parsed);
	return resolveTasks([parsed], { forward: true, ...settings }, { now: today, moment }).shown[0];
}

test("the same task parsed twice gives the same row", () => {
	const first = taskRowModel(resolved(line), options, env());
	const second = taskRowModel(resolved(line), options, env());
	assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("sameRowModel accepts the same model and equal models from re-read notes", () => {
	const first = taskRowModel(resolved(line), options, env());
	const second = taskRowModel(resolved(line), options, env());
	assert.notEqual(first, second);
	assert.notEqual(first.position, second.position);
	assert.ok(sameRowModel(first, first));
	assert.ok(sameRowModel(first, second));
	assert.ok(sameRowModel(second, first));
});

test("sameRowModel checks every primitive field", () => {
	const row = taskRowModel(resolved(line), options, env());
	const changed: Omit<TaskRowModel, "position" | "badges" | "tags"> = {
		display: row.display + " changed",
		path: "Elsewhere.md",
		line: row.line + 1,
		col: row.col + 1,
		link: "Elsewhere.md#section",
		isDailyNote: !row.isDailyNote,
		color: "#123456",
		fileTitle: "Elsewhere",
		subPath: "section",
		statusMarker: "x",
		status: "done",
		useBuiltinStyle: !row.useBuiltinStyle,
	};
	for (const [field, value] of Object.entries(changed)) {
		const other = { ...row, [field]: value };
		assert.equal(sameRowModel(row, other), false, field);
		assert.equal(sameRowModel(other, row), false, field);
	}
});

test("sameRowModel checks both position endpoints by their numbers", () => {
	const row = taskRowModel(resolved(line), options, env());
	for (const endpoint of ["start", "end"] as const) {
		for (const field of ["line", "col", "offset"] as const) {
			const point = row.position[endpoint];
			const other = {
				...row,
				position: { ...row.position, [endpoint]: { ...point, [field]: point[field] + 1 } },
			};
			assert.equal(sameRowModel(row, other), false, `${endpoint}.${field}`);
			assert.equal(sameRowModel(other, row), false, `${endpoint}.${field}`);
		}
	}
});

test("sameRowModel checks badge and tag fields, lengths and order", () => {
	const row = taskRowModel(resolved(line), options, env());
	const changed: TaskRowModel[] = [
		{ ...row, badges: row.badges.slice(1) },
		{ ...row, badges: [...row.badges].reverse() },
		{ ...row, tags: row.tags.slice(1) },
		{ ...row, tags: [...row.tags].reverse() },
		...Object.entries({ kind: "created", ariaLabel: "changed aria", label: "changed label" }).map(
			([field, value]) => ({
				...row,
				badges: row.badges.map((badge, i) => (i === 0 ? { ...badge, [field]: value } : badge)),
			}),
		),
		...Object.entries({ tag: "#changed", color: "#123456" }).map(([field, value]) => ({
			...row,
			tags: row.tags.map((tag, i) => (i === 0 ? { ...tag, [field]: value } : tag)),
		})),
	];
	for (const other of changed) {
		assert.equal(sameRowModel(row, other), false);
		assert.equal(sameRowModel(other, row), false);
	}
});

test("a row changes when the task's text, status or dates change", () => {
	const row = JSON.stringify(taskRowModel(resolved(line), options, env()));
	const changed = [
		line.replace("write", "finish"),
		line.replace("- [ ]", "- [x]"),
		line.replace("📅 2026-10-13", "📅 2026-10-14"),
	];
	for (const other of changed) {
		assert.notEqual(JSON.stringify(taskRowModel(resolved(other), options, env())), row, other);
	}
});

test("relative dates follow the current day, so a row changes when the day does", () => {
	const task = resolved(line);
	const now = taskRowModel(task, options, env());
	const tomorrow = taskRowModel(task, options, env(today.clone().add(1, "day")));
	assert.deepEqual(
		now.badges.map((b) => b.label),
		["Yesterday", "Tomorrow", "every week", "High Priority"],
	);
	assert.notEqual(JSON.stringify(now), JSON.stringify(tomorrow));
});

test("badges come in the order the row shows them, with their full dates in the labels", () => {
	const row = taskRowModel(resolved(line), { ...options, dateFormat: "DD.MM.YYYY" }, env());
	assert.deepEqual(
		row.badges.map((b) => [b.kind, b.ariaLabel]),
		[
			["scheduled", "scheduled to 11.10.2026"],
			["due", "due at 13.10.2026"],
			["repeat", "recurrent: every week"],
			["priority", "priority: High"],
		],
	);
});

test("hidden tags are left out and tag colours come from the palette", () => {
	const row = taskRowModel(
		resolved(line),
		{ ...options, hideTags: ["#home"], tagPalette: { "#work": "#ff0000" } },
		env(),
	);
	assert.deepEqual(row.tags, [{ tag: "#work", color: "#ff0000" }]);
});

test("a changed option changes the row", () => {
	const task = resolved(line);
	const row = JSON.stringify(taskRowModel(task, options, env()));
	assert.notEqual(JSON.stringify(taskRowModel(task, { ...options, useBuiltinStyle: false }, env())), row);
	assert.notEqual(JSON.stringify(taskRowModel(task, { ...options, tagPalette: { "#home": "#00ff00" } }, env())), row);
});

test("a row shows the daily note's date, the note and its section, and is frozen", () => {
	const row = taskRowModel(resolved("- [ ] diary", "Journal/2026-10-10.md"), options, env());
	assert.ok(row.isDailyNote);
	assert.deepEqual(
		row.badges.map((b) => b.kind),
		["created", "start", "scheduled"],
	);
	assert.equal(row.fileTitle, "2026-10-10");
	assert.equal(row.subPath, "");
	assert.equal(row.display, "diary");
	assert.ok(Object.isFrozen(row) && Object.isFrozen(row.badges) && Object.isFrozen(row.tags));
});

// What the legacy tests did not pin

test("every date badge has its own words before the full date", () => {
	const row = taskRowModel(
		resolved("- [x] all ⏳ 2026-10-11 🛫 2026-10-10 📅 2026-10-13 ✅ 2026-10-12", "Inbox.md", {
			hideStatusTasks: [],
		}),
		options,
		env(),
	);
	assert.deepEqual(
		row.badges.map((b) => b.ariaLabel),
		["start at 2026-10-10", "scheduled to 2026-10-11", "due at 2026-10-13", "complete at 2026-10-12"],
	);
	const diary = taskRowModel(resolved("- [ ] diary", "Journal/2026-10-10.md"), options, env());
	assert.equal(diary.badges[0].ariaLabel, "create at 2026-10-10");
});

test("a row shows the text after the 24-hour option, or the task's text when nothing is left to show", () => {
	assert.equal(
		taskRowModel(resolved("- [ ] 14:30 meeting", "Inbox.md", { convert24HourTimePrefix: true }), options, env())
			.display,
		"2:30 pm meeting",
	);
	const empty = resolved("- [ ] 📅 2026-10-13");
	assert.equal(empty.visual, "");
	assert.equal(taskRowModel(empty, options, env()).display, empty.task.text);
});

test("a row links to its section with the first apostrophe escaped, as before", () => {
	assert.equal(taskRowModel(resolved("- [ ] t", "Tom's 'notes'.md"), options, env()).link, "Tom&apos;s 'notes'.md");
});

test("a row has the task's marker, status, line and the column its line ends at", () => {
	const text = "- [/] half way 📅 2026-10-13";
	const row = taskRowModel(resolved(text), options, env());
	assert.deepEqual([row.statusMarker, row.status, row.line, row.col], ["/", "process", 0, text.length]);
});

test("a row takes its colour from the note's color property", () => {
	const content = "---\ncolor: '#123456'\n---\n- [ ] coloured";
	const offset = content.indexOf("- [ ]");
	const position = { start: { line: 3, col: 0, offset }, end: { line: 3, col: 14, offset: offset + 14 } };
	assert.equal(content.slice(position.start.offset, position.end.offset), "- [ ] coloured");
	const [task] = parseNote(
		{
			path: "Coloured.md",
			content,
			metadata: { listItems: [{ task: " ", parent: -1, position }], frontmatter: { color: "#123456" } },
		},
		moment,
	).tasks;
	const shown = resolveTasks([task], {}, { now: today, moment }).shown[0];
	assert.equal(taskRowModel(shown, options, env()).color, "#123456");
	assert.equal(taskRowModel(resolved("- [ ] plain"), options, env()).color, undefined);
	// A property without a value is null, and the row keeps it as written.
	const [blank] = parseNote(
		{
			path: "Blank.md",
			content,
			metadata: { listItems: [{ task: " ", parent: -1, position }], frontmatter: { color: null } },
		},
		moment,
	).tasks;
	assert.equal(taskRowModel(resolveTasks([blank], {}, { now: today, moment }).shown[0], options, env()).color, null);
});

test("a row in a note named with digits that is not a daily note is not a daily note's row", () => {
	const row = taskRowModel(resolved("- [ ] t", "Plans 2020.md"), options, env());
	assert.equal(row.isDailyNote, false);
	assert.deepEqual(
		row.badges.map((b) => b.kind),
		[],
	);
});

/** Every array and plain object reachable from a value that is not frozen. Dates are left out: they are typed read-only. */
function unfrozen(value: unknown, seen = new Set<object>()): object[] {
	if (value === null || typeof value !== "object" || moment.isMoment(value) || seen.has(value)) return [];
	seen.add(value);
	return [
		...(Object.isFrozen(value) ? [] : [value]),
		...Object.values(value).flatMap((item) => unfrozen(item, seen)),
	];
}

test("every part of a row is frozen: its badges, its tags and its position", () => {
	const row = taskRowModel(resolved(line), options, env());
	assert.ok(row.badges.length > 0 && row.tags.length > 0);
	assert.deepEqual(unfrozen(row), []);
});

test("a row passes on the warning when the platform has no relative date format for moment's language", () => {
	const warnings: string[] = [];
	// Obsidian's moment with a language the platform has no format for.
	const rejected: MomentFactory = Object.assign(
		(input: Parameters<MomentFactory>[0], format?: string, strict?: boolean) => moment(input, format, strict),
		{ locale: () => "not a locale" },
	);
	const row = taskRowModel(resolved(line), options, {
		now: today,
		moment: rejected,
		warn: (message) => warnings.push(message),
	});
	// One warning for each date badge, whose label falls back to moment's own words.
	assert.equal(warnings.length, 2);
	assert.match(warnings[0], /not a locale/);
	assert.deepEqual(
		row.badges.slice(0, 2).map((b) => b.label),
		["A day ago", "In a day"],
	);
});

test("relative dates are written in moment's language now, whatever it was when the task was read", () => {
	const task = resolved("- [ ] 明天 📅 2026-10-13");
	const previous = moment.locale();
	try {
		assert.equal(moment.locale("zh-cn"), "zh-cn");
		const row = taskRowModel(task, options, env());
		assert.deepEqual(
			row.badges.map((b) => b.label),
			["明天"],
		);
	} finally {
		moment.locale(previous);
	}
});
