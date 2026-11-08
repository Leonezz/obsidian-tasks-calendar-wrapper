// Pin today's tag lists, palette and visibility through the drawn tab for the phase 4 step 13 generator.
// These tests must stay green, unchanged.
import "./golden-clock";
import "./setup";

import { beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copy, settingIssues } from "@tasks-calendar-wrapper/core";

import { settingGroups, settingsSchema } from "../src/settings-schema";
import { settingRows, type SettingRow, type SettingRowOf } from "../src/settings/rows";
import { defaultUserOptions } from "../src/useroptions";
import { FIXTURE_NAMES, readFixture, rowsOf, startPlugin, type Row } from "./settings-fixtures";
import {
	ButtonComponent,
	ExtraButtonComponent,
	FakeElement,
	Modal,
	Notice,
	SettingControl,
	SettingItemElement,
	type Setting,
} from "./stubs/obsidian";

beforeEach(() => {
	Notice.shown = [];
	Notice.instances = [];
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const tagLists = ["hideTags", "taskIncludeTags", "fileIncludeTags", "taskExcludeTags", "fileExcludeTags"] as const;

async function drawnTab(t: TestContext, options: object) {
	const { plugin } = await startPlugin(JSON.stringify(options));
	t.after(() => plugin.unload());
	const tab = plugin.settingTab;
	assert.ok(tab, "the plugin adds its settings tab");
	tab.display();
	return { plugin, tab, container: tab.containerEl as unknown as FakeElement };
}

function settingsIn(container: FakeElement): Setting[] {
	return container.children.flatMap((child) => (child instanceof SettingItemElement ? [child.setting] : []));
}

function settingNamed(container: FakeElement, name: string): Setting {
	const setting = settingsIn(container).find((setting) => setting.name === name);
	assert.ok(setting, name);
	return setting;
}

function extraButtons(setting: Setting, icon: string): ExtraButtonComponent[] {
	return setting.components.filter(
		(component): component is ExtraButtonComponent =>
			component instanceof ExtraButtonComponent && component.icon === icon,
	);
}

function nestedButtons(setting: Setting, icon: string): ExtraButtonComponent[] {
	const container = setting.controlEl.firstChild;
	assert.ok(container instanceof FakeElement);
	return settingsIn(container).flatMap((line) => extraButtons(line, icon));
}

function addButton(setting: Setting): ExtraButtonComponent {
	const buttons = extraButtons(setting, "plus-with-circle");
	assert.equal(buttons.length, 1);
	return buttons[0];
}

function valueControl(setting: Setting, type: string): SettingControl {
	const control = setting.components.find(
		(component) => component instanceof SettingControl && component.type === type,
	);
	assert.ok(control instanceof SettingControl, type);
	return control;
}

/** Opens the real dialog through its button, types into its controls, and presses Save. */
async function saveDialog(t: TestContext, button: ExtraButtonComponent, tag: string, color?: string) {
	const opened = t.mock.method(Modal.prototype, "open");
	await button.click();
	assert.equal(opened.mock.callCount(), 1);
	const modal = opened.mock.calls[0].this;
	assert.ok(modal instanceof Modal);
	opened.mock.restore();
	t.after(() => modal.close());
	const [input, footer] = modal.contentEl.children;
	assert.ok(input instanceof FakeElement);
	assert.ok(footer instanceof FakeElement);
	const setting = settingsIn(input)[0];
	assert.ok(setting);
	await valueControl(setting, "text").change(tag);
	if (color !== undefined) await valueControl(setting, "color").change(color);
	const save = settingsIn(footer)[0].components.find(
		(component) => component instanceof ButtonComponent && component.tooltip === "Save",
	);
	assert.ok(save instanceof ButtonComponent);
	await save.click();
	await settle();
}

test("deleting each tag of each tag list deletes that tag and draws the tab again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const deletes = async (key: (typeof tagLists)[number], tags: string[], position: number, expected: string[]) => {
		const { plugin, tab, container } = await drawnTab(t, {
			useIncludeTags: true,
			useExcludeTags: true,
			[key]: tags,
		});
		const writes = t.mock.method(plugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		const buttons = nestedButtons(settingNamed(container, copy.settings[key].name), "cross");
		assert.equal(buttons.length, tags.length, key);
		await buttons[position].click();
		await settle();
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments),
			[[{ [key]: expected }]],
			`${key}[${position}]`,
		);
		assert.equal(draws.mock.callCount(), 1, `${key}[${position}]`);
	};
	const tags = ["#a", "#b", "#c", "#d"];
	for (const key of tagLists) {
		for (let position = 0; position < tags.length; position++) {
			await deletes(
				key,
				tags,
				position,
				tags.filter((_, index) => index !== position),
			);
		}
	}
	await deletes("hideTags", ["#a", "#b", "#a"], 0, ["#b"]);
});

