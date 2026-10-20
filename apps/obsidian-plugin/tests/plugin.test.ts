// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { TasksTimelineView, TIMELINE_VIEW } from "../src/views";
import type { FakeVault } from "./fakevault";
import { deeplyFrozen, nothingFrozen } from "./frozen";
import { FIXTURE_NAMES, readFixture, snapshotsIn, startPlugin, type StartedPlugin } from "./settings-fixtures";
import { FakeElement, Modal } from "./stubs/obsidian";

// How the plugin loads, saves and hands on its options today, for the data.json shapes users have, see
// settings-fixtures.ts. Later steps replace this code and must keep what these tests pin, or change them on purpose.

const snapshots = snapshotsIn(
	"start",
	FIXTURE_NAMES.flatMap((fixture) => {
		const name = fixture.replace(/\.json$/, "");
		return [`${name}.options.json`, `${name}.data.json`];
	}),
);

/** The options reach the views this long after the last change, see utils/refresh.ts. */
const OPTIONS_DELAY_MS = 200;

/** Lets what a step started, which needs no timer, finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Opens a timeline in the right sidebar, as the plugin's command does, which makes the view with the plugin's factory. */
async function openTimeline(vault: FakeVault): Promise<TasksTimelineView> {
	const leaf = vault.app.workspace.getRightLeaf(false);
	await leaf.setViewState({ type: TIMELINE_VIEW, active: true });
	return leaf.view as unknown as TasksTimelineView;
}

/** Counts the options handed to every timeline view, from before the first is made. */
const countUpdates = (t: TestContext) => t.mock.method(TasksTimelineView.prototype, "onUpdateOptions");

const savedKeys = (plugin: StartedPlugin) => Object.keys(JSON.parse(plugin.dataJson ?? "null"));

test("no data.json, one holding null, and one that is not JSON give today's defaults, as copies", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const errors = t.mock.method(console, "error", () => {});
	for (const dataJson of [null, "null", "", "{ not json"]) {
		const { plugin } = await startPlugin(dataJson);
		assert.deepEqual(plugin.userOptions, defaultUserOptions, String(dataJson));
		assert.deepEqual(Object.keys(plugin.userOptions), Object.keys(defaultUserOptions));
		assert.notEqual(plugin.userOptions.excludePaths, defaultUserOptions.excludePaths);
		assert.notEqual(plugin.userOptions.tagColorPalette, defaultUserOptions.tagColorPalette);
		assert.equal(plugin.dataJson, dataJson, "loading saves nothing");
	}
	// Obsidian reports a data.json it cannot read as JSON; the plugin starts with the defaults.
	const unreadable = errors.mock.calls.filter((call) => call.arguments[0] === "failed to read JSON");
	assert.equal(unreadable.length, 2);
});

test("some options are merged into the defaults, in the defaults' order", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin(readFixture("quiet.json"));
	assert.deepEqual(plugin.userOptions, {
		...defaultUserOptions,
		showWhatsNewOnUpdate: false,
		lastSeenVersion: "0.3.7",
	});
	assert.deepEqual(Object.keys(plugin.userOptions), Object.keys(defaultUserOptions));
});

test("options this version does not know are kept after its own, in the file's order, and saved again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const text = readFixture("0.0.5-useinfo.json");
	const saved = JSON.parse(text);
	const { vault, plugin } = await startPlugin(text);
	const legacy = ["fileFilter", "useTagFilter", "taskTagFilters", "fileTagFilters", "useInfo", "useCompletedTasks"];
	assert.deepEqual(Object.keys(plugin.userOptions), [...Object.keys(defaultUserOptions), ...legacy]);
	const options = plugin.userOptions as unknown as Record<string, unknown>;
	for (const key of legacy) assert.deepEqual(options[key], saved[key], key);
	// What they meant is not carried over: useInfo's switches and the old tag filter are left as they were.
	assert.equal(saved.useInfo.useRecurrence, false);
	assert.equal(plugin.userOptions.useRecurrence, true);
	assert.equal(plugin.userOptions.useIncludeTags, false);
	// An option holding a list or a map takes the saved one as a whole.
	assert.deepEqual(plugin.userOptions.tagColorPalette, saved.tagColorPalette);
	// The first start of a version saves the options, the unknown ones too, in the same order.
	vault.app.workspace.finishLayout();
	await settle();
	assert.deepEqual(savedKeys(plugin), [...Object.keys(defaultUserOptions), ...legacy]);
	assert.deepEqual(JSON.parse(plugin.dataJson ?? "null").useInfo, saved.useInfo);
});

