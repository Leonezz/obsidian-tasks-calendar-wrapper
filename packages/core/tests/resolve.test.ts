import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { parseTaskLine } from "../src/parse";
import type { Task } from "../src/task";
import { noteVisible, resolveTasks, type ResolveSettings } from "../src/resolve";
import { sortOptionLabels } from "../src/sort";

// Ported from the parse-based tests of the plugin's tests/sort.test.ts, plus what resolveTasks adds: the order the
// tasks come in, the note filters and the 24-hour option.

const TODAY = moment("2026-09-18", "YYYY-MM-DD");

function task(line: string, path = "Inbox.md"): Task {
    const parsed = parseTaskLine(line, { moment, path });
    assert.ok(parsed, `not a task line: ${line}`);
    return parsed;
}

const shownTexts = (tasks: Task[], settings: ResolveSettings) =>
    resolveTasks(tasks, { forward: true, ...settings }, { now: TODAY, moment }).shown.map(r => r.visual);

const sortedTexts = (sort: string, lines: string[]) => shownTexts(lines.map(line => task(line)), { sort });

test("text sorting orders by task text in both directions", () => {
    const lines = ["- [ ] cherry", "- [ ] apple", "- [ ] banana"];
    assert.deepEqual(sortedTexts("text-asc", lines), ["apple", "banana", "cherry"]);
    assert.deepEqual(sortedTexts("text-desc", lines), ["cherry", "banana", "apple"]);
});

test("due date sorting puts undated tasks last in both directions", () => {
    const lines = ["- [ ] late 📅 2026-10-01", "- [ ] none", "- [ ] early 📅 2026-09-20"];
    assert.deepEqual(sortedTexts("due-asc", lines), ["early", "late", "none"]);
    assert.deepEqual(sortedTexts("due-desc", lines), ["late", "early", "none"]);
});

test("priority sorting runs from highest to lowest with no priority in the middle", () => {
    const lines = ["- [ ] low 🔽", "- [ ] highest 🔺", "- [ ] none", "- [ ] high ⏫", "- [ ] lowest ⏬", "- [ ] medium 🔼"];
    assert.deepEqual(sortedTexts("priority-desc", lines), ["highest", "high", "medium", "none", "low", "lowest"]);
    assert.deepEqual(sortedTexts("priority-asc", lines), ["lowest", "low", "none", "medium", "high", "highest"]);
});

test("status sorting follows the configured status order", () => {
    const tasks = ["- [ ] unplanned", "- [ ] due 📅 2026-09-18", "- [ ] overdue 📅 2026-09-01"].map(line => task(line));
    const taskStatusOrder = ["overdue", "due", "unplanned"];
    assert.deepEqual(shownTexts(tasks, { sort: "status-asc", taskStatusOrder }), ["overdue", "due", "unplanned"]);
    assert.deepEqual(shownTexts(tasks, { sort: "status-desc", taskStatusOrder }), ["unplanned", "due", "overdue"]);
});

test("every sort keeps tasks it ranks equal in the order they come in", () => {
    const tasks = [task("- [ ] same text", "a.md"), task("- [ ] same text", "b.md")];
    for (const sort of [...Object.keys(sortOptionLabels), "no-such-sort"]) {
        const shown = resolveTasks(tasks, { sort }, { now: TODAY, moment }).shown;
        assert.deepEqual(shown.map(r => r.task.path), ["a.md", "b.md"], sort);
    }
});

test("tasks come in path order, then line order, whatever order they are passed in", () => {
    const at = (path: string, line: number) => {
        const parsed = task("- [ ] t", path);
        return { ...parsed, line, id: `${path}:${line}` };
    };
    const shown = resolveTasks([at("b.md", 0), at("a.md", 5), at("a.md", 2)], {}, { now: TODAY, moment }).shown;
    assert.deepEqual(shown.map(r => r.task.id), ["a.md:2", "a.md:5", "b.md:0"]);
});

test("resolving gives new values and leaves the tasks passed in as they were", () => {
    const tasks = [task("- [ ] 14:00 call 📅 2026-09-01")];
    const before = JSON.stringify(tasks);
    const [resolved] = resolveTasks(tasks, { forward: true, convert24HourTimePrefix: true }, { now: TODAY, moment }).shown;
    assert.equal(resolved.visual, "2:00 pm call");
    assert.equal(resolved.task.visual, "14:00 call");
    assert.equal(JSON.stringify(tasks), before);
    assert.ok(Object.isFrozen(resolved));
});

// The note filters of the settings: paths, the note's own tags and its frontmatter properties

const note = (path: string, tags: string[] = [], frontmatter: Record<string, unknown> = {}) => ({ path, tags, frontmatter });

test("an included folder keeps the notes in it, and a trailing slash includes nothing", () => {
    assert.ok(noteVisible(note("Daily/2026-01-15.md"), { includePaths: ["Daily"] }));
    assert.ok(!noteVisible(note("Inbox.md"), { includePaths: ["Daily"] }));
    assert.ok(!noteVisible(note("Daily/2026-01-15.md"), { includePaths: ["Daily/"] }));
});

test("an excluded folder or note drops it, and the root excludes nothing", () => {
    assert.ok(!noteVisible(note("Excluded/Secret.md"), { excludePaths: ["Excluded"] }));
    assert.ok(!noteVisible(note("Big note.md"), { excludePaths: ["Big note.md"] }));
    assert.ok(noteVisible(note("Excluded/Secret.md"), { excludePaths: ["/"] }));
});

test("note tags and properties include or exclude a note", () => {
    assert.ok(noteVisible(note("a.md", ["#project"]), { fileIncludeTags: ["#project"] }));
    assert.ok(!noteVisible(note("a.md"), { fileIncludeTags: ["#project"] }));
    assert.ok(!noteVisible(note("a.md", ["#project"]), { fileExcludeTags: ["#project"] }));
    assert.ok(!noteVisible(note("a.md", [], { status: "archived" }), { excludeProperties: { status: ["archived"] } }));
    assert.ok(noteVisible(note("a.md", [], { status: "active" }), { excludeProperties: { status: ["archived"] } }));
});

test("resolving drops the tasks of notes the filters leave out", () => {
    const tasks = [task("- [ ] secret", "Excluded/Secret.md"), task("- [ ] kept", "Inbox.md")];
    assert.deepEqual(shownTexts(tasks, { excludePaths: ["Excluded"] }), ["kept"]);
});
