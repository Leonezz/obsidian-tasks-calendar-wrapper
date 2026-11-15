import type { TasksParityCase } from "./tasks-parity-notes.mjs";
import type { NoteDiff } from "./capture-tasks-toggle-lib.mjs";

export interface ParityArgs {
	readonly mode: "check" | "restore";
	readonly report: string;
	readonly backupdir: string;
}
export interface ParityOracleCase extends TasksParityCase {
	readonly api: string;
	readonly after: NoteDiff;
}
export interface ParityFixture {
	readonly format: number;
	readonly group: string;
	readonly tasksVersion: string;
	readonly day: string;
	readonly notes: Readonly<Record<string, string>>;
	readonly cases: readonly ParityOracleCase[];
}
export interface ParityCase extends ParityOracleCase {
	readonly id: string;
	readonly expected: "written" | "refused" | "hidden";
	readonly reason?: string;
	readonly oracle: "recorded" | "session";
}
export function parseParityArgs(argv: readonly string[]): ParityArgs;
export function validateParityPaths(
	args: ParityArgs,
	worktrees?: readonly string[],
): { report: string; backupdir: string };
export function planParityCases(fixture: ParityFixture, corpus: readonly TasksParityCase[]): ParityCase[];
export function applyOracleLine(before: string, line: number, api: string): string;
export function compareParityNote(
	before: string,
	after: string,
	entry: ParityCase,
	expectedApi: string,
): { matches: boolean; mode: "whole-note" | "changed-lines"; detail?: string };
export interface ParityBackup {
	schema: number;
	vault: string;
	vaultPath: string;
	runtime: Record<string, unknown>;
	folders: string[];
	files: Record<string, string | null>;
	complete: boolean;
	runId?: string;
}
export function backupParityFixture(
	directory: string,
	vaultPath: string,
	notes: ReadonlyMap<string, Buffer>,
	runtime: Record<string, unknown>,
): ParityBackup;
export function readParityBackup(directory: string, notes: ReadonlyMap<string, Buffer>): ParityBackup;
export function verifyParityBackup(index: ParityBackup): void;
export function parityPage(input: Record<string, unknown>): Promise<unknown>;
export function runParityCheck(args: ParityArgs): Promise<unknown>;