test("a sort saved as a lambda is read as today's sort at once, and saved so at the next save", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const sorts: [fixture: string, sort: string][] = [
		["0.0.5-useinfo.json", "status-asc"],
		["0.1.2-freetext-sort.json", "status-asc"],
		["0.2.9-dropdown-sort.json", "due-asc"],
		["0.3.1-hide-literal-todo.json", "status-asc"],
	];
	for (const [fixture, sort] of sorts) {
		const text = readFixture(fixture);
		const { plugin } = await startPlugin(text);
		assert.notEqual(JSON.parse(text).sort, sort, fixture);
		assert.equal(plugin.userOptions.sort, sort, fixture);
		assert.equal(plugin.dataJson, text, `${fixture}: loading saves nothing`);
		await plugin.writeOptions({});
		assert.equal(JSON.parse(plugin.dataJson ?? "null").sort, sort, fixture);
	}
});

test("options of the wrong type are kept as they are", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const palette = (await startPlugin(readFixture("0.0.4-array-palette.json"))).plugin.userOptions.tagColorPalette;
	assert.ok(Array.isArray(palette) && palette.length === 0);
	const hidden = (await startPlugin(readFixture("0.3.1-hide-literal-todo.json"))).plugin.userOptions.hideStatusTasks;
	assert.deepEqual(hidden, ["x", "-", "[ ]"]);
	const odd = { useTags: "yes", hideTags: "#later", lastSeenVersion: null, sort: ["due-asc"] };
	const { plugin } = await startPlugin(JSON.stringify(odd));
	const options = plugin.userOptions as unknown as Record<string, unknown>;
	assert.equal(options.useTags, "yes");
	assert.equal(options.hideTags, "#later");
	assert.equal(options.lastSeenVersion, null);
	// The sort is looked up by its text, which a list of one key also has.
	assert.deepEqual(options.sort, ["due-asc"]);
});

for (const fixture of FIXTURE_NAMES) {
	const name = fixture.replace(/\.json$/, "");
	test(`start on ${fixture}: the options read, and what data.json holds after the first start`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		t.mock.method(console, "error", () => {});
		const text = readFixture(fixture);
		const { vault, plugin } = await startPlugin(text);
		snapshots.match(`${name}.options.json`, JSON.stringify(plugin.userOptions, null, 2) + "\n");
		const saves = t.mock.method(plugin, "saveData");
		vault.app.workspace.finishLayout();
		await settle();
		// The first start of a version saves the options once, to remember the version; a file that has it is left.
		const seen = (JSON.parse(text) as Partial<UserOption> | null)?.lastSeenVersion;
		assert.equal(saves.mock.callCount(), seen === "0.3.7" ? 0 : 1);
		snapshots.match(`${name}.data.json`, plugin.dataJson ?? "");
	});
}