test("adding a tag a list already holds shows the notice and writes nothing, in every tag list", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const key of tagLists) {
		Notice.shown = [];
		Notice.instances = [];
		const { plugin, tab, container } = await drawnTab(t, {
			useIncludeTags: true,
			useExcludeTags: true,
			[key]: ["#x"],
		});
		const writes = t.mock.method(plugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		await saveDialog(t, addButton(settingNamed(container, copy.settings[key].name)), "#x");
		assert.deepEqual(Notice.shown, ["Tag #x already exists."], key);
		assert.equal(Notice.instances.length, 1, key);
		assert.equal(Notice.instances[0].duration, 5000, key);
		assert.equal(writes.mock.callCount(), 0, key);
		assert.equal(draws.mock.callCount(), 0, key);
	}
});

test("adding a new tag appends it to the list saved now and draws the tab again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, tab, container } = await drawnTab(t, { hideTags: [] });
	await plugin.writeOptions({ hideTags: ["#late"] });
	const writes = t.mock.method(plugin, "writeOptions");
	const draws = t.mock.method(tab, "display");
	await saveDialog(t, addButton(settingNamed(container, copy.settings.hideTags.name)), "#new");
	assert.deepEqual(
		writes.mock.calls.map((call) => call.arguments),
		[[{ hideTags: ["#late", "#new"] }]],
	);
	assert.equal(draws.mock.callCount(), 1);
});

test("editing a palette tag replaces it and adding one appends it, each drawing the tab again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, tab, container } = await drawnTab(t, {
		useTags: true,
		tagColorPalette: { "#TODO": "#ff0000", "#TEST": "#00ff00" },
	});
	const saves = async (
		button: ExtraButtonComponent,
		tag: string,
		color: string,
		expected?: Record<string, string>,
	) => {
		const writes = t.mock.method(plugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		await saveDialog(t, button, tag, color);
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments),
			expected ? [[{ tagColorPalette: expected }]] : [],
		);
		assert.equal(draws.mock.callCount(), expected ? 1 : 0);
		if (expected) {
			const saved = writes.mock.calls[0].arguments[0].tagColorPalette;
			assert.ok(saved);
			assert.deepEqual(Object.entries(saved), Object.entries(expected));
		}
		writes.mock.restore();
		draws.mock.restore();
	};
	const edited = { "#TODO": "#ff0000", "#renamed": "#123456" };
	const pencils = nestedButtons(settingNamed(container, copy.settings.useTags.name), "pencil");
	assert.equal(pencils.length, 2);
	await saves(pencils[1], "#renamed", "#123456", edited);

	tab.display();
	const add = addButton(settingNamed(container, copy.settings.useTags.name));
	assert.equal(add.tooltip, "Add a palette");
	await saves(add, "#added", "#abcdef", { ...edited, "#added": "#abcdef" });

	tab.display();
	await saves(nestedButtons(settingNamed(container, copy.settings.useTags.name), "pencil")[1], "nohash", "#123456");
});

test("a truthy option of the wrong type shows the rows it controls, as today", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const quickEntryRows = [
		copy.settings.taskFiles.name,
		copy.settings.inbox.name,
		copy.settings.sectionForNewTasks.name,
	];
	for (const value of ["no", 0]) {
		const { plugin, container } = await drawnTab(t, { useQuickEntry: value });
		assert.equal(plugin.userOptions.useQuickEntry, value, "loading preserves the wrong-typed option");
		const names = rowsOf(container).map((row) => row.name);
		for (const name of quickEntryRows) assert.equal(names.includes(name), Boolean(value), `${value}: ${name}`);
	}
});

