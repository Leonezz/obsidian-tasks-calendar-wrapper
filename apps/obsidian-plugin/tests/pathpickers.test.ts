import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test } from "node:test";
import { copy } from "@tasks-calendar-wrapper/core";
import type { App } from "obsidian";
import { appendPaths, PathSuggest, renderPathList, vaultPaths } from "../src/settings/controls/pathPicker";
import { renderText } from "../src/settings/controls/text";
import { settingsSchema } from "../src/settings-schema";
import { settingRows, type SettingRowOf } from "../src/settings/rows";
import type { SettingsControlActions } from "../src/settings/generate";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import {
	AbstractInputSuggest,
	ButtonComponent,
	FakeElement,
	Setting,
	TFile,
	TFolder,
	TextComponent,
} from "./stubs/obsidian";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const keyEvent = (key: string, isComposing = false) =>
	Object.assign(new Event("keydown", { cancelable: true }), {
		key,
		isComposing,
		keyCode: isComposing ? 229 : 13,
	}) as KeyboardEvent;

function file(path: string) {
	const value = new TFile();
	value.setPath(path);
	return value;
}

function folder(path: string) {
	const value = new TFolder();
	value.setPath(path);
	return value;
}

test("adding paths deduplicates additions while preserving existing legacy entries", () => {
	const original = ["", "Inbox.md", "Inbox.md"];
	assert.deepEqual(appendPaths(original, ["Inbox.md", "Notes/New.md", "Notes/New.md"]), [
		"",
		"Inbox.md",
		"Inbox.md",
		"Notes/New.md",
	]);
	assert.deepEqual(original, ["", "Inbox.md", "Inbox.md"]);
});

test("vault path suggestions include empty folders, normalize directory slashes and limit files to Markdown", () => {
	const app = {
		vault: {
			getAllLoadedFiles: () => [
				folder("/"),
				folder("Empty/"),
				folder("Notes"),
				file("Notes/Task.md"),
				file("cover.png"),
			],
		},
	} as unknown as App;
	assert.deepEqual(vaultPaths(app, "file"), ["Notes/Task.md"]);
	assert.deepEqual(vaultPaths(app, "folder"), ["", "Empty", "Notes"]);
	assert.deepEqual(vaultPaths(app, "path"), ["", "cover.png", "Empty", "Notes", "Notes/Task.md"]);
});

test("path suggestions filter without constraining free text and preserve exact selected paths", () => {
	const input = new FakeElement("input");
	const picked: string[] = [];
	const suggest = new PathSuggest(
		{} as App,
		input as unknown as HTMLInputElement,
		() => ["Notes/My Task.md", "Projects/Plan.md"],
		(value) => picked.push(value),
	);
	const native = suggest as unknown as AbstractInputSuggest<string>;
	input.value = "my task";
	assert.deepEqual(native.suggestions(), ["Notes/My Task.md"]);
	input.value = "new/uncreated";
	assert.deepEqual(native.suggestions(), []);
	input.value = "Notes,Projects";
	assert.deepEqual(native.suggestions(), []);
	const composing = keyEvent("Enter", true);
	suggest.selectSuggestion("Notes/My Task.md", composing);
	assert.deepEqual(picked, []);
	const selected = keyEvent("Enter");
	suggest.selectSuggestion("Notes/My Task.md", selected);
	assert.equal(selected.defaultPrevented, true);
	assert.equal(input.value, "Notes/My Task.md");
	assert.equal(input.focused, true);
	assert.equal(native.isOpen, false);
	assert.deepEqual(picked, ["Notes/My Task.md"]);
});

function pathControl(key: "includePaths" | "excludePaths" | "taskFiles", initial: string[]) {
	let options: UserOption = { ...defaultUserOptions, [key]: initial };
	const writes: Partial<UserOption>[] = [];
	const cleanups: (() => void)[] = [];
	const app = {
		vault: { getAllLoadedFiles: () => [folder("Notes"), file("Inbox.md"), file("Notes/Picked.md")] },
	} as unknown as App;
	let hold: Promise<void> | undefined;
	const tab = {
		plugin: { app },
		options: () => options,
		isShown: () => true,
		setMessages: () => {},
		registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
		save: async (update: Partial<UserOption>) => {
			writes.push(update);
			options = { ...options, ...update };
			await hold;
		},
		saveInBackground: () => {},
	} as unknown as SettingsControlActions;
	const row = settingRows(settingsSchema, options, []).find(
		(row) => row.kind === "setting" && row.key === key,
	) as SettingRowOf<"setting">;
	const setting = new Setting(new FakeElement());
	renderPathList(setting as never, row, tab);
	const component = setting.components.find((component) => component instanceof TextComponent) as TextComponent;
	assert.ok(component);
	const input = (component as unknown as { inputEl: FakeElement }).inputEl;
	const shell = setting.controlEl.children[0] as FakeElement;
	const chips = shell.children[0] as FakeElement;
	return {
		setting,
		input,
		chips,
		writes,
		cleanups,
		options: () => options,
		hold: (promise: Promise<void>) => {
			hold = promise;
		},
	};
}

