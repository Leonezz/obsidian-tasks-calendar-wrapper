/** Types for scripts/frozen-tests.mjs, which the tests import. */

export const FROZEN_FILES: readonly string[];

export interface SourceLine {
	readonly number: number;
	readonly text: string;
}

export interface FrozenDifference {
	readonly path: string;
	readonly deleted: boolean;
	readonly changes: readonly { readonly side: "base" | "current"; readonly line: number; readonly text: string }[];
}

export function stripImports(source: string): { text: string; lines: SourceLine[] };
export function compareFrozenFiles(
	base: Readonly<Record<string, string>>,
	current: Readonly<Record<string, string>>,
): FrozenDifference[];
export function formatChanges(differences: readonly FrozenDifference[]): string;
export function parseLabels(raw: string | undefined, eventName?: string): string[];
