import "./golden-clock";
import "./setup";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copy } from "@tasks-calendar-wrapper/core";
import { TagModal } from "../src/settings/modals";
import { isSingleTag, SettingsTagSuggest } from "../src/settings/tags";
import { markup, startPlugin } from "./settings-fixtures";
import {
	AbstractInputSuggest,
	ButtonComponent,
	ExtraButtonComponent,
	FakeElement,
	Modal,
	SettingControl,
	SettingItemElement,
	type Setting,
} from "./stubs/obsidian";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function settingsIn(container: FakeElement): Setting[] {
	return container.children.flatMap((child) => (child instanceof SettingItemElement ? [child.setting] : []));
}
function named(container: FakeElement, name: string): Setting {
	const setting = settingsIn(container).find((row) => markup(row.name) === name);
	assert.ok(setting, name);
	return setting;
}
function control(row: Setting, type = "text"): SettingControl {
	const found = row.components.find((item) => item instanceof SettingControl && item.type === type);
	assert.ok(found instanceof SettingControl);
	return found;
}
function button(row: Setting, tooltip: string): ButtonComponent {
	const found = row.components.find((item) => item instanceof ButtonComponent && item.tooltip === tooltip);
	assert.ok(found instanceof ButtonComponent);
	return found;
}
async function drawn(t: TestContext, options: object = {}) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const context = await startPlugin(JSON.stringify({ useQuickEntry: true, useTags: true, ...options }));
	t.after(() => context.plugin.unload());
	const tab = context.plugin.settingTab;
	assert.ok(tab);
	tab.display();
	return { ...context, tab, container: tab.containerEl as unknown as FakeElement };
}
async function paletteDialog(t: TestContext, container: FakeElement, edit?: number) {
	const row = named(container, copy.settings.useTags.name);
	const add = row.components.find((item) => item instanceof ExtraButtonComponent && item.icon === "plus-with-circle");
	assert.ok(add instanceof ExtraButtonComponent);
	const palette = row.controlEl.children.find(
		(child) => child instanceof FakeElement && child.cls.includes("tcw-settings-palette"),
	);
	assert.ok(palette instanceof FakeElement);
	const editButtons = settingsIn(palette).flatMap((chip) =>
		chip.components.filter(
			(item): item is ExtraButtonComponent => item instanceof ExtraButtonComponent && item.icon === "pencil",
		),
	);
	const opened = t.mock.method(Modal.prototype, "open");
	await (edit === undefined ? add : editButtons[edit]).click();
	const modal = opened.mock.calls[0]?.this;
	assert.ok(modal instanceof Modal);
	opened.mock.restore();
	t.after(() => modal.close());
	const [input, footer] = modal.contentEl.children;
	assert.ok(input instanceof FakeElement && footer instanceof FakeElement);
	const setting = settingsIn(input)[0];
	return { modal, setting, save: button(settingsIn(footer)[0], "Save") };
}

test("single tag validation rejects partial, empty and multi-tag inputs without regex state", () => {
	for (let pass = 0; pass < 3; pass++) {
		for (const tag of ["#", "abc #home", "#home #work", "#home!", "#home\n", "", "home", "#one,#two"])
			assert.equal(isSingleTag(tag), false, tag);
		for (const tag of ["#home", "#work/project", "#日本語/标签", "#Q1-2026", "#with_underscore"])
			assert.equal(isSingleTag(tag), true, tag);
	}
});

test("tag dialog keeps invalid and duplicate drafts open, then awaits a valid save", async (t) => {
	const { plugin } = await drawn(t);
	let release = () => {};
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const writes: string[] = [];
	const modal = new TagModal(plugin, async (tag) => {
		if (tag === "#existing") return copy.settings.tab.tagExists({ tag });
		writes.push(tag);
		await waiting;
	});
	modal.open();
	t.after(() => modal.close());
	const closed = t.mock.method(modal, "close");
	const [input, footer] = modal.contentEl.children;
	assert.ok(input instanceof FakeElement && footer instanceof FakeElement);
	const row = settingsIn(input)[0];
	const save = button(settingsIn(footer)[0], "Save");
	assert.equal(markup(row.desc).includes("color"), false);
	for (const tag of ["#", "abc #home", "#home #work", "#home!", "#existing"]) {
		await control(row).change(tag);
		await save.click();
		assert.equal(closed.mock.callCount(), 0, tag);
		assert.equal(control(row).value, tag);
		assert.ok(markup(row.desc).includes("tasks-calendar-wrapper-setting-warning"));
	}
	await control(row).change("#valid");
	const saving = save.click();
	assert.equal(closed.mock.callCount(), 0, "persistence still pending");
	assert.equal(save.disabled, true);
	release();
	await saving;
	assert.deepEqual(writes, ["#valid"]);
	assert.equal(closed.mock.callCount(), 1);
});

