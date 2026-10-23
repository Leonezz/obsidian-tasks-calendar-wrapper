/**
 * What the timeline in fixtures/golden-vault shows, taken in a real Obsidian, to check that a change looks the same.
 * The states: Obsidian's default theme in light and dark, each entry position (top, today, bottom), "Focus on today"
 * off and on, and no active counter or the Todo, Overdue or Unplanned counter with the Filter or the Focus behaviour.
 * Two records per state, in fixtures/screenshots:
 * - visible/<state>.txt, for every light state: one line per year, date, counter and task that is displayed, in order,
 *   with the task's status, whether the Focus behaviour highlights it, and its text. Exact, small and diffable, and the
 *   same whether a hidden task is left out of the DOM or hidden with CSS.
 * - <state>.png, a screenshot of the whole timeline, for all 84 states: about 780 KB for one without a filter, 36 MB
 *   in all.
 *
 * `pnpm screenshots` builds the plugin, takes both and compares them with fixtures/screenshots, the screenshots pixel by
 * pixel, writes what it took and a diff image of each screenshot that differs to a folder it names, and fails if anything
 * differs. `pnpm screenshots --update` writes to fixtures/screenshots instead what no longer matches it, and keeps the
 * rest, so re-recording changes no file that only differs by rendering noise or colour drift, see screenshotVerdict in png.mjs. `--only=<text>` takes only the states whose
 * name contains the text, e.g. `--only=dark-today`, and cannot be combined with --update.
 *
 * Pixels and colours depend on the machine, the Obsidian version, the golden vault's appearance settings (accent colour,
 * font size and fonts, community theme, CSS snippets, ribbon, zoom), the font the timeline ends up with, and the display
 * the window is on, whose colour space Chrome converts screenshots into. fixtures/screenshots/screenshots.json records
 * all of them, and the script warns, naming each one, when this run's differ; compare on the same setup.
 *
 * Needs Obsidian running with the vault named golden-vault open, as for `pnpm capture:golden`. The script only talks to
 * that vault, after checking its notes are exactly fixtures/golden-vault. It installs the build into the vault, turns
 * community plugins on, pins today to 2026-01-15, sizes the window's page through the DevTools protocol, switches the
 * theme and the layout, and puts all of that back at the end.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
	buildInfo,
	fixtureCli,
	fixtureVaultPath,
	fixtureWindow,
	installPlugin,
	machineInfo,
	manifest,
	notesOf,
	quietSettings,
	repoRoot,
	runAndUndo,
	runScript,
	ScriptError,
	TIMELINE_VIEW,
} from "./fixture-app.mjs";
import { comparePngs, decodePng, encodePng, screenshotVerdict } from "./png.mjs";

const VAULT_NAME = "golden-vault";
const baselineDir = path.join(repoRoot, "fixtures", "screenshots");
const manifestFile = path.join(baselineDir, "screenshots.json");
const VISIBLE = "visible";
/** The page size the screenshots are taken at; the height grows to fit the whole timeline. */
const VIEWPORT_WIDTH = 600;
const MIN_HEIGHT = 600;
const MAX_HEIGHT = 16_000;
/**
 * The plugin pushes its options to open views 200 ms after it loads (#203), which renders the timeline again; the
 * timeline is left this long after opening, and then until it is quiet, before the first screenshot.
 */
const SETTLE_AFTER_LOAD_MS = 1_500;

/** The appearance settings recorded in screenshots.json, with their names in Obsidian's settings for the warnings. */
const APPEARANCE = {
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

const THEMES = { light: "moonstone", dark: "obsidian" };
const POSITIONS = ["top", "today", "bottom"];
const COUNTERS = { todo: "Todo Tasks", overdue: "Overdue Tasks", unplanned: "Unplanned Tasks" };
const TODAY_FOCUS = "Focus today";

/** Every state has a screenshot. A smaller set would keep fewer megabytes in git; this is the place to pick one. */
const takesPng = () => true;

/** Which elements are displayed does not depend on the theme, so only light states get a visible/<state>.txt. */
const takesVisible = ({ theme }) => theme === "light";

/** The screenshots whose name contains `only`, grouped by the settings that need the plugin loaded again. */
function plan(only) {
	const groups = [];
	for (const position of POSITIONS) {
		for (const behavior of ["Filter", "Focus"]) {
			// Without an active counter the behaviour changes nothing, so that state is taken once.
			const counters = behavior === "Filter" ? ["none", ...Object.keys(COUNTERS)] : Object.keys(COUNTERS);
			const shots = [];
			for (const theme of Object.keys(THEMES)) {
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
						shots.push({ ...state, png: takesPng(state), visible: takesVisible(state) });
					}
				}
			}
			const wanted = shots.filter((shot) => (shot.png || shot.visible) && shot.name.includes(only));
			if (wanted.length > 0)
				groups.push({ settings: { entryPosition: position, counterBehavior: behavior }, shots: wanted });
		}
	}
	return groups;
}

