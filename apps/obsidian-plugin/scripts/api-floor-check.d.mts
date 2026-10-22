/** Types for scripts/api-floor-check.mjs, which the tests import. */
import type { Program } from "typescript";

/** A run-time use of a declaration of Obsidian's typings newer than the floor that no requireApiVersion gates. */
export interface ApiFloorViolation {
	readonly file: string;
	/** From 1. */
	readonly line: number;
	/** From 1. */
	readonly column: number;
	readonly name: string;
	/** The declaration's `@since`. */
	readonly since: string;
}

export function compareVersions(a: string, b: string): number;

export function apiFloorViolations(
	program: Program,
	floor: string,
	isPluginFile: (fileName: string) => boolean,
): ApiFloorViolation[];
