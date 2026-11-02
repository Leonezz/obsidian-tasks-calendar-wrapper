/** Types for screenshot theme sets, installed-theme checks and appearance restoration. */

export type ThemeSet = "default" | "all";
export type ThemeName = "light" | "dark" | "blue-topaz-light" | "blue-topaz-dark";
export type ScreenshotMode = "screenshots" | "styles" | "ab";

/** Theme folder names and state-name prefixes, with the default themes first. */
export const THEMES: {
	readonly light: { readonly base: "moonstone"; readonly cssTheme: "" };
	readonly dark: { readonly base: "obsidian"; readonly cssTheme: "" };
	readonly "blue-topaz-light": { readonly base: "moonstone"; readonly cssTheme: "Blue Topaz" };
	readonly "blue-topaz-dark": { readonly base: "obsidian"; readonly cssTheme: "Blue Topaz" };
};

/** Return light and dark for default, or all four themes for all; throw for any other set. */
export function themeNames(set: string): ThemeName[];

export const POSITIONS: readonly ["top", "today", "bottom"];
export const COUNTERS: {
	readonly todo: "Todo Tasks";
	readonly overdue: "Overdue Tasks";
	readonly unplanned: "Unplanned Tasks";
};

export type ScreenshotPosition = (typeof POSITIONS)[number];
export type CounterBehavior = "Filter" | "Focus";

/** The existing planned state fields; only the extra fingerprint states have dimmed. */
export type ScreenshotShot = {
	name: string;
	theme: ThemeName;
	position: ScreenshotPosition;
	todayFocus: boolean;
	counter: "none" | keyof typeof COUNTERS;
	behavior: CounterBehavior | null;
	dimmed?: true;
	png: boolean;
	visible: boolean;
	styles: boolean;
};

export type ScreenshotGroup = {
	settings: { entryPosition: ScreenshotPosition; counterBehavior: CounterBehavior };
	shots: ScreenshotShot[];
};

/** Every ordinary state takes a PNG; only light states take visible text. */
export function takesPng(shot?: unknown): boolean;
export function takesVisible(shot: { readonly theme: string }): boolean;

/** Preserve the existing group and state order, filtering names by only; defaults to screenshots and default. */
export function plan(only: string, mode?: ScreenshotMode, themes?: ThemeSet): ScreenshotGroup[];

/** Match the longest known theme prefix followed by a hyphen; throw when no theme matches. */
export function themeOfState(name: string): ThemeName;

export type ThemePin = { version: string; themeCssSha256: string };
export type ThemePins = Readonly<Record<string, ThemePin>>;

/** Read .obsidian/themes/<cssTheme>/manifest.json and theme.css, hashing the CSS bytes with SHA-256. */
export function readInstalledTheme(input: { vaultPath: string; cssTheme: string }): ThemePin;

/**
 * Read the installed theme and require its version and SHA-256 to match pin. Missing pins name
 * `pnpm screenshots --pin-theme`. Read and check failures are one-line plain Errors naming paths,
 * found and pinned values where present, and manual installation or `--themes=default` as the fix.
 */
export function checkInstalledTheme(input: { vaultPath: string; cssTheme: string; pin?: ThemePin | null }): ThemePin;

/** Return a new manifest, preserving key order and existing pins; a new themePins key is last. */
export function withThemePin<T extends Readonly<Record<string, unknown>>>(
	manifest: T,
	pin: ThemePin & { cssTheme: string },
): Omit<T, "themePins"> & { themePins: ThemePins };

/**
 * Standalone window function: set the theme if different, await loadTheme, then verify the theme name,
 * config and stylesheet. Default requires empty text; a community theme requires sha256 matching the
 * UTF-8 stylesheet through crypto.subtle. Failures name expected and actual values, using length and
 * hash for the stylesheet, never its text. No module-scope dependencies.
 */
export function selectCssTheme(input: { cssTheme: string; sha256?: string }): Promise<void>;

/**
 * Standalone window function: set the original theme (null means the original config key was absent),
 * unset cssTheme for null, await loadTheme and saveConfig, then wait two seconds. No module closures.
 */
export function resetCssTheme(input: { cssTheme: string | null }): Promise<void>;

export type AppearanceBackup = { existed: boolean; bytes: Buffer; cssTheme: string | null };

/**
 * Remove a leftover .tcw-fixture-appearance.json.tmp; preserve an existing backup and return leftover:
 * true. Otherwise atomically write { existed, base64 } to .obsidian/.tcw-fixture-appearance.json
 * through the temporary file and return leftover: false.
 */