test("inline tag entry validates batches atomically, deduplicates and keeps later drafts during save", async (t) => {
	const { plugin, container } = await drawn(t, { hideTags: ["#existing"] });
	const row = named(container, copy.settings.hideTags.name);
	const text = control(row);
	const add = button(row, copy.settings.tab.addTagTooltip);
	const writes = t.mock.method(plugin, "writeOptions");
	await text.change("#valid, bad #tag");
	await add.click();
	assert.equal(writes.mock.callCount(), 0, "invalid batch writes no subset");
	assert.equal(text.value, "#valid, bad #tag");
	const original = plugin.saveData.bind(plugin);
	let release = () => {};
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	t.mock.method(plugin, "saveData", async (data: unknown) => {
		await waiting;
		await original(data);
	});
	await text.change("#existing, #new\n#new, #日本語/标签");
	const saving = add.click();
	await text.change("#later");
	release();
	await saving;
	assert.deepEqual(plugin.userOptions.hideTags, ["#existing", "#new", "#日本語/标签"]);
	assert.equal(control(row), text, "same input survives");
	assert.equal(text.value, "#later", "later text survives");
	await add.click();
	assert.deepEqual(plugin.userOptions.hideTags, ["#existing", "#new", "#日本語/标签", "#later"]);
	assert.equal(text.value, "");
});

test("inline tag entry can retry its optimistic failed write", async (t) => {
	const { plugin, container } = await drawn(t, { hideTags: [] });
	const row = named(container, copy.settings.hideTags.name);
	const text = control(row);
	const add = button(row, copy.settings.tab.addTagTooltip);
	const original = plugin.saveData.bind(plugin);
	let fail = true;
	t.mock.method(console, "error", () => {});
	t.mock.method(plugin, "saveData", async (data: unknown) => {
		if (fail) throw new Error("full");
		await original(data);
	});
	await text.change("#retry");
	await add.click();
	assert.equal(text.value, "#retry");
	assert.deepEqual(plugin.userOptions.hideTags, ["#retry"], "store is optimistic");
	fail = false;
	await add.click();
	assert.equal(text.value, "");
	assert.deepEqual(JSON.parse(plugin.dataJson ?? "{}").hideTags, ["#retry"]);
});

test("raw multiline tag paste preserves all tags and selection, validates atomically and respects composition", async (t) => {
	const { plugin, container } = await drawn(t, { hideTags: [] });
	const row = named(container, copy.settings.hideTags.name);
	const input = control(row);
	const paste = (raw: string) => {
		const event = Object.assign(new Event("paste", { cancelable: true }), {
			clipboardData: { getData: () => raw },
		});
		input.el.dispatchEvent(event);
		return event;
	};
	const first = paste("#one\n#two");
	await settle();
	assert.equal(first.defaultPrevented, true);
	assert.deepEqual(plugin.userOptions.hideTags, ["#one", "#two"]);
	await input.change("#prefix, #old");
	Object.assign(input.el, { selectionStart: 9, selectionEnd: 13 });
	paste("#a\r\n#b");
	await settle();
	assert.deepEqual(plugin.userOptions.hideTags, ["#one", "#two", "#prefix", "#a", "#b"]);
	Object.assign(input.el, { selectionStart: 0, selectionEnd: 0 });
	paste("#valid\ninvalid");
	await settle();
	assert.equal(plugin.userOptions.hideTags.includes("#valid"), false, "invalid batch saves no subset");
	assert.equal(input.el.value, "#valid,invalid");
	await input.change("");
	input.el.dispatchEvent(new Event("compositionstart"));
	paste("#later\n#next");
	await settle();
	assert.equal(plugin.userOptions.hideTags.includes("#later"), false);
	const composing = Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", isComposing: true });
	input.el.dispatchEvent(composing);
	await settle();
	assert.equal(plugin.userOptions.hideTags.includes("#later"), false);
	input.el.dispatchEvent(new Event("compositionend"));
	input.el.dispatchEvent(
		Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", isComposing: false }),
	);
	await settle();
	assert.deepEqual(plugin.userOptions.hideTags, ["#one", "#two", "#prefix", "#a", "#b", "#later", "#next"]);
});

