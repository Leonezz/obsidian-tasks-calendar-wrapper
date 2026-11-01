/**
 * Compares the markup goldens with the real timeline in golden-vault. Only the contents rendered by
 * MarkdownRenderer are normalized; attributes, controls, badges and row-list containers must match exactly.
 * The fixture helpers install the build, pin today, and restore the plugin, settings, clock and layout.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { JSDOM } from "jsdom";
import {
	fixtureCli,
	fixtureVaultPath,
	fixtureWindow,
	installPlugin,
	manifest,
	notesOf,
	quietSettings,
	repoRoot,
	runAndUndo,
	runScript,
	ScriptError,
	TIMELINE_VIEW,
} from "./fixture-app.mjs";
import { compareMarkup, deserializeMarkup, obsidianMarkupStates, parseVisibleState } from "./markup.mjs";

const VAULT_NAME = "golden-vault";
const baselineDir = path.join(repoRoot, "fixtures", "markup");

/** Runs in Obsidian, starting each state from a newly opened timeline as screenshots.mjs does. */
async function captureState({ pluginId, viewType, state }) {
	const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const content = () => document.querySelector(`.workspace-leaf-content[data-type="${viewType}"] > .view-content`);
	async function quiet(ms) {
		const target = content();
		if (!target) throw new Error("the timeline view is not open");
		let last = performance.now();
		const observer = new MutationObserver(() => {
			last = performance.now();
		});
		observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
		const start = performance.now();
		try {
			while (performance.now() - last < ms) {
				if (performance.now() - start > 15_000) throw new Error("the timeline kept changing for 15 s");
				await pause(50);
			}
		} finally {
			observer.disconnect();
		}
	}
	async function click(selector, className) {
		const target = content()?.querySelector(selector);
		if (!target) throw new Error(`the timeline has no ${selector}`);
		target.click();
		const start = performance.now();
		while (!content()?.querySelector(".taskido")?.classList.contains(className)) {
			if (performance.now() - start > 2_000) throw new Error(`clicking ${selector} did not add ${className}`);
			await pause(20);
		}
		document.activeElement?.blur();
		await quiet(300);
	}

	app.workspace.detachLeavesOfType(viewType);
	if (app.plugins.plugins[pluginId]) await app.plugins.disablePlugin(pluginId);
	if (!(await app.plugins.enablePlugin(pluginId))) throw new Error(`Obsidian could not load the plugin ${pluginId}`);
	const others = [];
	app.workspace.iterateRootLeaves((leaf) => others.push(leaf));
	const leaf = app.workspace.getLeaf("tab");
	await leaf.setViewState({ type: viewType, active: true });
	others.filter((other) => other !== leaf).forEach((other) => other.detach());
	app.workspace.leftSplit.collapse();
	app.workspace.rightSplit.collapse();
	app.changeTheme("moonstone");
	// Options arrive 200 ms after loading the plugin; markdown rendering can finish later still.
	await pause(1_500);
	await quiet(500);
	if (state.todayFocus) await click('[aria-label="Focus today"]', "todayFocus");
	if (state.counter) await click(`#${state.counter}`, `${state.counter}${state.behavior}`);
	const root = content()?.querySelector(".taskido");
	if (!root) throw new Error("the timeline has no .taskido element");
	return root.outerHTML;
}

