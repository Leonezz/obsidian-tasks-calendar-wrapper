import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import { migrateSortOption } from "@tasks-calendar-wrapper/core";
import {
	createSettingsStore,
	loadedSettings,
	loadedState,
	MIGRATIONS,
	savedForm,
	SETTINGS_VERSION,
	settingWarnings,
	storedVersionOf,
	withChanges,
} from "../src/state/settings";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { deeplyFrozen, nothingFrozen } from "./frozen";
import { readFixture } from "./settings-fixtures";

// The plugin's options as one frozen snapshot, which every load and every change replaces as a whole.

const pristineDefaults = JSON.stringify(defaultUserOptions);

test("the store starts with no options, as the plugin did before loading them, and no version", () => {
	const snapshot = createSettingsStore().getSnapshot();
	assert.deepEqual(snapshot, { options: {}, storedVersion: 0 });
	assert.ok(deeplyFrozen(snapshot));
});

test("without saved options, loading gives the defaults, frozen, sharing no list or map with them", () => {
	for (const saved of [null, undefined, {}]) {
		const settings = loadedSettings(saved);
		assert.deepEqual(settings, defaultUserOptions, String(saved));
		assert.deepEqual(Object.keys(settings), Object.keys(defaultUserOptions));
		assert.ok(deeplyFrozen(settings));
		assert.notEqual(settings.excludePaths, defaultUserOptions.excludePaths);
		assert.notEqual(settings.tagColorPalette, defaultUserOptions.tagColorPalette);
	}
	assert.ok(nothingFrozen(defaultUserOptions), "the defaults are not frozen");
	assert.equal(JSON.stringify(defaultUserOptions), pristineDefaults);
});

test("saved options are taken over the defaults, in the defaults' order, then the unknown ones in the file's order", () => {
	const saved = {
		legacy: { kept: ["as", "it was"] },
		dateFormat: "YYYY",
		excludePaths: ["Archive"],
		tagColorPalette: { "#work": "red" },
		other: 1,
	};
	const text = JSON.stringify(saved);
	const settings = loadedSettings(saved as Partial<UserOption>);
	assert.deepEqual(settings, { ...defaultUserOptions, ...saved });
	assert.deepEqual(Object.keys(settings), [...Object.keys(defaultUserOptions), "legacy", "other"]);
	assert.ok(deeplyFrozen(settings));
	assert.ok(nothingFrozen(saved), "what was read is not frozen");
	assert.equal(JSON.stringify(saved), text, "nor changed");
	assert.notEqual(settings.excludePaths, saved.excludePaths);
});

test("a sort saved as a lambda is read as today's sort key, in its place", () => {
	const saved = JSON.parse(readFixture("0.1.2-freetext-sort.json")) as Partial<UserOption>;
	const settings = loadedSettings(saved);
	assert.notEqual(saved.sort, "status-asc");
	assert.equal(settings.sort, "status-asc");
	assert.equal(settings.sort, migrateSortOption(saved.sort));
	assert.equal(Object.keys(settings).indexOf("sort"), Object.keys(defaultUserOptions).indexOf("sort"));
	// A sort that is not text is looked up as before, and kept.
	assert.deepEqual(loadedSettings({ sort: ["due-asc"] } as never).sort, ["due-asc"]);
});

test("a change gives new frozen options and leaves the ones before as they were", () => {
	const before = loadedSettings(null);
	const after = withChanges(before, { dateFormat: "YYYY", hideTags: ["#later"] });
	assert.notEqual(after, before);
	assert.equal(before.dateFormat, defaultUserOptions.dateFormat);
	assert.deepEqual(before.hideTags, []);
	assert.deepEqual(after, { ...before, dateFormat: "YYYY", hideTags: ["#later"] });
	assert.deepEqual(Object.keys(after), Object.keys(before));
	assert.ok(deeplyFrozen(after));
	const again = withChanges(after, {});
	assert.notEqual(again, after, "a change that changes nothing is new options too");
	assert.deepEqual(again, after);
});

