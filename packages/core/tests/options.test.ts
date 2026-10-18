import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeOptions } from "../src/options";

/** The same kinds of values as defaultUserOptions in src/settings.ts, which cannot load without Obsidian. */
const makeDefaults = () => ({
	sort: "status-asc",
	forward: true,
	hideTags: [] as string[],
	styles: ["style1"],
	tagColorPalette: { "#TODO": "#339988" } as Record<string, string>,
});

test("missing keys take the default and saved keys win", () => {
	const options = mergeOptions(makeDefaults(), { sort: "due-asc", hideTags: ["#later"] });
	assert.deepEqual(options, { ...makeDefaults(), sort: "due-asc", hideTags: ["#later"] });
});

test("nothing saved yet gives the defaults", () => {
	assert.deepEqual(mergeOptions(makeDefaults(), null), makeDefaults());
	assert.deepEqual(mergeOptions(makeDefaults(), undefined), makeDefaults());
});

test("editing the merged options in place leaves the defaults unchanged", () => {
	const defaults = makeDefaults();
	const options = mergeOptions(defaults, {});
	options.hideTags.push("#later");
	options.styles.splice(0, 1);
	options.tagColorPalette["#TEST"] = "#998877";
	delete options.tagColorPalette["#TODO"];
	assert.deepEqual(defaults, makeDefaults());
});

test("loading again after an edit merges against the original defaults", () => {
	const defaults = makeDefaults();
	mergeOptions(defaults, null).hideTags.push("#later");
	assert.deepEqual(mergeOptions(defaults, null).hideTags, []);
});

test("editing the merged options leaves the saved data unchanged", () => {
	const saved = { hideTags: ["#later"], tagColorPalette: { "#TODO": "#000000" } };
	const options = mergeOptions(makeDefaults(), saved);
	options.hideTags.push("#someday");
	options.tagColorPalette["#TODO"] = "#ffffff";
	assert.deepEqual(saved, { hideTags: ["#later"], tagColorPalette: { "#TODO": "#000000" } });
});