test("the first start of a version shows what is new since the last one, and saves the version once", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const opened = t.mock.method(Modal.prototype, "open");
	const versionsShown = () =>
		opened.mock.calls.map((call) =>
			(call.this as Modal & { contentEl: FakeElement }).contentEl.children
				.filter((child): child is FakeElement => child instanceof FakeElement && child.tag === "h4")
				.map((heading) => heading.text),
		);
	const start = async (options: object | null) => {
		opened.mock.resetCalls();
		const { vault, plugin } = await startPlugin(JSON.stringify(options));
		const saves = t.mock.method(plugin, "saveData");
		vault.app.workspace.finishLayout();
		await settle();
		return { versions: versionsShown(), saves: saves.mock.callCount(), plugin };
	};

	const first = await start(null);
	assert.deepEqual(first.versions, [["Version 0.3.7"]]);
	assert.equal(first.saves, 1);
	assert.equal(JSON.parse(first.plugin.dataJson ?? "null").lastSeenVersion, "0.3.7");
	assert.deepEqual((await start({ lastSeenVersion: "0.3.5" })).versions, [["Version 0.3.7", "Version 0.3.6"]]);
	assert.deepEqual(await start({ lastSeenVersion: "0.3.7" }).then(({ versions, saves }) => ({ versions, saves })), {
		versions: [],
		saves: 0,
	});
	const off = await start({ showWhatsNewOnUpdate: false, lastSeenVersion: "" });
	assert.deepEqual({ versions: off.versions, saves: off.saves }, { versions: [], saves: 1 });
	// An older version than the last one seen shows nothing, and remembers this one.
	const older = await start({ lastSeenVersion: "0.4.0" });
	assert.deepEqual({ versions: older.versions, saves: older.saves }, { versions: [], saves: 1 });
	assert.equal(older.plugin.userOptions.lastSeenVersion, "0.3.7");
});

test("a version that is not text stops what is new on every start, and nothing is saved", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const errors = t.mock.method(console, "error", () => {});
	const { vault, plugin } = await startPlugin(JSON.stringify({ lastSeenVersion: 37 }));
	const saves = t.mock.method(plugin, "saveData");
	vault.app.workspace.finishLayout();
	await settle();
	assert.equal(saves.mock.callCount(), 0);
	const failures = errors.mock.calls.filter(
		(call) => call.arguments[0] === "Tasks Calendar Wrapper: showing what's new failed",
	);
	assert.equal(failures.length, 1);
	assert.ok(failures[0].arguments[1] instanceof TypeError);
});

test("every change of an option saves all the options, even one that changes nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin(readFixture("quiet.json"));
	const saves = t.mock.method(plugin, "saveData");
	await plugin.writeOptions({ dateFormat: plugin.userOptions.dateFormat });
	await plugin.writeOptions({ dateFormat: plugin.userOptions.dateFormat });
	await plugin.writeOptions({});
	assert.equal(saves.mock.callCount(), 3);
	const last = saves.mock.calls[2].arguments[0];
	assert.deepEqual(last, plugin.userOptions);
	assert.deepEqual(savedKeys(plugin), Object.keys(defaultUserOptions));
	assert.equal(plugin.dataJson, JSON.stringify(plugin.userOptions, undefined, 2));
	// What was saved is not changed by a later change.
	const saved = last.dateFormat;
	await plugin.writeOptions({ dateFormat: "QQQ" });
	assert.equal(last.dateFormat, saved);
});

test("the options are one frozen snapshot, which every load and every change replaces, and the defaults stay", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const pristine = JSON.stringify(defaultUserOptions);
	const { plugin } = await startPlugin(readFixture("0.3.7-full.json"));
	const loaded = plugin.userOptions;
	assert.ok(deeplyFrozen(loaded));
	assert.equal(plugin.userOptions, loaded, "the same options until something changes");
	const loadedFormat = loaded.dateFormat;
	await plugin.writeOptions({ dateFormat: "QQQ" });
	const changed = plugin.userOptions;
	assert.notEqual(changed, loaded);
	assert.ok(deeplyFrozen(changed));
	assert.equal(loaded.dateFormat, loadedFormat, "the options before are as they were");
	plugin.dataJson = readFixture("quiet.json");
	await plugin.onExternalSettingsChange();
	assert.notEqual(plugin.userOptions, changed);
	assert.ok(deeplyFrozen(plugin.userOptions));
	assert.equal(changed.dateFormat, "QQQ");
	assert.equal(JSON.stringify(defaultUserOptions), pristine);
	assert.ok(nothingFrozen(defaultUserOptions));
});

