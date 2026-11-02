import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
	THEMES,
	POSITIONS,
	COUNTERS,
	themeNames,
	takesPng,
	takesVisible,
	plan,
	themeOfState,
	readInstalledTheme,
	checkInstalledTheme,
	withThemePin,
	saveAppearanceBackup,
	readAppearanceBackup,
	restoreAppearanceFile,
	isOtherSetState,
	missingPngBaseline,
	statesToRemove,
	comparedBaselineNames,
	updatedManifest,
	updatedStylesManifest,
	styleUpdateCommand,
	warnAboutSetup,
} from "../scripts/screenshots-themes.mjs";
import { FIXTURES } from "./golden-vault";

const cssTheme = "Blue Topaz";
const css = ".theme-light { color: rgb(1, 2, 3); }\n";
const pin = { version: "1.2.3", themeCssSha256: createHash("sha256").update(css).digest("hex") };
const takenAt = "2026-11-03";
const plugin = { version: "0.3.7", commit: "fixture", uncommittedChanges: false };
const screenshotNote =
	"Taken by apps/obsidian-plugin/scripts/screenshots.mjs (`pnpm screenshots --update`). Do not edit by hand.";
const stylesNote =
	"Taken by apps/obsidian-plugin/scripts/screenshots.mjs (`pnpm screenshots --styles --update`). Do not edit by hand.";

function temporaryVault(t: TestContext): string {
	const vaultPath = mkdtempSync(path.join(tmpdir(), "screenshots-themes-"));
	t.after(() => rmSync(vaultPath, { recursive: true, force: true }));
	mkdirSync(path.join(vaultPath, ".obsidian"));
	return vaultPath;
}

function installTheme(vaultPath: string): string {
	const folder = path.join(vaultPath, ".obsidian", "themes", cssTheme);
	mkdirSync(folder, { recursive: true });
	writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: cssTheme, version: pin.version }));
	writeFileSync(path.join(folder, "theme.css"), css);
	return folder;
}

function themeError(run: () => unknown, expected: readonly string[]): void {
	assert.throws(run, (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.equal(error.constructor, Error);
		assert.doesNotMatch(error.message, /[\r\n]/);
		for (const text of expected) assert.ok(error.message.includes(text), `${error.message} must name ${text}`);
		return true;
	});
}

function appearanceFiles(vaultPath: string) {
	return {
		appearance: path.join(vaultPath, ".obsidian", "appearance.json"),
		backup: path.join(vaultPath, ".obsidian", ".tcw-fixture-appearance.json"),
		temporary: path.join(vaultPath, ".obsidian", ".tcw-fixture-appearance.json.tmp"),
	};
}

test("the default set is the two default themes and all adds Blue Topaz", () => {
	assert.deepEqual(THEMES, {
		light: { base: "moonstone", cssTheme: "" },
		dark: { base: "obsidian", cssTheme: "" },
		"blue-topaz-light": { base: "moonstone", cssTheme },
		"blue-topaz-dark": { base: "obsidian", cssTheme },
	});
	assert.deepEqual(themeNames("default"), ["light", "dark"]);
	assert.deepEqual(themeNames("all"), ["light", "dark", "blue-topaz-light", "blue-topaz-dark"]);
	for (const invalid of ["", "blue", "light"]) assert.throws(() => themeNames(invalid));
	assert.deepEqual(POSITIONS, ["top", "today", "bottom"]);
	assert.deepEqual(COUNTERS, { todo: "Todo Tasks", overdue: "Overdue Tasks", unplanned: "Unplanned Tasks" });
	for (const theme of themeNames("all")) {
		assert.equal(takesPng({ theme }), true);
		assert.equal(takesVisible({ theme }), theme === "light");
		assert.equal(
			styleUpdateCommand(theme),
			theme.startsWith("blue-topaz-")
				? "pnpm screenshots --styles --themes=all --update"
				: "pnpm screenshots --styles --update",
		);
	}
});

