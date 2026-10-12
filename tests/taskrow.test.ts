import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import moment from "moment";

import { RowOptions, taskRowModel } from "../Obsidian-Tasks-Timeline/src/taskrow";
import { parse } from "./helpers";

// Issue #63: every save re-rendered every row of the timeline. A row is now skipped when the data it
// shows is unchanged, so that data has to cover everything the row displays and nothing else.

const today = moment("2026-10-12");
const options: RowOptions = { dateFormat: "YYYY-MM-DD", hideTags: [], tagPalette: {}, useBuiltinStyle: true };

const line = "- [ ] write the report #work #home ⏫ 🔁 every week ⏳ 2026-10-11 📅 2026-10-13";

test("the same task parsed twice gives the same row", async () => {
    const first = taskRowModel(await parse(line, today), options, today);
    const second = taskRowModel(await parse(line, today), options, today);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("a row changes when the task's text, status or dates change", async () => {
    const row = JSON.stringify(taskRowModel(await parse(line, today), options, today));
    const changed = [
        line.replace("write", "finish"),
        line.replace("- [ ]", "- [x]"),
        line.replace("📅 2026-10-13", "📅 2026-10-14"),
    ];
    for (const other of changed) {
        assert.notEqual(JSON.stringify(taskRowModel(await parse(other, today), options, today)), row, other);
    }
});

test("relative dates follow the current day, so a row changes when the day does", async () => {
    const task = await parse(line, today);
    const now = taskRowModel(task, options, today);
    const tomorrow = taskRowModel(task, options, today.clone().add(1, "day"));
    assert.deepEqual(now.badges.map(b => b.label), ["Yesterday", "Tomorrow", "every week", "High Priority"]);
    assert.notEqual(JSON.stringify(now), JSON.stringify(tomorrow));
});

test("badges come in the order the row shows them, with their full dates in the labels", async () => {
    const row = taskRowModel(await parse(line, today), { ...options, dateFormat: "DD.MM.YYYY" }, today);
    assert.deepEqual(row.badges.map(b => [b.kind, b.ariaLabel]), [
        ["scheduled", "scheduled to 11.10.2026"],
        ["due", "due at 13.10.2026"],
        ["repeat", "recurrent: every week"],
        ["priority", "priority: High"],
    ]);
});

test("hidden tags are left out and tag colours come from the palette", async () => {
    const row = taskRowModel(await parse(line, today), { ...options, hideTags: ["#home"], tagPalette: { "#work": "#ff0000" } }, today);
    assert.deepEqual(row.tags, [{ tag: "#work", color: "#ff0000" }]);
});

test("a changed option changes the row", async () => {
    const task = await parse(line, today);
    const row = JSON.stringify(taskRowModel(task, options, today));
    assert.notEqual(JSON.stringify(taskRowModel(task, { ...options, useBuiltinStyle: false }, today)), row);
    assert.notEqual(JSON.stringify(taskRowModel(task, { ...options, tagPalette: { "#home": "#00ff00" } }, today)), row);
});
