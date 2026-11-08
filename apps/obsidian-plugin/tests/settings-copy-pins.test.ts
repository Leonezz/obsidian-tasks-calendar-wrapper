// Pin verbatim settings-tab texts no snapshot pins, so the move into copy.settings (phase 4 step 12)
// is checked byte for byte. These tests must stay green, unchanged.
import "./golden-clock";
import "./setup";

import { beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { rowsOf, startPlugin } from "./settings-fixtures";
import {
	ButtonComponent,
	DropdownComponent,
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

async function drawnTab(t: TestContext, options: object = {}) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin(
		JSON.stringify({ useCounters: true, useQuickEntry: true, useTags: true, ...options }),
	);
	t.after(() => plugin.unload());
	const tab = plugin.settingTab;
	assert.ok(tab, "the plugin adds its settings tab");
	tab.display();
	return { plugin, container: tab.containerEl as unknown as FakeElement };
}

function settingsIn(container: FakeElement): Setting[] {
	return container.children.flatMap((child) => (child instanceof SettingItemElement ? [child.setting] : []));
}

function settingNamed(container: FakeElement, name: string): Setting {
	const setting = settingsIn(container).find((setting) => setting.name === name);
	assert.ok(setting, name);
	return setting;
}

function valueControl(setting: Setting, type: string): SettingControl {
	const control = setting.components.find(
		(component) => component instanceof SettingControl && component.type === type,
	);
	assert.ok(control instanceof SettingControl, type);
	return control;
}

/** Opens the real dialog through the tab; the spy keeps the instance and still calls open. */
async function openDialog(t: TestContext, container: FakeElement, row: "Use Tags" | "Hide Tags") {
	const add = settingNamed(container, row).components.find(
		(component) =>
			component instanceof ExtraButtonComponent &&
			(row === "Use Tags" ? component.tooltip === "Add a palette" : component.icon === "plus-with-circle"),
	);
	assert.ok(add instanceof ExtraButtonComponent);
	const opened = t.mock.method(Modal.prototype, "open");
	await add.click();
	assert.equal(opened.mock.callCount(), 1);
	const modal = opened.mock.calls[0].this;
	assert.ok(modal instanceof Modal);
	t.after(() => modal.close());
	const [input, footer] = modal.contentEl.children;
	assert.ok(input instanceof FakeElement);
	assert.ok(footer instanceof FakeElement);
	const setting = settingsIn(input)[0];
	assert.ok(setting);
	const buttons = settingsIn(footer)[0].components.filter(
		(component): component is ButtonComponent => component instanceof ButtonComponent,
	);
	assert.equal(buttons.length, 2);
	return { input, setting, buttons };
}

function assertNotice(expected: string): void {
	assert.deepEqual(Notice.shown, [expected]);
	assert.equal(Notice.instances.length, 1);
	assert.equal(Notice.instances[0].duration, 5000);
}

test("the five settings dropdowns pin every option value and label in order", async (t) => {
	const { container } = await drawnTab(t);
	const expected = {
		"Behavior of Counters and Filters Panel": { Filter: "Filter", Focus: "Focus" },
		"Quick Entry Panel Position": { today: "today", top: "top", bottom: "bottom" },
		"Activate Filter On Load": {
			"": "No filters",
			todoFilter: "todo",
			overdueFilter: "overdue",
			unplannedFilter: "unplanned",
		},
		"Style for new dates": {
			emoji: "Emoji (📅 2026-10-25)",
			dataview: "Dataview fields ([due:: 2026-10-25])",
		},
		"Sort By": {
			"status-asc": "status (ascending)",
			"status-desc": "status (descending)",
			"text-asc": "text (ascending)",
			"text-desc": "text (descending)",
			"start-asc": "start time (ascending)",
			"start-desc": "start time (descending)",
			"due-asc": "due time (ascending)",
			"due-desc": "due time (descending)",
			"priority-desc": "priority (highest first)",
			"priority-asc": "priority (lowest first)",
			"tags-asc": "tags (ascending)",
			"tags-desc": "tags (descending)",
		},
	};
	for (const [name, options] of Object.entries(expected)) {
		const dropdown = valueControl(settingNamed(container, name), "dropdown");
		assert.ok(dropdown instanceof DropdownComponent);
		assert.deepEqual(Object.entries(dropdown.options), Object.entries(options), name);
	}
});

test("the tag colour palette dialog pins its name, description and Save and Cancel tooltips", async (t) => {
	const { container } = await drawnTab(t);
	const { input, buttons } = await openDialog(t, container, "Use Tags");
	const [row] = rowsOf(input);
	assert.equal(row.name, "Tag and color");
	assert.equal(row.desc, "Enter tag text (# included) in the text input and select color in the color selector.");
	assert.deepEqual(
		buttons.map((button) => button.tooltip),
		["Save", "Cancel"],
	);
});

test("the tag dialog pins its name, description and Save and Cancel tooltips", async (t) => {
	const { container } = await drawnTab(t);
	const { input, buttons } = await openDialog(t, container, "Hide Tags");
	const [row] = rowsOf(input);
	assert.equal(row.name, "Tag");
	assert.equal(row.desc, "Enter tag text (# included) in the text input and select color in the color selector.");
	assert.deepEqual(
		buttons.map((button) => button.tooltip),
		["Save", "Cancel"],
	);
});

test("adding a duplicate hidden tag pins the notice text and its five second duration", async (t) => {
	const { container } = await drawnTab(t, { hideTags: ["#existing"] });
	const { setting, buttons } = await openDialog(t, container, "Hide Tags");
	await valueControl(setting, "text").change("#existing");
	await buttons[0].click();
	await settle();
	assertNotice("Tag #existing already exists.");
});

test("an invalid palette tag pins the notice text and its five second duration", async (t) => {
	const { container } = await drawnTab(t);
	const { setting, buttons } = await openDialog(t, container, "Use Tags");
	await valueControl(setting, "text").change("invalid");
	await buttons[0].click();
	assertNotice("invalid seems not a valid tag.");
});

test("an invalid tag in the tag dialog pins the notice text and its five second duration", async (t) => {
	const { container } = await drawnTab(t);
	const { setting, buttons } = await openDialog(t, container, "Hide Tags");
	await valueControl(setting, "text").change("invalid");
	await buttons[0].click();
	assertNotice("invalid seems not a valid tag.");
});

test("an empty palette colour pins the notice text and its five second duration", async (t) => {
	const { container } = await drawnTab(t);
	const { setting, buttons } = await openDialog(t, container, "Use Tags");
	await valueControl(setting, "text").change("#new-tag");
	await buttons[0].click();
	assertNotice("The color seems to be empty, maybe you forget to click the color picker.");
});

test("a failed settings save pins the notice text and its five second duration", async (t) => {
	t.mock.method(console, "error", () => {});
	const { plugin, container } = await drawnTab(t, { hideTags: [] });
	t.mock.method(plugin, "saveData", async () => {
		throw new Error("disk full");
	});
	const { setting, buttons } = await openDialog(t, container, "Hide Tags");
	await valueControl(setting, "text").change("#new-tag");
	await buttons[0].click();
	await settle();
	assertNotice("Failed to save the timeline settings. See the developer console for details.");
});