test("the default plan takes the recorded states in the recorded order", () => {
	const baseline = JSON.parse(readFileSync(path.join(FIXTURES, "screenshots", "screenshots.json"), "utf8")) as {
		shots: Record<string, unknown>;
	};
	const groups = plan("", "screenshots", "default");
	const shots = groups.flatMap((group) => group.shots);
	assert.deepEqual(
		shots.map(({ name }) => name),
		Object.keys(baseline.shots).filter((name) => !name.startsWith("blue-topaz-")),
	);
	assert.deepEqual(plan(""), groups);
	assert.deepEqual(shots[0], {
		name: "light-top-all-days-no-counter",
		theme: "light",
		position: "top",
		todayFocus: false,
		counter: "none",
		behavior: null,
		png: true,
		visible: true,
		styles: false,
	});
	assert.deepEqual(Object.keys(shots[0]), [
		"name",
		"theme",
		"position",
		"todayFocus",
		"counter",
		"behavior",
		"png",
		"visible",
		"styles",
	]);
	assert.ok(shots.every((shot) => Object.keys(shot).join() === Object.keys(shots[0]).join()));
	assert.deepEqual(
		plan("light-top-all-days-no-counter").flatMap((group) => group.shots),
		[shots[0]],
	);
});

test("a --themes=all plan takes 168 PNGs, 172 fingerprints and 42 visible", () => {
	const shots = plan("", "ab", "all").flatMap((group) => group.shots);
	assert.equal(shots.filter(({ png }) => png).length, 168);
	assert.equal(shots.filter(({ styles }) => styles).length, 172);
	assert.equal(shots.filter(({ visible }) => visible).length, 42);
	assert.ok(shots.filter(({ visible }) => visible).every(({ theme }) => theme === "light"));
	assert.equal(new Set(shots.map(({ name }) => name)).size, 172);
	assert.ok(shots.some(({ name }) => name === "blue-topaz-light-top-all-days-no-counter"));
	assert.ok(shots.some(({ name }) => name === "blue-topaz-dark-top-all-days-no-counter"));
	assert.deepEqual(
		shots.filter(({ dimmed }) => dimmed).map(({ name }) => name),
		["light-row-dimmed", "dark-row-dimmed", "blue-topaz-light-row-dimmed", "blue-topaz-dark-row-dimmed"],
	);
	const styles = plan("", "styles", "all").flatMap((group) => group.shots);
	assert.equal(styles.length, 172);
	assert.ok(styles.every((shot) => shot.styles && !shot.png && !shot.visible));
});

test("themeOfState reads every theme's state names", () => {
	for (const theme of ["light", "dark", "blue-topaz-light", "blue-topaz-dark"])
		for (const suffix of ["x", "top-all-days-no-counter", "row-dimmed"])
			assert.equal(themeOfState(`${theme}-${suffix}`), theme);
});

test("themeOfState refuses a name of no theme", () => {
	for (const name of ["", "foo", "light", "dark", "lightning-x", "blue-topaz-light", "blue-topaz-lightning-x"])
		assert.throws(() => themeOfState(name), { name: "Error" });
});

test("a missing theme is an error that says how to install it", (t) => {
	for (const missing of ["folder", "theme.css", "manifest.json", "unparsable", "version"] as const) {
		const vaultPath = temporaryVault(t);
		const folder = path.join(vaultPath, ".obsidian", "themes", cssTheme);
		if (missing !== "folder") {
			installTheme(vaultPath);
			if (missing === "theme.css" || missing === "manifest.json") rmSync(path.join(folder, missing));
			if (missing === "unparsable") writeFileSync(path.join(folder, "manifest.json"), "{");
			if (missing === "version") writeFileSync(path.join(folder, "manifest.json"), '{"version":123}');
		}
		const file =
			missing === "folder" ? folder : path.join(folder, missing === "theme.css" ? missing : "manifest.json");
		for (const run of [
			() => readInstalledTheme({ vaultPath, cssTheme }),
			() => checkInstalledTheme({ vaultPath, cssTheme, pin }),
		])
			themeError(run, [file, "--themes=default"]);
	}
});

test("a missing pin is an error that names --pin-theme", (t) => {
	const vaultPath = temporaryVault(t);
	const folder = installTheme(vaultPath);
	themeError(
		() => checkInstalledTheme({ vaultPath, cssTheme }),
		[folder, "pnpm screenshots --pin-theme", "--themes=default"],
	);
});

