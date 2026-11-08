// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	copy,
	type CounterFilter,
	migrateSortOption,
	type NewDateStyle,
	settingIssues,
	type SettingControl,
	type SettingSpec,
	sortOptionLabels,
} from "@tasks-calendar-wrapper/core";
import type { TasksCalendarSettingTab } from "../src/settings";
import { settingsSchema } from "../src/settings-schema";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { FIXTURE_NAMES, readFixture, rowsOf, startPlugin, type Control, type Row } from "./settings-fixtures";
import type { FakeElement } from "./stubs/obsidian";

// The plugin's settings schema: one entry for each option. The tab reads its texts through the schema, but its rows
// stay hand-written until step 13. These tests hold it to what step 4 recorded in fixtures/settings/tab.

type Key = keyof UserOption;

const specOf = (key: string): (typeof settingsSchema)[number] => {
	const spec = settingsSchema.find((found) => found.key === key);
	assert.ok(spec, `the schema has ${key}`);
	return spec;
};

/** What step 4 recorded each control of the tab saving, see settingstab.test.ts. */
interface RecordedChange {
	row: string;
	type: string;
	input: unknown;
	writes: Partial<UserOption>[];
	redrawn: boolean;
}
const recorded = JSON.parse(readFixture("tab/changes.json")) as RecordedChange[];

/** The control a recorded change was made with, as the schema names it. */
const CONTROL_OF_RECORDED: Readonly<Record<string, SettingControl>> = {
	toggle: "toggle",
	dropdown: "dropdown",
	text: "text",
	"moment-format": "momentFormat",
	textarea: "textArea",
};

/** The rows of tags, which the recording leaves out: their tags are added and deleted through dialogs. */
const TAG_ROWS: Readonly<Record<string, Key>> = {
	"Hide Tags": "hideTags",
	"Task Include Filters": "taskIncludeTags",
	"File Include Tags": "fileIncludeTags",
	"Task Exclude Filters": "taskExcludeTags",
	"File Exclude Tags": "fileExcludeTags",
};

/** The option each row of the tab sets: the one its control saves, or the tags it lists. */
const keyOfRow = (row: string): Key | undefined =>
	TAG_ROWS[row] ?? (Object.keys(recorded.find((change) => change.row === row)?.writes[0] ?? {})[0] as Key);

test("the schema has one entry for each option, in the defaults' order", () => {
	assert.deepEqual(
		settingsSchema.map((spec) => spec.key),
		Object.keys(defaultUserOptions),
	);
	assert.equal(settingsSchema.length, 48);
	assert.ok(Object.isFrozen(settingsSchema) && settingsSchema.every((spec) => Object.isFrozen(spec)));
});

test("openNoteInsteadOfInPlace defaults to false and is a taskItems toggle read on push", () => {
	assert.equal(defaultUserOptions.openNoteInsteadOfInPlace, false);
	assert.deepEqual(specOf("openNoteInsteadOfInPlace"), {
		key: "openNoteInsteadOfInPlace",
		type: "boolean",
		control: "toggle",
		copy: "openNoteInsteadOfInPlace",
		group: "taskItems",
		redrawsTab: false,
		readWhen: "push",
	});
});

test("newDateStyle defaults to emoji and follows the open-note toggle as a taskItems dropdown read on push", () => {
	assert.equal(defaultUserOptions.newDateStyle, "emoji");
	assert.deepEqual(specOf("newDateStyle"), {
		key: "newDateStyle",
		type: "string",
		control: "dropdown",
		copy: "newDateStyle",
		options: { emoji: "emoji", dataview: "dataview" },
		group: "taskItems",
		redrawsTab: false,
		readWhen: "push",
	});
	const index = settingsSchema.findIndex((spec) => spec.key === "openNoteInsteadOfInPlace");
	assert.equal(settingsSchema[index + 1].key, "newDateStyle");
});