test("changing the options in place fails at once, instead of being lost or reaching some views only", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin(readFixture("quiet.json"));
	assert.throws(() => {
		(plugin.userOptions as { dateFormat: string }).dateFormat = "QQQ";
	}, TypeError);
	assert.throws(() => (plugin.userOptions.hideTags as string[]).push("#later"), TypeError);
	assert.equal(plugin.userOptions.dateFormat, defaultUserOptions.dateFormat);
	assert.deepEqual(plugin.userOptions.hideTags, []);
});

test("a data.json changed outside replaces the options as a whole, without the options the new file lacks", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin(readFixture("0.0.5-useinfo.json"));
	plugin.dataJson = readFixture("quiet.json");
	await plugin.onExternalSettingsChange();
	assert.deepEqual(plugin.userOptions, {
		...defaultUserOptions,
		showWhatsNewOnUpdate: false,
		lastSeenVersion: "0.3.7",
	});
	assert.deepEqual(Object.keys(plugin.userOptions), Object.keys(defaultUserOptions));
	await plugin.writeOptions({});
	assert.deepEqual(savedKeys(plugin), Object.keys(defaultUserOptions));
});

test('a hand-edited data.json with a "__proto__" key is saved without it, and the keys after it, as before', async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin('{ "__proto__": { "later": 1 }, "later": 2, "dateFormat": "YYYY" }');
	await plugin.writeOptions({});
	assert.ok(!plugin.dataJson?.includes("__proto__"), plugin.dataJson ?? "");
	const saved = JSON.parse(plugin.dataJson ?? "null");
	assert.equal(saved.later, 2);
	assert.equal(saved.dateFormat, "YYYY");
});

test("a change copies the lists it is handed, so changing them afterwards changes no option", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { plugin } = await startPlugin(readFixture("quiet.json"));
	const tags = ["#later"];
	await plugin.writeOptions({ hideTags: tags });
	assert.ok(nothingFrozen(tags));
	tags.push("#someday");
	assert.deepEqual(plugin.userOptions.hideTags, ["#later"]);
	assert.deepEqual(JSON.parse(plugin.dataJson ?? "null").hideTags, ["#later"]);
});

test("the view factory hands a new timeline the options at once, which later changes leave as they were", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault, plugin } = await startPlugin(readFixture("0.2.9-dropdown-sort.json"), { layoutReady: true });
	await wait(t, 10 * OPTIONS_DELAY_MS);
	const view = await openTimeline(vault);
	assert.equal(updates.mock.callCount(), 1);
	const [handed] = updates.mock.calls[0].arguments;
	assert.equal(updates.mock.calls[0].this, view);
	assert.deepEqual(handed, plugin.userOptions);
	assert.ok(deeplyFrozen(handed));
	const before = handed.dateFormat;
	await plugin.writeOptions({ dateFormat: "QQQ" });
	assert.equal(handed.dateFormat, before);
});

test("a timeline opened while the plugin starts gets the options twice: from the factory and 200 ms after loading", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault } = await startPlugin(readFixture("quiet.json"), { layoutReady: true });
	await openTimeline(vault);
	assert.equal(updates.mock.callCount(), 1);
	await wait(t, OPTIONS_DELAY_MS);
	assert.equal(updates.mock.callCount(), 2);
});

