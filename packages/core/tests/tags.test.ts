import { test } from "node:test";
import assert from "node:assert/strict";

import { isTagHidden } from "../src/tags";

// Issue #61: hiding a tag should hide the tags nested under it

test("a hidden tag also hides its subtags", () => {
    assert.ok(isTagHidden("#work", ["#work"]));
    assert.ok(isTagHidden("#work/admin", ["#work"]));
    assert.ok(isTagHidden("#work/admin/mail", ["#work"]));
});

test("a hidden tag does not hide unrelated tags that start with the same letters", () => {
    assert.ok(!isTagHidden("#workshop", ["#work"]));
    assert.ok(!isTagHidden("#homework", ["#work"]));
    assert.ok(!isTagHidden("#work", ["#home"]));
});

test("nothing is hidden when no tags are configured", () => {
    assert.ok(!isTagHidden("#work", []));
});
