/** Types for scripts/png.mjs, which the tests import. */

export interface Image {
	readonly width: number;
	readonly height: number;
	/** RGBA bytes, row by row. */
	readonly data: Buffer;
}

export interface Comparison {
	readonly differing: number;
	readonly maxDelta: number;
	readonly total: number;
	readonly sameSize: boolean;
	readonly diff: Image | null;
}

export function decodePng(buffer: Buffer): Image;
export function encodePng(image: Image): Buffer;
export function comparePngs(expected: Image, actual: Image): Comparison;

export const NOISE_PIXELS: number;
export const NOISE_DELTA: number;
export const DRIFT_DELTA: number;

export function screenshotVerdict(
	comparison: Pick<Comparison, "differing" | "maxDelta" | "sameSize">,
): "same" | "noise" | "drift" | "changed";