test("changed options reach the timelines 200 ms after the last change, once a burst, as they are then", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault, plugin } = await startPlugin(readFixture("quiet.json"), { layoutReady: true });
	const first = await openTimeline(vault);
	const second = await openTimeline(vault);
	await wait(t, 10 * OPTIONS_DELAY_MS);
	updates.mock.resetCalls();
	await plugin.writeOptions({ dateFormat: "YYYY" });
	await wait(t, 100);
	await plugin.writeOptions({ dateFormat: "DD.MM.YYYY" });
	await wait(t, OPTIONS_DELAY_MS - 1);
	assert.equal(updates.mock.callCount(), 0);
	await wait(t, 1);
	assert.deepEqual(
		updates.mock.calls.map((call) => call.this),
		[first, second],
	);
	for (const call of updates.mock.calls) assert.equal(call.arguments[0].dateFormat, "DD.MM.YYYY");
	for (const call of updates.mock.calls) assert.ok(deeplyFrozen(call.arguments[0]));
	await wait(t, 10 * OPTIONS_DELAY_MS);
	assert.equal(updates.mock.callCount(), 2);
	// What the timelines were handed is not changed by a later change.
	await plugin.writeOptions({ dateFormat: "QQQ" });
	for (const call of updates.mock.calls.slice(0, 2)) assert.equal(call.arguments[0].dateFormat, "DD.MM.YYYY");
});

test("a change reaches the timelines 200 ms after it while its save is still written, and so does one of nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault, plugin } = await startPlugin(readFixture("quiet.json"), { layoutReady: true });
	const view = await openTimeline(vault);
	await wait(t, 10 * OPTIONS_DELAY_MS);
	updates.mock.resetCalls();
	t.mock.method(plugin, "saveData", () => new Promise<void>(() => {}));
	void plugin.writeOptions({ dateFormat: "YYYY" });
	await wait(t, OPTIONS_DELAY_MS);
	assert.deepEqual(
		updates.mock.calls.map((call) => [call.this, call.arguments[0].dateFormat]),
		[[view, "YYYY"]],
	);
	void plugin.writeOptions({});
	await wait(t, OPTIONS_DELAY_MS);
	assert.equal(updates.mock.callCount(), 2, "a change that changes nothing reaches them too");
});

test("a leaf of the timeline's type whose view is not loaded yet is skipped", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault, plugin } = await startPlugin(readFixture("quiet.json"), { layoutReady: true });
	// Obsidian keeps a leaf in a tab not shown yet with a stand-in view that reports the type.
	const deferred = vault.app.workspace.addLeaf();
	deferred.view = { getViewType: () => TIMELINE_VIEW };
	const view = await openTimeline(vault);
	await wait(t, 10 * OPTIONS_DELAY_MS);
	updates.mock.resetCalls();
	await plugin.writeOptions({ dateFormat: "YYYY" });
	await wait(t, OPTIONS_DELAY_MS);
	assert.deepEqual(
		updates.mock.calls.map((call) => call.this),
		[view],
	);
});

test("unloading the plugin drops the options waiting to reach the timelines, and what it added", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault, plugin } = await startPlugin(readFixture("quiet.json"), { layoutReady: true });
	await openTimeline(vault);
	await wait(t, 10 * OPTIONS_DELAY_MS);
	assert.deepEqual(
		plugin.commands.map((command) => [command.id, command.name]),
		[
			["tasks-calendar-wrapper:open-tasks-timeline-view", "Tasks Calendar Wrapper: Open Tasks Timeline View"],
			["tasks-calendar-wrapper:show-whats-new", "Tasks Calendar Wrapper: Show what's new"],
		],
	);
	assert.ok(plugin.settingTab);
	updates.mock.resetCalls();
	await plugin.writeOptions({ dateFormat: "YYYY" });
	const looks = t.mock.method(vault.app.workspace, "getLeavesOfType");
	plugin.unload();
	// The timelines close first, which looks for the others; the push would look for them when its time comes.
	await settle();
	looks.mock.resetCalls();
	await wait(t, 10 * OPTIONS_DELAY_MS);
	assert.equal(looks.mock.callCount(), 0, "the push never ran");
	assert.equal(updates.mock.callCount(), 0);
	// As when Obsidian unloads the plugin to update or reload it, the timelines close with their view type, and their
	// leaves keep a stand-in; turning the plugin off also takes the leaves away.
	assert.deepEqual(
		vault.app.workspace.getLeavesOfType(TIMELINE_VIEW).map((leaf) => leaf.view instanceof TasksTimelineView),
		[false],
	);
	assert.deepEqual(plugin.commands, []);
	assert.equal(plugin.settingTab, null);
	assert.equal(vault.app.viewRegistry.creatorOf(TIMELINE_VIEW), undefined);
});