test("multi-path inputs keep partial edits out of saved filters, then add free and batched paths on Enter", async () => {
	const control = pathControl("includePaths", ["Existing"]);
	control.input.value = "New folder, Notes/Task.md\nProjects";
	control.input.dispatchEvent(new Event("input"));
	assert.deepEqual(control.writes, []);
	const composing = keyEvent("Enter", true);
	control.input.dispatchEvent(composing);
	assert.deepEqual(control.writes, []);
	control.input.dispatchEvent(keyEvent("Enter"));
	await settle();
	assert.deepEqual(control.options().includePaths, ["Existing", "New folder", "Notes/Task.md", "Projects"]);
	assert.equal(control.input.value, "");
	assert.equal(control.chips.children.length, 4);
});

test("legacy empty task-file chips are retained until removed and native suggestions close with the tab", async () => {
	const control = pathControl("taskFiles", ["", "Inbox.md"]);
	assert.equal((control.chips.children[0] as FakeElement).textContent, copy.settings.tab.emptyPathLabel + "×");
	const remove = (control.chips.children[0] as FakeElement).children[1] as FakeElement;
	remove.click();
	await settle();
	assert.deepEqual(control.options().taskFiles, ["Inbox.md"]);
	const native = AbstractInputSuggest.made.at(-1) as AbstractInputSuggest<string>;
	for (const cleanup of control.cleanups) cleanup();
	assert.equal(native.isOpen, false);
});

test("saving a path leaves edits typed while that save is pending in the input", async () => {
	const control = pathControl("excludePaths", []);
	let release = () => {};
	control.hold(
		new Promise<void>((resolve) => {
			release = resolve;
		}),
	);
	control.input.value = "Archive";
	control.input.dispatchEvent(keyEvent("Enter"));
	control.input.value = "Templates";
	control.input.dispatchEvent(keyEvent("Enter"));
	assert.equal(control.writes.length, 1);
	release();
	await settle();
	assert.equal(control.input.value, "Templates");
	assert.deepEqual(control.options().excludePaths, ["Archive"]);
});

test("pasted path batches are added once and keep Markdown-file codec empty entries", async () => {
	const control = pathControl("taskFiles", ["Inbox.md"]);
	const paste = Object.assign(new Event("paste", { cancelable: true }), {
		clipboardData: { getData: () => "Notes/One.md,,Notes/Two.md\nNotes/One.md" },
	});
	control.input.dispatchEvent(paste);
	await settle();
	assert.equal(paste.defaultPrevented, true);
	assert.equal(control.writes.length, 1);
	assert.deepEqual(control.options().taskFiles, ["Inbox.md", "Notes/One.md", "", "Notes/Two.md"]);
});

test("single file and daily-folder suggestions save their picked values through the settings actions", async () => {
	for (const key of ["inbox", "dailyNoteFolder"] as const) {
		const options: UserOption = { ...defaultUserOptions };
		const writes: Partial<UserOption>[] = [];
		const cleanups: (() => void)[] = [];
		const app = {
			vault: { getAllLoadedFiles: () => [folder("Empty/"), file("Notes/Picked.md")] },
		} as unknown as App;
		const row = settingRows(settingsSchema, options, []).find(
			(row) => row.kind === "setting" && row.key === key,
		) as SettingRowOf<"setting">;
		const setting = new Setting(new FakeElement());
		renderText(setting as never, row, {
			plugin: { app },
			options: () => options,
			registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
			save: async (update: Partial<UserOption>) => {
				writes.push(update);
			},
		} as unknown as SettingsControlActions);
		const input = setting.components[0] as TextComponent;
		const native = AbstractInputSuggest.made.at(-1) as AbstractInputSuggest<string>;
		(input as unknown as { inputEl: FakeElement }).inputEl.value = "";
		assert.deepEqual(native.suggestions(), key === "inbox" ? ["Notes/Picked.md"] : ["Empty"]);
		const selected = key === "inbox" ? "Notes/Picked.md" : "Empty";
		native.selectSuggestion(selected);
		await settle();
		assert.deepEqual(writes, [{ [key]: selected }]);
		assert.equal(input.value, selected);
		for (const cleanup of cleanups) cleanup();
		assert.equal(native.isOpen, false);
	}
});

function statusControl(markers: string[]) {
	let options: UserOption = { ...defaultUserOptions, hideStatusTasks: markers };
	const writes: Partial<UserOption>[] = [];
	const cleanups: (() => void)[] = [];
	let held: Promise<void> | undefined;
	let fail = false;
	const row = settingRows(settingsSchema, options, []).find(
		(row) => row.kind === "setting" && row.key === "hideStatusTasks",
	) as SettingRowOf<"setting">;
	const setting = new Setting(new FakeElement());
	renderText(setting as never, row, {
		plugin: { app: {} },
		options: () => options,
		registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
		save: async (update: Partial<UserOption>) => {
			writes.push(update);
			options = { ...options, ...update };
			await held;
			if (fail) throw new Error("disk full");
		},
	} as unknown as SettingsControlActions);
	const input = setting.components.find((component) => component instanceof TextComponent) as TextComponent;
	const group = setting.controlEl.children.find(
		(child) => child instanceof FakeElement && child.cls === "tcw-settings-status-presets",
	) as FakeElement;
	const buttons = group.children.filter((child): child is ButtonComponent => child instanceof ButtonComponent);
	assert.equal(buttons.length, 3);
	return {
		input,
		buttons,
		writes,
		cleanups,
		options: () => options,
		hold: (promise: Promise<void>) => {
			held = promise;
		},
		fail: () => {
			fail = true;
		},
	};
}