test("palette disables delete, edit and add during a held save so a second click cannot resurrect a removed tag", async (t) => {
	const { plugin, container } = await drawn(t, { tagColorPalette: { "#a": "#111111", "#b": "#222222" } });
	const row = named(container, copy.settings.useTags.name);
	const palette = row.controlEl.children.find(
		(child) => child instanceof FakeElement && child.cls.includes("tcw-settings-palette"),
	);
	assert.ok(palette instanceof FakeElement);
	const actions = settingsIn(palette).flatMap((chip) =>
		chip.components.filter((item): item is ExtraButtonComponent => item instanceof ExtraButtonComponent),
	);
	const removes = actions.filter((item) => item.icon === "cross");
	const add = row.components.find((item) => item instanceof ExtraButtonComponent && item.icon === "plus-with-circle");
	assert.ok(add instanceof ExtraButtonComponent);
	const original = plugin.saveData.bind(plugin);
	let release = () => {};
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	t.mock.method(plugin, "saveData", async (data: unknown) => {
		await waiting;
		await original(data);
	});
	const opened = t.mock.method(Modal.prototype, "open");
	const deleting = removes[0].click();
	assert.ok(actions.every((item) => item.disabled));
	assert.equal(add.disabled, true);
	await removes[1].click();
	await add.click();
	for (const edit of actions.filter((item) => item.icon === "pencil")) await edit.click();
	assert.equal(opened.mock.callCount(), 0);
	release();
	await deleting;
	assert.deepEqual(plugin.userOptions.tagColorPalette, { "#b": "#222222" });
	const nextPalette = row.controlEl.children.find(
		(child) => child instanceof FakeElement && child.cls.includes("tcw-settings-palette"),
	);
	assert.ok(nextPalette instanceof FakeElement);
	const remaining = settingsIn(nextPalette)[0].components.find(
		(item) => item instanceof ExtraButtonComponent && item.icon === "cross",
	);
	assert.ok(remaining instanceof ExtraButtonComponent);
	await remaining.click();
	assert.deepEqual(plugin.userOptions.tagColorPalette, {});
});

test("palette add and rename reject duplicate tags including changes while the dialog is open", async (t) => {
	const { plugin, container } = await drawn(t, { tagColorPalette: { "#a": "#111111", "#b": "#222222" } });
	for (const edit of [undefined, 0]) {
		const { modal, setting, save } = await paletteDialog(t, container, edit);
		const closed = t.mock.method(modal, "close");
		await control(setting).change("#b");
		await save.click();
		assert.equal(closed.mock.callCount(), 0);
		assert.equal(plugin.userOptions.tagColorPalette["#b"], "#222222");
		assert.ok(markup(setting.desc).includes("already exists"));
		await control(setting).change("#external");
		await plugin.writeOptions({
			tagColorPalette: { ...plugin.userOptions.tagColorPalette, "#external": "#333333" },
		});
		await save.click();
		assert.equal(closed.mock.callCount(), 0);
		assert.equal(plugin.userOptions.tagColorPalette["#external"], "#333333");
		modal.close();
	}
});

