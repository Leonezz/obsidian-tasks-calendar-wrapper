// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import type { TasksCalendarSettingTab } from "../src/settings";
import {
	FIXTURE_NAMES,
	readFixture,
	rowsOf,
	snapshotsIn,
	startPlugin,
	type Row,
	type StartedPlugin,
} from "./settings-fixtures";
import {
	ControlElement,
	ExtraButtonComponent,
	FakeElement,
	SettingControl,
	SettingItemElement,
	setApiVersion,
} from "./stubs/obsidian";

// What the settings tab shows for the data.json shapes users have, see settings-fixtures.ts, and what each of its
// controls saves. Later steps move these conversions into a settings schema and must keep what is pinned here.

const snapshots = snapshotsIn("tab", [...FIXTURE_NAMES, "changes.json"]);

/** Lets what a step started, which needs no timer, finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The plugin started on the options, with its settings tab drawn. The test has mocked the clock. */
async function drawnTab(t: TestContext, dataJson: string | null) {
	const { plugin } = await startPlugin(dataJson);
	const tab = plugin.settingTab as TasksCalendarSettingTab;
	assert.ok(tab, "the plugin adds its settings tab");
	tab.display();
	return { plugin, tab, container: tab.containerEl as unknown as FakeElement };
}

const names = (rows: Row[]) => rows.map((row) => row.name);

/** The stub's settings window opening and closing at the tab; Obsidian's typings know nothing of it. */
const settingsWindow = (tab: TasksCalendarSettingTab) =>
	tab as unknown as { openSettings(): void; closeSettings(): void };

/** Makes the stubs act as this Obsidian version for the rest of the test. */
function onObsidian(t: TestContext, version: string): void {
	const replaced = setApiVersion(version);
	t.after(() => setApiVersion(replaced));
}

// Obsidian draws an open settings tab again after onExternalSettingsChange from 1.13 (SettingTab.update); before
// that, the plugin does. Either way the tab is drawn once, with the new options.
for (const [version, drawer] of [
	["1.12.7", "the plugin"],
	["1.13.0", "Obsidian"],
	["1.14.4", "Obsidian"],
] as const) {
	test(`data.json changed outside while the settings show the tab: ${drawer} draws it once more (Obsidian ${version})`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		onObsidian(t, version);
		const { plugin } = await startPlugin(readFixture("quiet.json"));
		const tab = plugin.settingTab as TasksCalendarSettingTab;
		settingsWindow(tab).openSettings();
		const draws = t.mock.method(tab, "display");
		const changed = readFixture("0.2.9-dropdown-sort.json");
		await plugin.changeDataJsonOutside(changed);
		assert.equal(draws.mock.callCount(), 1);
		const drawnOnChanged = rowsOf((await drawnTab(t, changed)).container);
		assert.deepEqual(rowsOf(tab.containerEl as unknown as FakeElement), drawnOnChanged);
		assert.notDeepEqual(drawnOnChanged, rowsOf((await drawnTab(t, readFixture("quiet.json"))).container));
	});

	test(`data.json changed outside while the settings are closed: the tab is not drawn (Obsidian ${version})`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		onObsidian(t, version);
		const { plugin } = await startPlugin(readFixture("quiet.json"));
		const tab = plugin.settingTab as TasksCalendarSettingTab;
		const draws = t.mock.method(tab, "display");
		await plugin.changeDataJsonOutside(readFixture("0.2.9-dropdown-sort.json"));
		assert.equal(draws.mock.callCount(), 0, "never opened");
		settingsWindow(tab).openSettings();
		settingsWindow(tab).closeSettings();
		draws.mock.resetCalls();
		await plugin.changeDataJsonOutside(readFixture("quiet.json"));
		assert.equal(draws.mock.callCount(), 0, "closed again");
		assert.deepEqual(plugin.userOptions, (await startPlugin(readFixture("quiet.json"))).plugin.userOptions);
	});
}

test("a tab closed while a toggle's save runs is not drawn again when the save is done, nor at the next change", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	onObsidian(t, "1.12.7");
	const { plugin } = await startPlugin(readFixture("quiet.json"));
	const tab = plugin.settingTab as TasksCalendarSettingTab;
	settingsWindow(tab).openSettings();
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	const save = plugin.saveData.bind(plugin);
	t.mock.method(plugin, "saveData", async (data: unknown) => {
		await held;
		await save(data);
	});
	const draws = t.mock.method(tab, "display");
	// A toggle that draws the page again once its option is saved.
	const saving = tab.onOptionUpdate({ useQuickEntry: false }, true);
	settingsWindow(tab).closeSettings();
	release();
	await saving;
	await plugin.changeDataJsonOutside(readFixture("0.2.9-dropdown-sort.json"));
	assert.equal(draws.mock.callCount(), 0);
});

for (const fixture of FIXTURE_NAMES) {
	test(`the settings tab on ${fixture}`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const { container } = await drawnTab(t, readFixture(fixture));
		snapshots.match(fixture, JSON.stringify(rowsOf(container), null, 2) + "\n");
	});
}

