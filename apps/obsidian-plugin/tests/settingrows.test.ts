// Pin the generated tag lists, palette, visibility and in-place updates through the drawn tab.
import "./golden-clock";
import "./setup";

import { beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copy, propertyRulesCodec, settingIssues } from "@tasks-calendar-wrapper/core";
import { moment as obsidianMoment } from "obsidian";
import type momentFactory from "moment";

import { settingGroups, settingsSchema } from "../src/settings-schema";
import { settingRows, type SettingRow, type SettingRowOf } from "../src/settings/rows";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { FIXTURE_NAMES, markup, readFixture, rowsOf, startPlugin, type Row } from "./settings-fixtures";
import {
	ButtonComponent,
	ControlElement,
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

test("deleting each tag of each tag list deletes that tag and redraws its row", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const deletes = async (key: (typeof tagLists)[number], tags: string[], position: number, expected: string[]) => {
		const { plugin, tab, container } = await drawnTab(t, {
			useIncludeTags: true,
			useExcludeTags: true,
			[key]: tags,
		});
		const writes = t.mock.method(plugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		const row = settingNamed(container, copy.settings[key].name);
		const buttons = nestedButtons(row, "cross");
		assert.equal(buttons.length, tags.length, key);
		await buttons[position].click();
		await settle();
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments),
			[[{ [key]: expected }]],
			`${key}[${position}]`,
		);
		assert.equal(draws.mock.callCount(), 0, `${key}[${position}]`);
		assert.equal(settingNamed(container, copy.settings[key].name), row);
		assert.equal(nestedButtons(row, "cross").length, expected.length);
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

test("adding a tag a list already holds shows inline and writes nothing, in every tag list", async (t) => {
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
		assert.ok(
			markup(settingNamed(container, copy.settings[key].name).desc).includes(
				'<p class="tasks-calendar-wrapper-setting-warning">Tag #x already exists.</p>',
			),
			key,
		);
		assert.deepEqual(Notice.shown, [], key);
		assert.equal(Notice.instances.length, 0, key);
		assert.equal(writes.mock.callCount(), 0, key);
		assert.equal(draws.mock.callCount(), 0, key);
	}
});

test("adding a new tag appends it to the list saved now and redraws its row", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, tab, container } = await drawnTab(t, { hideTags: [] });
	await plugin.writeOptions({ hideTags: ["#late"] });
	const writes = t.mock.method(plugin, "writeOptions");
	const draws = t.mock.method(tab, "display");
	const row = settingNamed(container, copy.settings.hideTags.name);
	await saveDialog(t, addButton(row), "#new");
	assert.deepEqual(
		writes.mock.calls.map((call) => call.arguments),
		[[{ hideTags: ["#late", "#new"] }]],
	);
	assert.equal(draws.mock.callCount(), 0);
	assert.equal(settingNamed(container, copy.settings.hideTags.name), row);
	assert.equal(nestedButtons(row, "cross").length, 2);
});

