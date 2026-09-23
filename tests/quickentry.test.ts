import { test } from "node:test";
import assert from "node:assert/strict";

import { insertTaskUnderSection, normalizeNotePath } from "../utils/quickentry";

// Issue #48: a path without an extension created a file the timeline never reads

test("a note path without an extension gets .md", () => {
    assert.equal(normalizeNotePath("Inbox"), "Inbox.md");
    assert.equal(normalizeNotePath("01 Tasks/Inbox"), "01 Tasks/Inbox.md");
});

test("a note path that already ends in .md is kept", () => {
    assert.equal(normalizeNotePath("Inbox.md"), "Inbox.md");
    assert.equal(normalizeNotePath("Notes/Inbox.MD"), "Notes/Inbox.MD");
});

test("surrounding spaces and a leading slash are removed", () => {
    assert.equal(normalizeNotePath("  /Tasks/Inbox.md "), "Tasks/Inbox.md");
});

test("a dot inside a folder name does not count as an extension", () => {
    assert.equal(normalizeNotePath("v1.2/Inbox"), "v1.2/Inbox.md");
});

// The task goes under the configured section, or under a new one at the end, never above the frontmatter

test("the task is inserted right below the section heading", () => {
    const note = "---\ntags: inbox\n---\n# Inbox\n## Tasks\n- [ ] older\n";
    assert.equal(insertTaskUnderSection(note, "## Tasks", "- [ ] new"),
        "---\ntags: inbox\n---\n# Inbox\n## Tasks\n- [ ] new\n- [ ] older\n");
});

test("a missing section is added at the end instead of writing above the frontmatter", () => {
    const note = "---\ntags: inbox\n---\n# Inbox\nSome text\n";
    assert.equal(insertTaskUnderSection(note, "## Tasks", "- [ ] new"),
        "---\ntags: inbox\n---\n# Inbox\nSome text\n\n## Tasks\n- [ ] new\n");
});

test("a note with Windows line endings still finds its section and keeps its line endings", () => {
    const note = "# Inbox\r\n## Tasks\r\n- [ ] older\r\n";
    assert.equal(insertTaskUnderSection(note, "## Tasks", "- [ ] new"),
        "# Inbox\r\n## Tasks\r\n- [ ] new\r\n- [ ] older\r\n");
});

test("an empty note gets the section and the task", () => {
    assert.equal(insertTaskUnderSection("", "## Tasks", "- [ ] new"), "## Tasks\n- [ ] new\n");
});

test("with no section configured the task is appended at the end", () => {
    assert.equal(insertTaskUnderSection("# Inbox\n- [ ] older\n", "", "- [ ] new"), "# Inbox\n- [ ] older\n- [ ] new\n");
});
