import { test } from "node:test";
import assert from "node:assert/strict";

import { formatPropertyRules, matchesProperties, parsePropertyRules } from "../src/properties";

// Issue #186: exclude the tasks of notes by a frontmatter property, e.g. status: archived

const rules = { status: ["archived"], priority: ["2"], project: ["[[Home]]"] };

test("values match as trimmed, case-sensitive text, and a list matches if any item does", () => {
	assert.equal(matchesProperties({ status: " archived " }, rules), true);
	assert.equal(matchesProperties({ status: "Archived" }, rules), false);
	assert.equal(matchesProperties({ priority: 2 }, rules), true);
	assert.equal(matchesProperties({ project: "[[Home]]" }, rules), true);
	assert.equal(matchesProperties({ status: ["todo", "archived"] }, rules), true);
});

test("missing, empty and object values never match", () => {
	assert.equal(matchesProperties(undefined, rules), false);
	assert.equal(matchesProperties({ status: "" }, rules), false);
	assert.equal(matchesProperties({ status: { value: "archived" } }, rules), false);
});

test("the settings text has one property per line with comma separated values", () => {
	assert.deepEqual(parsePropertyRules("status: archived, done\nno colon\ntype:\nstatus: todo"), {
		status: ["archived", "done", "todo"],
	});
	assert.deepEqual(parsePropertyRules(formatPropertyRules(rules)), rules);
});
