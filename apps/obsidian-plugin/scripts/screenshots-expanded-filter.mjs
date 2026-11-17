/** Opt-in expanded quick-filter records, kept outside the ordinary screenshot matrix. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { comparePngs, decodePng, encodePng, screenshotVerdict } from "./png.mjs";
import {
	collectStyles,
	compareStyles,
	formatStyleDifference,
	ROOT_CUSTOM_PROPERTIES,
	serializeStyles,
	STYLE_PROBES,
	STYLE_PROPERTIES,
} from "./screenshots-styles.mjs";
import { selectCssTheme, themeNames, THEMES, warnAboutSetup } from "./screenshots-themes.mjs";

const MANIFEST = "expanded-filter.json";
const json = (value) => JSON.stringify(value, null, "\t") + "\n";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Resolve directory aliases even when the output's last components have not been created yet. */
function canonicalDirectory(directory) {
	const missing = [];
	let ancestor = path.resolve(directory);
	while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
		missing.push(path.basename(ancestor));
		const parent = path.dirname(ancestor);
		if (parent === ancestor) throw new Error(`Cannot resolve expanded-filter directory ${directory}.`);
		ancestor = parent;
	}
	const real = realpathSync(ancestor);
	if (!lstatSync(real).isDirectory()) throw new Error(`Expanded-filter directory is not a directory: ${directory}`);
	return path.join(real, ...missing.reverse());
}

const within = (directory, parent) => directory === parent || directory.startsWith(parent + path.sep);

export function expandedFilterPlan(themes = "default") {
	return themeNames(themes).map((theme) => ({ name: `${theme}-expanded-filter`, theme }));
}

/** Extra probes belong only to this mode; the ordinary fingerprints remain unchanged. */
export const EXPANDED_FILTER_PROBES = Object.freeze([
	...STYLE_PROBES,
	...[
		".quickFilterBar .dateRange",
		".dateRange label:first-of-type input",
		".dateRange label:last-of-type input",
		".applyDateRange",
		".priorityFilter",
		".priorityOptions",
		'.priorityOptions input[value="High"]',
		'.priorityOptions input[value="No"]',
	].map((selector) => Object.freeze({ name: selector, selector })),
]);

/** Standalone browser function: use actual controls, then await the actual applied store value. */
export async function applyExpandedFilter({ viewType }) {
	const root = document.querySelector(`.workspace-leaf-content[data-type="${viewType}"] .taskido`);
	if (!root) throw new Error("The expanded-filter timeline is not open.");
	const view = root.ownerDocument.defaultView;
	const sleep = (ms) => new Promise((resolve) => view.setTimeout(resolve, ms));
	const until = async (test, label) => {
		const started = view.performance.now();
		while (!test()) {
			if (view.performance.now() - started > 5_000) throw new Error(`Timed out waiting for ${label}.`);
			await sleep(20);
		}
	};
	const select = async (selector, value) => {
		const element = root.querySelector(selector);
		if (!element || ![...element.options].some((option) => option.value === value))
			throw new Error(`Missing expanded-filter choice ${selector} / ${value}.`);
		Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, "value").set.call(element, value);
		element.dispatchEvent(new view.Event("change", { bubbles: true }));
		await sleep(20);
	};
	await select("select.dateScope", "custom");
	await until(() => root.querySelectorAll(".dateRange input").length === 2, "both filter date inputs");
	const dates = root.querySelectorAll(".dateRange input");
	for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
		Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value").set.call(dates[index], value);
		dates[index].dispatchEvent(new view.Event("input", { bubbles: true }));
		await sleep(20);
	}
	const button = root.querySelector(".applyDateRange");
	if (!button) throw new Error("The expanded-filter date apply button is missing.");
	button.click();
	await until(() => {
		const filter = app.workspace.getLeavesOfType(viewType)[0]?.view?.viewState?.store?.getSnapshot()?.quickFilter;
		return filter?.from === "2026-01-10" && filter.to === "2026-01-20";
	}, "the applied date range");
	await sleep(20);
	for (const value of ["High", "No"]) {
		// Applying a filter may remove a year and remount the entry controls under its new year key.
		const priority = root.querySelector("details.priorityFilter");
		const summary = priority?.querySelector("summary");
		if (!priority || !summary) throw new Error("The expanded-filter priority menu is missing.");
		if (!priority.open) summary.click();
		await until(() => priority.open, "the open priority menu");
		const choice = priority.querySelector(`input[value="${value}"]`);
		if (!choice) throw new Error(`The expanded-filter priority ${value} is missing.`);
		if (!choice.checked) choice.click();
		await sleep(20);
		await until(() => {
			const filter = app.workspace
				.getLeavesOfType(viewType)[0]
				?.view?.viewState?.store?.getSnapshot()?.quickFilter;
			return (
				root.querySelector(`.priorityOptions input[value="${value}"]`)?.checked &&
				filter?.priorities.includes(value)
			);
		}, `the applied ${value} priority`);
	}
	await until(() => {
		const state = app.workspace.getLeavesOfType(viewType)[0]?.view?.viewState?.store?.getSnapshot();
		return (
			state?.quickFilter?.from === "2026-01-10" &&
			state.quickFilter.to === "2026-01-20" &&
			JSON.stringify(state.quickFilter.priorities) === '["High","No",""]'
		);
	}, "the applied quick filter, not its draft");
	const priority = root.querySelector("details.priorityFilter");
	if (priority?.open) priority.querySelector("summary").click();
	await until(() => !root.querySelector("details.priorityFilter")?.open, "the closed priority menu");
	root.ownerDocument.activeElement?.blur();
	return true;
}

