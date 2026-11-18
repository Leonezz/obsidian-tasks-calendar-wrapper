/** Types for the independent, opt-in expanded-filter screenshot case. */
import type { StyleProbe } from "./screenshots-styles.mjs";
import type { ThemeName, ThemePins, ThemeSet } from "./screenshots-themes.mjs";

export type ExpandedFilterShot = { name: string; theme: ThemeName };
export function expandedFilterPlan(themes?: ThemeSet): ExpandedFilterShot[];
export const EXPANDED_FILTER_PROBES: readonly StyleProbe[];

export type ExpandedFilterSemantic = {
	counter: string;
	todayFocus: boolean;
	entryPosition: string;
	counterBehavior: string;
	controls: {
		dateScope: string | undefined;
		dates: string[];
		priorityOptions: { value: string; label: string; checked: boolean }[];
		priorityOpen: boolean;
		prioritySummary: string | undefined;
		entryText: string | undefined;
	};
	applied: { from?: string; to?: string; priorities: string[]; tags: string[] } | null;
	rows: { day: string; path: string; line: number; marker: string | null; busy: boolean; text: string }[];
};
type Rect = { x: number; y: number; width: number; height: number };
export type ExpandedFilterCollection = {
	semantic: ExpandedFilterSemantic;
	geometry: {
		content: Rect;
		panel: Rect;
		scrollTop: number;
		viewport: { width: number; height: number; deviceScaleFactor: number };
	};
};
/** Both functions can be serialized into the browser without module-scope helpers. */
export function applyExpandedFilter(input: { viewType: string }): Promise<true>;
export function collectExpandedFilter(input: { viewType: string }): ExpandedFilterCollection;
export function assertExpandedFilter(record: ExpandedFilterCollection): void;

export type ExpandedFilterRecord = { png: Buffer; styles: string; semantic: ExpandedFilterSemantic };
export type ExpandedFilterManifest = {
	schema: 1;
	kind: "expanded-filter";
	complete: boolean;
	themes: ThemeSet;
	build: unknown;
	env: unknown;
	states: ExpandedFilterShot[];
	files: Record<string, { sha256: string; bytes: number }>;
	error?: string;
};
/** run invokes onState for every shot, and returns the environment only after all undo steps succeed. */
export function reviewExpandedFilter(input: {
	outDir: string;
	themes?: ThemeSet;
	build: unknown;
	run: (states: ExpandedFilterShot[], onState: (name: string, record: ExpandedFilterRecord) => void) => unknown;
}): ExpandedFilterManifest;
/** Reject incomplete reviews, unexpected plans or file paths, and missing or modified files. */
export function readExpandedFilterReview(dir: string): ExpandedFilterManifest;
/** Offline: validate every input, reject real-path overlap and symlink targets, then promote exact reviewed bytes. */
export function recordExpandedFilter(artifactDir: string, baselineDir: string): ExpandedFilterManifest;
/** Existing PNG verdicts, exact serialized S, and exact semantic records; diffs stay in artifactDir. */
export function compareExpandedFilter(artifactDir: string, baselineDir: string): string[];

type Cli = {
	evaluate<T, A>(fn: (argument: A) => T, argument: A): Awaited<T>;
	cdp(method: string, argument?: Record<string, unknown>): unknown;
};
/** Helpers supplied by screenshots.mjs; record uses only repoRoot and never loads the fixture driver. */
export type ExpandedFilterHelpers = {
	repoRoot: string;
	fixture(): {
		buildInfo(): Record<string, unknown>;
		releaseBuild(): { mainJs: string; stylesCss: string };
		installPlugin(
			vaultPath: string,
			settings: Record<string, unknown>,
			build: { mainJs: string; stylesCss: string },
		): InstalledPlugin;
		quietSettings(extra?: Record<string, unknown>): Record<string, unknown>;
		fixtureWindow(
			cli: Cli,
			vaultName: string,
			plugin: InstalledPlugin,
		): { prepare(): unknown; undoSteps: [string, () => unknown][] };
		runAndUndo<T>(work: () => T, undo: [string, () => unknown][]): T;
		TIMELINE_VIEW: string;
		manifest: { id: string };
	};
	screenshotVault(): { cli: Cli; vaultPath: string };
	checkedThemePins(vaultPath: string, themes: ThemeSet): ThemePins;
	timeline(argument: Record<string, unknown>): Promise<unknown>;
	capture(cli: Cli): Buffer;
	unhover(cli: Cli): void;
	backupAppearance(vaultPath: string): void;
	restoreAppearance(cli: Cli, vaultPath: string): void;
	environment(cli: Cli, prepared: unknown): Record<string, unknown>;
	appearances(cli: Cli, shots: Record<string, ExpandedFilterShot>, pins: ThemePins): Record<string, unknown>;
	settleMs: number;
};
type InstalledPlugin = { writeSettings(settings: Record<string, unknown>): void; restore(): void };
export function runExpandedFilter(
	args: { themes: ThemeSet; expandedFilter: { action: "review" | "record" | "check"; directory: string | null } },
	helpers: ExpandedFilterHelpers,
): Promise<0 | 1>;
