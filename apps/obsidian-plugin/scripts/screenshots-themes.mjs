/** Theme sets, installed-theme checks and appearance restoration for the screenshot tooling. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

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

/** What blueTopazAppearance also records about the installed theme file. */
const THEME_FILE = { themeVersion: "theme version", themeCssSha256: "theme.css sha256" };

export function themeNames(set) {
	if (set === "default") return ["light", "dark"];
	if (set === "all") return Object.keys(THEMES);
	throw new Error(`unknown theme set ${JSON.stringify(set)}; use default or all.`);
}

/** Every state has a screenshot. A smaller set would keep fewer megabytes in git; this is the place to pick one. */
export function takesPng() {
	return true;
}

/** Which elements are displayed does not depend on the theme, so only light states get a visible/<state>.txt. */
export function takesVisible({ theme }) {
	return theme === "light";
}

/** The screenshots whose name contains `only`, grouped by the settings that need the plugin loaded again. */
export function plan(only, mode = "screenshots", themes = "default") {
	const groups = [];
	const wanted = (shot) => (shot.png || shot.visible || shot.styles) && shot.name.includes(only);
	for (const position of POSITIONS) {
		for (const behavior of ["Filter", "Focus"]) {
			// Without an active counter the behaviour changes nothing, so that state is taken once.
			const counters = behavior === "Filter" ? ["none", ...Object.keys(COUNTERS)] : Object.keys(COUNTERS);
			const shots = [];
			for (const theme of themeNames(themes)) {
				for (const todayFocus of [false, true]) {
					for (const counter of counters) {
						const name = [
							theme,
							position,
							todayFocus ? "today-focus" : "all-days",
							counter === "none" ? "no-counter" : `${counter}-${behavior.toLowerCase()}`,
						].join("-");
						const state = {
							name,
							theme,
							position,
							todayFocus,
							counter,
							behavior: counter === "none" ? null : behavior,
						};
						shots.push({
							...state,
							png: mode !== "styles" && takesPng(state),
							visible: mode !== "styles" && takesVisible(state),
							styles: mode !== "screenshots",
						});
					}
				}
			}
			const selected = shots.filter(wanted);
			if (selected.length > 0)
				groups.push({ settings: { entryPosition: position, counterBehavior: behavior }, shots: selected });
		}
	}
	if (mode !== "screenshots") {
		for (const theme of themeNames(themes)) {
			const shot = {
				name: `${theme}-row-dimmed`,
				theme,
				position: "today",
				todayFocus: false,
				counter: "none",
				behavior: null,
				dimmed: true,
				png: false,
				visible: false,
				styles: true,
			};
			if (wanted(shot))
				groups.push({ settings: { entryPosition: "today", counterBehavior: "Filter" }, shots: [shot] });
		}
	}
	return groups;
}

export function themeOfState(name) {
	const theme = themeNames("all")
		.sort((a, b) => b.length - a.length)
		.find((theme) => name.startsWith(`${theme}-`));
	if (!theme) throw new Error(`no theme in state name ${JSON.stringify(name)}.`);
	return theme;
}

function installedTheme({ vaultPath, cssTheme, pin }) {
	const folder = path.join(vaultPath, ".obsidian", "themes", cssTheme);
	const problem = (file, found) =>
		new Error(
			`${JSON.stringify(file)}: found ${found}${pin ? `; pinned ${JSON.stringify(pin)}` : ""}; install the pinned version by hand, or use --themes=default.`,
		);
	try {
		if (!statSync(folder).isDirectory()) throw new Error("not a folder");
	} catch (error) {
		throw problem(folder, JSON.stringify(error.message));
	}
	const manifestFile = path.join(folder, "manifest.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
	} catch (error) {
		throw problem(manifestFile, JSON.stringify(error.message));
	}
	if (typeof manifest?.version !== "string")
		throw problem(manifestFile, `version ${JSON.stringify(manifest?.version)}`);
	const cssFile = path.join(folder, "theme.css");
	let bytes;
	try {
		bytes = readFileSync(cssFile);
	} catch (error) {
		throw problem(cssFile, JSON.stringify(error.message));
	}
	return { version: manifest.version, themeCssSha256: createHash("sha256").update(bytes).digest("hex") };
}

export function readInstalledTheme({ vaultPath, cssTheme }) {
	return installedTheme({ vaultPath, cssTheme });
}

export function checkInstalledTheme({ vaultPath, cssTheme, pin }) {
	const found = installedTheme({ vaultPath, cssTheme, pin });
	const folder = path.join(vaultPath, ".obsidian", "themes", cssTheme);
	if (!pin)
		throw new Error(
			`${JSON.stringify(folder)}: found ${JSON.stringify(found)}, no pinned theme; use pnpm screenshots --pin-theme to record it, install the pinned version by hand, or use --themes=default.`,
		);
	for (const [key, file] of [
		["version", "manifest.json"],
		["themeCssSha256", "theme.css"],
	]) {
		if (found[key] !== pin[key])
			throw new Error(
				`${JSON.stringify(path.join(folder, file))}: found ${key} ${JSON.stringify(found[key])}, pinned ${JSON.stringify(pin[key])}; install the pinned version by hand, or use --themes=default.`,
			);
	}
	return found;
}