test("editing a palette tag replaces it and adding one appends it, each redrawing its row", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, tab, container } = await drawnTab(t, {
		useTags: true,
		tagColorPalette: { "#TODO": "#ff0000", "#TEST": "#00ff00" },
	});
	const row = settingNamed(container, copy.settings.useTags.name);
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
		assert.equal(draws.mock.callCount(), 0);
		assert.equal(settingNamed(container, copy.settings.useTags.name), row);
		if (expected) assert.equal(nestedButtons(row, "cross").length, Object.keys(expected).length);
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

	const add = addButton(settingNamed(container, copy.settings.useTags.name));
	assert.equal(add.tooltip, "Add a palette");
	await saves(add, "#added", "#abcdef", { ...edited, "#added": "#abcdef" });

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
		const rows = rowsOf(container);
		for (const name of quickEntryRows) {
			const row = rows.find((row) => row.name === name);
			assert.ok(row, name);
			assert.equal(!row.hidden, Boolean(value), `${value}: ${name}`);
		}
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
		const snapshot = JSON.parse(readFixture(`tab/${name}`)).slice(1) as Row[];
		assert.deepEqual(
			rows.map((row) => (row.kind === "heading" ? row.name : row.texts.name)),
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

test("each row carries the spec flag for changes to what the tab shows", () => {
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

test("the palette has no row of its own and shows in the row of Use tags", () => {
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
		openViewOnStartup: 41.1,
		showWhatsNewOnUpdate: 41.2,
		useBuiltinStyle: 17.1,
		newestFirst: 17.2,
		useYearHeader: 17.3,
		filterEmpty: 43.5,
		includePaths: 3.5,
		excludeProperties: 5.5,
		dailyNoteFolder: 30.4,
		dailyNoteFormat: 30.5,
		sectionForNewTasks: 30.3,
		hideTags: 36.5,
		sort: 17.4,
		dateFormat: 17.5,
		inbox: 30.2,
		taskFiles: 30.1,
		defaultTodayFocus: 28.2,
		defaultFilters: 28.1,
		convert24HourTimePrefix: 17.6,
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

const allParentsOn = { useQuickEntry: true, useTags: true, useIncludeTags: true, useExcludeTags: true };
const wrongTypedOptions = { useTags: "yes", hideTags: "#later", sort: ["due-asc"] };
const issueInputs = () => [
	...FIXTURE_NAMES.map((name) => ({ name, data: readFixture(name) })),
	{ name: "wrong-typed options", data: JSON.stringify(wrongTypedOptions) },
];
const expectedTypeWords = {
	boolean: "true or false",
	string: "text",
	stringList: "a list of texts",
	stringMap: "a map of texts",
	stringListMap: "a map of lists of texts",
};
const warningParagraph = (message: string) => `<p class="tasks-calendar-wrapper-setting-warning">${message}</p>`;
const issueMessage = (issue: ReturnType<typeof settingIssues>[number]) =>
	`Saved value is ${issue.found}, expected ${expectedTypeWords[issue.expected]}. It is used as is.`;

async function undrawnTab(t: TestContext, data: string) {
	const { plugin } = await startPlugin(data);
	t.after(() => plugin.unload());
	const tab = plugin.settingTab;
	assert.ok(tab, "the plugin adds its settings tab");
	return { plugin, tab, container: tab.containerEl as unknown as FakeElement };
}

/** The broken tag list still throws; its warning and Reset must already have been drawn. */
function drawWithIssues({ plugin, tab }: Awaited<ReturnType<typeof undrawnTab>>) {
	if (typeof plugin.userOptions.hideTags === "string") {
		assert.throws(() => tab.display(), /forEach is not a function/);
	} else {
		tab.display();
	}
}

function resetButton(setting: Setting, label: string): ExtraButtonComponent {
	const buttons = extraButtons(setting, "reset");
	assert.equal(buttons.length, 1, `${label}: one Reset button`);
	assert.equal(buttons[0].tooltip, "Reset to default", label);
	return buttons[0];
}

function settingForIssue(container: FakeElement, key: string): Setting {
	const spec = settingsSchema.find((spec) => spec.key === (key === "tagColorPalette" ? "useTags" : key));
	assert.ok(spec?.copy, key);
	return settingNamed(container, copy.settings[spec.copy].name);
}

async function openDialog(t: TestContext, button: ExtraButtonComponent) {
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
	const buttonNamed = (tooltip: string) => {
		const button = settingsIn(footer)[0].components.find(
			(component) => component instanceof ButtonComponent && component.tooltip === tooltip,
		);
		assert.ok(button instanceof ButtonComponent, tooltip);
		return button;
	};
	return { modal, setting, save: buttonNamed("Save"), cancel: buttonNamed("Cancel") };
}

function paletteContainer(setting: Setting): FakeElement {
	const element = setting.controlEl.children.find(
		(child) => child instanceof FakeElement && !(child instanceof ControlElement),
	);
	assert.ok(element instanceof FakeElement, "the palette has its own container");
	return element;
}

test("every data.json shape with a value of the wrong type shows the warning and Reset in that row", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const { name, data } of issueInputs()) {
		const context = await undrawnTab(t, data);
		const { plugin, container } = context;
		const issues = settingIssues(plugin.userOptions, settingsSchema);
		drawWithIssues(context);
		for (const issue of issues) {
			const setting = settingForIssue(container, issue.key);
			const message = issueMessage(issue);
			assert.ok(markup(setting.desc).includes(warningParagraph(message)), `${name}: ${issue.key}: ${message}`);
			const reset = resetButton(setting, `${name}: ${issue.key}`);
			assert.equal(setting.components[0], reset, `${issue.key}: Reset precedes the control`);
		}
		const rows = settingsIn(container);
		assert.equal(
			rows.reduce((count, setting) => count + extraButtons(setting, "reset").length, 0),
			issues.length,
			`${name}: Reset buttons correspond exactly to issues`,
		);
		assert.equal(
			rows.reduce((count, setting) => count + (markup(setting.desc).match(/Saved value is /g)?.length ?? 0), 0),
			issues.length,
			`${name}: warnings correspond exactly to issues`,
		);
	}
});

test("Reset writes the default and nothing else", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const { name, data } of issueInputs()) {
		const original = await undrawnTab(t, data);
		for (const issue of settingIssues(original.plugin.userOptions, settingsSchema)) {
			const context = await undrawnTab(t, data);
			const { plugin, tab, container } = context;
			drawWithIssues(context);
			const setting = settingForIssue(container, issue.key);
			const reset = resetButton(setting, `${name}: ${issue.key}`);
			const key = settingsSchema.find((spec) => spec.key === issue.key)?.key;
			assert.ok(key, issue.key);
			const update = { [key]: defaultUserOptions[key] };
			await plugin.writeOptions({ dailyNoteFolder: "Changed after drawing" });
			const before = plugin.userOptions;
			const baseline = await undrawnTab(t, data);
			await baseline.plugin.writeOptions({ dailyNoteFolder: "Changed after drawing" });
			await baseline.plugin.writeOptions(update);
			const writes = t.mock.method(plugin, "writeOptions");
			const draws = t.mock.method(tab, "display");
			await reset.click();
			await settle();
			assert.deepEqual(
				writes.mock.calls.map((call) => call.arguments),
				[[update]],
				`${name}: ${key}`,
			);
			assert.deepEqual(plugin.userOptions, { ...before, ...update }, `${key}: all other options survive`);
			assert.equal(plugin.dataJson, baseline.plugin.dataJson, `${key}: unchanged serialization`);
			assert.equal(draws.mock.callCount(), 0, `${key}: no whole-tab redraw`);
			assert.equal(settingForIssue(container, key), setting, `${key}: the same Setting is refreshed`);
			assert.equal(markup(setting.desc).includes(issueMessage(issue)), false, `${key}: warning removed`);
			assert.equal(extraButtons(setting, "reset").length, 0, `${key}: Reset removed`);
		}
	}
});

test("Reset is the only write", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const { name, data } of [...issueInputs(), { name: "all dialogs", data: JSON.stringify(allParentsOn) }]) {
		const context = await undrawnTab(t, data);
		const { plugin, container } = context;
		const before = plugin.dataJson;
		const writes = t.mock.method(plugin, "writeOptions");
		drawWithIssues(context);
		drawWithIssues(context);
		const buttons = settingsIn(container).flatMap((setting) => [
			...extraButtons(setting, "plus-with-circle"),
			...setting.controlEl.children.flatMap((child) =>
				child instanceof FakeElement ? settingsIn(child).flatMap((line) => extraButtons(line, "pencil")) : [],
			),
		]);
		for (const button of buttons) {
			const { setting, cancel } = await openDialog(t, button);
			await valueControl(setting, "text").change("#cancelled");
			await cancel.click();
			await settle();
			assert.equal(writes.mock.callCount(), 0, `${name}: cancelling a dialog writes nothing`);
			assert.equal(plugin.dataJson, before, `${name}: cancelling preserves data.json bytes`);
		}
		assert.equal(writes.mock.callCount(), 0, `${name}: drawing descriptions and controls writes nothing`);
		assert.equal(plugin.dataJson, before, `${name}: repeated display preserves data.json bytes`);
	}
	const context = await undrawnTab(t, readFixture("0.0.4-array-palette.json"));
	drawWithIssues(context);
	const writes = t.mock.method(context.plugin, "writeOptions");
	const reset = resetButton(settingForIssue(context.container, "tagColorPalette"), "issue UI writes only on Reset");
	assert.equal(writes.mock.callCount(), 0, "finding Reset does not write");
	await reset.click();
	await settle();
	assert.deepEqual(
		writes.mock.calls.map((call) => call.arguments),
		[[{ tagColorPalette: defaultUserOptions.tagColorPalette }]],
	);
});