test("the defaults, and every option of a full 0.3.7 data.json, are of the types the schema gives", () => {
	assert.deepEqual(settingIssues(defaultUserOptions, settingsSchema), []);
	assert.deepEqual(
		settingIssues({ ...defaultUserOptions, ...JSON.parse(readFixture("0.3.7-full.json")) }, settingsSchema),
		[],
	);
});

test("the values of the wrong type users have are found, and only those", () => {
	const issues = (dataJson: object) =>
		settingIssues({ ...defaultUserOptions, ...dataJson }, settingsSchema).map((issue) => issue.key);
	assert.deepEqual(issues(JSON.parse(readFixture("0.0.4-array-palette.json"))), ["tagColorPalette"]);
	assert.deepEqual(issues({ useTags: "yes", hideTags: "#later", lastSeenVersion: null, sort: ["due-asc"] }), [
		"lastSeenVersion",
		"hideTags",
		"sort",
		"useTags",
	]);
	// A literal [ ] among the statuses to hide is text all the same.
	assert.deepEqual(issues(JSON.parse(readFixture("0.3.1-hide-literal-todo.json"))), []);
	// Property rules are lists of values by property, and the null maps the tab cannot draw are found too.
	assert.deepEqual(issues({ excludeProperties: { status: ["archived", "done"], priority: ["low"] } }), []);
	assert.deepEqual(issues({ excludeProperties: { status: "archived" } }), ["excludeProperties"]);
	assert.deepEqual(issues({ tagColorPalette: null, excludeProperties: null }), [
		"excludeProperties",
		"tagColorPalette",
	]);
});

test("every value the tab was recorded saving is of the type the schema gives", () => {
	for (const change of recorded)
		assert.deepEqual(settingIssues({ ...defaultUserOptions, ...change.writes[0] }, settingsSchema), [], change.row);
});

test("options the plugin manages itself have no control, no group and no codec", () => {
	const hidden = settingsSchema.filter((spec) => spec.control === "none").map((spec) => spec.key);
	assert.deepEqual(hidden, ["lastSeenVersion", "styles", "taskStatusOrder"]);
	for (const key of hidden) {
		const spec = specOf(key);
		assert.equal(spec.group, undefined, key);
		assert.equal(spec.codec, undefined, key);
		assert.equal(spec.shownWhen, undefined, key);
		assert.equal(spec.redrawsTab, false, key);
	}
	for (const spec of settingsSchema.filter((found) => found.control !== "none"))
		assert.ok(spec.group, `${spec.key} has a group`);
});

test("exactly the options typed into a box have a codec", () => {
	const typed: SettingControl[] = ["text", "textArea", "momentFormat"];
	for (const spec of settingsSchema) assert.equal(spec.codec !== undefined, typed.includes(spec.control), spec.key);
});

test("every spec except control none has copy", () => {
	for (const spec of settingsSchema) {
		assert.equal(spec.copy !== undefined, spec.control !== "none", spec.key);
		assert.equal(spec.options !== undefined, spec.control === "dropdown", spec.key);
		if (spec.copy === undefined) continue;
		assert.equal(spec.copy, spec.key, spec.key);
		const texts = copy.settings[spec.copy];
		assert.ok(texts, spec.key);
		assert.equal(typeof texts.name, "string", spec.key);
		assert.equal(typeof texts.desc, "string", spec.key);
	}
});

