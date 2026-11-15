export const COLDSTART_FIXTURES: readonly string[];
export interface ColdstartArgs {
	report: string;
	timeoutMs: number;
}
export interface ColdstartRow {
	day: string;
	id: string;
	path: string;
	line: number;
}
export interface ColdstartSample {
	vaultPath: string;
	skipOpenReread: boolean;
	mainPid: number;
	parentPid: number;
	rendererPid: number;
	at: number;
	locale: string;
	today: string;
	bootNonce: string;
	sourceSha256: string;
	actualFlag: boolean;
	metadata: { initialized: boolean; inProgressTaskCount: number };
	controls: { counter: string; todayFocus: boolean; quickFilter: null };
	rows: ColdstartRow[];
	taskIds: string[];
	shownIds: string[];
	windowing: { rowCount: number; windowed: boolean };
	committedReloadId: number;
	lastListReloadId: number;
}
export interface ColdstartWindow {
	name: string;
	vaultPath: string;
	mainPid: number;
	parentPid: number;
	rendererPid: number;
	webContentsId: number;
	windowId: number;
	title: string;
	crashed: boolean;
	layoutReady: boolean;
	saved: boolean;
	jobs: number;
	layout: Record<string, unknown>;
	locale: string;
	clock: number;
	realClock: number;
	throttling: boolean;
	visibility: string;
	restricted: boolean;
	enabled: string[];
	loaded: string[];
	theme: string | null;
	cssTheme: string | null;
	views: { id: string; hasController: boolean; controls: Record<string, unknown> | null }[];
}
export interface ColdstartInventory {
	mainPid: number;
	callerWebContentsId: number;
	executable: string;
	version: string;
	versions: Record<string, string>;
	windows: ColdstartWindow[];
}
export interface ColdstartFile {
	bytes: number;
	sha256: string;
}
export type ColdstartBackups = Record<
	string,
	{
		pluginExisted: boolean;
		pluginsDirExisted: boolean;
		plugin: Record<string, ColdstartFile>;
		config: Record<string, ColdstartFile | null>;
	}
>;
export function parseColdstartArgs(argv: readonly string[]): ColdstartArgs;
export function coldstartReportPaths(input: string): { file: string; directory: string };
export function wrapColdstartBundle(
	source: string,
	skipOpenReread: boolean,
	today: { year: number; month: number; day: number },
): string;
export function collectColdstartSample(arg: {
	pluginId: string;
	viewType: string;
	vaultPath: string;
	skipOpenReread: boolean;
	sourceSha256: string;
}): ColdstartSample;
export function compareColdstartSamples(before: ColdstartSample, after: ColdstartSample): void;
export function assertColdstartInventory(inventory: ColdstartInventory, expectedPaths: Record<string, string>): void;
export function assertColdstartRestorable(
	inventory: ColdstartInventory,
	communities: Record<string, unknown>,
	pluginId: string,
): void;
export function assertNoColdstartLeftovers(vaultPath: string): void;
export function coldstartDriverProcesses(ps: string, selfPid: number): { pid: number; command: string }[];
export function waitForColdstart<T>(
	read: () => T,
	timeoutMs: number,
	description: string,
	options?: {
		now?: () => number;
		sleep?: (ms: number) => void;
		accept?: (result: T) => boolean;
		retry?: (error: Error) => boolean;
	},
): T;
export function coldstartHost(arg: {
	action: "inventory" | "quit";
	pluginId: string;
	viewType: string;
	expectedPaths: Record<string, string>;
	restore?: Record<string, ColdstartWindow>;
}): Promise<ColdstartInventory | { mainPid: number; scheduled: boolean }>;
export function coldstartLayout(original: Record<string, unknown>, viewType: string): Record<string, unknown>;
export function coldstartLayoutIdentity(
	layout: Record<string, unknown>,
	viewType: string,
): {
	layout: Record<string, unknown>;
	sessions: { leafId: string; session: unknown }[];
};
export function backupColdstartFiles(
	vaults: Record<string, string>,
	directory: string,
	pluginId: string,
): ColdstartBackups;
export function restoreColdstartFiles(
	vaults: Record<string, string>,
	directory: string,
	backups: ColdstartBackups,
	pluginId: string,
): void;
export function runColdstartCheck(argv: readonly string[]): Promise<number>;
