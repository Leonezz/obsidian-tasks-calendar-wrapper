/**
 * Which release notes to show after an update: version ordering (semver pre-releases included)
 * and the rules for when the dialog opens. The notes themselves live in the plugin.
 */

export interface ReleaseNote {
    version: string;
    items: string[];
}

/**
 * Compares version numbers by value, so 0.3.10 comes after 0.3.9. Missing parts count as 0.
 * A pre-release such as 0.4.0-beta.1 comes after 0.3.x and before 0.4.0, as in semver.
 */
export function compareVersions(a: string, b: string): number {
    const va = splitVersion(a);
    const vb = splitVersion(b);
    const byRelease = compareReleaseParts(va.release, vb.release);
    if (byRelease !== 0) return byRelease;
    // A release comes after its pre-releases, so the side without a pre-release part is the later one.
    if (va.preRelease.length === 0 || vb.preRelease.length === 0) return vb.preRelease.length - va.preRelease.length;
    return comparePreReleases(va.preRelease, vb.preRelease);
}

/** Splits 0.4.0-beta.1 into its release parts, [0, 4, 0], and its pre-release parts, ["beta", "1"]. */
function splitVersion(version: string): { release: number[]; preRelease: string[] } {
    const dash = version.indexOf("-");
    const release = dash === -1 ? version : version.slice(0, dash);
    const preRelease = dash === -1 ? "" : version.slice(dash + 1);
    return {
        release: release.split(".").map(Number),
        preRelease: preRelease === "" ? [] : preRelease.split("."),
    };
}

function isPreRelease(version: string): boolean {
    return splitVersion(version).preRelease.length > 0;
}

function compareReleaseParts(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** Numbers compare by value and come before words, words compare as text, and a longer list comes later. */
function comparePreReleases(a: string[], b: string[]): number {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const diff = comparePreReleasePart(a[i], b[i]);
        if (diff !== 0) return diff;
    }
    return a.length - b.length;
}

function comparePreReleasePart(a: string, b: string): number {
    const aIsNumber = /^\d+$/.test(a);
    const bIsNumber = /^\d+$/.test(b);
    if (aIsNumber && bIsNumber) return Number(a) - Number(b);
    if (aIsNumber !== bIsNumber) return aIsNumber ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

export interface WhatsNewState {
    /** The version the user last saw the notes for. Empty on a fresh install and for releases before this feature. */
    lastSeenVersion: string;
    currentVersion: string;
    enabled: boolean;
}

export function shouldShowWhatsNew(state: WhatsNewState): boolean {
    if (!state.enabled) return false;
    if (state.lastSeenVersion === "") return true;
    return compareVersions(state.currentVersion, state.lastSeenVersion) > 0;
}

/**
 * Notes newer than the last seen version, up to the running one, newest first. A release leaves out
 * the notes of pre-releases, so someone updating from 0.3.7 to 0.4.0 never sees the 0.4.0 betas' notes.
 */
export function notesSince(notes: ReleaseNote[], lastSeenVersion: string, currentVersion: string): ReleaseNote[] {
    const runningRelease = !isPreRelease(currentVersion);
    return notes
        .filter(note => compareVersions(note.version, currentVersion) <= 0)
        .filter(note => !(runningRelease && isPreRelease(note.version)))
        .filter(note => lastSeenVersion === ""
            ? compareVersions(note.version, currentVersion) === 0
            : compareVersions(note.version, lastSeenVersion) > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}
