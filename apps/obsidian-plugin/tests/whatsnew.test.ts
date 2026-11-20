import { test } from "node:test";
import assert from "node:assert/strict";

/** The plugin manifest stays at the repository root, where Obsidian reads it. Tests run from apps/obsidian-plugin. */
const MANIFEST_PATH = "../../manifest.json";

test("the version in manifest.json has release notes", async () => {
	const { readFileSync } = await import("node:fs");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { version: string };
	const note = RELEASE_NOTES.find((n) => n.version === manifest.version);
	assert.ok(note && note.items.length > 0, `add release notes for ${manifest.version} to utils/whatsnew.ts`);
});

test("the stable 0.4.0 entry is first and store updates or fresh installs show its cumulative notes", async () => {
	const { notesSince } = await import("@tasks-calendar-wrapper/core");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	assert.equal(RELEASE_NOTES[0].version, "0.4.0");
	assert.ok(RELEASE_NOTES[0].items.length > 0);
	assert.ok(RELEASE_NOTES[0].items.every((item) => item.trim().length > 0));
	assert.equal(new Set(RELEASE_NOTES.map((note) => note.version)).size, RELEASE_NOTES.length);
	assert.deepEqual(notesSince(RELEASE_NOTES, "0.3.7", "0.4.0"), [RELEASE_NOTES[0]]);
	assert.deepEqual(notesSince(RELEASE_NOTES, "", "0.4.0"), [RELEASE_NOTES[0]]);
});

test("updates from every 0.4.0 beta show only the stable release's cumulative notes", async () => {
	const { notesSince } = await import("@tasks-calendar-wrapper/core");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	const stable = RELEASE_NOTES.find((note) => note.version === "0.4.0");
	assert.ok(stable);
	for (let beta = 1; beta <= 6; beta++) {
		assert.deepEqual(notesSince(RELEASE_NOTES, `0.4.0-beta.${beta}`, "0.4.0"), [stable]);
	}
});

test("an update to beta.6 or a beta fresh install still shows only its own notes", async () => {
	const { notesSince } = await import("@tasks-calendar-wrapper/core");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	const beta6 = RELEASE_NOTES.find((note) => note.version === "0.4.0-beta.6");
	assert.ok(beta6);
	assert.deepEqual(notesSince(RELEASE_NOTES, "0.4.0-beta.5", "0.4.0-beta.6"), [beta6]);
	assert.deepEqual(notesSince(RELEASE_NOTES, "", "0.4.0-beta.6"), [beta6]);
});

test("an update to beta.5 still shows only its own notes after newer beta notes are prepared", async () => {
	const { notesSince } = await import("@tasks-calendar-wrapper/core");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	const beta5 = RELEASE_NOTES.find((note) => note.version === "0.4.0-beta.5");
	assert.ok(beta5);
	assert.deepEqual(notesSince(RELEASE_NOTES, "0.4.0-beta.4", "0.4.0-beta.5"), [beta5]);
});

test("an update to beta.4 still shows only its own notes after newer beta notes are prepared", async () => {
	const { notesSince } = await import("@tasks-calendar-wrapper/core");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	const beta4 = RELEASE_NOTES.find((note) => note.version === "0.4.0-beta.4");
	assert.ok(beta4);
	assert.deepEqual(notesSince(RELEASE_NOTES, "0.4.0-beta.3", "0.4.0-beta.4"), [beta4]);
});

test("the prepared beta notes do not appear for stable versions", async () => {
	const { notesSince } = await import("@tasks-calendar-wrapper/core");
	const { RELEASE_NOTES } = await import("../utils/whatsnew");
	assert.deepEqual(
		notesSince(RELEASE_NOTES, "0.3.6", "0.3.7").map((note) => note.version),
		["0.3.7"],
	);
	assert.ok(notesSince(RELEASE_NOTES, "0.3.7", "0.4.0").every((note) => !note.version.includes("-beta.")));
});

test("the support links in the dialog match the fundingUrl in manifest.json", async () => {
	const { readFileSync } = await import("node:fs");
	const { SUPPORT_LINKS } = await import("../utils/whatsnew");
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { fundingUrl?: Record<string, string> };
	assert.ok(SUPPORT_LINKS.length > 0, "the dialog should offer support links");
	assert.deepEqual(manifest.fundingUrl, Object.fromEntries(SUPPORT_LINKS.map((link) => [link.label, link.url])));
});

test("the star button points at this plugin's repository", async () => {
	const { readFileSync } = await import("node:fs");
	const { REPOSITORY_URL } = await import("../utils/whatsnew");
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { authorUrl: string };
	assert.equal(REPOSITORY_URL, `${manifest.authorUrl}/obsidian-tasks-calendar-wrapper`);
});
