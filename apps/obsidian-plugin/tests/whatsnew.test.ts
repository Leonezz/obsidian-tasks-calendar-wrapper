import { test } from "node:test";
import assert from "node:assert/strict";

/** The plugin manifest stays at the repository root, where Obsidian reads it. Tests run from apps/obsidian-plugin. */
const MANIFEST_PATH = "../../manifest.json";

test("the version in manifest.json has release notes", async () => {
    const { readFileSync } = await import("node:fs");
    const { RELEASE_NOTES } = await import("../utils/whatsnew");
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { version: string };
    const note = RELEASE_NOTES.find(n => n.version === manifest.version);
    assert.ok(note && note.items.length > 0, `add release notes for ${manifest.version} to utils/whatsnew.ts`);
});

test("the support links in the dialog match the fundingUrl in manifest.json", async () => {
    const { readFileSync } = await import("node:fs");
    const { SUPPORT_LINKS } = await import("../utils/whatsnew");
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { fundingUrl?: Record<string, string> };
    assert.ok(SUPPORT_LINKS.length > 0, "the dialog should offer support links");
    assert.deepEqual(manifest.fundingUrl, Object.fromEntries(SUPPORT_LINKS.map(link => [link.label, link.url])));
});

test("the star button points at this plugin's repository", async () => {
    const { readFileSync } = await import("node:fs");
    const { REPOSITORY_URL } = await import("../utils/whatsnew");
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { authorUrl: string };
    assert.equal(REPOSITORY_URL, `${manifest.authorUrl}/obsidian-tasks-calendar-wrapper`);
});
