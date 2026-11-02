/** Theme sets, installed-theme checks and appearance restoration for the screenshot tooling. */

export const THEMES = {
	light: { base: "moonstone", cssTheme: "" },
	dark: { base: "obsidian", cssTheme: "" },
	"blue-topaz-light": { base: "moonstone", cssTheme: "Blue Topaz" },
	"blue-topaz-dark": { base: "obsidian", cssTheme: "Blue Topaz" },
};

export const POSITIONS = ["top", "today", "bottom"];
export const COUNTERS = { todo: "Todo Tasks", overdue: "Overdue Tasks", unplanned: "Unplanned Tasks" };

/** The appearance settings recorded in screenshots.json, with their names in Obsidian's settings for the warnings. */
export const APPEARANCE = {
	accentColor: "accent colour",
	baseFontSize: "font size",
	interfaceFontFamily: "interface font",
	textFontFamily: "text font",
	monospaceFontFamily: "monospace font",
	cssTheme: "community theme",
	enabledCssSnippets: "CSS snippets",
	showRibbon: "ribbon",
	zoom: "zoom level",
	timelineFont: "font of the timeline, as the browser computes it",
	// Chrome converts screenshots into the colour space of the display the window is on.
	display: "display the window is on",
};

export function themeNames(set) {
	throw new Error("not implemented");
}

export function takesPng() {
	throw new Error("not implemented");
}

export function takesVisible({ theme }) {
	throw new Error("not implemented");
}

export function plan(only, mode = "screenshots", themes = "default") {
	throw new Error("not implemented");
}

export function themeOfState(name) {
	throw new Error("not implemented");
}

export function readInstalledTheme({ vaultPath, cssTheme }) {
	throw new Error("not implemented");
}

export function checkInstalledTheme({ vaultPath, cssTheme, pin }) {
	throw new Error("not implemented");
}

export function withThemePin(manifest, { cssTheme, version, themeCssSha256 }) {
	throw new Error("not implemented");
}

export async function selectCssTheme({ cssTheme, sha256 }) {
	throw new Error("not implemented");
}

export async function resetCssTheme({ cssTheme }) {
	throw new Error("not implemented");
}

export function saveAppearanceBackup(vaultPath) {
	throw new Error("not implemented");
}

export function readAppearanceBackup(vaultPath) {
	throw new Error("not implemented");
}

export function restoreAppearanceFile(vaultPath, wait) {
	throw new Error("not implemented");
}

export function isOtherSetState(name, themes) {
	throw new Error("not implemented");
}

export function statesToRemove(names, taken, themes) {
	throw new Error("not implemented");
}

export function comparedBaselineNames(baselineShots, only, themes) {
	throw new Error("not implemented");
}

export function updatedManifest({ previous, env, takenAt, plugin, shots, themes }) {
	throw new Error("not implemented");
}

export function updatedStylesManifest({
	previous,
	env,
	takenAt,
	plugin,
	shots,
	probes,
	properties,
	rootCustomProperties,
	themes,
}) {
	throw new Error("not implemented");
}

export function styleUpdateCommand(theme) {
	throw new Error("not implemented");
}

export function warnAboutSetup(baseline, env, label = "the baselines") {
	throw new Error("not implemented");
}