test("typing in a text field keeps focus (display is not re-run)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { tab, container } = await drawnTab(t, allParentsOn);
	const draws = t.mock.method(tab, "display");
	const originalRows = settingsIn(container);
	for (const spec of settingsSchema.filter((spec) => ["text", "textArea", "momentFormat"].includes(spec.control))) {
		assert.ok(spec.copy);
		const setting = settingNamed(container, copy.settings[spec.copy].name);
		const type =
			spec.control === "textArea" ? "textarea" : spec.control === "momentFormat" ? "moment-format" : "text";
		const control = valueControl(setting, type);
		control.el.focus();
		for (const input of ["", "YYYY", "DD.MM."]) {
			await control.change(input);
			assert.equal(draws.mock.callCount(), 0, `${spec.key}: typing does not display`);
			assert.equal(settingNamed(container, copy.settings[spec.copy].name), setting, `${spec.key}: same row`);
			assert.equal(valueControl(setting, type), control, `${spec.key}: same control`);
			assert.equal(control.el.focused, true, `${spec.key}: input keeps focus`);
		}
	}
	const dependents = {
		useQuickEntry: ["taskFiles", "inbox", "sectionForNewTasks"],
		useIncludeTags: ["taskIncludeTags", "fileIncludeTags"],
		useExcludeTags: ["taskExcludeTags", "fileExcludeTags"],
		useTags: [],
	} as const;
	const paletteRow = settingNamed(container, copy.settings.useTags.name);
	const palette = paletteContainer(paletteRow);
	const paletteAdd = addButton(paletteRow);
	for (const parent of Object.keys(dependents) as (keyof typeof dependents)[]) {
		for (const enabled of [false, true]) {
			await valueControl(settingNamed(container, copy.settings[parent].name), "toggle").change(enabled);
			assert.equal(draws.mock.callCount(), 0, `${parent}: toggling visibility does not display`);
			const rows = settingsIn(container);
			assert.equal(rows.length, originalRows.length, `${parent}: hidden rows remain drawn`);
			for (let index = 0; index < rows.length; index++) {
				const setting = rows[index];
				assert.equal(setting, originalRows[index], `${parent}: row identity at ${index}`);
				const dependentNames: readonly string[] = dependents[parent].map((key) => copy.settings[key].name);
				assert.equal(
					Reflect.get(setting.settingEl, "hidden"),
					!enabled && dependentNames.includes(markup(setting.name)),
					`${parent}: hidden for ${markup(setting.name)}`,
				);
			}
			assert.equal(Reflect.get(palette, "hidden"), parent === "useTags" && !enabled, "palette visibility");
			assert.equal(
				Reflect.get(paletteAdd.el, "hidden"),
				parent === "useTags" && !enabled,
				"palette add visibility",
			);
		}
	}
});

