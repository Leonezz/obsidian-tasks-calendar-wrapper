import { test } from "node:test";
import assert from "node:assert/strict";

import { compareVersions, notesSince, ReleaseNote, shouldShowWhatsNew } from "../utils/whatsnew";

const notes: ReleaseNote[] = [
    { version: "0.3.4", items: ["four"] },
    { version: "0.3.5", items: ["five"] },
    { version: "0.3.10", items: ["ten"] },
];

test("versions compare by number, not as text", () => {
    assert.ok(compareVersions("0.3.10", "0.3.9") > 0);
    assert.ok(compareVersions("0.3.4", "0.3.5") < 0);
    assert.equal(compareVersions("1.0.0", "1.0"), 0);
});

test("a fresh install or an update from a release before this feature shows the dialog", () => {
    // Neither has a last seen version yet.
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "", currentVersion: "0.3.5", enabled: true }), true);
});

test("an update to a newer version shows the dialog once", () => {
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "0.3.4", currentVersion: "0.3.5", enabled: true }), true);
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "0.3.5", currentVersion: "0.3.5", enabled: true }), false);
});

test("the dialog can be turned off", () => {
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "0.3.4", currentVersion: "0.3.5", enabled: false }), false);
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "", currentVersion: "0.3.5", enabled: false }), false);
});

test("notes since the last seen version are listed newest first", () => {
    assert.deepEqual(notesSince(notes, "0.3.4", "0.3.10").map(n => n.version), ["0.3.10", "0.3.5"]);
});

test("notes newer than the running version are not listed", () => {
    assert.deepEqual(notesSince(notes, "0.3.4", "0.3.5").map(n => n.version), ["0.3.5"]);
});

test("without a last seen version only the running version is listed", () => {
    assert.deepEqual(notesSince(notes, "", "0.3.5").map(n => n.version), ["0.3.5"]);
});

test("the version in manifest.json has release notes", async () => {
    const { readFileSync } = await import("node:fs");
    const { RELEASE_NOTES } = await import("../utils/whatsnew");
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { version: string };
    const note = RELEASE_NOTES.find(n => n.version === manifest.version);
    assert.ok(note && note.items.length > 0, `add release notes for ${manifest.version} to utils/whatsnew.ts`);
});

test("the support links in the dialog match the fundingUrl in manifest.json", async () => {
    const { readFileSync } = await import("node:fs");
    const { SUPPORT_LINKS } = await import("../utils/whatsnew");
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { fundingUrl?: Record<string, string> };
    assert.ok(SUPPORT_LINKS.length > 0, "the dialog should offer support links");
    assert.deepEqual(manifest.fundingUrl, Object.fromEntries(SUPPORT_LINKS.map(link => [link.label, link.url])));
});

test("the star button points at this plugin's repository", async () => {
    const { readFileSync } = await import("node:fs");
    const { REPOSITORY_URL } = await import("../utils/whatsnew");
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { authorUrl: string };
    assert.equal(REPOSITORY_URL, `${manifest.authorUrl}/obsidian-tasks-calendar-wrapper`);
});
