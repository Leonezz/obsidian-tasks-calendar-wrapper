import { test } from "node:test";
import assert from "node:assert/strict";

import { comparePngs, decodePng, encodePng, screenshotVerdict, type Image } from "../scripts/png.mjs";

// scripts/png.mjs, which `pnpm screenshots` compares its screenshots with: the comparison, and what a difference means.

/** An image of the size, every pixel the colour, with the given pixels set to another. */
function image(width: number, height: number, rgba: number[], changed: [number, number[]][] = []): Image {
	const data = Buffer.alloc(width * height * 4);
	for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
	for (const [pixel, other] of changed) data.set(other, pixel * 4);
	return { width, height, data };
}

test("an image goes through encodePng and decodePng unchanged, and compares as the same", () => {
	const original = image(3, 2, [10, 20, 30, 255], [[4, [200, 100, 0, 255]]]);
	const decoded = decodePng(encodePng(original));
	assert.deepEqual([decoded.width, decoded.height], [3, 2]);
	assert.ok(decoded.data.equals(original.data));
	assert.deepEqual(comparePngs(original, decoded), {
		differing: 0,
		maxDelta: 0,
		total: 6,
		sameSize: true,
		diff: null,
	});
});

test("comparePngs counts the pixels that differ and the largest difference of a channel; another size differs by 255", () => {
	const base = image(4, 4, [100, 100, 100, 255]);
	const result = comparePngs(
		base,
		image(
			4,
			4,
			[100, 100, 100, 255],
			[
				[0, [110, 100, 100, 255]],
				[5, [100, 93, 100, 255]],
			],
		),
	);
	assert.deepEqual([result.differing, result.maxDelta, result.sameSize], [2, 10, true]);
	const taller = comparePngs(base, image(4, 5, [100, 100, 100, 255]));
	assert.deepEqual([taller.differing, taller.maxDelta, taller.sameSize], [4, 255, false]);
});

test("a screenshot is the same with a few pixels of noise or any number drifted a little; otherwise it changed", () => {
	const cases: [number, number, boolean, string][] = [
		[0, 0, true, "same"],
		[500, 24, true, "noise"],
		[132, 13, true, "noise"],
		[35_000, 15, true, "drift"],
		[4_947_288, 16, true, "drift"],
		[35_000, 17, true, "changed"],
		[501, 24, true, "changed"],
		[22_000, 120, true, "changed"],
		[300, 255, false, "changed"],
		[35_000, 10, false, "changed"],
	];
	for (const [differing, maxDelta, sameSize, verdict] of cases)
		assert.equal(
			screenshotVerdict({ differing, maxDelta, sameSize }),
			verdict,
			JSON.stringify({ differing, maxDelta, sameSize }),
		);
});
