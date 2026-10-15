/**
 * Release notes shown once after the plugin is updated, and the links shown with them.
 * When releasing a version, add its entry at the top of RELEASE_NOTES. A test checks that the
 * version in manifest.json has one, so the release workflow stops if it is missing.
 * A pre-release such as 0.4.0-beta.1 gets its own entry for testers, but users of 0.4.0 only see the
 * 0.4.0 entry, so that entry has to cover everything its betas changed.
 */

export interface ReleaseNote {
    version: string;
    items: string[];
}

export interface SupportLink {
    label: string;
    url: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
    {
        version: "0.4.0-beta.1",
        items: [
            "With the \"Focus\" counter behaviour, a counter, whether clicked or turned on by \"Activate Filter On Load\", now highlights its tasks and keeps the rest of the timeline visible, instead of hiding them like \"Filter\".",
            "This version needs Obsidian 1.11.0 or later.",
            "This beta rebuilds the plugin with newer tools, as groundwork for 0.4. Nothing else should look or work differently; if something does, please open an issue on GitHub.",
        ],
    },
    {
        version: "0.3.7",
        items: [
            "The timeline no longer freezes Obsidian while you type. Saving a note without tasks no longer reloads it, and in a vault with 4,000 tasks the pause after saving a note with tasks went from about 2.5 seconds to about 0.3 seconds.",
            "Memory use no longer grows with every save, and closing the timeline frees its memory.",
            "Open tasks are no longer shown with a ticked checkbox, and clicking a task's checkbox toggles that task instead of the first one on the page.",
        ],
    },
    {
        version: "0.3.6",
        items: [
            "This dialog: after each update it shows what changed, with links to star the plugin and to support its development. Turn it off in the settings, or reopen it any time with the \"Show what's new\" command.",
            "Daily notes whose format has folders, such as YYYY/MMM/Wo/ddd, are recognised, so their tasks get the note's date.",
        ],
    },
    {
        version: "0.3.5",
        items: [
            "Tasks in large notes, or in notes another plugin makes slow to read, no longer go missing.",
            "New options: hide subtasks, hide the modify badge, and show tasks that have started or were scheduled before today on today.",
            "Hiding a tag now also hides its subtags.",
            "A task in a daily note is no longer shown on several days at once.",
            "Dataview style [start:: ] and [completion:: ] dates are read.",
            "Quick entry adds tasks to a note the timeline can read, and never above the frontmatter.",
            "A missing Tasks plugin is reported instead of clicks doing nothing.",
        ],
    },
];

/** Shown under the release notes. Keep in sync with fundingUrl in manifest.json; a test checks it. */
export const SUPPORT_LINKS: SupportLink[] = [
    { label: "Buy Me a Coffee", url: "https://buymeacoffee.com/zhuwenqa" },
    { label: "Ko-fi", url: "https://ko-fi.com/zhuwenqa" },
    { label: "Patreon", url: "https://patreon.com/zhuwenq" },
    { label: "PayPal", url: "https://www.paypal.com/paypalme/zhuwenq" },
];

/** Where the star button leads. */
export const REPOSITORY_URL = "https://github.com/Leonezz/obsidian-tasks-calendar-wrapper";

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