test("every dropdown option value is a value of the codec or type", () => {
	type DropdownValue = {
		counterBehavior: UserOption["counterBehavior"];
		entryPosition: UserOption["entryPosition"];
		newDateStyle: NewDateStyle;
		defaultFilters: CounterFilter;
	};
	const values = {
		counterBehavior: ["Filter", "Focus"],
		entryPosition: ["today", "top", "bottom"],
		newDateStyle: ["emoji", "dataview"],
		defaultFilters: ["", "todoFilter", "overdueFilter", "unplannedFilter"],
		sort: Object.keys(sortOptionLabels),
	} as const satisfies { [K in keyof DropdownValue]: readonly DropdownValue[K][] } & { sort: readonly string[] };
	// The lists must cover their unions as well as contain only values of them.
	const exhaustive: {
		[K in keyof DropdownValue]: Exclude<DropdownValue[K], (typeof values)[K][number]> extends never ? true : false;
	} = { counterBehavior: true, entryPosition: true, newDateStyle: true, defaultFilters: true };
	void exhaustive;
	const dropdowns = settingsSchema.filter((spec) => spec.control === "dropdown");
	assert.deepEqual(dropdowns.map((spec) => spec.key).sort(), Object.keys(values).sort());
	for (const [key, expected] of Object.entries(values)) {
		const spec = specOf(key);
		// The codec branch is vacuous today: no dropdown has a codec.
		assert.equal(spec.codec, undefined, key);
		assert.ok(spec.options && Object.isFrozen(spec.options), key);
		assert.deepEqual(Object.keys(spec.options), expected, key);
		assert.ok(spec.copy, key);
		const texts = copy.settings[spec.copy];
		assert.ok("options" in texts, key);
		for (const option of Object.values(spec.options)) {
			assert.ok(Object.prototype.hasOwnProperty.call(texts.options, option), `${key}: ${option}`);
		}
		assert.deepEqual(
			[...new Set(Object.values(spec.options))].sort(),
			Object.keys(texts.options).sort(),
			`${key}: every option copy key is used`,
		);
	}
	for (const value of values.sort) assert.equal(migrateSortOption(value), value, value);
});

test("each control of the tab is the one the schema names, and draws the tab again exactly when it says", () => {
	const seen = new Set<string>();
	for (const change of recorded) {
		assert.equal(change.writes.length, 1, change.row);
		const [key] = Object.keys(change.writes[0]);
		const spec = specOf(key);
		assert.equal(spec.control, CONTROL_OF_RECORDED[change.type], key);
		assert.equal(spec.redrawsTab, change.redrawn, key);
		seen.add(key);
	}
	// Every option shown with one of these controls was recorded.
	const recordable = settingsSchema.filter((spec) => Object.values(CONTROL_OF_RECORDED).includes(spec.control));
	assert.deepEqual(
		recordable.map((spec) => spec.key).filter((key) => !seen.has(key)),
		[],
	);
	// Tags are added and deleted through dialogs, and each change draws the tab again, see settingstab.test.ts.
	for (const key of Object.values(TAG_ROWS))
		assert.deepEqual([specOf(key).control, specOf(key).redrawsTab], ["tagList", true]);
	assert.deepEqual([specOf("tagColorPalette").control, specOf("tagColorPalette").redrawsTab], ["tagPalette", true]);
});

test("what the tab saves from a box is the codec's reading of the text typed", () => {
	let boxes = 0;
	for (const change of recorded) {
		const [[key, written]] = Object.entries(change.writes[0]);
		const { codec } = specOf(key);
		if (!codec) continue;
		assert.equal(typeof change.input, "string", key);
		assert.deepEqual(written, codec.parse(change.input as string), `${key} from ${JSON.stringify(change.input)}`);
		boxes += 1;
	}
	assert.ok(boxes >= 10, `${boxes} typed changes recorded`);
});

test("the boxes of the tab show the codec's text of the options saved", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let shown = 0;
	for (const fixture of FIXTURE_NAMES) {
		const { plugin, rows } = await drawnTab(fixture);
		for (const row of rows) {
			const key = keyOfRow(row.name);
			const codec = key && specOf(key).codec;
			if (!key || !codec) continue;
			const control = row.controls.find((found) => "value" in found);
			assert.ok(control && "value" in control, row.name);
			assert.equal(control.value, codec.format(plugin.userOptions[key]), `${fixture}: ${row.name}`);
			shown += 1;
		}
	}
	assert.ok(shown > 50, `${shown} boxes compared`);
});