export function saveAppearanceBackup(vaultPath: string): { leftover: boolean };

/** Return null without a backup; corrupt backup data or original appearance JSON throws naming its file. */
export function readAppearanceBackup(vaultPath: string): AppearanceBackup | null;

/**
 * Synchronously restore the exact original bytes or absence, wait(2000), and verify the file again.
 * A mismatch throws naming the file and both values and keeps the backup; success removes the backup.
 * The default wait sleeps synchronously with Atomics.wait.
 */
export function restoreAppearanceFile(vaultPath: string, wait?: (milliseconds: number) => void): void;

/** True for a known theme outside the selected set; stray names are false, never an error. */
export function isOtherSetState(name: string, themes: ThemeSet): boolean;

/** Keep input order, excluding taken names and names belonging to the other theme set. */
export function statesToRemove(names: Iterable<string>, taken: ReadonlySet<string>, themes: ThemeSet): string[];

/** Baseline keys containing only, excluding states belonging to the other theme set. */
export function comparedBaselineNames(
	baselineShots: Readonly<Record<string, unknown>>,
	only: string,
	themes: ThemeSet,
): string[];

export type ScreenshotEnvironment = Readonly<Record<string, unknown>> & {
	appearance?: Readonly<Record<string, unknown>>;
	blueTopazAppearance?: Readonly<Record<string, unknown>>;
};

export type ScreenshotManifest = ScreenshotEnvironment & {
	note: string;
	takenAt: string;
	plugin: unknown;
	shots: Readonly<Record<string, unknown>>;
	themePins?: ThemePins;
};

export type StylesManifest = ScreenshotEnvironment & {
	note: string;
	takenAt: string;
	plugin: unknown;
	states: string[];
	probes: readonly { readonly name: string; readonly selector: string; readonly pseudo?: "::after" }[];
	properties: readonly string[];
	rootCustomProperties: readonly string[];
};

export type ManifestUpdate = {
	previous: (ScreenshotEnvironment & { shots?: Readonly<Record<string, unknown>>; themePins?: ThemePins }) | null;
	env: ScreenshotEnvironment;
	takenAt: string;
	plugin: unknown;
	shots: Readonly<Record<string, unknown>>;
	themes: ThemeSet;
};

/**
 * Return note (the existing screenshots.json text), ...env, takenAt, plugin, shots, then unchanged
 * previous.themePins when present. Preserve other-set shots in the canonical all-theme plan order,
 * with unknown states after. With no other-set shots, retain the run's order. For default, preserve
 * previous.blueTopazAppearance if env omits it, immediately after appearance.
 */
export function updatedManifest(input: ManifestUpdate): ScreenshotManifest;

/**
 * Return the existing styles.json note and environment, takenAt, plugin, sorted states including
 * other-set previous.states, probes, properties and rootCustomProperties. Preserve Blue Topaz
 * appearance the same way as updatedManifest.
 */
export function updatedStylesManifest(
	input: Omit<ManifestUpdate, "previous"> & {
		previous: (ScreenshotEnvironment & { states?: readonly string[] }) | null;
		probes: StylesManifest["probes"];
		properties: readonly string[];
		rootCustomProperties: readonly string[];
	},
): StylesManifest;

/** Include --themes=all for a blue-topaz-* theme; otherwise return the existing styles update command. */
export function styleUpdateCommand(theme: string): string;

/** The problem reported for a state with no PNG; a blue-topaz-* state also names the recording command. */
export function missingPngBaseline(name: string): string;

/** Appearance setting keys mapped to their unchanged Obsidian settings names for warnings. */
export const APPEARANCE: {
	readonly accentColor: "accent colour";
	readonly baseFontSize: "font size";
	readonly interfaceFontFamily: "interface font";
	readonly textFontFamily: "text font";
	readonly monospaceFontFamily: "monospace font";
	readonly cssTheme: "community theme";
	readonly enabledCssSnippets: "CSS snippets";
	readonly showRibbon: "ribbon";
	readonly zoom: "zoom level";
	readonly timelineFont: "font of the timeline, as the browser computes it";
	readonly display: "display the window is on";
};

/**
 * Warn about differing setup and appearance values with the existing text; absent env.appearance
 * is skipped. Compare env.blueTopazAppearance when present, labelling it `${label} (Blue Topaz)`.
 * label defaults to "the baselines".
 */
export function warnAboutSetup(baseline: ScreenshotEnvironment, env: ScreenshotEnvironment, label?: string): void;