/**
 * Runs in Obsidian: everything the screenshots do in the window. Each action ends when the timeline's DOM has not
 * changed for a while, so rows that render their markdown later are in the picture.
 */
async function timeline({ action, viewType, pluginId, label, theme, settleMs }) {
	// A window behind others may draw no frames, so waiting for one is cut short.
	const frame = () =>
		Promise.race([
			new Promise((resolve) => requestAnimationFrame(() => resolve())),
			new Promise((resolve) => setTimeout(resolve, 500)),
		]);
	const content = () => document.querySelector(`.workspace-leaf-content[data-type="${viewType}"] > .view-content`);
	async function quiet(ms, timeoutMs = 15_000) {
		const target = content();
		if (!target) throw new Error("the timeline view is not open");
		let last = performance.now();
		const observer = new MutationObserver(() => {
			last = performance.now();
		});
		observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
		const start = performance.now();
		while (performance.now() - last < ms) {
			if (performance.now() - start > timeoutMs) {
				observer.disconnect();
				throw new Error(`the timeline kept changing for ${timeoutMs / 1000} s`);
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		observer.disconnect();
		await document.fonts.ready;
		await frame();
		await frame();
	}
	function measure() {
		const target = content();
		const rect = target.getBoundingClientRect();
		return {
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height,
			scrollHeight: target.scrollHeight,
			clientHeight: target.clientHeight,
			below: innerHeight - rect.bottom,
		};
	}
	switch (action) {
		case "open": {
			// The plugin is loaded again, so the timeline starts without a counter or "Focus on today".
			app.workspace.detachLeavesOfType(viewType);
			if (app.plugins.plugins[pluginId]) await app.plugins.disablePlugin(pluginId);
			if (!(await app.plugins.enablePlugin(pluginId)))
				throw new Error(`Obsidian could not load the plugin ${pluginId}`);
			const others = [];
			app.workspace.iterateRootLeaves((leaf) => others.push(leaf));
			const leaf = app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: viewType, active: true });
			// An empty tab can be reused for the timeline, so only the other leaves go.
			others.filter((other) => other !== leaf).forEach((other) => other.detach());
			app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.collapse();
			if (!document.getElementById("tcw-screenshots")) {
				// The status bar floats over the bottom of the view. The page grows until nothing scrolls, so a scroll bar
				// would only take room, and whether it does depends on the system: macOS reserves room for one only
				// when it shows scroll bars always, e.g. with a mouse connected.
				document.head.createEl("style", {
					attr: { id: "tcw-screenshots" },
					text: `.status-bar { display: none !important; } .workspace-leaf-content[data-type="${viewType}"] > .view-content { scrollbar-width: none !important; }`,
				});
			}
			await new Promise((resolve) => setTimeout(resolve, settleMs));
			await quiet(500);
			return measure();
		}
		case "click": {
			const target = content()?.querySelector(`[aria-label="${label}"]`);
			if (!target) throw new Error(`the timeline has nothing labelled "${label}"`);
			// Every click changes the timeline's state, so one that changes nothing in the DOM did not land.
			let changed = false;
			const observer = new MutationObserver(() => {
				changed = true;
			});
			observer.observe(content(), { subtree: true, childList: true, characterData: true, attributes: true });
			target.click();
			const start = performance.now();
			while (!changed && performance.now() - start < 2_000)
				await new Promise((resolve) => setTimeout(resolve, 20));
			observer.disconnect();
			if (!changed) throw new Error(`clicking "${label}" changed nothing in the timeline within 2 s`);
			document.activeElement?.blur();
			await quiet(300);
			return measure();
		}
		case "theme": {
			app.changeTheme(theme);
			// changeTheme turns CSS transitions off for 200 ms.
			await new Promise((resolve) => setTimeout(resolve, 300));
			await quiet(300);
			return measure();
		}
		case "measure":
			await quiet(300);
			return measure();
		case "visible": {
			// What is displayed, as one line per element, whether the rest is hidden with CSS or not rendered.
			const root = content()?.querySelector(".taskido");
			if (!root) throw new Error("the timeline has no .taskido element");
			await quiet(300);
			const text = (element) => (element?.innerText ?? "").replace(/\s+/g, " ").trim();
			const lines = [];
			for (const element of root.querySelectorAll(
				".year, .todayHeader, .counter, .quickEntryPanel, .dateLine, .task",
			)) {
				if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
				const style = getComputedStyle(element);
				if (element.matches(".year")) lines.push(`year ${text(element)}`);
				else if (element.matches(".todayHeader"))
					lines.push(`today header "${text(element)}", color ${style.color}`);
				else if (element.matches(".counter"))
					lines.push(`counter ${text(element)}, color ${style.color}, background ${style.backgroundColor}`);
				else if (element.matches(".quickEntryPanel")) lines.push("quick entry");
				else if (element.matches(".dateLine")) lines.push(`date ${text(element)}`);
				else {
					const status = [...element.classList].filter((name) => name !== "task").join(" ");
					const highlighted = style.backgroundColor === "rgba(0, 0, 0, 0)" ? "" : " highlighted";
					const badges = [...(element.querySelector(".info")?.children ?? [])]
						.map(text)
						.filter(Boolean)
						.join(" · ");
					lines.push(
						`  task ${status}${highlighted}: ${text(element.querySelector(".content"))} | ${badges}`,
					);
				}
			}
			return lines;
		}
		case "appearance": {
			const root = content()?.querySelector(".taskido");
			if (!root) throw new Error("the timeline has no .taskido element");
			const settings = [
				"accentColor",
				"baseFontSize",
				"interfaceFontFamily",
				"textFontFamily",
				"monospaceFontFamily",
				"cssTheme",
				"enabledCssSnippets",
				"showRibbon",
			];
			const display = require("@electron/remote").screen.getDisplayMatching(electronWindow.getBounds());
			return {
				...Object.fromEntries(settings.map((key) => [key, app.vault.getConfig(key) ?? null])),
				zoom: require("electron").webFrame.getZoomFactor(),
				timelineFont: getComputedStyle(root).fontFamily,
				display: {
					name: display.label,
					internal: display.internal,
					colorSpace: display.colorSpace,
					scaleFactor: display.scaleFactor,
				},
			};
		}
		case "cleanup":
			document.getElementById("tcw-screenshots")?.remove();
			return true;
		default:
			throw new Error(`unknown action ${action}`);
	}
}

