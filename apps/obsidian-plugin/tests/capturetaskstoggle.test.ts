import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Native imports keep the corpus's fixture paths relative to its module when esbuild bundles these tests.
const libUrl = pathToFileURL(path.resolve("scripts/capture-tasks-toggle-lib.mjs")).href;
const corpusUrl = pathToFileURL(path.resolve("scripts/tasks-parity-notes.mjs")).href;
const library = () => import(libUrl) as Promise<typeof import("../scripts/capture-tasks-toggle-lib.mjs")>;
const corpus = () => import(corpusUrl) as Promise<typeof import("../scripts/tasks-parity-notes.mjs")>;

test("the toggle capture applies the eight exact Tasks settings groups in order", async () => {
	const { SETTINGS_GROUPS } = await library();
	assert.deepEqual(
		SETTINGS_GROUPS.map(({ name, settings }) => ({ name, settings })),
		[
			{ name: "default", settings: {} },
			{ name: "dataview", settings: { taskFormat: "dataview" } },
			{ name: "next-line", settings: { recurrenceOnNextLine: true } },
			{ name: "remove-scheduled", settings: { removeScheduledDateOnRecurrence: true } },
			{ name: "no-done-cancelled-dates", settings: { setDoneDate: false, setCancelledDate: false } },
			{ name: "created-date", settings: { setCreatedDate: true } },
			{ name: "global-filter", settings: { globalFilter: "#task", removeGlobalFilter: false } },
			{
				name: "custom-statuses",
				settings: {
					statusSettings: {
						coreStatuses: [
							{
								symbol: " ",
								name: "Todo",
								nextStatusSymbol: "x",
								availableAsCommand: true,
								type: "TODO",
							},
							{
								symbol: "x",
								name: "Done",
								nextStatusSymbol: " ",
								availableAsCommand: true,
								type: "DONE",
							},
						],
						customStatuses: [
							{
								symbol: "/",
								name: "In Progress",
								nextStatusSymbol: "x",
								availableAsCommand: false,
								type: "IN_PROGRESS",
							},
							{
								symbol: "-",
								name: "Cancelled",
								nextStatusSymbol: " ",
								availableAsCommand: false,
								type: "CANCELLED",
							},
							{
								symbol: "!",
								name: "Important",
								nextStatusSymbol: "x",
								availableAsCommand: false,
								type: "TODO",
							},
							{
								symbol: "?",
								name: "Question",
								nextStatusSymbol: "!",
								availableAsCommand: false,
								type: "TODO",
							},
							{
								symbol: "D",
								name: "Done (custom)",
								nextStatusSymbol: " ",
								availableAsCommand: false,
								type: "DONE",
							},
							{
								symbol: "c",
								name: "Cancelled (custom)",
								nextStatusSymbol: " ",
								availableAsCommand: false,
								type: "CANCELLED",
							},
							{
								symbol: "h",
								name: "On hold",
								nextStatusSymbol: " ",
								availableAsCommand: false,
								type: "ON_HOLD",
							},
							{
								symbol: "n",
								name: "Not a task",
								nextStatusSymbol: " ",
								availableAsCommand: false,
								type: "NON_TASK",
							},
						],
					},
				},
			},
		],
	);
});

test("the settings probes distinguish all eight groups without depending on the capture day", async () => {
	const { PROBE_LINES, SETTINGS_GROUPS, probeSignature, stableStringify } = await library();
	assert.deepEqual(PROBE_LINES, [
		"- [ ] probe",
		"- [ ] probe 🔁 every day 📅 2026-01-01",
		"- [ ] probe 🔁 every day ⏳ 2026-01-01 📅 2026-01-02",
		"- [ ] #task probe",
		"- [?] probe",
	]);
	assert.equal(new Set(SETTINGS_GROUPS.map(({ signature }) => stableStringify(signature))).size, 8);
	for (const day of ["2026-10-31", "2026-11-02"]) {
		const done = `- [x] probe ✅ ${day}`;
		const daily = `- [ ] probe 🔁 every day 📅 2026-01-02\n- [x] probe 🔁 every day 📅 2026-01-01 ✅ ${day}`;
		const scheduled = `- [ ] probe 🔁 every day ⏳ 2026-01-02 📅 2026-01-03\n- [x] probe 🔁 every day ⏳ 2026-01-01 📅 2026-01-02 ✅ ${day}`;
		const tagged = `- [x] #task probe ✅ ${day}`;
		const defaults = [done, daily, scheduled, tagged, done];
		const outputs: Record<string, string[]> = {
			default: defaults,
			dataview: [
				`- [x] probe [completion:: ${day}]`,
				`- [x] probe 🔁 every day 📅 2026-01-01 [completion:: ${day}]`,
				`- [x] probe 🔁 every day ⏳ 2026-01-01 📅 2026-01-02 [completion:: ${day}]`,
				`- [x] #task probe [completion:: ${day}]`,
				`- [x] probe [completion:: ${day}]`,
			],
			"next-line": [
				done,
				daily.split("\n").reverse().join("\n"),
				scheduled.split("\n").reverse().join("\n"),
				tagged,
				done,
			],
			"remove-scheduled": [done, daily, scheduled.replace(" ⏳ 2026-01-02", ""), tagged, done],
			"no-done-cancelled-dates": defaults.map((output) => output.replaceAll(` ✅ ${day}`, "")),
			"created-date": [done, daily.replace("- [ ] probe", `- [ ] probe ➕ ${day}`), scheduled, tagged, done],
			"global-filter": [
				"- [x] probe",
				"- [x] probe 🔁 every day 📅 2026-01-01",
				"- [x] probe 🔁 every day ⏳ 2026-01-01 📅 2026-01-02",
				tagged,
				"- [ ] probe",
			],
			"custom-statuses": [done, daily, scheduled, tagged, "- [!] probe"],
		};
		for (const { name, signature } of SETTINGS_GROUPS)
			assert.deepEqual(probeSignature(outputs[name]), signature, name);
	}
	assert.throws(() => probeSignature([]), /five strings/);
});

