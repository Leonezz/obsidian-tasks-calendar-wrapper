import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { tagSearchUri } from "../utils/utils";

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