test("a duplicate tag shows inline and writes nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const key of tagLists) {
		const { plugin, tab, container } = await drawnTab(t, { ...allParentsOn, [key]: ["#x"] });
		const setting = settingNamed(container, copy.settings[key].name);
		const before = plugin.dataJson;
		const writes = t.mock.method(plugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		await saveDialog(t, addButton(setting), "#x");
		assert.ok(
			markup(setting.desc).includes(warningParagraph("Tag #x already exists.")),
			`${key}: duplicate tag is inline`,
		);
		assert.deepEqual(Notice.shown, [], key);
		assert.equal(writes.mock.callCount(), 0, key);
		assert.equal(draws.mock.callCount(), 0, key);
		assert.equal(plugin.dataJson, before, key);
	}
});

test("the moment preview follows the input", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const moment = obsidianMoment as unknown as typeof momentFactory;
	const { plugin, tab, container } = await drawnTab(t, {});
	const draws = t.mock.method(tab, "display");
	for (const key of ["dailyNoteFormat", "dateFormat"] as const) {
		const setting = settingNamed(container, copy.settings[key].name);
		const preview = (format: string) => `Today in this format: ${moment().format(format)}`;
		assert.ok(
			markup(setting.desc).includes(preview(plugin.userOptions[key])),
			`${key}: preview of the saved format`,
		);
		const control = valueControl(setting, "moment-format");
		for (const input of ["YYYY", "DD.MM."]) {
			const originalWrite = plugin.writeOptions.bind(plugin);
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const writes = t.mock.method(plugin, "writeOptions", async (update: Partial<UserOption>) => {
				await gate;
				await originalWrite(update);
			});
			const changed = control.change(input);
			try {
				assert.ok(
					markup(setting.desc).includes(preview(input)),
					`${key}: preview updates before saving ${input}`,
				);
			} finally {
				release();
				await changed;
				writes.mock.restore();
			}
			assert.ok(markup(setting.desc).includes(preview(input)), `${key}: preview after saving ${input}`);
			assert.equal(draws.mock.callCount(), 0, key);
		}
	}
});

