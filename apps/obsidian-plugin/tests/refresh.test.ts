import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import type { CachedMetadata, ListItemCache } from "obsidian";

import { changeAffectsTasks } from "../utils/refresh";

// Issue #63: the timeline was rebuilt after every change to any file. Only changes to files that
// have tasks, or had tasks at the last reload, can change what it shows.

const position = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 10, offset: 10 } };
const listItem = (task?: string): ListItemCache => ({ position, parent: -1, ...(task === undefined ? {} : { task }) });
const withTasks: CachedMetadata = { listItems: [listItem(), listItem(" ")] };
const withoutTasks: CachedMetadata = { listItems: [listItem(), listItem()] };
const noLists: CachedMetadata = {};

test("a file that has tasks affects the timeline", () => {
    assert.equal(changeAffectsTasks(["Projects/a.md"], withTasks, new Set()), true);
});

test("a done task counts as a task", () => {
    assert.equal(changeAffectsTasks(["a.md"], { listItems: [listItem("x")] }, new Set()), true);
});

test("a file without tasks that had none does not affect the timeline", () => {
    assert.equal(changeAffectsTasks(["Notes/a.md"], withoutTasks, new Set(["Projects/b.md"])), false);
    assert.equal(changeAffectsTasks(["Notes/a.md"], noLists, new Set()), false);
});

test("a file whose last task was removed affects the timeline", () => {
    assert.equal(changeAffectsTasks(["Projects/a.md"], withoutTasks, new Set(["Projects/a.md"])), true);
});

test("a deleted file that had tasks affects the timeline", () => {
    assert.equal(changeAffectsTasks(["Projects/a.md"], null, new Set(["Projects/a.md"])), true);
    assert.equal(changeAffectsTasks(["Notes/a.md"], null, new Set(["Projects/a.md"])), false);
});

test("a renamed file affects the timeline when its old path had tasks", () => {
    assert.equal(changeAffectsTasks(["Archive/a.md", "Projects/a.md"], undefined, new Set(["Projects/a.md"])), true);
});
