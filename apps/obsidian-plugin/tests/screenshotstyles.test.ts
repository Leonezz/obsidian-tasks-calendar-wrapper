import { test } from "node:test";
import assert from "node:assert/strict";

import {
	STYLE_PROBES,
	STYLE_PROPERTIES,
	ROOT_CUSTOM_PROPERTIES,
	collectStyles,
	serializeStyles,
	compareStyles,
	formatStyleDifference,
	stylesFile,
	stylesBaselineProblems,
	type StyleRecord,
} from "../scripts/screenshots-styles.mjs";

test("the probes have unique names and the properties are the fixed list", () => {
	assert.deepEqual(STYLE_PROPERTIES, [
		"color",
		"background-color",
		"background-image",
		"display",
		"visibility",
		"position",
		"padding",
		"margin",
		"font-family",
		"font-size",
		"font-weight",
		"font-style",
		"line-height",
		"text-decoration-line",
		"text-align",
		"white-space",
		"border",
		"border-radius",
		"box-shadow",
		"outline",
		"width",
		"height",
		"opacity",
		"z-index",
		"cursor",
		"overflow",
		"flex-direction",
		"flex-wrap",
		"align-items",
		"justify-content",
		"stroke",
		"stroke-width",
		"content",
	]);
	assert.deepEqual(ROOT_CUSTOM_PROPERTIES, [
		"--taskido-color-warning",
		"--taskido-color-focus",
		"--taskido-color-focus-hsl",
		"--taskido-color-overdue",
		"--taskido-color-done",
		"--taskido-color-process",
	]);
	assert.deepEqual(
		STYLE_PROBES.map(({ selector }) => selector),
		[
			".taskido",
			".year",
			".year.current",
			".details:not(.today)",
			".details.today",
			".dateLine",
			".date",
			".weekday",
			".todayHeader",
			".counters",
			".counter#todo",
			".counter#overdue",
			".counter#unplanned",
			".counter#todo .count",
			".counter#todo .label",
			".task.due",
			".task.overdue",
			".task.process",
			".task.scheduled",
			".task.start",
			".task.unplanned",
			'.task[data-task=">"]',
			'.task[data-task="<"]',
			'.task[data-task="/"]',
			".task .lines",
			".task .content",
			".task .info",
			".task .header",
			".task .timeline",
			".task .timeline .icon",
			".task .timeline label.icon svg",
			".task.overdue .timeline .icon svg",
			".task.process .timeline .icon svg",
			".task.unplanned .timeline",
			".task.scheduled .timeline",
			".task.overdue .timeline",
			".task.process .timeline",
			'.task[data-task=">"] .timeline',
			".task .info .relative",
			".task.overdue .info .relative",
			".task .info .repeat",
			".task .info .priority",
			".task .info .file",
			".task .info .tag",
			".task .modify",
			".quickEntryPanel",
			".quickEntryPanel .left",
			".quickEntryPanel .actionSelect",
			".quickEntryPanel .actionName",
			".quickEntryPanel .fileSelect",
			".quickEntryPanel .newTask",
			".quickEntryPanel .ok",
			".quickEntryPanel .right",
			".quickEntryPanel svg",
			'.task[aria-busy="true"]',
			'.task[aria-busy="true"] .content',
			'.task[aria-busy="true"] .info .file',
			'.task[aria-busy="true"] .timeline .icon svg',
		],
	);
	assert.equal(STYLE_PROBES.length, 58);
	assert.equal(new Set(STYLE_PROBES.map(({ name }) => name)).size, 58);
	assert.deepEqual(STYLE_PROBES[0], { name: ".taskido", selector: ".taskido" });
	for (const probe of STYLE_PROBES) assert.equal(probe.name, probe.selector + (probe.pseudo ?? ""));
	assert.deepEqual(
		STYLE_PROBES.filter(({ pseudo }) => pseudo !== undefined).map(({ selector, pseudo }) => [selector, pseudo]),
		[
			[".task.unplanned .timeline", "::after"],
			[".task.scheduled .timeline", "::after"],
			[".task.overdue .timeline", "::after"],
			[".task.process .timeline", "::after"],
			['.task[data-task=">"] .timeline', "::after"],
		],
	);
	for (const list of [STYLE_PROBES, STYLE_PROPERTIES, ROOT_CUSTOM_PROPERTIES]) assert.ok(Object.isFrozen(list));
});

test("the fingerprint is serialized with sorted keys, whatever the collection order", () => {
	const first: StyleRecord = {
		".z": { "z-index": "2", color: "red", "--Z": "var(--text-normal)", "--a": "  " },
		".a": null,
		".A": { visibility: "hidden", color: "" },
	};
	const second: StyleRecord = {
		".A": { color: "", visibility: "hidden" },
		".a": null,
		".z": { "--a": "  ", "--Z": "var(--text-normal)", color: "red", "z-index": "2" },
	};
	const expected =
		'{\n\t".A": {\n\t\t"color": "",\n\t\t"visibility": "hidden"\n\t},\n' +
		'\t".a": null,\n\t".z": {\n\t\t"--Z": "var(--text-normal)",\n\t\t"--a": "  ",\n' +
		'\t\t"color": "red",\n\t\t"z-index": "2"\n\t}\n}\n';
	const serialized = serializeStyles(first);
	assert.equal(serialized, expected);
	assert.equal(serializeStyles(second), serialized);
	assert.deepEqual(JSON.parse(serialized), first);
});

