/**
 * Release notes shown once after the plugin is updated, and the links shown with them.
 * When releasing a version, add its entry at the top of RELEASE_NOTES. A test checks that the
 * version in manifest.json has one, so the release workflow stops if it is missing.
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

/** Compares dotted version numbers by value, so 0.3.10 comes after 0.3.9. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
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

/** Notes newer than the last seen version, up to the running one, newest first. */
export function notesSince(notes: ReleaseNote[], lastSeenVersion: string, currentVersion: string): ReleaseNote[] {
    return notes
        .filter(note => compareVersions(note.version, currentVersion) <= 0)
        .filter(note => lastSeenVersion === ""
            ? compareVersions(note.version, currentVersion) === 0
            : compareVersions(note.version, lastSeenVersion) > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}
