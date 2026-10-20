import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import { migrateSortOption } from "@tasks-calendar-wrapper/core";
import { createSettingsStore, loadedSettings, withChanges } from "../src/state/settings";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { deeplyFrozen, nothingFrozen } from "./frozen";
import { readFixture } from "./settings-fixtures";

// The plugin's options as one frozen snapshot, which every load and every change replaces as a whole.

const pristineDefaults = JSON.stringify(defaultUserOptions);

test("the store starts with no options, as the plugin did before loading them", () => {
	const snapshot = createSettingsStore().getSnapshot();
	assert.deepEqual(snapshot, {});
	assert.ok(Object.isFrozen(snapshot));
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
