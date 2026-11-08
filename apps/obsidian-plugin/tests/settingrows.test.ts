// Pin today's tag lists, palette and visibility through the drawn tab for the phase 4 step 13 generator.
// These tests must stay green, unchanged.
import "./golden-clock";
import "./setup";

import { beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copy } from "@tasks-calendar-wrapper/core";

import { rowsOf, startPlugin } from "./settings-fixtures";
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