function modelSettings(rows: readonly SettingRow[]): SettingRowOf<"setting">[] {
	return rows.flatMap((row) => (row.kind === "heading" ? [] : [row, ...(row.palette ? [row.palette] : [])]));
}

function assertDeepFrozen(value: unknown): void {
	if (value === null || typeof value !== "object") return;
	assert.ok(Object.isFrozen(value));
	for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("the row model of each data.json shape lists the rows the tab shows, in order", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const name of FIXTURE_NAMES) {
		const { plugin } = await startPlugin(readFixture(name));
		t.after(() => plugin.unload());
		const options = plugin.userOptions;
		const rows = settingRows(settingsSchema, options, settingIssues(options, settingsSchema));
		const snapshot = JSON.parse(readFixture(`tab/${name}`)) as Row[];
		assert.deepEqual(
			rows.flatMap((row) => (row.kind === "heading" ? [row.name] : row.shown ? [row.texts.name] : [])),
			snapshot.map((row) => row.name),
			name,
		);
		assert.deepEqual(
			rows.filter((row) => row.kind === "heading").map((row) => row.group),
			settingGroups,
			name,
		);
		assertDeepFrozen(rows);
	}
});

test("a row is shown exactly while the option its spec names in shownWhen is on", () => {
	const children = {
		useQuickEntry: ["taskFiles", "inbox", "sectionForNewTasks"],
		useTags: ["tagColorPalette"],
		useIncludeTags: ["taskIncludeTags", "fileIncludeTags"],
		useExcludeTags: ["taskExcludeTags", "fileExcludeTags"],
	};
	for (const [parent, expected] of Object.entries(children)) {
		const on = modelSettings(settingRows(settingsSchema, { ...defaultUserOptions, [parent]: true }, []));
		const off = modelSettings(settingRows(settingsSchema, { ...defaultUserOptions, [parent]: false }, []));
		assert.deepEqual(
			on.map((row) => row.key),
			off.map((row) => row.key),
			"hidden rows stay in the model",
		);
		assert.deepEqual(
			on
				.filter((row, index) => row.shown !== off[index].shown)
				.map((row) => row.key)
				.sort(),
			[...expected].sort(),
			parent,
		);
		for (let index = 0; index < on.length; index++) {
			assert.equal(
				on[index].shown,
				!on[index].spec.shownWhen ||
					Boolean({ ...defaultUserOptions, [parent]: true }[on[index].spec.shownWhen!]),
			);
			assert.equal(
				off[index].shown,
				!off[index].spec.shownWhen ||
					Boolean({ ...defaultUserOptions, [parent]: false }[off[index].spec.shownWhen!]),
			);
		}
	}
	for (const value of ["no", 0]) {
		const rows = modelSettings(settingRows(settingsSchema, { ...defaultUserOptions, useQuickEntry: value }, []));
		for (const key of children.useQuickEntry)
			assert.equal(rows.find((row) => row.key === key)?.shown, Boolean(value), `${key}: ${value}`);
	}
});

test("each row redraws the tab exactly when its spec says", () => {
	const rows = modelSettings(settingRows(settingsSchema, defaultUserOptions, []));
	for (const row of rows) {
		const spec = settingsSchema.find((spec) => spec.key === row.key);
		assert.ok(spec);
		assert.equal(row.redrawsTab, spec.redrawsTab, row.key);
		assert.deepEqual(row.spec, spec, row.key);
	}
	assert.deepEqual(
		rows
			.filter((row) => row.redrawsTab)
			.map((row) => row.key)
			.sort(),
		["useQuickEntry", "useTags", "useIncludeTags", "useExcludeTags", ...tagLists, "tagColorPalette"].sort(),
	);
});