test("a theme.css with another sha256 is an error that names both", (t) => {
	const vaultPath = temporaryVault(t);
	const folder = installTheme(vaultPath);
	const changedCss = `${css}.theme-dark { color: red; }\n`;
	writeFileSync(path.join(folder, "theme.css"), changedCss);
	const found = createHash("sha256").update(changedCss).digest("hex");
	themeError(
		() => checkInstalledTheme({ vaultPath, cssTheme, pin }),
		[path.join(folder, "theme.css"), found, pin.themeCssSha256, "--themes=default"],
	);
});

test("a manifest with another version is an error that names both", (t) => {
	const vaultPath = temporaryVault(t);
	const folder = installTheme(vaultPath);
	writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ version: "9.8.7" }));
	themeError(
		() => checkInstalledTheme({ vaultPath, cssTheme, pin }),
		[path.join(folder, "manifest.json"), "9.8.7", pin.version, "--themes=default"],
	);
});

test("the installed pinned theme passes", (t) => {
	const vaultPath = temporaryVault(t);
	installTheme(vaultPath);
	assert.deepEqual(readInstalledTheme({ vaultPath, cssTheme }), pin);
	assert.deepEqual(checkInstalledTheme({ vaultPath, cssTheme, pin }), pin);
});

test("a default run keeps the other set's baselines", () => {
	const blueLight = "blue-topaz-light-top-all-days-no-counter";
	const blueDark = "blue-topaz-dark-bottom-all-days-no-counter";
	const extra = "blue-topaz-light-extra";
	const current = "light-top-all-days-no-counter";
	const previous = {
		shots: {
			[blueDark]: { marker: "dark" },
			[extra]: { marker: "extra" },
			[blueLight]: { marker: "light" },
			"light-gone": { marker: "gone" },
			foo: { marker: "stray" },
		},
	};
	const shots = { [current]: { marker: "current" } };
	const before = structuredClone(previous);
	assert.deepEqual(statesToRemove(Object.keys(previous.shots), new Set([current]), "default"), ["light-gone", "foo"]);
	assert.equal(isOtherSetState(blueLight, "default"), true);
	assert.equal(isOtherSetState(blueDark, "all"), false);
	assert.equal(isOtherSetState("blue-topaz-lightning-x", "default"), false);
	assert.equal(isOtherSetState("foo", "default"), false);
	const record = updatedManifest({ previous, env: {}, takenAt, plugin, shots, themes: "default" });
	assert.deepEqual(Object.keys(record.shots), [current, blueLight, blueDark, extra]);
	assert.deepEqual(record.shots, {
		...shots,
		[blueLight]: previous.shots[blueLight],
		[blueDark]: previous.shots[blueDark],
		[extra]: previous.shots[extra],
	});
	assert.deepEqual(previous, before);
	assert.deepEqual(updatedManifest({ previous: null, env: {}, takenAt, plugin, shots, themes: "default" }), {
		note: screenshotNote,
		takenAt,
		plugin,
		shots,
	});
});

test("a default compare does not report the other set's baselines", () => {
	const baselineShots = { "light-x": {}, "blue-topaz-light-x": {}, "dark-y": {}, "blue-topaz-dark-y": {}, foo: {} };
	assert.deepEqual(comparedBaselineNames(baselineShots, "", "default"), ["light-x", "dark-y", "foo"]);
	assert.deepEqual(comparedBaselineNames(baselineShots, "x", "default"), ["light-x"]);
	assert.deepEqual(comparedBaselineNames(baselineShots, "x", "all"), ["light-x", "blue-topaz-light-x"]);
	assert.deepEqual(comparedBaselineNames(baselineShots, "", "all"), Object.keys(baselineShots));
});

test("an update of a set still removes that set's state no longer taken", () => {
	const names = ["light-kept", "light-gone", "blue-topaz-light-gone", "foo"];
	const taken = new Set(["light-kept"]);
	assert.deepEqual(statesToRemove(names, taken, "default"), ["light-gone", "foo"]);
	assert.deepEqual(statesToRemove(new Set(names), taken, "all"), ["light-gone", "blue-topaz-light-gone", "foo"]);
	assert.deepEqual([...taken], ["light-kept"]);
});