test("the lists and maps a change hands in are copied, so they are neither frozen nor tied to the options", () => {
	const tags = ["#later"];
	const palette = { "#work": "red" };
	const settings = withChanges(loadedSettings(null), { hideTags: tags, tagColorPalette: palette });
	assert.ok(nothingFrozen(tags) && nothingFrozen(palette));
	tags.push("#someday");
	(palette as Record<string, string>)["#home"] = "blue";
	assert.deepEqual(settings.hideTags, ["#later"]);
	assert.deepEqual(settings.tagColorPalette, { "#work": "red" });
});

test("options a change adds come after the others, and one set to nothing is kept as a key", () => {
	const settings = withChanges(loadedSettings(null), { added: 1, inbox: undefined } as never);
	assert.deepEqual(Object.keys(settings), [...Object.keys(defaultUserOptions), "added"]);
	assert.ok("inbox" in settings);
	assert.equal(settings.inbox, undefined);
});

// Step 8: data.json says which version of the options' shape it holds, and the options of the wrong type are reported.

const LAMBDA_SORT = (JSON.parse(readFixture("0.1.2-freetext-sort.json")) as { sort: string }).sort;

test("settingsVersion is not an option: loading leaves it out, wherever the file has it", () => {
	const settings = loadedSettings({ dateFormat: "YYYY", settingsVersion: 1, legacy: 2 } as never);
	assert.deepEqual(Object.keys(settings), [...Object.keys(defaultUserOptions), "legacy"]);
	assert.equal(settings.dateFormat, "YYYY");
});

test("the version saved is read as it is when it is a number, and as 0 when there is none or it is not one", () => {
	assert.equal(SETTINGS_VERSION, 1);
	for (const saved of [null, undefined, {}, [], 5, "text"]) assert.equal(storedVersionOf(saved), 0, String(saved));
	assert.equal(storedVersionOf({ settingsVersion: 1 }), 1);
	assert.equal(storedVersionOf({ settingsVersion: 3 }), 3);
	assert.equal(storedVersionOf({ settingsVersion: "2" }), 0);
	assert.equal(storedVersionOf({ settingsVersion: null }), 0);
	assert.equal(storedVersionOf(JSON.parse('{ "settingsVersion": 1e400 }')), 0, "Infinity");
	assert.equal(storedVersionOf({ settingsVersion: -Infinity }), 0);
	assert.equal(storedVersionOf({ settingsVersion: 1.5 }), 1.5, "a number is taken as it is");
});

test("the state loaded holds the options and the version saved, frozen", () => {
	const saved = { settingsVersion: 3, dateFormat: "YYYY" };
	const state = loadedState(saved);
	assert.deepEqual(state, { options: loadedSettings(saved as never), storedVersion: 3 });
	assert.ok(deeplyFrozen(state));
	assert.ok(nothingFrozen(saved));
});

test("what is saved is the options, then settingsVersion last, never lower than the version the file had", () => {
	const options = withChanges(loadedSettings({ legacy: 1 } as never), { added: 2 } as never);
	const saved = savedForm({ options, storedVersion: 0 });
	assert.deepEqual(Object.keys(saved), [...Object.keys(defaultUserOptions), "legacy", "added", "settingsVersion"]);
	assert.deepEqual(saved, { ...options, settingsVersion: SETTINGS_VERSION });
	assert.ok(nothingFrozen(saved), "a copy");
	assert.equal(savedForm({ options, storedVersion: 1 }).settingsVersion, 1);
	assert.equal(savedForm({ options, storedVersion: 3 }).settingsVersion, 3, "a newer device's version stays");
	assert.equal(savedForm({ options, storedVersion: -1 }).settingsVersion, SETTINGS_VERSION);
	assert.equal(savedForm({ options, storedVersion: 0.5 }).settingsVersion, SETTINGS_VERSION);
});

