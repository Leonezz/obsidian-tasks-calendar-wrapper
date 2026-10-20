import { test } from "node:test";
import assert from "node:assert/strict";

import { deepFreeze } from "../src/options";
import { formatPropertyRules, parsePropertyRules } from "../src/properties";
import {
	describedValue,
	fileListCodec,
	migrated,
	pathListCodec,
	plainTextCodec,
	propertyRulesCodec,
	settingIssues,
	statusListCodec,
	trimmedTextCodec,
	type Migration,
	type SettingSpec,
} from "../src/settings";

// The generic part of the settings schema: how text boxes turn into values and back, as the settings tab converted
// them, and a check of the values' types that never changes them.

test("a path list drops empty paths and trims the others", () => {
	assert.deepEqual(pathListCodec.parse(" Archive, Projects/Old ,, Daily.md ,"), [
		"Archive",
		"Projects/Old",
		"Daily.md",
	]);
	assert.deepEqual(pathListCodec.parse(""), []);
	assert.deepEqual(pathListCodec.parse(" , "), []);
	assert.equal(pathListCodec.format(["Archive", "Projects/Old"]), "Archive,Projects/Old");
	assert.equal(pathListCodec.format([]), "");
});

test("a file list keeps empty entries, so an empty box is one empty file", () => {
	assert.deepEqual(fileListCodec.parse(" Inbox.md, ,Later.md"), ["Inbox.md", "", "Later.md"]);
	assert.deepEqual(fileListCodec.parse(""), [""]);
	assert.equal(fileListCodec.format(["Inbox.md", "", "Later.md"]), "Inbox.md,,Later.md");
	assert.equal(fileListCodec.format([]), "");
});

test('a status list trims the markers and reads "[ ]" as the space of a task to do', () => {
	assert.deepEqual(statusListCodec.parse("x, -, [ ]"), ["x", "-", " "]);
	assert.deepEqual(statusListCodec.parse(" [ ] "), [" "]);
	// A marker typed as a space is trimmed away, as before; only "[ ]" stands for it.
	assert.deepEqual(statusListCodec.parse("x, "), ["x", ""]);
	assert.deepEqual(statusListCodec.parse(""), [""]);
	assert.equal(statusListCodec.format(["x", "-", " "]), "x,-, ");
});

test("a trimmed text loses the spaces around it, and a plain text is kept as typed", () => {
	assert.equal(trimmedTextCodec.parse("  Inbox.md \n"), "Inbox.md");
	assert.equal(trimmedTextCodec.format(" Inbox.md "), " Inbox.md ");
	assert.equal(plainTextCodec.parse("  ## Tasks "), "  ## Tasks ");
	assert.equal(plainTextCodec.format("  ## Tasks "), "  ## Tasks ");
});

test("property rules are read and written as the exclude-properties box did", () => {
	const text = "status: archived, done\npriority: 2";
	assert.deepEqual(propertyRulesCodec.parse(text), parsePropertyRules(text));
	const rules = { status: ["archived", "done"], priority: ["2"] };
	assert.equal(propertyRulesCodec.format(rules), formatPropertyRules(rules));
});

test("the codecs cannot be changed", () => {
	for (const codec of [
		pathListCodec,
		fileListCodec,
		statusListCodec,
		trimmedTextCodec,
		plainTextCodec,
		propertyRulesCodec,
	])
		assert.ok(Object.isFrozen(codec));
});

const schema: readonly SettingSpec[] = [
	{ key: "on", type: "boolean", control: "toggle", group: "a", redrawsTab: false, readWhen: "push" },
	{
		key: "name",
		type: "string",
		control: "text",
		codec: plainTextCodec,
		group: "a",
		redrawsTab: false,
		readWhen: "push",
	},
	{
		key: "paths",
		type: "stringList",
		control: "textArea",
		codec: pathListCodec,
		redrawsTab: false,
		readWhen: "push",
	},
	{ key: "colors", type: "stringMap", control: "tagPalette", redrawsTab: true, readWhen: "push" },
	{
		key: "rules",
		type: "stringListMap",
		control: "textArea",
		codec: propertyRulesCodec,
		redrawsTab: false,
		readWhen: "push",
	},
];