test("a data.json changed outside is read as at start, and reaches the timelines, without saving", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const updates = countUpdates(t);
	const { vault, plugin } = await startPlugin(readFixture("quiet.json"), { layoutReady: true });
	const view = await openTimeline(vault);
	await wait(t, 10 * OPTIONS_DELAY_MS);
	updates.mock.resetCalls();
	const saves = t.mock.method(plugin, "saveData");
	const before = plugin.userOptions;
	// As when Sync or git changes the file; Obsidian then calls onExternalSettingsChange.
	plugin.dataJson = readFixture("0.2.9-dropdown-sort.json");
	await plugin.onExternalSettingsChange();
	assert.notEqual(plugin.userOptions, before, "new options");
	assert.equal(plugin.userOptions.sort, "due-asc");
	assert.equal(plugin.userOptions.counterBehavior, "Focus");
	assert.equal(plugin.userOptions.lastSeenVersion, "", "the file has none");
	assert.equal(saves.mock.callCount(), 0);
	await wait(t, OPTIONS_DELAY_MS - 1);
	assert.equal(updates.mock.callCount(), 0);
	await wait(t, 1);
	assert.deepEqual(
		updates.mock.calls.map((call) => [call.this, call.arguments[0].sort]),
		[[view, "due-asc"]],
	);
});

test("opening the timeline on start is decided once, when the plugin loads", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const timelines = (vault: FakeVault) => vault.app.workspace.getLeavesOfType(TIMELINE_VIEW).length;

	const onStart = await startPlugin(JSON.stringify({ openViewOnStartup: true, lastSeenVersion: "0.3.7" }));
	assert.equal(timelines(onStart.vault), 0, "not before the layout is ready");
	onStart.vault.app.workspace.finishLayout();
	await settle();
	assert.equal(timelines(onStart.vault), 1);

	// Turned on after loading, by the settings tab or by a changed data.json, it waits for the next start.
	const later = await startPlugin(JSON.stringify({ openViewOnStartup: false, lastSeenVersion: "0.3.7" }));
	await later.plugin.writeOptions({ openViewOnStartup: true });
	later.vault.app.workspace.finishLayout();
	await settle();
	assert.equal(timelines(later.vault), 0);
	later.plugin.dataJson = JSON.stringify({ openViewOnStartup: true });
	await later.plugin.onExternalSettingsChange();
	await settle();
	assert.equal(timelines(later.vault), 0);

	// A timeline Obsidian restored with the layout is shown, and no other one is opened.
	const restored = await startPlugin(JSON.stringify({ openViewOnStartup: true, lastSeenVersion: "0.3.7" }));
	await openTimeline(restored.vault);
	restored.vault.app.workspace.finishLayout();
	await settle();
	assert.equal(timelines(restored.vault), 1);
	assert.deepEqual(
		restored.vault.app.workspace.revealed,
		restored.vault.app.workspace.getLeavesOfType(TIMELINE_VIEW),
	);
});

/** Lets the given time pass on the mocked clock, then what starts then finish. */
async function wait(t: TestContext, ms: number): Promise<void> {
	t.mock.timers.tick(ms);
	await settle();
}

// Declared last, so it runs after every test that produces a snapshot.
test("fixtures/settings/start holds the snapshots these tests write, and no others", () => {
	snapshots.checkFolder();
});