test("an update keeps the theme pin", () => {
	const themePins = { [cssTheme]: pin, Other: { version: "2", themeCssSha256: "b".repeat(64) } };
	const previous = { note: "old", themePins, shots: {} };
	const env = { obsidianVersion: "1.14.5", appearance: { cssTheme: "" }, viewportWidth: 600 };
	const before = structuredClone(previous);
	for (const themes of ["default", "all"] as const) {
		const record = updatedManifest({ previous, env, takenAt, plugin, shots: {}, themes });
		assert.deepEqual(record, { note: screenshotNote, ...env, takenAt, plugin, shots: {}, themePins });
		assert.deepEqual(Object.keys(record), [
			"note",
			"obsidianVersion",
			"appearance",
			"viewportWidth",
			"takenAt",
			"plugin",
			"shots",
			"themePins",
		]);
		assert.deepEqual(record.themePins, themePins);
	}
	assert.deepEqual(previous, before);
});

test("a default update keeps blueTopazAppearance and the other set's styles states", () => {
	const blueTopazAppearance = { cssTheme, accentColor: "#123456" };
	const previous = {
		blueTopazAppearance,
		shots: { "blue-topaz-light-x": { marker: "kept" } },
		states: ["blue-topaz-dark-row-dimmed", "light-gone", "blue-topaz-light-x"],
	};
	const env = { obsidianVersion: "1.14.5", appearance: { cssTheme: "" }, viewportWidth: 600 };
	const shots = { "light-x": {}, "dark-x": {} };
	const probes = [{ name: ".taskido", selector: ".taskido" }];
	const properties = ["color"];
	const rootCustomProperties = ["--taskido-color-focus"];
	const args = { previous, env, takenAt, plugin, shots, themes: "default" as const };
	const record = updatedManifest(args);
	assert.deepEqual(record.blueTopazAppearance, blueTopazAppearance);
	assert.deepEqual(Object.keys(record), [
		"note",
		"obsidianVersion",
		"appearance",
		"blueTopazAppearance",
		"viewportWidth",
		"takenAt",
		"plugin",
		"shots",
	]);
	const styles = updatedStylesManifest({ ...args, probes, properties, rootCustomProperties });
	assert.deepEqual(styles, {
		note: stylesNote,
		obsidianVersion: env.obsidianVersion,
		appearance: env.appearance,
		blueTopazAppearance,
		viewportWidth: env.viewportWidth,
		takenAt,
		plugin,
		states: ["blue-topaz-dark-row-dimmed", "blue-topaz-light-x", "dark-x", "light-x"],
		probes,
		properties,
		rootCustomProperties,
	});
	assert.deepEqual(Object.keys(styles), [
		"note",
		"obsidianVersion",
		"appearance",
		"blueTopazAppearance",
		"viewportWidth",
		"takenAt",
		"plugin",
		"states",
		"probes",
		"properties",
		"rootCustomProperties",
	]);
	const currentAppearance = { cssTheme, accentColor: "#654321" };
	const all = { ...args, themes: "all" as const, env: { ...env, blueTopazAppearance: currentAppearance } };
	assert.deepEqual(updatedManifest(all).blueTopazAppearance, currentAppearance);
	assert.deepEqual(
		updatedStylesManifest({ ...all, probes, properties, rootCustomProperties }).blueTopazAppearance,
		currentAppearance,
	);
	assert.deepEqual(updatedStylesManifest({ ...all, probes, properties, rootCustomProperties }).states, [
		"dark-x",
		"light-x",
	]);
	assert.equal(updatedManifest({ ...args, themes: "all" }).blueTopazAppearance, undefined);
	assert.equal(
		updatedStylesManifest({ ...args, themes: "all", probes, properties, rootCustomProperties }).blueTopazAppearance,
		undefined,
	);
});

test("a run that took only Blue Topaz warns without a default appearance", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const baseline = { appearance: { cssTheme: "old" }, blueTopazAppearance: { cssTheme, accentColor: "#123456" } };
	const env = { blueTopazAppearance: { cssTheme, accentColor: "#654321" } };
	assert.doesNotThrow(() => warnAboutSetup(baseline, env));
	assert.deepEqual(
		warn.mock.calls.map(({ arguments: args }) => args),
		[
			[
				'screenshots: warning: the baselines (Blue Topaz) were taken with the accent colour (accentColor) "#123456", this run has "#654321"; pixels may differ for that reason alone.',
			],
		],
	);
	warn.mock.resetCalls();
	warnAboutSetup(baseline, env, "the styles.json baselines");
	assert.equal(warn.mock.callCount(), 1);
	assert.ok(String(warn.mock.calls[0].arguments[0]).includes("the styles.json baselines (Blue Topaz)"));
});