// Brief-derived layout, visibility and inline-feedback checks.
test("the rows sit in the four approved groups, in the approved order", () => {
	const rows = settingRows(settingsSchema, { ...defaultUserOptions, ...allParentsOn }, []);
	const expected: readonly ["sources" | "display" | "newTasks" | "advanced", string][] = [
		["sources", "includePaths"],
		["sources", "excludePaths"],
		["sources", "excludeProperties"],
		["sources", "useIncludeTags"],
		["sources", "taskIncludeTags"],
		["sources", "fileIncludeTags"],
		["sources", "useExcludeTags"],
		["sources", "taskExcludeTags"],
		["sources", "fileExcludeTags"],
		["sources", "hideStatusTasks"],
		["sources", "hideSubTasks"],
		["sources", "filterEmpty"],
		["display", "useBuiltinStyle"],
		["display", "newestFirst"],
		["display", "useYearHeader"],
		["display", "sort"],
		["display", "dateFormat"],
		["display", "convert24HourTimePrefix"],
		["display", "forward"],
		["display", "forwardPastStartAndScheduled"],
		["display", "forwardUndatedDone"],
		["display", "useCounters"],
		["display", "counterBehavior"],
		["display", "defaultFilters"],
		["display", "defaultTodayFocus"],
		["display", "useRelative"],
		["display", "useRecurrence"],
		["display", "usePriority"],
		["display", "useTags"],
		["display", "hideTags"],
		["display", "useFileBadge"],
		["display", "useSection"],
		["display", "useModifyBadge"],
		["newTasks", "useQuickEntry"],
		["newTasks", "entryPosition"],
		["newTasks", "taskFiles"],
		["newTasks", "inbox"],
		["newTasks", "sectionForNewTasks"],
		["newTasks", "dailyNoteFolder"],
		["newTasks", "dailyNoteFormat"],
		["advanced", "openNoteInsteadOfInPlace"],
		["advanced", "newDateStyle"],
		["advanced", "openViewOnStartup"],
		["advanced", "showWhatsNewOnUpdate"],
	];
	assert.deepEqual(
		rows.flatMap((row) => (row.kind === "setting" ? [[row.spec.group, row.key]] : [])),
		expected,
		"the 44 (group, key) pairs match the approved table",
	);
	assert.deepEqual(
		rows.flatMap((row) => (row.kind === "heading" ? [row.name] : [])),
		["Sources", "Display", "New tasks", "Advanced"],
	);
});

