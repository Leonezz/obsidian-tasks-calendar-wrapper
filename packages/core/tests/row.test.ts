import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { parseTaskLine } from "../src/parse";
import { resolveTasks, type ResolvedTask } from "../src/resolve";
import { taskRowModel, type RowOptions } from "../src/row";

// Ported from the plugin's tests/taskrow.test.ts. Issue #63: every save re-rendered every row of the timeline. A row
// is now skipped when the data it shows is unchanged, so that data has to cover everything the row displays and nothing
// else.

const today = moment("2026-10-12", "YYYY-MM-DD", true);
const options: RowOptions = { dateFormat: "YYYY-MM-DD", hideTags: [], tagPalette: {}, useBuiltinStyle: true };
const noWarning = (message: string) => assert.fail(`unexpected warning: ${message}`);
const env = (now = today) => ({ now, moment, warn: noWarning });

const line = "- [ ] write the report #work #home ⏫ 🔁 every week ⏳ 2026-10-11 📅 2026-10-13";

function resolved(text: string, path = "Inbox.md"): ResolvedTask {
	const parsed = parseTaskLine(text, { moment, path });
	assert.ok(parsed);
	return resolveTasks([parsed], { forward: true }, { now: today, moment }).shown[0];
}

test("the same task parsed twice gives the same row", () => {
	const first = taskRowModel(resolved(line), options, env());
	const second = taskRowModel(resolved(line), options, env());
	assert.equal(JSON.stringify(first), JSON.stringify(second));
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
