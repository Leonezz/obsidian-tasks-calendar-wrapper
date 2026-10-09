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

test("a fresh install does not show the dialog", () => {
    assert.equal(shouldShowWhatsNew({ freshInstall: true, lastSeenVersion: "", currentVersion: "0.3.5", enabled: true }), false);
});

test("an update from a version before this feature shows the dialog", () => {
    // Users upgrading from a release that did not record a version yet have settings but no last seen version.
    assert.equal(shouldShowWhatsNew({ freshInstall: false, lastSeenVersion: "", currentVersion: "0.3.5", enabled: true }), true);
});

test("an update to a newer version shows the dialog once", () => {
    assert.equal(shouldShowWhatsNew({ freshInstall: false, lastSeenVersion: "0.3.4", currentVersion: "0.3.5", enabled: true }), true);
    assert.equal(shouldShowWhatsNew({ freshInstall: false, lastSeenVersion: "0.3.5", currentVersion: "0.3.5", enabled: true }), false);
});

test("the dialog can be turned off", () => {
    assert.equal(shouldShowWhatsNew({ freshInstall: false, lastSeenVersion: "0.3.4", currentVersion: "0.3.5", enabled: false }), false);
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