test("a different Blue Topaz file is a setup difference the warnings name", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const recorded = { cssTheme, themeVersion: "1", themeCssSha256: "aaa" };
	warnAboutSetup(
		{ blueTopazAppearance: recorded },
		{ blueTopazAppearance: { ...recorded, themeVersion: "2", themeCssSha256: "bbb" } },
	);
	assert.deepEqual(
		warn.mock.calls.map(({ arguments: args }) => args),
		[
			[
				'screenshots: warning: the baselines (Blue Topaz) were taken with the theme version (themeVersion) "1", this run has "2"; pixels may differ for that reason alone.',
			],
			[
				'screenshots: warning: the baselines (Blue Topaz) were taken with the theme.css sha256 (themeCssSha256) "aaa", this run has "bbb"; pixels may differ for that reason alone.',
			],
		],
	);
});

test("a missing screenshot baseline names the recording command only for Blue Topaz", () => {
	assert.equal(missingPngBaseline("light-x"), "has no screenshot baseline");
	assert.equal(
		missingPngBaseline("blue-topaz-dark-x"),
		"has no screenshot baseline; run `pnpm screenshots --themes=all --update` to record it",
	);
});

test("pinning adds only the themePins key", () => {
	const text = readFileSync(path.join(FIXTURES, "screenshots", "screenshots.json"), "utf8");
	const parsed = JSON.parse(text) as Record<string, unknown>;
	assert.equal(JSON.stringify(parsed, null, "\t") + "\n", text);
	const manifest = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "themePins"));
	const before = JSON.stringify(manifest, null, "\t") + "\n";
	assert.equal(JSON.stringify(JSON.parse(before), null, "\t") + "\n", before);
	const pinned = withThemePin(manifest, { cssTheme, ...pin });
	const after = JSON.stringify(pinned, null, "\t") + "\n";
	const added = JSON.stringify({ themePins: { [cssTheme]: pin } }, null, "\t")
		.split("\n")
		.slice(1, -1);
	assert.equal(after, `${before.slice(0, -3)},\n${added.join("\n")}\n}\n`);
	assert.deepEqual(Object.keys(pinned), [...Object.keys(manifest), "themePins"]);
	assert.equal(JSON.stringify(manifest, null, "\t") + "\n", before);
	assert.notEqual(pinned, manifest);
	const existing = { first: 1, themePins: { Other: pin, [cssTheme]: { ...pin, version: "old" } }, last: 2 };
	const updated = withThemePin(existing, { cssTheme, ...pin });
	assert.deepEqual(Object.keys(updated), Object.keys(existing));
	assert.deepEqual(updated.themePins, { Other: pin, [cssTheme]: pin });
	assert.equal(existing.themePins[cssTheme].version, "old");
});

test("a killed run's appearance backup is taken as the original", (t) => {
	const vaultPath = temporaryVault(t);
	const files = appearanceFiles(vaultPath);
	const original = Buffer.from('{\n  "cssTheme": "Blue Topaz"\n}');
	const backup = JSON.stringify({ existed: true, base64: original.toString("base64") });
	writeFileSync(files.backup, backup);
	writeFileSync(files.appearance, '{"cssTheme":""}\n');
	writeFileSync(files.temporary, "interrupted write");
	assert.deepEqual(saveAppearanceBackup(vaultPath), { leftover: true });
	assert.equal(readFileSync(files.backup, "utf8"), backup);
	assert.equal(existsSync(files.temporary), false);
	assert.deepEqual(readAppearanceBackup(vaultPath), { existed: true, bytes: original, cssTheme });
	restoreAppearanceFile(vaultPath, () => {});
	assert.deepEqual(readFileSync(files.appearance), original);
	assert.equal(existsSync(files.backup), false);
});