test("a probe without an element is recorded as null", () => {
	const element = {};
	const root = { querySelector: (selector: string) => (selector === ".present" ? element : null) };
	const container = { querySelector: (selector: string) => (selector === ".taskido" ? root : null) };
	const documentBefore = Object.getOwnPropertyDescriptor(globalThis, "document");
	const computedStyleBefore = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
	const calls: { element: unknown; pseudo: string | null }[] = [];
	try {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { querySelector: (selector: string) => (selector === "#fixture" ? container : null) },
		});
		Object.defineProperty(globalThis, "getComputedStyle", {
			configurable: true,
			value: (element: unknown, pseudo: string | null) => {
				calls.push({ element, pseudo });
				return { getPropertyValue: (property: string) => ` ${property} ` };
			},
		});
		const arg = {
			container: "#fixture",
			probes: [
				{ name: ".taskido", selector: ".taskido" },
				{ name: ".missing", selector: ".missing" },
				{ name: ".present", selector: ".present" },
			],
			properties: ["color", "opacity"],
			rootCustomProperties: ["--taskido-color-focus"],
		};
		assert.deepEqual(collectStyles(arg), {
			".taskido": { color: " color ", opacity: " opacity ", "--taskido-color-focus": " --taskido-color-focus " },
			".missing": null,
			".present": { color: " color ", opacity: " opacity " },
		});
		assert.deepEqual(calls, [
			{ element: root, pseudo: null },
			{ element, pseudo: null },
		]);
		assert.throws(() => collectStyles({ ...arg, container: "#missing" }), /#missing/);
		container.querySelector = () => null;
		assert.throws(() => collectStyles(arg), /\.taskido/);
	} finally {
		if (documentBefore) Object.defineProperty(globalThis, "document", documentBefore);
		else Reflect.deleteProperty(globalThis, "document");
		if (computedStyleBefore) Object.defineProperty(globalThis, "getComputedStyle", computedStyleBefore);
		else Reflect.deleteProperty(globalThis, "getComputedStyle");
	}
});

test("compareStyles lists each differing probe and property with both values", () => {
	const base: StyleRecord = {
		".z": { color: "red" },
		".missing": null,
		".a": { opacity: "1", color: "red", display: "block" },
	};
	const candidate: StyleRecord = {
		".a": { color: "blue", display: "block", opacity: "0.5" },
		".missing": { color: "green" },
		".z": { color: "black" },
	};
	const differences = compareStyles(base, candidate);
	assert.deepEqual(differences, [
		{ probe: ".a", property: "color", base: "red", candidate: "blue" },
		{ probe: ".a", property: "opacity", base: "1", candidate: "0.5" },
		{ probe: ".missing", property: null, base: null, candidate: "element" },
		{ probe: ".z", property: "color", base: "red", candidate: "black" },
	]);
	assert.deepEqual(
		differences.map((difference) => formatStyleDifference("light/example", difference)),
		[
			"light/example .a color: red → blue",
			"light/example .a opacity: 1 → 0.5",
			"light/example .missing <element>: null → element",
			"light/example .z color: red → black",
		],
	);
	assert.deepEqual(
		compareStyles(candidate, base),
		differences.map(({ probe, property, base, candidate }) => ({
			probe,
			property,
			base: candidate,
			candidate: base,
		})),
	);
	assert.deepEqual(compareStyles(base, base), []);
	assert.deepEqual(compareStyles({ ".a": { color: "" } }, { ".b": {} }), [
		{ probe: ".a", property: null, base: "element", candidate: "missing" },
		{ probe: ".b", property: null, base: "missing", candidate: "element" },
	]);
	assert.deepEqual(compareStyles({ ".a": null }, {}), [
		{ probe: ".a", property: null, base: null, candidate: "missing" },
	]);
	assert.deepEqual(compareStyles({ ".a": { color: "" } }, { ".a": {} }), [
		{ probe: ".a", property: "color", base: "", candidate: null },
	]);
});

test("a missing baseline is an error that names the file and the update command", () => {
	const state = "light/light-today-all-days-no-counter";
	const file = "fixtures/screenshots/styles/light/light-today-all-days-no-counter.json";
	const serialized = JSON.stringify({ ".taskido": { color: "red" } }, null, "\t") + "\n";
	const taken = new Map([[state, serialized]]);
	for (const baselines of [new Map<string, string | undefined>(), new Map([[state, undefined]])]) {
		const problems = stylesBaselineProblems(taken, baselines);
		assert.equal(problems.length, 1);
		assert.ok(problems[0].includes(file));
		assert.ok(problems[0].includes("pnpm screenshots --styles --update"));
	}
	assert.equal(stylesFile("light", "light-today-all-days-no-counter"), file);
	assert.equal(stylesFile("dark", "dark-row-dimmed"), "fixtures/screenshots/styles/dark/dark-row-dimmed.json");
	assert.deepEqual(stylesBaselineProblems(taken, new Map([[state, serialized]])), []);
	const baseline = JSON.stringify({ ".taskido": { color: "blue", opacity: "1" } }, null, "\t") + "\n";
	assert.deepEqual(stylesBaselineProblems(taken, new Map([[state, baseline]])), [
		`${state} .taskido color: blue → red`,
		`${state} .taskido opacity: 1 → null`,
	]);
	const malformed = stylesBaselineProblems(taken, new Map([[state, "{ broken JSON"]]));
	assert.equal(malformed.length, 1);
	assert.ok(malformed[0].includes(file));
	assert.match(malformed[0], /parse|JSON/i);
});