test("the tab with the defaults has 41 rows, three of them headings", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { tab, container } = await drawnTab(t, null);
	const rows = rowsOf(container);
	assert.equal(rows.length, 41);
	assert.deepEqual(
		rows.filter((row) => row.heading).map((row) => row.name),
		["Interface", "Task items", "Formats and filters"],
	);
	// Drawing the tab again replaces what it drew.
	tab.display();
	assert.deepEqual(rowsOf(container), rows);
});

test("the rows for the quick entry, the tag palette and the tag filters show only when they are on", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const off = JSON.stringify({ useQuickEntry: false, useTags: false });
	const offRows = rowsOf((await drawnTab(t, off)).container);
	const onRows = rowsOf(
		(await drawnTab(t, JSON.stringify({ useIncludeTags: true, useExcludeTags: true, hideTags: ["#a", "#b"] })))
			.container,
	);
	for (const name of ["Tasks Files", "Inbox", "Section For New Tasks"]) {
		assert.ok(!names(offRows).includes(name), name);
		assert.ok(names(onRows).includes(name), name);
	}
	for (const name of ["Task Include Filters", "File Include Tags", "Task Exclude Filters", "File Exclude Tags"]) {
		assert.ok(names(onRows).includes(name), name);
		assert.ok(!names(offRows).includes(name), name);
	}
	// With tags off, the palette's row shows its switch alone.
	const tags = (rows: Row[]) => rows.find((row) => row.name === "Use Tags")?.controls.map((control) => control.type);
	assert.deepEqual(tags(offRows), ["rows", "toggle"]);
	assert.deepEqual(tags(onRows), ["rows", "extra-button", "toggle"]);
});

test("the statuses to hide show as saved, a typed [ ] too, and a palette that is a list shows no tags", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hidden = rowsOf((await drawnTab(t, readFixture("0.3.1-hide-literal-todo.json"))).container);
	const status = hidden.find((row) => row.name === "Hide tasks of specific status.");
	assert.deepEqual(status?.controls[0], {
		type: "text",
		value: "x,-,[ ]",
		placeholder: "Status markers split by comma. e.g.,: x, -.",
	});
	const listPalette = rowsOf((await drawnTab(t, readFixture("0.0.4-array-palette.json"))).container);
	const palette = listPalette.find((row) => row.name === "Use Tags")?.controls[0];
	assert.deepEqual(palette, { type: "rows", rows: [{ name: "", desc: "", controls: [] }] });
});

test("the text boxes show the saved lists and rules as text", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const options = {
		taskFiles: ["a", "", "b c"],
		includePaths: ["Daily", "Projects/x.md"],
		excludePaths: ["Templates", "Archive"],
		excludeProperties: { status: ["archived", "done"], priority: ["low"] },
		hideStatusTasks: ["x", "-", " "],
		inbox: " Inbox.md ",
	};
	const rows = rowsOf((await drawnTab(t, JSON.stringify(options))).container);
	const shown = (name: string) => {
		const control = rows.find((row) => row.name === name)?.controls[0];
		return control && "value" in control ? control.value : undefined;
	};
	assert.deepEqual(
		{
			taskFiles: shown("Tasks Files"),
			includePaths: shown("Include Paths"),
			excludePaths: shown("Exclude Paths"),
			excludeProperties: shown("Exclude Properties"),
			hideStatusTasks: shown("Hide tasks of specific status."),
			inbox: shown("Inbox"),
		},
		{
			taskFiles: "a,,b c",
			includePaths: "Daily,Projects/x.md",
			excludePaths: "Templates,Archive",
			excludeProperties: "status: archived, done\npriority: low",
			// A space is shown as a space, not as the "[ ]" typed for it.
			hideStatusTasks: "x,-, ",
			inbox: " Inbox.md ",
		},
	);
});

test("a tag list shows three tags a row, and the palette two", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const palette = { "#a": "#111111", "#b": "#222222", "#c": "#333333" };
	const rows = rowsOf(
		(await drawnTab(t, JSON.stringify({ hideTags: ["#a", "#b", "#c", "#d"], tagColorPalette: palette }))).container,
	);
	const tagsByRow = (name: string) => {
		const nested = rows.find((row) => row.name === name)?.controls[0];
		assert.ok(nested && nested.type === "rows" && "rows" in nested, name);
		return nested.rows.map((row) => row.controls.flatMap((control) => ("text" in control ? [control.text] : [])));
	};
	assert.deepEqual(tagsByRow("Hide Tags"), [["#a", "#b", "#c"], ["#d"]]);
	assert.deepEqual(tagsByRow("Use Tags"), [["#a", "#b"], ["#c"]]);
});

test("a lambda sort shows as the sort it is read as", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const sortOf = async (fixture: string) => {
		const rows = rowsOf((await drawnTab(t, readFixture(fixture))).container);
		const dropdown = rows.find((row) => row.name === "Sort By")?.controls[0];
		return dropdown && "value" in dropdown ? dropdown.value : undefined;
	};
	assert.equal(await sortOf("0.2.9-dropdown-sort.json"), "due-asc");
	assert.equal(await sortOf("0.1.2-freetext-sort.json"), "status-asc");
	assert.equal(await sortOf("0.0.5-useinfo.json"), "status-asc");
});

