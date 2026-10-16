import { test } from "node:test";
import assert from "node:assert/strict";

import { formatPropertyRules, matchesProperties, parsePropertyRules } from "../utils/properties";

// Issue #186: exclude the tasks of notes by a frontmatter property, e.g. status: archived

const rules = { status: ["archived", "done"], priority: ["2"], pinned: ["true"], project: ["[[Home]]"] };

test("a property with one of the values matches", () => {
    assert.equal(matchesProperties({ status: "archived" }, rules), true);
    assert.equal(matchesProperties({ status: " done " }, rules), true);
    assert.equal(matchesProperties({ status: "todo" }, rules), false);
});

test("values are case-sensitive", () => {
    assert.equal(matchesProperties({ status: "Archived" }, rules), false);
});

test("numbers, booleans and links match as their text", () => {
    assert.equal(matchesProperties({ priority: 2 }, rules), true);
    assert.equal(matchesProperties({ pinned: true }, rules), true);
    assert.equal(matchesProperties({ project: "[[Home]]" }, rules), true);
});

test("a list property matches if any item does", () => {
    assert.equal(matchesProperties({ status: ["todo", "archived"] }, rules), true);
    assert.equal(matchesProperties({ status: ["todo"] }, rules), false);
});

test("missing, empty and object values never match", () => {
    assert.equal(matchesProperties(undefined, rules), false);
    assert.equal(matchesProperties({}, rules), false);
    assert.equal(matchesProperties({ status: null }, rules), false);
    assert.equal(matchesProperties({ status: "" }, rules), false);
    assert.equal(matchesProperties({ status: { value: "archived" } }, rules), false);
    assert.equal(matchesProperties({ status: "archived" }, {}), false);
});

test("the settings text has one property per line with comma separated values", () => {
    assert.deepEqual(parsePropertyRules("status: archived, done\n priority : 2 \nno colon\n: x\ntype:\nstatus: done, todo"),
        { status: ["archived", "done", "todo"], priority: ["2"] });
    assert.equal(formatPropertyRules({ status: ["archived", "done"], priority: ["2"] }), "status: archived, done\npriority: 2");
    assert.deepEqual(parsePropertyRules(formatPropertyRules(rules)), rules);
});