test("status presets keep custom markers and display the to-do marker without losing its space value", async () => {
	const control = statusControl(["?", " "]);
	assert.equal(control.input.value, "?,[ ]");
	assert.equal(control.buttons[0].buttonEl.getAttribute("aria-pressed"), "true");
	assert.equal(control.buttons[1].buttonEl.getAttribute("aria-pressed"), "false");
	await control.buttons[1].click();
	assert.deepEqual(control.options().hideStatusTasks, ["?", " ", "x"]);
	assert.equal(control.input.value, "?,[ ],x");
	assert.equal(control.buttons[1].buttonEl.getAttribute("aria-pressed"), "true");
	await control.buttons[1].click();
	assert.deepEqual(control.options().hideStatusTasks, ["?", " "]);
	assert.equal(control.input.value, "?,[ ]");
});

test("custom status text still uses the existing codec and updates the preset state", async () => {
	const control = statusControl([]);
	await control.input.change("x, ?, [ ]");
	assert.deepEqual(control.options().hideStatusTasks, ["x", "?", " "]);
	assert.equal(control.input.value, "x, ?, [ ]");
	assert.equal(control.buttons[0].buttonEl.getAttribute("aria-pressed"), "true");
	assert.equal(control.buttons[1].buttonEl.getAttribute("aria-pressed"), "true");
	await control.buttons[2].click();
	assert.deepEqual(control.options().hideStatusTasks, ["x", "?", " ", "-"]);
	assert.equal(control.input.value, "x,?,[ ],-");
});

test("status presets guard repeated clicks while keeping newer custom edits during a pending save", async () => {
	const control = statusControl(["?"]);
	let release = () => {};
	control.hold(
		new Promise<void>((resolve) => {
			release = resolve;
		}),
	);
	const saving = control.buttons[1].click();
	assert.ok(control.buttons.every((button) => button.disabled));
	await control.buttons[2].click();
	assert.equal(control.writes.length, 1);
	const typing = control.input.change("!,[ ]");
	release();
	await Promise.all([saving, typing]);
	assert.equal(control.input.value, "!,[ ]");
	assert.deepEqual(control.options().hideStatusTasks, ["!", " "]);
	assert.ok(control.buttons.every((button) => !button.disabled));
	for (const cleanup of control.cleanups) cleanup();
	await control.buttons[1].click();
	assert.equal(control.writes.length, 2, "a disposed preset cannot save into a reopened tab");
});

test("a status preset save failure restores button availability and retains the submitted value", async (t) => {
	t.mock.method(console, "error", () => {});
	const control = statusControl(["?"]);
	control.fail();
	await control.buttons[0].click();
	assert.equal(control.input.value, "?,[ ]");
	assert.ok(control.buttons.every((button) => !button.disabled));
	assert.equal(control.buttons[0].buttonEl.getAttribute("aria-pressed"), "true");
});

test("path remove buttons visibly disable while a path mutation is pending", async () => {
	const control = pathControl("excludePaths", ["Archive", "Templates"]);
	let release = () => {};
	control.hold(
		new Promise<void>((resolve) => {
			release = resolve;
		}),
	);
	const buttons = control.chips.children.map(
		(child) => (child as FakeElement).children[1] as FakeElement & { disabled: boolean },
	);
	buttons[0].click();
	assert.ok(buttons.every((button) => button.disabled));
	buttons[1].click();
	assert.equal(control.writes.length, 1);
	release();
	await settle();
	assert.deepEqual(control.options().excludePaths, ["Templates"]);
	assert.equal(
		((control.chips.children[0] as FakeElement).children[1] as FakeElement & { disabled: boolean }).disabled,
		false,
	);
});

test("multiline path paste clears the draft after native single-line normalization", async () => {
	const control = pathControl("includePaths", []);
	let nativeValue = "";
	Object.defineProperty(control.input, "value", {
		get: () => nativeValue,
		set: (value: string) => {
			nativeValue = value.replace(/[\r\n]/g, "");
		},
		configurable: true,
	});
	control.input.dispatchEvent(
		Object.assign(new Event("paste", { cancelable: true }), {
			clipboardData: { getData: () => "First\nSecond\rThird" },
		}),
	);
	await settle();
	assert.deepEqual(control.options().includePaths, ["First", "Second", "Third"]);
	assert.equal(control.input.value, "");
	control.input.dispatchEvent(keyEvent("Enter"));
	await settle();
	assert.equal(control.writes.length, 1);
});