/** Standalone browser function. Stable semantics are separate from diagnostic geometry and React IDs. */
export function collectExpandedFilter({ viewType }) {
	const view = app.workspace.getLeavesOfType(viewType)[0]?.view;
	const state = view?.viewState?.store?.getSnapshot();
	const options = view?.store?.getSnapshot()?.options;
	const content = document.querySelector(`.workspace-leaf-content[data-type="${viewType}"] > .view-content`);
	const root = content?.querySelector(".taskido");
	const panel = root?.querySelector(".quickEntryPanel");
	const filters = root?.querySelector(".quickFilterBar");
	if (!state || !options || !root || !panel || !filters)
		throw new Error("The expanded-filter host stores or panel are unavailable.");
	const priority = filters.querySelector("details.priorityFilter");
	const rows = [...root.querySelectorAll(".task")].map((row) => {
		const file = row.querySelector("a.file[aria-label]")?.getAttribute("aria-label");
		const line = row.getAttribute("data-line");
		if (!file || !/^\d+$/.test(line ?? "") || !Number.isSafeInteger(Number(line)))
			throw new Error("An expanded-filter row has no unambiguous file/line identity.");
		const id = row.getAttribute("aria-labelledby")?.split(/\s+/)[0] ?? "";
		const suffix = `-${encodeURIComponent(`${file}:${line}`)}-text`;
		if (!id.endsWith(suffix)) throw new Error(`Cannot read the expanded-filter date instance from ${id}.`);
		const day = id.slice(0, -suffix.length).slice(-10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid expanded-filter date identity ${day}.`);
		return {
			day,
			path: file,
			line: Number(line),
			marker: row.getAttribute("data-task"),
			busy: row.hasAttribute("aria-busy"),
			text: row.querySelector(":scope > .lines > .content")?.textContent?.trim() ?? "",
		};
	});
	const rect = (element) => {
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height };
	};
	const applied = state.quickFilter;
	return {
		semantic: {
			counter: state.counter,
			todayFocus: state.todayFocus,
			entryPosition: options.entryPosition,
			counterBehavior: options.counterBehavior,
			controls: {
				dateScope: filters.querySelector("select.dateScope")?.value,
				dates: [...filters.querySelectorAll(".dateRange input")].map((input) => input.value),
				priorityOptions: [...(priority?.querySelectorAll('input[type="checkbox"]') ?? [])].map((input) => ({
					value: input.value,
					label: input.closest("label")?.textContent.trim() ?? "",
					checked: input.checked,
				})),
				priorityOpen: Boolean(priority?.open),
				prioritySummary: priority?.querySelector("summary")?.textContent.trim(),
				entryText: panel.querySelector("input.newTask")?.value,
			},
			applied: applied
				? {
						from: applied.from,
						to: applied.to,
						priorities: [...applied.priorities],
						tags: [...(applied.tags ?? [])],
					}
				: null,
			rows,
		},
		geometry: {
			content: rect(content),
			panel: rect(panel),
			scrollTop: content.scrollTop,
			viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
		},
	};
}

export function assertExpandedFilter({ semantic, geometry }) {
	assert.equal(semantic.counter, "");
	assert.equal(semantic.todayFocus, false);
	assert.equal(semantic.entryPosition, "top");
	assert.equal(semantic.counterBehavior, "Filter");
	assert.deepEqual(semantic.applied, {
		from: "2026-01-10",
		to: "2026-01-20",
		priorities: ["High", "No", ""],
		tags: [],
	});
	assert.deepEqual(semantic.controls, {
		dateScope: "custom",
		dates: ["2026-01-10", "2026-01-20"],
		priorityOptions: [
			{ value: "Highest", label: "Highest", checked: false },
			{ value: "High", label: "High", checked: true },
			{ value: "Medium", label: "Medium", checked: false },
			{ value: "No", label: "None", checked: true },
			{ value: "Low", label: "Low", checked: false },
			{ value: "Lowest", label: "Lowest", checked: false },
		],
		priorityOpen: false,
		prioritySummary: "High, None",
		entryText: "",
	});
	assert.equal(geometry.viewport.width, 600);
	assert.equal(geometry.viewport.deviceScaleFactor, 1);
	assert.equal(Math.round(geometry.content.width), 556);
	assert.ok(Math.abs(geometry.scrollTop) <= 0.5, "the expanded-filter timeline must be at the top");
	const keys = semantic.rows.map((row) => `${row.day}\u0000${row.path}\u0000${row.line}`);
	assert.equal(new Set(keys).size, keys.length, "duplicate expanded-filter row instances");
	assert.ok(
		semantic.rows.every((row) => !row.busy),
		"expanded-filter rows still have pending overlays",
	);
	for (const [file, line] of [
		["Dataview fields.md", 4],
		["Dataview fields.md", 2],
		["Emoji dates.md", 31],
	])
		assert.ok(
			semantic.rows.some((row) => row.path === file && row.line === line),
			`Missing positive fixture ${file}:${line}`,
		);
	for (const [file, line] of [
		["Priorities.md", 12],
		["Emoji dates.md", 6],
	])
		assert.ok(
			!semantic.rows.some((row) => row.path === file && row.line === line),
			`Unexpected negative fixture ${file}:${line}`,
		);
}

const stateFiles = (name) => [`${name}.png`, `styles/${name}.json`, `semantic/${name}.json`];

/** run must return only after the shared runAndUndo has finished successfully. */
export function reviewExpandedFilter({ outDir, themes = "default", build, run }) {
	const states = expandedFilterPlan(themes);
	if (existsSync(outDir) && readdirSync(outDir).length)
		throw new Error(`Expanded-filter output is not empty: ${outDir}`);
	mkdirSync(outDir, { recursive: true });
	const manifest = {
		schema: 1,
		kind: "expanded-filter",
		complete: false,
		themes,
		build,
		env: null,
		states,
		files: {},
	};
	const save = () => writeFileSync(path.join(outDir, MANIFEST), json(manifest));
	save();
	const seen = new Set();
	try {
		manifest.env = run(states, (name, record) => {
			if (!states.some((state) => state.name === name) || seen.has(name))
				throw new Error(`Unexpected or repeated expanded-filter state ${name}.`);
			assert.ok(Buffer.isBuffer(record.png), "expanded-filter PNG bytes are missing");
			decodePng(record.png);
			JSON.parse(record.styles);
			const values = [record.png, Buffer.from(record.styles), Buffer.from(json(record.semantic))];
			for (const [index, file] of stateFiles(name).entries()) {
				const bytes = values[index];
				mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
				writeFileSync(path.join(outDir, file), bytes, { flag: "wx" });
				manifest.files[file] = { sha256: sha256(bytes), bytes: bytes.length };
			}
			seen.add(name);
			save();
		});
		if (manifest.env && typeof manifest.env.then === "function")
			throw new Error("Expanded-filter run must finish its undo synchronously before returning.");
		if (seen.size !== states.length)
			throw new Error(`Expanded-filter review took ${seen.size} of ${states.length} states.`);
		manifest.complete = true;
		save();
		return manifest;
	} catch (error) {
		manifest.complete = false;
		manifest.error = error.message;
		save();
		throw error;
	}
}

function verifiedReview(dir) {
	const read = (file) => {
		const target = path.join(dir, file);
		if (!lstatSync(target).isFile()) throw new Error(`Expanded-filter artifact is not a regular file: ${file}`);
		return readFileSync(target);
	};
	const manifestBytes = read(MANIFEST);
	const manifest = JSON.parse(manifestBytes);
	if (manifest.schema !== 1 || manifest.kind !== "expanded-filter" || manifest.complete !== true)
		throw new Error("Expanded-filter review is incomplete or has an unsupported schema.");
	if (manifest.themes !== "default" && manifest.themes !== "all")
		throw new Error("Expanded-filter review has no valid theme set.");
	const states = expandedFilterPlan(manifest.themes);
	assert.deepEqual(manifest.states, states, "expanded-filter review has an unexpected state plan");
	const files = states.flatMap(({ name }) => stateFiles(name));
	assert.deepEqual(
		Object.keys(manifest.files).sort(),
		[...files].sort(),
		"expanded-filter review has missing or unexpected files",
	);
	const bytes = new Map([[MANIFEST, manifestBytes]]);
	for (const file of files) {
		const value = read(file);
		const recorded = manifest.files[file];
		if (recorded.bytes !== value.length || recorded.sha256 !== sha256(value))
			throw new Error(`Expanded-filter artifact hash/size differs: ${file}`);
		if (file.endsWith(".png")) decodePng(value);
		else JSON.parse(value.toString("utf8"));
		bytes.set(file, value);
	}
	return { manifest, bytes };
}

export function readExpandedFilterReview(dir) {
	return verifiedReview(dir).manifest;
}

/** Offline promotion of the reviewed bytes; no build, app access, recapture or ordinary baseline update. */
export function recordExpandedFilter(artifactDir, baselineDir) {
	if (lstatSync(path.resolve(baselineDir), { throwIfNoEntry: false })?.isSymbolicLink())
		throw new Error("The expanded-filter baseline target must not be a symbolic link.");
	const source = canonicalDirectory(artifactDir);
	const target = canonicalDirectory(baselineDir);
	if (within(source, target) || within(target, source))
		throw new Error("Expanded-filter artifacts and baselines must be separate directories.");
	const { manifest, bytes } = verifiedReview(source);
	mkdirSync(path.dirname(target), { recursive: true });
	const stage = mkdtempSync(path.join(path.dirname(target), ".expanded-filter-record-"));
	const previous = stage + ".previous";
	try {
		for (const [file, value] of bytes) {
			mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
			writeFileSync(path.join(stage, file), value);
		}
		if (existsSync(target)) renameSync(target, previous);
		try {
			renameSync(stage, target);
		} catch (error) {
			if (existsSync(previous)) renameSync(previous, target);
			throw error;
		}
		return manifest;
	} finally {
		rmSync(stage, { recursive: true, force: true });
		if (existsSync(target)) rmSync(previous, { recursive: true, force: true });
	}
}

export function compareExpandedFilter(artifactDir, baselineDir) {
	const actual = verifiedReview(artifactDir);
	const expected = verifiedReview(baselineDir);
	const problems = [];
	for (const { name } of actual.manifest.states) {
		for (const file of stateFiles(name)) {
			const before = expected.bytes.get(file);
			const after = actual.bytes.get(file);
			if (!before) {
				problems.push(`${file} has no expanded-filter baseline.`);
				continue;
			}
			if (before.equals(after)) continue;
			if (file.endsWith(".png")) {
				const result = comparePngs(decodePng(before), decodePng(after));
				const verdict = screenshotVerdict(result);
				if (verdict === "changed") {
					problems.push(
						`${file}: ${result.differing}/${result.total} pixels changed (max delta ${result.maxDelta}).`,
					);
					if (result.diff) writeFileSync(path.join(artifactDir, `${name}.diff.png`), encodePng(result.diff));
				}
			} else if (file.startsWith("styles/")) {
				const differences = compareStyles(JSON.parse(before), JSON.parse(after));
				problems.push(
					...(differences.length
						? differences.map((difference) => formatStyleDifference(name, difference))
						: [`${file}: serialized fingerprint changed.`]),
				);
			} else problems.push(`${file}: controls, applied filter or ordered row instances changed.`);
		}
	}
	return problems;
}

/** The caller supplies existing screenshot helpers so their ordinary path and capture geometry stay unchanged. */
export async function runExpandedFilter(args, helpers) {
	const baselineDir = path.join(helpers.repoRoot, "fixtures", "screenshots", "expanded-filter");
	if (args.expandedFilter.action === "record") {
		const recorded = recordExpandedFilter(args.expandedFilter.directory, baselineDir);
		console.log(
			`screenshots: recorded ${recorded.states.length} reviewed expanded-filter states without recapturing.`,
		);
		return 0;
	}
	if (args.expandedFilter.action === "check" && !existsSync(path.join(baselineDir, MANIFEST)))
		throw new Error(
			"There are no expanded-filter baselines. Collect --expanded-filter --review=<dir>, then record the approved directory with --record=<dir>.",
		);
	const outDir = canonicalDirectory(
		args.expandedFilter.directory ?? mkdtempSync(path.join(os.tmpdir(), "tcw-expanded-filter-")),
	);
	const stored = canonicalDirectory(path.join(helpers.repoRoot, "fixtures", "screenshots"));
	if (within(outDir, stored))
		throw new Error("Expanded-filter review/check artifacts must stay outside stored screenshot baselines.");
	if (existsSync(outDir) && readdirSync(outDir).length)
		throw new Error(`Expanded-filter output is not empty: ${outDir}`);
	const {
		buildInfo,
		releaseBuild,
		installPlugin,
		quietSettings,
		fixtureWindow,
		runAndUndo,
		TIMELINE_VIEW,
		manifest,
	} = helpers.fixture();
	const buildFiles = releaseBuild();
	const build = {
		...buildInfo(),
		mainJsSha256: sha256(readFileSync(buildFiles.mainJs)),
		stylesCssSha256: sha256(readFileSync(buildFiles.stylesCss)),
	};
	const { cli, vaultPath } = helpers.screenshotVault();
	const pins = helpers.checkedThemePins(vaultPath, args.themes);
	const { timeline, capture, unhover } = helpers;
	const taken = reviewExpandedFilter({
		outDir,
		themes: args.themes,
		build,
		run: (states, onState) => {
			const plugin = installPlugin(vaultPath, quietSettings(), buildFiles);
			const fixture = fixtureWindow(cli, "golden-vault", plugin);
			return runAndUndo(() => {
				helpers.backupAppearance(vaultPath);
				const prepared = fixture.prepare();
				const env = helpers.environment(cli, prepared);
				for (const { name, theme } of states) {
					plugin.writeSettings(quietSettings({ entryPosition: "top", counterBehavior: "Filter" }));
					cli.cdp("Emulation.setDeviceMetricsOverride", {
						width: 600,
						height: 600,
						deviceScaleFactor: 1,
						mobile: false,
					});
					const { base, cssTheme } = THEMES[theme];
					cli.evaluate(selectCssTheme, { cssTheme, sha256: pins[cssTheme]?.themeCssSha256 });
					cli.evaluate(timeline, {
						action: "open",
						viewType: TIMELINE_VIEW,
						pluginId: manifest.id,
						settleMs: helpers.settleMs,
					});
					cli.evaluate(timeline, { action: "theme", viewType: TIMELINE_VIEW, theme: base });
					cli.evaluate(applyExpandedFilter, { viewType: TIMELINE_VIEW });
					unhover(cli);
					cli.evaluate(timeline, { action: "settle", viewType: TIMELINE_VIEW });
					const styles = serializeStyles(
						cli.evaluate(collectStyles, {
							container: `.workspace-leaf-content[data-type="${TIMELINE_VIEW}"] > .view-content`,
							probes: EXPANDED_FILTER_PROBES,
							properties: STYLE_PROPERTIES,
							rootCustomProperties: ROOT_CUSTOM_PROPERTIES,
						}),
					);
					const png = capture(cli);
					const record = cli.evaluate(collectExpandedFilter, { viewType: TIMELINE_VIEW });
					assertExpandedFilter(record);
					onState(name, { png, styles, semantic: record.semantic });
					console.log(`screenshots: ${name}: P, S and ${record.semantic.rows.length} ordered row instances.`);
				}
				return {
					...env,
					...helpers.appearances(cli, Object.fromEntries(states.map((state) => [state.name, state])), pins),
				};
			}, [
				["clear the page size", () => cli.cdp("Emulation.clearDeviceMetricsOverride")],
				["remove the screenshot style", () => cli.evaluate(timeline, { action: "cleanup" })],
				...fixture.undoSteps,
				["restore appearance.json", () => helpers.restoreAppearance(cli, vaultPath)],
			]);
		},
	});
	console.log(`screenshots: expanded-filter artifacts in ${outDir}; all fixture undo steps succeeded.`);
	if (args.expandedFilter.action === "review") return 0;
	const baseline = readExpandedFilterReview(baselineDir);
	warnAboutSetup({ ...baseline.env, plugin: baseline.build }, taken.env, "the expanded-filter baselines");
	const problems = compareExpandedFilter(outDir, baselineDir);
	for (const problem of problems) console.log(`screenshots: ${problem}`);
	return problems.length ? 1 : 0;
}
