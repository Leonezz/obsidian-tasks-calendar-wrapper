// Brief-derived tests pin the JSON comparison used by the timeline's caches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameJsonValue } from "../src/sameJsonValue";

test("sameJsonValue compares JSON values as underscore's isEqual does", () => {
	const cases: readonly (readonly [string, unknown, unknown, boolean])[] = [
		["same string", "todo", "todo", true],
		["different strings", "todo", "overdue", false],
		["different primitive types", 1, "1", false],
		["booleans", true, false, false],
		["null", null, null, true],
		["undefined", undefined, undefined, true],
		["null and undefined", null, undefined, false],
		["NaN", NaN, NaN, true],
		["NaN and a number", NaN, 1, false],
		["positive zero", 0, 0, true],
		["negative zero", -0, -0, true],
		["signed zero", 0, -0, false],
		["empty arrays", [], [], true],
		["array values", ["Inbox.md", "Tasks.md"], ["Inbox.md", "Tasks.md"], true],
		["array order", ["Inbox.md", "Tasks.md"], ["Tasks.md", "Inbox.md"], false],
		["array length", ["Inbox.md"], ["Inbox.md", "Tasks.md"], false],
		["array and object", [], {}, false],
		["array and numeric keys", ["todo"], { 0: "todo", length: 1 }, false],
		["empty objects", {}, {}, true],
		["object key order", { todo: 1, overdue: 2 }, { overdue: 2, todo: 1 }, true],
		["extra key", { todo: 1 }, { todo: 1, overdue: 2 }, false],
		["missing key", { todo: 1, overdue: 2 }, { todo: 1 }, false],
		["different key", { todo: 1 }, { overdue: 1 }, false],
		["missing undefined key", { todo: undefined }, {}, false],
		[
			"nested values and reordered keys",
			{ tags: ["#work", "#home"], palette: { "#work": "blue", "#home": "green" } },
			{ palette: { "#home": "green", "#work": "blue" }, tags: ["#work", "#home"] },
			true,
		],
		["nested difference", { rows: [{ done: false }] }, { rows: [{ done: true }] }, false],
		["nested NaN", { values: [NaN] }, { values: [NaN] }, true],
		["nested signed zero", { values: [0] }, { values: [-0] }, false],
	];
	for (const [label, a, b, expected] of cases) {
		assert.equal(sameJsonValue(a, b), expected, label);
		assert.equal(sameJsonValue(b, a), expected, `${label}, reversed`);
	}
	const date = new Date(0);
	const fn = () => {};
	assert.equal(sameJsonValue(date, date), true, "other types keep identity equality");
	assert.equal(sameJsonValue(date, new Date(0)), false, "different non-JSON objects");
	assert.equal(sameJsonValue(date, {}), false, "a non-JSON object and a plain object");
	assert.equal(sameJsonValue(fn, fn), true, "the same function");
	assert.equal(
		sameJsonValue(fn, () => {}),
		false,
		"different functions",
	);
});