test("options the tab cannot draw stop it where they are, as today", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const throwsAt = async (options: object, message: RegExp) => {
		const { plugin } = await startPlugin(JSON.stringify(options));
		const tab = plugin.settingTab as TasksCalendarSettingTab;
		assert.throws(() => tab.display(), message);
		return rowsOf(tab.containerEl as unknown as FakeElement).length;
	};
	assert.equal(await throwsAt({ tagColorPalette: null }, /Cannot convert undefined or null to object/), 27);
	assert.equal(await throwsAt({ excludeProperties: null }, /Cannot convert undefined or null to object/), 39);
	assert.equal(await throwsAt({ excludePaths: "Archive" }, /join is not a function/), 38);
});

/** The controls of the top rows that hold a value, with their row's name, as drawn now. */
function valueControls(container: FakeElement): { row: string; control: SettingControl }[] {
	return container.children.flatMap((child) => {
		if (!(child instanceof SettingItemElement)) return [];
		const row = typeof child.setting.name === "string" ? child.setting.name : "";
		return child.setting.controlEl.children.flatMap((element) =>
			element instanceof ControlElement && element.component instanceof SettingControl
				? [{ row, control: element.component }]
				: [],
		);
	});
}

/** What a user might type into a text box: nothing, items with spaces and empty ones, statuses, property rules. */
const TYPED = ["", " a , b ,, c ", "x, -, [ ]", "status: archived, done\npriority: low"];

/** The values tried on a control: the other value of a switch, each choice of a list, and the typed texts. */
function inputsFor(control: SettingControl): unknown[] {
	if (control.type === "toggle") return [!control.value];
	if (control.type === "dropdown") {
		const options = (control as unknown as { options: Record<string, string> }).options;
		return Object.keys(options).filter((value) => value !== control.value);
	}
	return TYPED;
}

/** Changes one control of a freshly drawn tab, and returns what the tab saved and whether it drew itself again. */
async function change(t: TestContext, dataJson: string | null, row: string, index: number, input: unknown) {
	const { plugin, tab, container } = await drawnTab(t, dataJson);
	const writes = t.mock.method(plugin as StartedPlugin, "writeOptions");
	const draws = t.mock.method(tab, "display");
	const control = valueControls(container).filter((found) => found.row === row)[index].control;
	await control.change(input);
	await settle();
	return { writes: writes.mock.calls.map((call) => call.arguments[0]), redrawn: draws.mock.callCount() > 0 };
}

test("what each control saves when it changes, and which ones draw the tab again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dataJson = JSON.stringify({ useIncludeTags: true, useExcludeTags: true });
	const changes = [];
	const controls = valueControls((await drawnTab(t, dataJson)).container);
	for (const [n, { row, control }] of controls.entries()) {
		const index = controls.slice(0, n).filter((other) => other.row === row).length;
		for (const input of inputsFor(control)) {
			changes.push({ row, type: control.type, input, ...(await change(t, dataJson, row, index, input)) });
		}
	}
	assert.ok(changes.length > 60);
	snapshots.match("changes.json", JSON.stringify(changes, null, 2) + "\n");
});

test("deleting a tag of the palette or of a tag list saves the rest and draws the tab again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dataJson = JSON.stringify({ hideTags: ["#a", "#b", "#c", "#d"] });
	const deletes = async (rowName: string, button: number) => {
		const { plugin, tab, container } = await drawnTab(t, dataJson);
		const writes = t.mock.method(plugin as StartedPlugin, "writeOptions");
		const draws = t.mock.method(tab, "display");
		const row = container.children.find(
			(child): child is SettingItemElement =>
				child instanceof SettingItemElement && child.setting.name === rowName,
		);
		const buttons = (element: FakeElement): ExtraButtonComponent[] =>
			element.children.flatMap((child) =>
				child instanceof ControlElement && child.component instanceof ExtraButtonComponent
					? [child.component]
					: child instanceof FakeElement
						? buttons(child)
						: [],
			);
		const deleting = buttons(row?.setting.controlEl as FakeElement).filter((found) => found.tooltip === "Delete");
		await deleting[button].click();
		await settle();
		return { writes: writes.mock.calls.map((call) => call.arguments[0]), draws: draws.mock.callCount() };
	};
	assert.deepEqual(await deletes("Use Tags", 0), {
		writes: [{ tagColorPalette: { "#TEST": "#998877" } }],
		draws: 1,
	});
	// The fourth tag is in the list's second row of three.
	assert.deepEqual(await deletes("Hide Tags", 3), { writes: [{ hideTags: ["#a", "#b", "#c"] }], draws: 1 });
});

// Declared last, so it runs after every test that produces a snapshot.
test("fixtures/settings/tab holds the snapshots these tests write, and no others", () => {
	snapshots.checkFolder();
});