test("each setting read when a timeline opens or Obsidian starts says so in its description", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { container } = await drawnTab(t, allParentsOn);
	const sentences = { viewOpen: "Applies when a timeline opens.", pluginLoad: "Applies when Obsidian starts." };
	const described: string[] = [];
	for (const spec of settingsSchema) {
		if (spec.control === "none" || spec.control === "tagPalette") continue;
		assert.ok(spec.copy);
		const description = markup(settingNamed(container, copy.settings[spec.copy].name).desc);
		if (spec.readWhen === "viewOpen" || spec.readWhen === "pluginLoad") {
			assert.ok(description.endsWith(sentences[spec.readWhen]), `${spec.key}: ${sentences[spec.readWhen]}`);
			described.push(spec.key);
		} else {
			for (const sentence of Object.values(sentences))
				assert.equal(description.includes(sentence), false, spec.key);
		}
	}
	assert.deepEqual(described.sort(), [
		"defaultFilters",
		"defaultTodayFocus",
		"openViewOnStartup",
		"showWhatsNewOnUpdate",
	]);
});

test("a hidden row draws no value, so a broken value in it throws nowhere until it shows", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const context = await undrawnTab(t, JSON.stringify({ useIncludeTags: false, taskIncludeTags: "x" }));
	const { plugin, tab, container } = context;
	assert.doesNotThrow(() => tab.display());
	const setting = settingNamed(container, copy.settings.taskIncludeTags.name);
	assert.equal(Reflect.get(setting.settingEl, "hidden"), true, "the broken tag-list row starts hidden");
	assert.equal(
		setting.components.some((component) => component instanceof SettingControl),
		false,
		"a hidden row draws no value control",
	);
	const originalRows = settingsIn(container);
	const draws = t.mock.method(tab, "display");
	await assert.rejects(
		async () => valueControl(settingNamed(container, copy.settings.useIncludeTags.name), "toggle").change(true),
		/forEach is not a function/,
	);
	assert.equal(draws.mock.callCount(), 0, "showing the broken row does not redraw other rows");
	assert.equal(Reflect.get(setting.settingEl, "hidden"), false, "the broken row is now visible");
	const issue = settingIssues(plugin.userOptions, settingsSchema).find((issue) => issue.key === "taskIncludeTags");
	assert.ok(issue);
	assert.ok(
		markup(setting.desc).includes(warningParagraph(issueMessage(issue))),
		"warning survives the control's throw",
	);
	assert.equal(setting.components[0], resetButton(setting, "taskIncludeTags"), "Reset precedes the throwing control");
	const rows = settingsIn(container);
	assert.equal(rows.length, originalRows.length);
	for (let index = 0; index < rows.length; index++) assert.equal(rows[index], originalRows[index]);
});

test("the property rules box lists the lines it skips while typing, and saves as before", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, tab, container } = await drawnTab(t, {});
	const setting = settingNamed(container, copy.settings.excludeProperties.name);
	const control = valueControl(setting, "textarea");
	const writes = t.mock.method(plugin, "writeOptions");
	const draws = t.mock.method(tab, "display");
	const text = "status: archived\nnocolon\n: x\nkey:";
	await control.change(text);
	for (const line of [2, 3, 4]) {
		const message = `Line ${line} is skipped: it needs a property, a colon and a value.`;
		assert.ok(markup(setting.desc).includes(warningParagraph(message)), message);
	}
	assert.equal((markup(setting.desc).match(/ is skipped:/g) ?? []).length, 3);
	assert.deepEqual(
		writes.mock.calls.map((call) => call.arguments),
		[[{ excludeProperties: propertyRulesCodec.parse(text) }]],
	);
	assert.deepEqual(plugin.userOptions.excludeProperties, propertyRulesCodec.parse(text));
	await control.change("status: done\n\n");
	assert.equal(markup(setting.desc).includes(" is skipped:"), false, "valid text clears the problems");
	assert.equal(writes.mock.callCount(), 2, "messages add no writes");
	assert.equal(draws.mock.callCount(), 0);
	assert.equal(valueControl(setting, "textarea"), control);
});