test("note diffs keep the longest non-overlapping UTF-16 prefix and suffix", async () => {
	const { diffNote, applyNoteDiff } = await library();
	const pairs = [
		["", ""],
		["", "new"],
		["removed", ""],
		["same", "same"],
		["aaaa", "aaa"],
		["ababa", "aba"],
		["aba", "ababa"],
		["\uFEFF- [ ] a\r\nkeep\r\n", "\uFEFF- [x] a\nkeep\n"],
		["prefix\r\n- [ ] a\nend", "prefix\n\nend"],
		["😀a", "😁a"],
	];
	for (const [before, after] of pairs) assert.equal(applyNoteDiff(before, diffNote(before, after)), after);
	assert.deepEqual(diffNote("aaaa", "aaa"), { prefix: 3, suffix: 0, text: "" });
	assert.deepEqual(diffNote("ababa", "aba"), { prefix: 3, suffix: 0, text: "" });
	assert.deepEqual(diffNote("😀a", "😁a"), { prefix: 1, suffix: 1, text: "\uDE01" });
});

test("note diffs round trip generated pairs with a fixed seed", async () => {
	const { diffNote, applyNoteDiff } = await library();
	let seed = 0x2ca71031;
	const next = (limit: number) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % limit;
	};
	const alphabet = ["a", "b", " ", "\t", "\r", "\n", "\uFEFF", "😀", "✅", "中"];
	const text = () => Array.from({ length: next(80) }, () => alphabet[next(alphabet.length)]).join("");
	for (let i = 0; i < 5000; i++) {
		const before = text();
		const prefix = next(before.length + 1);
		const suffix = next(before.length - prefix + 1);
		const after = i % 2 === 0 ? text() : before.slice(0, prefix) + text() + before.slice(before.length - suffix);
		const diff = diffNote(before, after);
		assert.equal(applyNoteDiff(before, diff), after, `pair ${i}`);
		assert.ok(diff.prefix + diff.suffix <= before.length);
		assert.ok(diff.prefix + diff.suffix <= after.length);
		if (diff.prefix < Math.min(before.length, after.length))
			assert.notEqual(before[diff.prefix], after[diff.prefix]);
		if (diff.suffix < Math.min(before.length, after.length) - diff.prefix)
			assert.notEqual(before[before.length - diff.suffix - 1], after[after.length - diff.suffix - 1]);
	}
});

test("capture JSON sorts keys recursively, preserves arrays and ends with a newline", async () => {
	const { stableStringify } = await library();
	const input = Object.freeze({
		z: Object.freeze([{ z: 2, a: 1 }, null]),
		a: Object.freeze({ y: false, b: "text" }),
	});
	assert.equal(
		stableStringify(input),
		'{\n\t"a": {\n\t\t"b": "text",\n\t\t"y": false\n\t},\n\t"z": [\n\t\t{\n\t\t\t"a": 1,\n\t\t\t"z": 2\n\t\t},\n\t\tnull\n\t]\n}\n',
	);
	assert.deepEqual(Object.keys(input), ["z", "a"]);
	assert.deepEqual(Object.keys(input.z[0]!), ["z", "a"]);
});

test("the toggle capture uses only tasks-parity and every corpus case", async () => {
	const { captureCases, TASKS_PARITY_VAULT } = await library();
	const { tasksParityCases } = await corpus();
	assert.equal(TASKS_PARITY_VAULT, "tasks-parity");
	const cases = captureCases();
	assert.deepEqual(cases, tasksParityCases());
	assert.ok(cases.length >= 500);
	assert.ok(cases.filter(({ recurring }) => recurring).length >= 120);
});