/** Moves the mouse off the page, so no task is drawn hovered. */
function unhover(cli) {
	cli.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: -50, y: -50 });
}

function setViewport(cli, height) {
	cli.cdp("Emulation.setDeviceMetricsOverride", {
		width: VIEWPORT_WIDTH,
		height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	return cli.evaluate(timeline, { action: "measure", viewType: TIMELINE_VIEW });
}

/**
 * Captures the whole timeline: starting from a short page, which the timeline overflows, the page grows until the
 * timeline is not scrolled. Starting short every time makes the size depend only on the timeline.
 */
function capture(cli) {
	let box = setViewport(cli, MIN_HEIGHT);
	for (let attempt = 0; box.scrollHeight > box.clientHeight; attempt++) {
		if (attempt === 3) throw new ScriptError(`the timeline does not fit the page: ${JSON.stringify(box)}`);
		const height = Math.ceil(box.y + box.scrollHeight + box.below);
		if (height > MAX_HEIGHT)
			throw new ScriptError(
				`the timeline is ${box.scrollHeight} px high, more than the ${MAX_HEIGHT} px a screenshot can take.`,
			);
		box = setViewport(cli, height);
	}
	// Once, right after a change of the page size, the timeline measured 0 px wide; it is measured again then.
	for (let attempt = 0; !(box.width >= 1 && box.height >= 1); attempt++) {
		if (attempt === 3)
			throw new ScriptError(`the timeline has no size to take a screenshot of: ${JSON.stringify(box)}`);
		box = cli.evaluate(timeline, { action: "measure", viewType: TIMELINE_VIEW });
	}
	const clip = {
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.round(box.width),
		height: Math.round(box.height),
		scale: 1,
	};
	const { data } = cli.cdp("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
	if (!data) throw new ScriptError("Page.captureScreenshot returned no image.");
	return Buffer.from(data, "base64");
}

/** Takes every state's records into `outDir` and returns what the manifest records about them. */
function takeScreenshots(cli, plugin, outDir, only) {
	const shots = {};
	mkdirSync(path.join(outDir, VISIBLE), { recursive: true });
	for (const group of plan(only)) {
		plugin.writeSettings(quietSettings(group.settings));
		cli.cdp("Emulation.setDeviceMetricsOverride", {
			width: VIEWPORT_WIDTH,
			height: MIN_HEIGHT,
			deviceScaleFactor: 1,
			mobile: false,
		});
		cli.evaluate(timeline, {
			action: "open",
			viewType: TIMELINE_VIEW,
			pluginId: manifest.id,
			settleMs: SETTLE_AFTER_LOAD_MS,
		});
		const state = { theme: null, todayFocus: false, counter: "none" };
		for (const shot of group.shots) {
			if (state.theme !== shot.theme) {
				cli.evaluate(timeline, { action: "theme", viewType: TIMELINE_VIEW, theme: THEMES[shot.theme] });
				state.theme = shot.theme;
			}
			if (state.todayFocus !== shot.todayFocus) {
				cli.evaluate(timeline, { action: "click", viewType: TIMELINE_VIEW, label: TODAY_FOCUS });
				state.todayFocus = shot.todayFocus;
			}
			if (state.counter !== shot.counter) {
				// Clicking the active counter turns it off; clicking another one switches to it.
				const label = COUNTERS[shot.counter === "none" ? state.counter : shot.counter];
				cli.evaluate(timeline, { action: "click", viewType: TIMELINE_VIEW, label });
				state.counter = shot.counter;
			}
			unhover(cli);
			const { name, png: takePng, visible: takeVisible, ...states } = shot;
			const record = { ...states, png: null, visibleLines: null };
			if (takeVisible) {
				const lines = cli.evaluate(timeline, { action: "visible", viewType: TIMELINE_VIEW });
				writeFileSync(path.join(outDir, VISIBLE, `${name}.txt`), lines.join("\n") + "\n");
				record.visibleLines = lines.length;
			}
			if (takePng) {
				const png = capture(cli);
				writeFileSync(path.join(outDir, `${name}.png`), png);
				const { width, height } = decodePng(png);
				record.png = { width, height };
			}
			shots[name] = record;
			console.log(
				`screenshots: ${name} (${[record.png && `${record.png.width}×${record.png.height}`, record.visibleLines !== null && `${record.visibleLines} visible`].filter(Boolean).join(", ")})`,
			);
		}
	}
	return shots;
}

/** The first line where two texts differ, for the report. */
function firstDifference(expected, actual) {
	const a = expected.split("\n");
	const b = actual.split("\n");
	const line = a.findIndex((text, i) => text !== b[i]);
	const at = line === -1 ? a.length : line;
	return `line ${at + 1}: ${JSON.stringify(a[at] ?? "(end)")} became ${JSON.stringify(b[at] ?? "(end)")}`;
}

function compareVisible(outDir, name) {
	const expectedFile = path.join(baselineDir, VISIBLE, `${name}.txt`);
	if (!existsSync(expectedFile)) return "has no visible/*.txt baseline";
	const expected = readFileSync(expectedFile, "utf8");
	const actual = readFileSync(path.join(outDir, VISIBLE, `${name}.txt`), "utf8");
	return expected === actual ? null : `what is displayed changed, first at ${firstDifference(expected, actual)}`;
}

function comparePng(outDir, name) {
	const expectedFile = path.join(baselineDir, `${name}.png`);
	if (!existsSync(expectedFile)) return "has no screenshot baseline";
	const expectedBytes = readFileSync(expectedFile);
	const actualBytes = readFileSync(path.join(outDir, `${name}.png`));
	if (expectedBytes.equals(actualBytes)) return null;
	const expected = decodePng(expectedBytes);
	const actual = decodePng(actualBytes);
	const result = comparePngs(expected, actual);
	if (result.differing === 0) return null;
	writeFileSync(path.join(outDir, `${name}.diff.png`), encodePng(result.diff));
	const size = result.sameSize ? "" : ` (${expected.width}×${expected.height} → ${actual.width}×${actual.height})`;
	const summary = `${result.differing} of ${result.total} pixels differ, by up to ${result.maxDelta} (${((100 * result.differing) / result.total).toFixed(2)} %)${size}`;
	const verdict = screenshotVerdict(result);
	if (verdict === "changed") return summary;
	console.log(
		`screenshots: ${name}: ${summary}, counted as ${verdict === "noise" ? "rendering noise" : "colour drift"}`,
	);
	return null;
}

/** Warns about each thing that decides the pixels and differs between the baselines and this run. */
function warnAboutSetup(baseline, env) {
	for (const key of ["obsidianVersion", "electron", "machine", "viewportWidth", "today"]) {
		if (JSON.stringify(baseline[key]) !== JSON.stringify(env[key])) {
			console.warn(
				`screenshots: warning: the baselines were taken with ${key} ${JSON.stringify(baseline[key])}, this run has ${JSON.stringify(env[key])}; pixels may differ for that reason alone.`,
			);
		}
	}
	for (const [key, setting] of Object.entries(APPEARANCE)) {
		const before = baseline.appearance?.[key];
		if (JSON.stringify(before) !== JSON.stringify(env.appearance[key])) {
			const was =
				before === undefined
					? `the baselines do not record the ${setting} (${key})`
					: `the baselines were taken with the ${setting} (${key}) ${JSON.stringify(before)}`;
			console.warn(
				`screenshots: warning: ${was}, this run has ${JSON.stringify(env.appearance[key])}; pixels may differ for that reason alone.`,
			);
		}
	}
}

function compare(outDir, shots, only) {
	const baseline = JSON.parse(readFileSync(manifestFile, "utf8"));
	const names = new Set([
		...Object.keys(shots),
		...Object.keys(baseline.shots).filter((name) => name.includes(only)),
	]);
	const results = [];
	for (const name of [...names].sort()) {
		const shot = shots[name];
		if (!shot) {
			results.push({ name, problem: "is no longer taken" });
			continue;
		}
		const problems = [
			shot.visibleLines !== null && compareVisible(outDir, name),
			shot.png && comparePng(outDir, name),
		].filter(Boolean);
		for (const problem of problems) results.push({ name, problem });
	}
	return { baseline, results };
}

/** What makes pixels comparable: the same machine, Obsidian and window size. */
function environment(cli, prepared) {
	return {
		obsidianVersion: cli.run("version"),
		electron: prepared.electron,
		chrome: prepared.chrome,
		machine: machineInfo(),
		viewportWidth: VIEWPORT_WIDTH,
		today: prepared.today,
	};
}

await runScript("screenshots", async () => {
	const unknown = process.argv.slice(2).filter((arg) => arg !== "--update" && !arg.startsWith("--only="));
	if (unknown.length)
		throw new ScriptError(`unknown arguments ${JSON.stringify(unknown)}; use --update or --only=<text>.`);
	const update = process.argv.includes("--update");
	const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? "";
	if (update && only)
		throw new ScriptError("--only cannot be combined with --update, which replaces all screenshots.");
	if (plan(only).length === 0) throw new ScriptError(`no screenshot name contains "${only}".`);
	// Checked before the run, which takes minutes, rather than after it.
	if (!update && !existsSync(manifestFile))
		throw new ScriptError(
			`there are no baselines in ${path.relative(repoRoot, baselineDir)}. Take them with \`pnpm screenshots --update\`.`,
		);
	const build = buildInfo();
	const cli = fixtureCli(VAULT_NAME);
	const vaultDir = path.join(repoRoot, "fixtures", VAULT_NAME);
	const vaultPath = fixtureVaultPath(
		cli,
		VAULT_NAME,
		notesOf(vaultDir),
		`Open ${vaultDir}, or a copy of it in a folder named ${VAULT_NAME}, with "Open folder as vault", then run this again.`,
	);

	// Taken into a folder of their own first, so a run that fails halfway leaves the baselines alone.
	const outDir = path.join(os.tmpdir(), "tcw-screenshots");
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });

	const plugin = installPlugin(vaultPath, quietSettings());
	const fixture = fixtureWindow(cli, VAULT_NAME, plugin);
	const { shots, env } = runAndUndo(() => {
		const prepared = fixture.prepare();
		const env = environment(cli, prepared);
		const shots = takeScreenshots(cli, plugin, outDir, only);
		// The last timeline is still open.
		env.appearance = cli.evaluate(timeline, { action: "appearance", viewType: TIMELINE_VIEW });
		return { env, shots };
	}, [
		["clear the page size", () => cli.cdp("Emulation.clearDeviceMetricsOverride")],
		["remove the style that hides the status bar", () => cli.evaluate(timeline, { action: "cleanup" })],
		...fixture.undoSteps,
	]);

	if (update) {
		if (existsSync(manifestFile)) warnAboutSetup(JSON.parse(readFileSync(manifestFile, "utf8")), env);
		// A baseline that still matches, rendering noise and colour drift included, is kept as it is, so re-recording adds to the git
		// history only what really changed.
		const visibleDir = path.join(baselineDir, VISIBLE);
		mkdirSync(visibleDir, { recursive: true });
		const changed = [];
		for (const [name, shot] of Object.entries(shots)) {
			if (shot.png && comparePng(outDir, name) !== null) {
				copyFileSync(path.join(outDir, `${name}.png`), path.join(baselineDir, `${name}.png`));
				changed.push(`${name}.png`);
			}
			if (shot.visibleLines !== null && compareVisible(outDir, name) !== null) {
				copyFileSync(path.join(outDir, VISIBLE, `${name}.txt`), path.join(visibleDir, `${name}.txt`));
				changed.push(`${VISIBLE}/${name}.txt`);
			}
		}
		const removed = [];
		for (const file of readdirSync(baselineDir).filter((file) => file.endsWith(".png"))) {
			if (!shots[file.slice(0, -".png".length)]?.png) {
				rmSync(path.join(baselineDir, file));
				removed.push(file);
			}
		}
		for (const file of readdirSync(visibleDir).filter((file) => file.endsWith(".txt"))) {
			const shot = shots[file.slice(0, -".txt".length)];
			if (!shot || shot.visibleLines === null) {
				rmSync(path.join(visibleDir, file));
				removed.push(`${VISIBLE}/${file}`);
			}
		}
		const record = {
			note: "Taken by apps/obsidian-plugin/scripts/screenshots.mjs (`pnpm screenshots --update`). Do not edit by hand.",
			...env,
			takenAt: new Date().toISOString().slice(0, 10),
			plugin: build,
			shots,
		};
		writeFileSync(manifestFile, JSON.stringify(record, null, "\t") + "\n");
		for (const file of changed) console.log(`screenshots: changed ${file}`);
		for (const file of removed) console.log(`screenshots: removed ${file}, a state no longer taken`);
		console.log(
			`screenshots: took ${Object.keys(shots).length} states; ${changed.length} baseline files changed and ${removed.length} were removed in ${path.relative(repoRoot, baselineDir)}, the others still match and were kept.`,
		);
		return 0;
	}

	const { baseline, results } = compare(outDir, shots, only);
	warnAboutSetup(baseline, env);
	if (results.length === 0) {
		console.log(
			`screenshots: all ${Object.keys(shots).length} states match ${path.relative(repoRoot, baselineDir)}.`,
		);
		return 0;
	}
	for (const { name, problem } of results) console.log(`screenshots: ${name}: ${problem}`);
	console.log(
		`screenshots: ${new Set(results.map((result) => result.name)).size} of ${Object.keys(shots).length} states differ. What this run took is in ${outDir}: visible/*.txt to diff with fixtures/screenshots/visible, and for each screenshot that differs a *.diff.png with the differing pixels in red.`,
	);
	return 1;
});