test("every migration runs on every load whatever version the file has, and running them again changes nothing", () => {
	assert.deepEqual(
		MIGRATIONS.map((migration) => migration.id),
		["sort-lambda-to-key"],
	);
	// A 0.3.x device writes the old shape back, with the version a newer one saved, this one's or a later one's.
	const lambda = "(t1, t2) => t1.start >= t2.start ? -1 : 1";
	for (const settingsVersion of [undefined, 0, SETTINGS_VERSION, SETTINGS_VERSION + 2, "2"]) {
		const state = loadedState({ settingsVersion, sort: lambda } as never);
		assert.equal(state.options.sort, "start-desc", String(settingsVersion));
	}
	const settings = loadedSettings({ settingsVersion: 1, sort: LAMBDA_SORT } as never);
	assert.equal(settings.sort, migrateSortOption(LAMBDA_SORT));
	for (const migration of MIGRATIONS) assert.deepEqual(migration.apply(settings), settings, migration.id);
	assert.deepEqual(Object.keys(settings), Object.keys(defaultUserOptions));
});

test("each option of the wrong type warns once, saying what data.json holds and what it should be", () => {
	const saved = { useTags: "yes", hideTags: "#later", lastSeenVersion: null, sort: ["due-asc"], tagColorPalette: [] };
	const warnings = settingWarnings(saved, loadedSettings(saved as never));
	assert.deepEqual(warnings, [
		'Tasks Calendar Wrapper: data.json holds null for "lastSeenVersion", which should be text. It is used as it is.',
		'Tasks Calendar Wrapper: data.json holds a string for "hideTags", which should be a list of texts. It is used as it is.',
		'Tasks Calendar Wrapper: data.json holds an array for "sort", which should be text. It is used as it is.',
		'Tasks Calendar Wrapper: data.json holds an array for "tagColorPalette", which should be a map of texts. It is used as it is.',
		'Tasks Calendar Wrapper: data.json holds a string for "useTags", which should be true or false. It is used as it is.',
	]);
	const rules = { excludeProperties: { status: "archived" } };
	assert.deepEqual(settingWarnings(rules, loadedSettings(rules as never)), [
		'Tasks Calendar Wrapper: data.json holds an object with a string for "excludeProperties", which should be a map of lists of texts. It is used as it is.',
	]);
	for (const fixture of ["0.3.7-full.json", "quiet.json", "0.1.2-freetext-sort.json"]) {
		const text = JSON.parse(readFixture(fixture));
		assert.deepEqual(settingWarnings(text, loadedSettings(text)), [], fixture);
	}
	assert.deepEqual(settingWarnings(null, loadedSettings(null)), []);
});

test("a settingsVersion that is not a number warns, and counts as no version", () => {
	const saved = { settingsVersion: "2", legacy: 1 };
	assert.deepEqual(settingWarnings(saved, loadedSettings(saved as never)), [
		'Tasks Calendar Wrapper: data.json holds a string for "settingsVersion", which should be a finite number. It is read as 0.',
	]);
	const huge = JSON.parse('{ "settingsVersion": 1e400 }');
	assert.deepEqual(settingWarnings(huge, loadedSettings(huge)), [
		'Tasks Calendar Wrapper: data.json holds Infinity for "settingsVersion", which should be a finite number. It is read as 0.',
	]);
	assert.deepEqual(settingWarnings({ settingsVersion: 2 }, loadedSettings(null)), []);
	// It is not an option either, and the version this plugin writes goes last.
	const state = loadedState(saved as never);
	assert.ok(!("settingsVersion" in state.options));
	assert.equal(state.storedVersion, 0);
	assert.deepEqual(Object.keys(savedForm(state)), [...Object.keys(defaultUserOptions), "legacy", "settingsVersion"]);
	assert.equal(savedForm(state).settingsVersion, SETTINGS_VERSION);
});