await runScript("markup:obsidian", () => {
	const args = process.argv.slice(2);
	const unknown = args.filter((arg) => !arg.startsWith("--state=") && !arg.startsWith("--report="));
	if (unknown.length)
		throw new ScriptError(
			`unknown arguments ${JSON.stringify(unknown)}; use --state=<visible-state> or --report=<file>. Only golden-vault is allowed.`,
		);
	const selected = args.filter((arg) => arg.startsWith("--state=")).map((arg) => arg.slice("--state=".length));
	const names = selected.length ? [...new Set(selected)] : [...obsidianMarkupStates];
	const states = names.map((name) => ({ name, ...parseVisibleState(name) }));
	const reportArgs = args.filter((arg) => arg.startsWith("--report="));
	if (reportArgs.length > 1 || reportArgs.some((arg) => arg === "--report="))
		throw new ScriptError("use --report=<file> at most once, with a nonempty path.");
	for (const { name } of states) {
		const file = path.join(baselineDir, `${name}.html`);
		if (!existsSync(file))
			throw new ScriptError(
				`${path.relative(repoRoot, file)} is missing. Run \`UPDATE_MARKUP=1 pnpm test\` first.`,
			);
	}

	const cli = fixtureCli(VAULT_NAME);
	const vaultDir = path.join(repoRoot, "fixtures", VAULT_NAME);
	const vaultPath = fixtureVaultPath(
		cli,
		VAULT_NAME,
		notesOf(vaultDir),
		`Open ${vaultDir}, or a copy in a folder named ${VAULT_NAME}, with "Open folder as vault", then run this again.`,
	);
	const outDir = mkdtempSync(path.join(os.tmpdir(), "tcw-markup-obsidian-"));
	const reportFile = reportArgs.length
		? path.resolve(reportArgs[0].slice("--report=".length))
		: path.join(outDir, "report.json");
	const plugin = installPlugin(vaultPath, quietSettings());
	const fixture = fixtureWindow(cli, VAULT_NAME, plugin);
	const captured = runAndUndo(() => {
		const prepared = fixture.prepare();
		const results = [];
		for (const state of states) {
			plugin.writeSettings(
				quietSettings({ entryPosition: state.position, counterBehavior: state.behavior ?? "Filter" }),
			);
			const outerHTML = cli.evaluate(captureState, { pluginId: manifest.id, viewType: TIMELINE_VIEW, state });
			const rawFile = path.join(outDir, `${state.name}.obsidian.html`);
			writeFileSync(rawFile, outerHTML + "\n");
			results.push({ state, outerHTML, rawFile });
		}
		return { prepared, results };
	}, fixture.undoSteps);

	const dom = new JSDOM("");
	try {
		const results = captured.results.map(({ state, outerHTML, rawFile }) => {
			const expected = deserializeMarkup(
				readFileSync(path.join(baselineDir, `${state.name}.html`), "utf8"),
				dom.window.document,
			);
			const template = dom.window.document.createElement("template");
			template.innerHTML = outerHTML;
			const actual = template.content.firstElementChild;
			if (!actual?.matches(".taskido") || template.content.childElementCount !== 1)
				throw new ScriptError(`${state.name}: Obsidian did not return one .taskido root.`);
			const comparison = compareMarkup(expected, actual);
			const expectedFile = path.join(outDir, `${state.name}.expected.html`);
			const actualFile = path.join(outDir, `${state.name}.actual.html`);
			const diffFile = path.join(outDir, `${state.name}.diff.txt`);
			writeFileSync(expectedFile, comparison.expected);
			writeFileSync(actualFile, comparison.actual);
			writeFileSync(diffFile, comparison.diff);
			return { name: state.name, matches: comparison.diff === "", rawFile, expectedFile, actualFile, diffFile };
		});
		const report = {
			vault: VAULT_NAME,
			today: captured.prepared.today,
			normalization: "Only .task .lines > .content inner HTML (MarkdownRenderer output).",
			results,
		};
		mkdirSync(path.dirname(reportFile), { recursive: true });
		writeFileSync(reportFile, JSON.stringify(report, null, "\t") + "\n");
		for (const result of results)
			console.log(
				`markup:obsidian: ${result.name}: ${result.matches ? "matches" : `differs; see ${result.diffFile}`}`,
			);
		console.log(`markup:obsidian: report ${reportFile}; captures ${outDir}`);
		return results.every((result) => result.matches) ? 0 : 1;
	} finally {
		dom.window.close();
	}
});