test("a row shows only while the option the schema names for it is on", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const parents = [...new Set(settingsSchema.flatMap((spec) => (spec.shownWhen ? [spec.shownWhen] : [])))];
	assert.deepEqual(parents.sort(), ["useExcludeTags", "useIncludeTags", "useQuickEntry", "useTags"]);
	const allOn = Object.fromEntries(parents.map((parent) => [parent, true]));
	const shownKeys = async (options: object) =>
		(await drawnTab(JSON.stringify(options))).rows.flatMap((row) => keyOfRow(row.name) ?? []);
	const withAll = await shownKeys(allOn);
	for (const parent of parents) {
		const without = await shownKeys({ ...allOn, [parent]: false });
		const hidden = withAll.filter((key) => !without.includes(key));
		// The palette has no row of its own: its tags and buttons are in the row of Use Tags.
		const expected = settingsSchema
			.filter((spec) => spec.shownWhen === parent && spec.control !== "tagPalette")
			.map((spec) => spec.key);
		assert.deepEqual([...hidden].sort(), [...expected].sort(), parent);
	}
	const paletteShown = async (useTags: boolean) =>
		(await drawnTab(JSON.stringify({ useTags }))).rows
			.find((row) => row.name === "Use Tags")
			?.controls.some(holdsTag);
	assert.deepEqual([await paletteShown(true), await paletteShown(false)], [true, false]);
	assert.equal(specOf("tagColorPalette").shownWhen, "useTags");
});

test("each row shows under the heading of its option's group", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const GROUP_OF_HEADING: Readonly<Record<string, string>> = {
		Interface: "interface",
		"Task items": "taskItems",
		"Formats and filters": "formatsAndFilters",
	};
	const { rows } = await drawnTab(JSON.stringify({ useIncludeTags: true, useExcludeTags: true }));
	let group: string | undefined;
	let placed = 0;
	for (const row of rows) {
		if (row.heading) {
			group = GROUP_OF_HEADING[row.name];
			assert.ok(group, row.name);
			continue;
		}
		const key = keyOfRow(row.name);
		assert.ok(key, `the row ${row.name} sets an option`);
		assert.equal(specOf(key).group, group, row.name);
		placed += 1;
	}
	assert.equal(
		placed,
		settingsSchema.filter((spec) => spec.control !== "none" && spec.control !== "tagPalette").length,
	);
	// The palette is in the row of Use Tags.
	assert.equal(specOf("tagColorPalette").group, specOf("useTags").group);
});

test("the schema records the options read only when the plugin loads or a timeline opens, and the one never read", () => {
	const readAt = (when: SettingSpec["readWhen"]) =>
		settingsSchema.filter((spec) => spec.readWhen === when).map((spec) => spec.key);
	// main.ts reads these in onload and when the layout is ready, see plugin.test.ts for opening on start and for what
	// is new; the timeline reads the next two when it opens, see timeline-instance.dom.test.ts.
	assert.deepEqual(readAt("pluginLoad"), ["openViewOnStartup", "showWhatsNewOnUpdate", "lastSeenVersion"]);
	assert.deepEqual(readAt("viewOpen"), ["defaultTodayFocus", "defaultFilters"]);
	// Nothing in the plugin or its packages reads styles.
	assert.deepEqual(readAt("never"), ["styles"]);
});

/** Whether a control is a tag, or holds rows with one, as the palette's rows in the row of Use Tags. */
const holdsTag = (control: Control): boolean =>
	control.type === "tag" ||
	(control.type === "rows" && "rows" in control && control.rows.some((row) => row.controls.some(holdsTag)));

/** The plugin started on a fixture, or on the given data.json text, with its settings tab drawn. */
async function drawnTab(fixtureOrText: string) {
	const text = FIXTURE_NAMES.includes(fixtureOrText) ? readFixture(fixtureOrText) : fixtureOrText;
	const { plugin } = await startPlugin(text);
	const tab = plugin.settingTab as TasksCalendarSettingTab;
	tab.display();
	return { plugin, rows: rowsOf(tab.containerEl as unknown as FakeElement) as Row[] };
}
