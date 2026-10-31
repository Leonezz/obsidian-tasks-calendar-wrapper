/** Types for scripts/private-api-check.mjs, which the tests import. */
import type { Program } from "typescript";

export interface PrivateApiPlace {
	/** Relative to the plugin, with forward slashes. */
	readonly file: string;
	/** From 1. */
	readonly line: number;
}

export interface PrivateApiViolation extends PrivateApiPlace {
	readonly name: string;
	readonly message: string;
}

export interface PrivateApiAllowance {
	readonly file: string;
	readonly name: string;
	readonly count: number;
}

export const MAX_TS_EXPECT_ERROR: 3;
export const STEP_8_ALLOW: readonly PrivateApiAllowance[];

export function isPluginSourceFile(fileName: string, relativeTo: string): boolean;

export function privateApiViolations(
	program: Program,
	options: {
		readonly isPluginFile: (fileName: string) => boolean;
		readonly relativeTo: string;
		readonly allow?: readonly PrivateApiAllowance[];
	},
): { violations: PrivateApiViolation[]; tsExpectErrors: PrivateApiPlace[] };
