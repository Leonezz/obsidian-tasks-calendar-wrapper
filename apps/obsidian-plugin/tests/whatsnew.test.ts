import { test } from "node:test";
import assert from "node:assert/strict";

import { compareVersions, notesSince, ReleaseNote, shouldShowWhatsNew } from "../utils/whatsnew";

/** The plugin manifest stays at the repository root, where Obsidian reads it. Tests run from apps/obsidian-plugin. */
const MANIFEST_PATH = "../../manifest.json";

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

test("a pre-release comes after the previous release and before its own", () => {
    assert.ok(compareVersions("0.4.0-beta.1", "0.3.7") > 0);
    assert.ok(compareVersions("0.4.0-beta.1", "0.4.0") < 0);
    assert.ok(compareVersions("0.4.1", "0.4.0-beta.3") > 0);
    assert.equal(compareVersions("0.4.0-beta.1", "0.4.0-beta.1"), 0);
});

test("pre-releases of one version compare by number, not as text", () => {
    assert.ok(compareVersions("0.4.0-beta.2", "0.4.0-beta.1") > 0);
    assert.ok(compareVersions("0.4.0-beta.10", "0.4.0-beta.9") > 0);
    assert.ok(compareVersions("0.4.0-alpha.1", "0.4.0-beta.1") < 0);
    assert.ok(compareVersions("0.4.0-beta", "0.4.0-beta.1") < 0);
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

test("beta testers see each beta's notes and then the release's", () => {
    const betaNotes: ReleaseNote[] = [
        { version: "0.3.7", items: ["seven"] },
        { version: "0.4.0-beta.1", items: ["beta one"] },
        { version: "0.4.0-beta.2", items: ["beta two"] },
        { version: "0.4.0", items: ["four"] },
    ];
    assert.deepEqual(notesSince(betaNotes, "", "0.4.0-beta.1").map(n => n.version), ["0.4.0-beta.1"]);
    assert.deepEqual(notesSince(betaNotes, "0.3.7", "0.4.0-beta.2").map(n => n.version), ["0.4.0-beta.2", "0.4.0-beta.1"]);
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "0.4.0-beta.1", currentVersion: "0.4.0-beta.2", enabled: true }), true);
    assert.equal(shouldShowWhatsNew({ lastSeenVersion: "0.4.0-beta.2", currentVersion: "0.4.0", enabled: true }), true);
    assert.deepEqual(notesSince(betaNotes, "0.4.0-beta.2", "0.4.0").map(n => n.version), ["0.4.0"]);
});

test("users on the store release do not see notes for a later beta", () => {
    const betaNotes: ReleaseNote[] = [
        { version: "0.3.7", items: ["seven"] },
        { version: "0.4.0-beta.1", items: ["beta one"] },
    ];
    assert.deepEqual(notesSince(betaNotes, "0.3.6", "0.3.7").map(n => n.version), ["0.3.7"]);
});

test("an update from one release to the next leaves out the betas in between", () => {
    const betaNotes: ReleaseNote[] = [
        { version: "0.3.7", items: ["seven"] },
        { version: "0.4.0-beta.1", items: ["beta one"] },
        { version: "0.4.0", items: ["four"] },
    ];
    assert.deepEqual(notesSince(betaNotes, "0.3.7", "0.4.0").map(n => n.version), ["0.4.0"]);
    assert.deepEqual(notesSince(betaNotes, "", "0.4.0").map(n => n.version), ["0.4.0"]);
});

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
