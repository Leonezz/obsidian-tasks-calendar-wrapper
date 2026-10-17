import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { defaultSortKey, getSortComparator, migrateSortOption, SortableTask, sortOptionLabels } from "../src/sort";

test("every offered option has a comparator", () => {
    for (const key of Object.keys(sortOptionLabels)) {
        assert.equal(typeof getSortComparator(key), "function", key);
    }
    assert.ok(Object.keys(sortOptionLabels).includes(defaultSortKey));
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

const task = (fields: Partial<SortableTask>): SortableTask => ({ order: 0, priority: "", tags: [], ...fields });

test("sorting needs only the fields it compares, so any task shape can be sorted", () => {
    const tasks = [
        task({ visual: "undated" }),
        task({ visual: "later", due: moment.utc("2026-02-01") }),
        task({ visual: "sooner", due: moment.utc("2026-01-01") }),
    ];
    assert.deepEqual([...tasks].sort(getSortComparator("due-asc")).map(t => t.visual), ["sooner", "later", "undated"]);
    assert.deepEqual([...tasks].sort(getSortComparator("due-desc")).map(t => t.visual), ["later", "sooner", "undated"]);
});

test("a task without text does not break text sorting", () => {
    assert.doesNotThrow(() => [task({ visual: undefined }), task({ visual: "visible" })].sort(getSortComparator("text-asc")));
});