test("an invalid tag in a tag list shows inline under the list and writes nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const key of tagLists) {
		const { plugin, tab, container } = await drawnTab(t, allParentsOn);
		const setting = settingNamed(container, copy.settings[key].name);
		const before = plugin.dataJson;
		const writes = t.mock.method(plugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		await saveDialog(t, addButton(setting), "nohash");
		assert.ok(
			markup(setting.desc).includes(warningParagraph("nohash seems not a valid tag.")),
			`${key}: invalid tag is inline`,
		);
		assert.deepEqual(Notice.shown, [], key);
		assert.equal(writes.mock.callCount(), 0, key);
		assert.equal(draws.mock.callCount(), 0, key);
		assert.equal(plugin.dataJson, before, key);
	}
});

test("an invalid palette tag shows inline in its dialog, which stays open", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, tab, container } = await drawnTab(t, { useTags: true, tagColorPalette: { "#x": "#123456" } });
	const palette = settingNamed(container, copy.settings.useTags.name);
	const writes = t.mock.method(plugin, "writeOptions");
	const draws = t.mock.method(tab, "display");
	const before = plugin.dataJson;
	for (const button of [addButton(palette), ...nestedButtons(palette, "pencil")]) {
		const { modal, setting, save, cancel } = await openDialog(t, button);
		const closed = t.mock.method(modal, "close");
		await valueControl(setting, "text").change("nohash");
		await valueControl(setting, "color").change("#123456");
		await save.click();
		assert.ok(
			markup(setting.desc).includes(warningParagraph("nohash seems not a valid tag.")),
			"the palette dialog shows the invalid tag inline",
		);
		assert.equal(closed.mock.callCount(), 0, "the palette dialog stays open");
		assert.deepEqual(Notice.shown, []);
		assert.equal(writes.mock.callCount(), 0);
		assert.equal(draws.mock.callCount(), 0);
		assert.equal(plugin.dataJson, before);
		await cancel.click();
		assert.equal(closed.mock.callCount(), 1, "Cancel still closes the dialog");
	}
});

test("a Reset whose save fails says so, as the tab's other saves do", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin, container } = await drawnTab(t, { useTags: "yes" });
	const reset = resetButton(settingForIssue(container, "useTags"), "useTags");
	t.mock.method(plugin, "saveData", async () => {
		throw new Error("disk full");
	});
	const logged = t.mock.method(console, "error", () => {});
	await reset.click();
	await settle();
	assert.deepEqual(Notice.shown, [copy.settings.tab.saveFailed]);
	assert.equal(logged.mock.callCount(), 1);
});

test("the palette dialog's invalid-tag message clears once the tag is edited", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { container } = await drawnTab(t, { useTags: true, tagColorPalette: { "#x": "#123456" } });
	const palette = settingNamed(container, copy.settings.useTags.name);
	const { setting, save } = await openDialog(t, addButton(palette));
	await valueControl(setting, "text").change("nohash");
	await save.click();
	assert.ok(markup(setting.desc).includes(warningParagraph("nohash seems not a valid tag.")));
	await valueControl(setting, "text").change("#fixed");
	assert.equal(markup(setting.desc), markup(copy.settings.tagColorPalette.desc));
});

test("the add button of each tag list says Add a tag", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { container } = await drawnTab(t, allParentsOn);
	for (const key of tagLists) {
		assert.equal(
			addButton(settingNamed(container, copy.settings[key].name)).tooltip,
			"Add a tag",
			`${key}: add tooltip`,
		);
	}
});