export function withThemePin(manifest, { cssTheme, version, themeCssSha256 }) {
	return { ...manifest, themePins: { ...manifest.themePins, [cssTheme]: { version, themeCssSha256 } } };
}

/** Standalone for cli.evaluate: both the configuration and the loaded stylesheet must identify the theme. */
export async function selectCssTheme({ cssTheme, sha256 }) {
	const failures = [];
	try {
		if (cssTheme && !sha256) throw new Error("a community theme requires sha256");
		if (app.customCss.theme !== cssTheme) app.customCss.setTheme(cssTheme);
		await app.customCss.loadTheme();
	} catch (error) {
		failures.push(String(error?.message ?? error));
	}
	const actualTheme = app.customCss?.theme;
	let actualConfig;
	try {
		actualConfig = app.vault.getConfig("cssTheme") ?? "";
	} catch (error) {
		failures.push(String(error?.message ?? error));
	}
	const text = app.customCss?.styleEl?.textContent;
	let hash = "unavailable";
	try {
		if (typeof text !== "string") throw new Error("stylesheet text is unavailable");
		hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))))
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
	} catch (error) {
		failures.push(String(error?.message ?? error));
	}
	if (
		failures.length ||
		actualTheme !== cssTheme ||
		actualConfig !== cssTheme ||
		(cssTheme === "" ? text !== "" : hash !== sha256)
	)
		throw new Error(
			`expected customCss.theme and cssTheme config ${JSON.stringify(cssTheme)}, stylesheet ${cssTheme === "" ? "length 0" : `sha256 ${JSON.stringify(sha256)}`}; actual customCss.theme ${JSON.stringify(actualTheme)}, cssTheme config ${JSON.stringify(actualConfig)}, stylesheet length ${typeof text === "string" ? text.length : "unavailable"}, sha256 ${hash}${failures.length ? `; ${JSON.stringify(failures.join("; "))}` : ""}.`,
		);
}

/** Flush the original setting before the node-side undo restores the exact appearance.json bytes. */
export async function resetCssTheme({ cssTheme }) {
	app.customCss.setTheme(cssTheme ?? "");
	if (cssTheme === null) app.vault.setConfig("cssTheme", undefined);
	await app.customCss.loadTheme();
	await app.vault.saveConfig();
	await new Promise((resolve) => setTimeout(resolve, 2000));
}

function appearanceFiles(vaultPath) {
	const folder = path.join(vaultPath, ".obsidian");
	return {
		appearance: path.join(folder, "appearance.json"),
		backup: path.join(folder, ".tcw-fixture-appearance.json"),
		temporary: path.join(folder, ".tcw-fixture-appearance.json.tmp"),
	};
}

export function saveAppearanceBackup(vaultPath) {
	const files = appearanceFiles(vaultPath);
	rmSync(files.temporary, { force: true });
	if (existsSync(files.backup)) return { leftover: true };
	const existed = existsSync(files.appearance);
	const bytes = existed ? readFileSync(files.appearance) : Buffer.alloc(0);
	writeFileSync(files.temporary, JSON.stringify({ existed, base64: bytes.toString("base64") }));
	renameSync(files.temporary, files.backup);
	return { leftover: false };
}

export function readAppearanceBackup(vaultPath) {
	const files = appearanceFiles(vaultPath);
	if (!existsSync(files.backup)) return null;
	let backup;
	let bytes;
	try {
		backup = JSON.parse(readFileSync(files.backup, "utf8"));
		if (typeof backup?.existed !== "boolean" || typeof backup.base64 !== "string")
			throw new Error("expected existed and base64");
		bytes = Buffer.from(backup.base64, "base64");
		if (bytes.toString("base64") !== backup.base64 || (!backup.existed && bytes.length !== 0))
			throw new Error("invalid base64 backup bytes");
	} catch (error) {
		throw new Error(
			`could not read appearance backup ${JSON.stringify(files.backup)}: ${JSON.stringify(error.message)}.`,
		);
	}
	let cssTheme = null;
	if (backup.existed) {
		try {
			const original = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
			if (!original || typeof original !== "object" || Array.isArray(original))
				throw new Error("expected an appearance object");
			if (Object.hasOwn(original, "cssTheme")) {
				if (typeof original.cssTheme !== "string") throw new Error("expected a string cssTheme");
				cssTheme = original.cssTheme;
			}
		} catch (error) {
			throw new Error(
				`corrupt original ${JSON.stringify(files.appearance)} in ${JSON.stringify(files.backup)}: ${JSON.stringify(error.message)}.`,
			);
		}
	}
	return { existed: backup.existed, bytes, cssTheme };
}

const syncSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function restoreAppearanceFile(vaultPath, wait = syncSleep) {
	const backup = readAppearanceBackup(vaultPath);
	if (!backup) return;
	const files = appearanceFiles(vaultPath);
	if (backup.existed) writeFileSync(files.appearance, backup.bytes);
	else rmSync(files.appearance, { force: true });
	wait(2000);
	const actual = existsSync(files.appearance) ? readFileSync(files.appearance) : null;
	if (backup.existed ? actual === null || !actual.equals(backup.bytes) : actual !== null)
		throw new Error(
			`restoring ${JSON.stringify(files.appearance)} did not hold: expected ${backup.existed ? `base64 ${JSON.stringify(backup.bytes.toString("base64"))}` : "no file"}, found ${actual === null ? "no file" : `base64 ${JSON.stringify(actual.toString("base64"))}`}; kept ${JSON.stringify(files.backup)}.`,
		);
	rmSync(files.backup);
}

export function isOtherSetState(name, themes) {
	const selected = themeNames(themes);
	return themeNames("all").some((theme) => !selected.includes(theme) && name.startsWith(`${theme}-`));
}

export function statesToRemove(names, taken, themes) {
	return [...names].filter((name) => !taken.has(name) && !isOtherSetState(name, themes));
}

export function comparedBaselineNames(baselineShots, only, themes) {
	return Object.keys(baselineShots).filter((name) => name.includes(only) && !isOtherSetState(name, themes));
}

function appearanceEnvironment(previous, env, themes) {
	const blueTopazAppearance = Object.hasOwn(env, "blueTopazAppearance")
		? env.blueTopazAppearance
		: themes === "default"
			? previous?.blueTopazAppearance
			: undefined;
	if (blueTopazAppearance === undefined) return { ...env };
	if (!Object.hasOwn(env, "appearance")) return { ...env, blueTopazAppearance };
	return Object.fromEntries(
		Object.entries(env)
			.filter(([key]) => key !== "blueTopazAppearance")
			.flatMap(([key, value]) =>
				key === "appearance"
					? [
							[key, value],
							["blueTopazAppearance", blueTopazAppearance],
						]
					: [[key, value]],
			),
	);
}

export function updatedManifest({ previous, env, takenAt, plugin, shots, themes }) {
	const kept = Object.fromEntries(
		Object.entries(previous?.shots ?? {}).filter(([name]) => isOtherSetState(name, themes)),
	);
	const combined = { ...kept, ...shots };
	const names = Object.keys(kept).length
		? [
				...new Set([
					...plan("", "screenshots", "all").flatMap((group) => group.shots.map(({ name }) => name)),
					...Object.keys(combined),
				]),
			].filter((name) => Object.hasOwn(combined, name))
		: Object.keys(shots);
	return {
		note: "Taken by apps/obsidian-plugin/scripts/screenshots.mjs (`pnpm screenshots --update`). Do not edit by hand.",
		...appearanceEnvironment(previous, env, themes),
		takenAt,
		plugin,
		shots: Object.fromEntries(names.map((name) => [name, combined[name]])),
		...(previous && Object.hasOwn(previous, "themePins") ? { themePins: previous.themePins } : {}),
	};
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
	return {
		note: "Taken by apps/obsidian-plugin/scripts/screenshots.mjs (`pnpm screenshots --styles --update`). Do not edit by hand.",
		...appearanceEnvironment(previous, env, themes),
		takenAt,
		plugin,
		states: [
			...new Set([
				...Object.keys(shots),
				...(previous?.states ?? []).filter((name) => isOtherSetState(name, themes)),
			]),
		].sort(),
		probes,
		properties,
		rootCustomProperties,
	};
}

export function styleUpdateCommand(theme) {
	return theme.startsWith("blue-topaz-")
		? "pnpm screenshots --styles --themes=all --update"
		: "pnpm screenshots --styles --update";
}

export function missingPngBaseline(name) {
	return name.startsWith("blue-topaz-")
		? "has no screenshot baseline; run `pnpm screenshots --themes=all --update` to record it"
		: "has no screenshot baseline";
}

/** Warns about each thing that decides the pixels and differs between the baselines and this run. */
export function warnAboutSetup(baseline, env, label = "the baselines") {
	for (const key of ["obsidianVersion", "electron", "machine", "viewportWidth", "today"]) {
		if (JSON.stringify(baseline[key]) !== JSON.stringify(env[key])) {
			console.warn(
				`screenshots: warning: ${label} were taken with ${key} ${JSON.stringify(baseline[key])}, this run has ${JSON.stringify(env[key])}; pixels may differ for that reason alone.`,
			);
		}
	}
	for (const [appearance, appearanceLabel, settings] of [
		["appearance", label, APPEARANCE],
		["blueTopazAppearance", `${label} (Blue Topaz)`, { ...APPEARANCE, ...THEME_FILE }],
	]) {
		if (env[appearance] === undefined) continue;
		for (const [key, setting] of Object.entries(settings)) {
			const before = baseline[appearance]?.[key];
			if (JSON.stringify(before) !== JSON.stringify(env[appearance][key])) {
				const was =
					before === undefined
						? `${appearanceLabel} do not record the ${setting} (${key})`
						: `${appearanceLabel} were taken with the ${setting} (${key}) ${JSON.stringify(before)}`;
				console.warn(
					`screenshots: warning: ${was}, this run has ${JSON.stringify(env[appearance][key])}; pixels may differ for that reason alone.`,
				);
			}
		}
	}
}
