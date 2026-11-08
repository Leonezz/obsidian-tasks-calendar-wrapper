import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePropertyRules, propertyRuleProblems } from "../src/properties";
import { mulberry32 } from "./support/random";

test("property rule problems list the 1-based lines with no colon, property or value", () => {
	assert.deepEqual(propertyRuleProblems("status: archived\nnocolon\n: x\nkey:"), [
		{ line: 2 },
		{ line: 3 },
		{ line: 4 },
	]);
});

test("property rule problems ignore blank lines but count them in later line numbers", () => {
	const text = ["", "\t ", "no colon", "", "status: , \t, ", " \t: done", "priority: 2", "\r", "empty:\r"].join("\n");
	assert.deepEqual(propertyRuleProblems(text), [{ line: 3 }, { line: 5 }, { line: 6 }, { line: 9 }]);
});

test("valid property rules have no problems, including repeated properties and colons in values", () => {
	for (const text of [
		"",
		"\n \t\r\n",
		"status: archived, done\nstatus: done, todo",
		" priority : 2, , 0, \nflag: false\r\nproject: [[Home]]\nurl: https://example.test",
	]) {
		assert.deepEqual(propertyRuleProblems(text), [], JSON.stringify(text));
	}
});

test("removing the reported lines from mixed property rules preserves the parsed rules", () => {
	const random = mulberry32(14);
	const lines = [
		{ text: "status: archived, done", skipped: false },
		{ text: "status: done, todo", skipped: false },
		{ text: " priority : 2, , 0 ", skipped: false },
		{ text: "flag: false", skipped: false },
		{ text: "url: https://example.test", skipped: false },
		{ text: "colon: :", skipped: false },
		{ text: "", skipped: false },
		{ text: " \t\r", skipped: false },
		{ text: "nocolon", skipped: true },
		{ text: ": x", skipped: true },
		{ text: " \t: x", skipped: true },
		{ text: "key:", skipped: true },
		{ text: "status: , \t, \r", skipped: true },
	];
	for (let sample = 0; sample < 100; sample++) {
		const mix = Array.from({ length: 1 + Math.floor(random() * 40) }, () => {
			return lines[Math.floor(random() * lines.length)];
		});
		const text = mix.map((line) => line.text).join("\n");
		const problems: readonly { line: number }[] = propertyRuleProblems(text);
		assert.deepEqual(
			problems,
			mix.flatMap((line, index) => (line.skipped ? [{ line: index + 1 }] : [])),
			`sample ${sample}: ${JSON.stringify(text)}`,
		);
		const skipped = new Set(problems.map((problem) => problem.line));
		const kept = mix.filter((_line, index) => !skipped.has(index + 1));
		assert.deepEqual(
			parsePropertyRules(kept.map((line) => line.text).join("\n")),
			parsePropertyRules(text),
			`sample ${sample}: removing problem lines preserves every rule`,
		);
	}
});