test("the palette has no row of its own and shows in the row of Use Tags", () => {
	for (const useTags of [false, true]) {
		const rows = settingRows(settingsSchema, { ...defaultUserOptions, useTags }, []);
		assert.equal(
			rows.some((row) => row.kind === "setting" && row.key === "tagColorPalette"),
			false,
		);
		const parent = rows.find((row) => row.kind === "setting" && row.key === "useTags");
		assert.ok(parent?.kind === "setting");
		assert.equal(parent.shown, true);
		assert.equal(parent.palette?.key, "tagColorPalette");
		assert.equal(parent.palette?.control, "tagPalette");
		assert.equal(parent.palette?.shown, useTags);
		assert.deepEqual(parent.palette?.texts, copy.settings.tagColorPalette);
		assert.equal(modelSettings(rows).filter((row) => row.control === "tagPalette").length, 1);
	}
});

test("every order hint is needed and rows without one keep the schema's order", () => {
	const hints = {
		useBuiltinStyle: 1.5,
		taskFiles: 30.1,
		inbox: 30.2,
		sectionForNewTasks: 30.3,
		dailyNoteFolder: 30.4,
		dailyNoteFormat: 30.5,
		forward: 42.1,
		forwardPastStartAndScheduled: 42.2,
		forwardUndatedDone: 42.3,
		hideTags: 36.5,
		dateFormat: 5.1,
		sort: 5.2,
		convert24HourTimePrefix: 5.3,
		excludePaths: 11.5,
		includePaths: 12.1,
		filterEmpty: 12.2,
	};
	assert.deepEqual(
		Object.fromEntries(
			settingsSchema.filter((spec) => spec.order !== undefined).map((spec) => [spec.key, spec.order]),
		),
		hints,
	);
	const options = {
		...defaultUserOptions,
		useQuickEntry: true,
		useTags: true,
		useIncludeTags: true,
		useExcludeTags: true,
	};
	const rows = settingRows(settingsSchema, options, []);
	const order = (rows: readonly SettingRow[]) => rows.flatMap((row) => (row.kind === "setting" ? [row.key] : []));
	for (const key of Object.keys(hints)) {
		const schema = settingsSchema.map((spec) => {
			if (spec.key !== key) return spec;
			const { order, ...withoutOrder } = spec;
			assert.notEqual(order, undefined, key);
			return withoutOrder;
		});
		assert.notDeepEqual(order(settingRows(schema, options, [])), order(rows), key);
	}
	for (const group of settingGroups) {
		const unhinted = settingsSchema
			.filter(
				(spec) =>
					spec.group === group &&
					spec.control !== "none" &&
					spec.control !== "tagPalette" &&
					spec.order === undefined,
			)
			.map((spec) => spec.key);
		assert.deepEqual(
			order(rows).filter((key) => unhinted.includes(key)),
			unhinted,
			group,
		);
	}
});

test("each row carries the issue settingIssues finds for its key", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const data of [readFixture("0.0.4-array-palette.json"), JSON.stringify({ hideTags: "x", useTags: 1 })]) {
		const { plugin } = await startPlugin(data);
		t.after(() => plugin.unload());
		const issues = settingIssues(plugin.userOptions, settingsSchema);
		const rows = modelSettings(settingRows(settingsSchema, plugin.userOptions, issues));
		assert.ok(issues.length > 0);
		for (const row of rows)
			assert.deepEqual(
				row.issue,
				issues.find((issue) => issue.key === row.key),
				row.key,
			);
		for (const issue of issues)
			assert.deepEqual(rows.find((row) => row.key === issue.key)?.issue, issue, issue.key);
	}
});

test("the row model formats no values, so a draw that throws still throws in its row", () => {
	for (const broken of [{ tagColorPalette: null }, { excludeProperties: null }, { excludePaths: "Archive" }]) {
		const options = { ...defaultUserOptions, ...broken };
		assert.doesNotThrow(() => {
			const issues = settingIssues(options, settingsSchema);
			const rows = settingRows(settingsSchema, options, issues);
			assert.ok(rows.length > 0);
		});
	}
	const parents = new Set(["useQuickEntry", "useTags", "useIncludeTags", "useExcludeTags"]);
	const options = new Proxy(defaultUserOptions, {
		get(target, key) {
			assert.ok(typeof key === "string" && parents.has(key), `the row model read ${String(key)}`);
			return Reflect.get(target, key);
		},
	});
	assert.doesNotThrow(() => settingRows(settingsSchema, options, []));
});