test("restoring puts the original bytes back and removes the backup", (t) => {
	for (const text of ['{\n  "cssTheme": "Blue Topaz"\n}', '{ "baseFontSize": 16 }\n']) {
		const vaultPath = temporaryVault(t);
		const files = appearanceFiles(vaultPath);
		const original = Buffer.from(text);
		writeFileSync(files.appearance, original);
		writeFileSync(files.temporary, "interrupted write");
		assert.equal(readAppearanceBackup(vaultPath), null);
		assert.deepEqual(saveAppearanceBackup(vaultPath), { leftover: false });
		assert.deepEqual(JSON.parse(readFileSync(files.backup, "utf8")), {
			existed: true,
			base64: original.toString("base64"),
		});
		assert.equal(existsSync(files.temporary), false);
		assert.deepEqual(readAppearanceBackup(vaultPath), {
			existed: true,
			bytes: original,
			cssTheme: text.includes("cssTheme") ? cssTheme : null,
		});
		writeFileSync(files.appearance, '{"cssTheme":""}');
		const waits: number[] = [];
		restoreAppearanceFile(vaultPath, (ms) => {
			waits.push(ms);
		});
		assert.deepEqual(waits, [2000]);
		assert.deepEqual(readFileSync(files.appearance), original);
		assert.equal(existsSync(files.backup), false);
		assert.equal(readAppearanceBackup(vaultPath), null);
	}
	for (const corrupt of ["{", '{"existed":"yes","base64":""}', '{"existed":true,"base64":"***"}']) {
		const vaultPath = temporaryVault(t);
		const files = appearanceFiles(vaultPath);
		writeFileSync(files.backup, corrupt);
		assert.throws(
			() => readAppearanceBackup(vaultPath),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.ok(error.message.includes(files.backup));
				return true;
			},
		);
		assert.equal(readFileSync(files.backup, "utf8"), corrupt);
	}
	const vaultPath = temporaryVault(t);
	const files = appearanceFiles(vaultPath);
	writeFileSync(files.backup, JSON.stringify({ existed: true, base64: Buffer.from("{").toString("base64") }));
	assert.throws(
		() => readAppearanceBackup(vaultPath),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.ok(error.message.includes(files.appearance));
			return true;
		},
	);
});

test("restoring removes an appearance.json that did not exist", (t) => {
	const vaultPath = temporaryVault(t);
	const files = appearanceFiles(vaultPath);
	assert.deepEqual(saveAppearanceBackup(vaultPath), { leftover: false });
	assert.deepEqual(readAppearanceBackup(vaultPath), { existed: false, bytes: Buffer.alloc(0), cssTheme: null });
	assert.deepEqual(JSON.parse(readFileSync(files.backup, "utf8")), { existed: false, base64: "" });
	writeFileSync(files.appearance, '{"cssTheme":"Blue Topaz"}');
	restoreAppearanceFile(vaultPath, () => {});
	assert.equal(existsSync(files.appearance), false);
	assert.equal(existsSync(files.backup), false);
});

test("a restore that does not hold keeps the backup and throws", (t) => {
	const vaultPath = temporaryVault(t);
	const files = appearanceFiles(vaultPath);
	const original = Buffer.from('{"cssTheme":"Blue Topaz"}');
	const replacement = Buffer.from('{"cssTheme":"Other"}');
	const backup = JSON.stringify({ existed: true, base64: original.toString("base64") });
	writeFileSync(files.backup, backup);
	writeFileSync(files.appearance, replacement);
	assert.throws(
		() =>
			restoreAppearanceFile(vaultPath, (ms) => {
				assert.equal(ms, 2000);
				assert.deepEqual(readFileSync(files.appearance), original);
				writeFileSync(files.appearance, replacement);
			}),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.ok(error.message.includes(files.appearance));
			for (const bytes of [original, replacement]) {
				const forms = [
					bytes.toString("utf8"),
					JSON.stringify(bytes.toString("utf8")),
					bytes.toString("base64"),
					bytes.toString("hex"),
				];
				assert.ok(
					forms.some((value) => error.message.includes(value)),
					"the error must name both file values",
				);
			}
			return true;
		},
	);
	assert.equal(readFileSync(files.backup, "utf8"), backup);
	assert.deepEqual(readFileSync(files.appearance), replacement);
});

test("the notes check ignores a theme folder in .obsidian", async (t) => {
	const vaultPath = temporaryVault(t);
	const folder = installTheme(vaultPath);
	writeFileSync(path.join(folder, "README.md"), "A theme's notes.\n");
	writeFileSync(path.join(vaultPath, "note.md"), "A vault note.\n");
	const { markdownFiles } = (await import(pathToFileURL(path.resolve("scripts/fixture-app.mjs")).href)) as {
		markdownFiles: (directory: string) => string[];
	};
	assert.deepEqual(markdownFiles(vaultPath), ["note.md"]);
});