test("values of the types the schema gives have no issues, and keys it does not know are not looked at", () => {
	const values = { on: false, name: "", paths: [], colors: {}, rules: { status: ["done"] }, unknown: 5 };
	assert.deepEqual(settingIssues(values, schema), []);
	assert.deepEqual(settingIssues({ ...values, colors: { "#a": "red" }, paths: ["a", "b"] }, schema), []);
});

test("each value of another type is one issue, in the schema's order, saying what was found", () => {
	const values = {
		rules: { status: "done" },
		colors: [],
		paths: ["a", 2],
		name: null,
		on: "yes",
	};
	assert.deepEqual(settingIssues(values, schema), [
		{ key: "on", expected: "boolean", found: "a string" },
		{ key: "name", expected: "string", found: "null" },
		{ key: "paths", expected: "stringList", found: "an array with a number" },
		{ key: "colors", expected: "stringMap", found: "an array" },
		{ key: "rules", expected: "stringListMap", found: "an object with a string" },
	]);
	assert.deepEqual(
		settingIssues({ colors: { "#a": 1 } }, schema).find((issue) => issue.key === "colors"),
		{
			key: "colors",
			expected: "stringMap",
			found: "an object with a number",
		},
	);
	const foundFor = (values: Record<string, unknown>, key: string) =>
		settingIssues(values, schema).find((issue) => issue.key === key)?.found;
	assert.equal(foundFor({ colors: { "#a": {} } }, "colors"), "an object with an object");
	assert.equal(foundFor({ paths: ["a", null] }, "paths"), "an array with null");
	assert.equal(
		foundFor({ paths: ["a", 1, null] }, "paths"),
		"an array with a number",
		"the first item that does not fit",
	);
	assert.equal(foundFor({ rules: { status: ["done", 2] } }, "rules"), "an object with an array with a number");
	assert.equal(foundFor({ colors: null }, "colors"), "null");
	assert.equal(foundFor({ rules: null }, "rules"), "null");
	assert.deepEqual(
		settingIssues({ rules: [] }, schema).find((issue) => issue.key === "rules"),
		{
			key: "rules",
			expected: "stringListMap",
			found: "an array",
		},
	);
});

test("a value that is missing is an issue too", () => {
	assert.deepEqual(settingIssues({ on: true, name: "", paths: [], colors: {} }, schema), [
		{ key: "rules", expected: "stringListMap", found: "undefined" },
	]);
});

test("the check never changes the values, and its issues cannot be changed", () => {
	const values = deepFreeze({ on: "yes", name: "", paths: [], colors: {}, rules: {} });
	const text = JSON.stringify(values);
	const issues = settingIssues(values, schema);
	assert.equal(JSON.stringify(values), text);
	assert.ok(Object.isFrozen(issues) && issues.every((issue) => Object.isFrozen(issue)));
});

test("a value is described as data.json holds it, with its article", () => {
	assert.deepEqual(["x", 2, true, null, undefined, [], {}].map(describedValue), [
		"a string",
		"a number",
		"a boolean",
		"null",
		"undefined",
		"an array",
		"an object",
	]);
});

test("migrations run in order, and the values handed in stay as they were", () => {
	const order: string[] = [];
	const migrations: readonly Migration<{ sort: string; size?: number }>[] = [
		{ id: "first", apply: (values) => (order.push("first"), { ...values, sort: values.sort.toUpperCase() }) },
		{ id: "second", apply: (values) => (order.push("second"), { ...values, size: values.sort.length }) },
	];
	const values = deepFreeze({ sort: "due" });
	assert.deepEqual(migrated(values, migrations), { sort: "DUE", size: 3 });
	assert.deepEqual(order, ["first", "second"]);
	assert.deepEqual(values, { sort: "due" });
	assert.equal(migrated(values, []), values, "no migrations, the same values");
});
