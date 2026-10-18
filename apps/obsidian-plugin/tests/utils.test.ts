import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { tagSearchUri, tasksPluginCommand } from "../utils/utils";

// Toggling a task with the Tasks plugin disabled threw an uncaught TypeError and showed nothing

test("an available Tasks command is returned", () => {
	const editorCheckCallback = () => true;
	const commands = { "obsidian-tasks-plugin:toggle-done": { editorCheckCallback } };
	assert.equal(
		tasksPluginCommand(commands, "obsidian-tasks-plugin:toggle-done"),
		commands["obsidian-tasks-plugin:toggle-done"],
	);
});

test("a missing Tasks command raises an error that says what to do", () => {
	assert.throws(() => tasksPluginCommand({}, "obsidian-tasks-plugin:toggle-done"), /Tasks plugin is not enabled/);
	assert.throws(
		() => tasksPluginCommand({ "obsidian-tasks-plugin:toggle-done": {} }, "obsidian-tasks-plugin:toggle-done"),
		/Tasks plugin is not enabled/,
	);
});

// Clicking a tag searches for it through the documented search URI, not the private search plugin

test("a tag search opens the search URI of the vault", () => {
	assert.equal(tagSearchUri("Notes", "#work"), "obsidian://search?vault=Notes&query=tag%3A%23work");
});

test("the vault name and the tag are encoded, so spaces, ampersands and nested tags survive", () => {
	assert.equal(
		tagSearchUri("My Vault & Co", "#work/admin"),
		"obsidian://search?vault=My%20Vault%20%26%20Co&query=tag%3A%23work%2Fadmin",
	);
	assert.equal(new URL(tagSearchUri("笔记", "#项目")).searchParams.get("vault"), "笔记");
	assert.equal(new URL(tagSearchUri("笔记", "#项目")).searchParams.get("query"), "tag:#项目");
});
