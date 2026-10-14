import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { makeTask, parse as parseChain } from "./helpers";
import { defaultSortKey, getSortComparator, migrateSortOption, sortOptionLabels } from "../utils/sort";
import { TaskDataModel } from "../utils/tasks";

const TODAY = moment("2026-09-18", "YYYY-MM-DD");

const sortedTexts = async (key: string, lines: string[]) => {
    const tasks: TaskDataModel[] = [];
    for (const line of lines) tasks.push(await parseChain(line, TODAY));
    return tasks.sort(getSortComparator(key)).map(t => t.visual);
};

test("every offered option has a comparator", () => {
    for (const key of Object.keys(sortOptionLabels)) {
        assert.equal(typeof getSortComparator(key), "function", key);
    }
    assert.ok(Object.keys(sortOptionLabels).includes(defaultSortKey));
});

test("text sorting orders by task text in both directions", async () => {
    const lines = ["- [ ] cherry", "- [ ] apple", "- [ ] banana"];
    assert.deepEqual(await sortedTexts("text-asc", lines), ["apple", "banana", "cherry"]);
    assert.deepEqual(await sortedTexts("text-desc", lines), ["cherry", "banana", "apple"]);
});

test("due date sorting puts undated tasks last in both directions", async () => {
    const lines = ["- [ ] late 📅 2026-10-01", "- [ ] none", "- [ ] early 📅 2026-09-20"];
    assert.deepEqual(await sortedTexts("due-asc", lines), ["early", "late", "none"]);
    assert.deepEqual(await sortedTexts("due-desc", lines), ["late", "early", "none"]);
});

test("priority sorting runs from highest to lowest with no priority in the middle", async () => {
    const lines = ["- [ ] low 🔽", "- [ ] highest 🔺", "- [ ] none", "- [ ] high ⏫", "- [ ] lowest ⏬", "- [ ] medium 🔼"];
    assert.deepEqual(await sortedTexts("priority-desc", lines),
        ["highest", "high", "medium", "none", "low", "lowest"]);
    assert.deepEqual(await sortedTexts("priority-asc", lines),
        ["lowest", "low", "none", "medium", "high", "highest"]);
});

test("status sorting follows the configured status order", async () => {
    const withOrder = (visual: string, order: number) => ({ visual, order } as TaskDataModel);
    const tasks = [withOrder("third", 3), withOrder("first", 1), withOrder("second", 2)];
    assert.deepEqual(tasks.slice().sort(getSortComparator("status-asc")).map(t => t.visual),
        ["first", "second", "third"]);
    assert.deepEqual(tasks.slice().sort(getSortComparator("status-desc")).map(t => t.visual),
        ["third", "second", "first"]);
});

test("comparators report ties as equal so the original order is kept", async () => {
    const a = await parseChain("- [ ] same text", TODAY);
    const b = await parseChain("- [ ] same text", TODAY);
    for (const key of Object.keys(sortOptionLabels)) {
        assert.equal(getSortComparator(key)(a, b), 0, key);
    }
});

test("a task without text does not break text sorting", () => {
    const empty = makeTask("- [ ] ");
    empty.visual = undefined;
    const other = makeTask("- [ ] visible");
    assert.doesNotThrow(() => [empty, other].sort(getSortComparator("text-asc")));
});

test("saved lambda settings are migrated to the new keys", () => {
    assert.equal(migrateSortOption("(t1, t2) => t1.order <= t2.order ? -1 : 1"), "status-asc");
    assert.equal(migrateSortOption("(t1, t2) => t1.visual.trim() >= t2.visual.trim() ? -1 : 1"), "text-desc");
    assert.equal(migrateSortOption("(t1, t2) => t1.due <= t2.due ? -1 : 1"), "due-asc");
    assert.equal(migrateSortOption("priority-desc"), "priority-desc");
    assert.equal(migrateSortOption("something else"), defaultSortKey);
    assert.equal(migrateSortOption(undefined), defaultSortKey);
});

test("a saved value that names a built-in object property is not treated as an option", () => {
    assert.equal(migrateSortOption("constructor"), defaultSortKey);
    assert.equal(migrateSortOption("toString"), defaultSortKey);
    assert.equal(getSortComparator("constructor"), getSortComparator(defaultSortKey));
});
