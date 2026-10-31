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

export const MAX_TS_EXPECT_ERROR: 1;

export function isPluginSourceFile(fileName: string, relativeTo: string): boolean;

export function privateApiViolations(
	program: Program,
	options: {
		readonly isPluginFile: (fileName: string) => boolean;
		readonly relativeTo: string;
	},
): { violations: PrivateApiViolation[]; tsExpectErrors: PrivateApiPlace[] };