test("palette failed save stays open and retries without mistaking its own provisional tag for a duplicate", async (t) => {
	const { plugin, container } = await drawn(t, { tagColorPalette: { "#a": "#111111" } });
	const { modal, setting, save } = await paletteDialog(t, container, 0);
	const closed = t.mock.method(modal, "close");
	const original = plugin.saveData.bind(plugin);
	let fail = true;
	t.mock.method(console, "error", () => {});
	t.mock.method(plugin, "saveData", async (data: unknown) => {
		if (fail) throw new Error("full");
		await original(data);
	});
	await control(setting).change("#renamed");
	await save.click();
	assert.equal(closed.mock.callCount(), 0);
	assert.equal(control(setting).value, "#renamed");
	fail = false;
	await save.click();
	assert.equal(closed.mock.callCount(), 1);
	assert.deepEqual(JSON.parse(plugin.dataJson ?? "{}").tagColorPalette, { "#renamed": "#111111" });
});

test("editing a palette draft during save keeps the dialog open and the next rename replaces the saved tag", async (t) => {
	const { plugin, container } = await drawn(t, { tagColorPalette: { "#a": "#111111" } });
	const row = named(container, copy.settings.useTags.name);
	const palette = row.controlEl.children.find(
		(child) => child instanceof FakeElement && child.cls.includes("tcw-settings-palette"),
	);
	assert.ok(palette instanceof FakeElement);
	const outerControls = [...row.controlEl.children];
	const emptyControls = row.controlEl.empty.bind(row.controlEl);
	// Model what the browser does when a parent is emptied; FakeElement otherwise leaves children connected.
	t.mock.method(row.controlEl, "empty", () => {
		for (const child of row.controlEl.children) if (child instanceof FakeElement) child.isConnected = false;
		emptyControls();
	});
	const { modal, setting, save } = await paletteDialog(t, container, 0);
	const closed = t.mock.method(modal, "close");
	const original = plugin.saveData.bind(plugin);
	let release = () => {};
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	t.mock.method(plugin, "saveData", async (data: unknown) => {
		await waiting;
		await original(data);
	});
	await control(setting).change("#first");
	const saving = save.click();
	await control(setting).change("#later");
	release();
	await saving;
	assert.deepEqual(row.controlEl.children, outerControls, "palette refresh keeps its container, Add and toggle");
	assert.equal(palette.isConnected, true);
	assert.equal(closed.mock.callCount(), 0);
	assert.equal(control(setting).value, "#later");
	await save.click();
	assert.equal(closed.mock.callCount(), 1);
	assert.deepEqual(plugin.userOptions.tagColorPalette, { "#later": "#111111" });
});

test("tag suggestions use vault cache, omit selected tags and select into inline entry", async (t) => {
	const { plugin, vault, container } = await drawn(t, { hideTags: ["#selected"] });
	vault.write("Suggestions.md", "---\ntags: frontmatter\n---\n#selected #work #日本語/标签");
	const input = control(named(container, copy.settings.hideTags.name));
	const picked: string[] = [];
	const suggest = new SettingsTagSuggest(
		plugin.app,
		input.el as unknown as HTMLInputElement,
		() => ["#selected"],
		(tag) => picked.push(tag),
	);
	assert.deepEqual(
		suggest.getSuggestions(""),
		["#frontmatter", "#work", "#日本語/标签"].sort((a, b) => a.localeCompare(b)),
	);
	assert.deepEqual(suggest.getSuggestions("work"), ["#work"]);
	const composing = Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", isComposing: true });
	suggest.selectSuggestion("#work", composing as unknown as KeyboardEvent);
	assert.deepEqual(picked, []);
	const selected = Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", isComposing: false });
	suggest.selectSuggestion("#work", selected as unknown as KeyboardEvent);
	assert.deepEqual(picked, ["#work"]);
	assert.equal(selected.defaultPrevented, true);
	assert.equal(input.el.value, "#work");
	suggest.close();
	const inline = [...AbstractInputSuggest.made]
		.reverse()
		.find(
			(item) =>
				item instanceof SettingsTagSuggest &&
				item !== suggest &&
				item.textInputEl === (input.el as unknown as HTMLInputElement),
		);
	assert.ok(inline instanceof SettingsTagSuggest);
	inline.selectSuggestion("#work");
	await settle();
	assert.deepEqual(plugin.userOptions.hideTags, ["#selected", "#work"]);
});
