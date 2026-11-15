import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { comparePngs, cropPng, decodePng, encodePng, screenshotVerdict, type Image } from "../scripts/png.mjs";

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

/** Independent bit-at-a-time CRC for constructing and checking test PNG chunks. */
function pngCrc(bytes: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
	const bytes = Buffer.alloc(body.length + 12);
	bytes.writeUInt32BE(body.length);
	bytes.write(type, 4, "ascii");
	body.copy(bytes, 8);
	bytes.writeUInt32BE(pngCrc(bytes.subarray(4, -4)), bytes.length - 4);
	return bytes;
}

function pngParts(png: Buffer): { type: string; body: Buffer; bytes: Buffer }[] {
	const parts = [];
	for (let at = 8; at < png.length;) {
		const length = png.readUInt32BE(at);
		const bytes = png.subarray(at, at + 12 + length);
		assert.equal(bytes.readUInt32BE(bytes.length - 4), pngCrc(bytes.subarray(4, -4)));
		parts.push({ type: bytes.toString("ascii", 4, 8), body: bytes.subarray(8, -4), bytes });
		at += bytes.length;
	}
	return parts;
}

function withMetadata(png: Buffer, before: Buffer[], after: Buffer[] = []): Buffer {
	return Buffer.concat([png.subarray(0, 33), ...before, png.subarray(33, -12), ...after, png.subarray(-12)]);
}

/** A small RGB ICC header/tag-table envelope; the crop keeps the enclosed transform bytes opaque. */
function profile(): Buffer {
	const bytes = Buffer.alloc(156);
	bytes.writeUInt32BE(bytes.length);
	bytes.write("RGB ", 16);
	bytes.write("XYZ ", 20);
	bytes.write("acsp", 36);
	bytes.writeUInt32BE(1, 128);
	bytes.write("desc", 132);
	bytes.writeUInt32BE(144, 136);
	bytes.writeUInt32BE(12, 140);
	bytes.write("text", 144);
	return bytes;
}

const iccp = (bytes = profile()) => pngChunk("iCCP", Buffer.concat([Buffer.from("test\0\0"), deflateSync(bytes)]));
const viewport = { width: 3, height: 3 };
const clip = { x: 1, y: 1, width: 2, height: 2 };

test("cropPng maps RGBA pixels and alpha exactly from an integer rectangle without modifying its source", () => {
	const original = encodePng(
		image(
			3,
			3,
			[9, 8, 7, 255],
			[
				[4, [11, 12, 13, 0]],
				[5, [21, 22, 23, 64]],
				[7, [31, 32, 33, 128]],
				[8, [41, 42, 43, 254]],
			],
		),
	);
	const untouched = Buffer.from(original);
	const result = decodePng(cropPng(original, clip, viewport));
	assert.deepEqual([result.width, result.height], [2, 2]);
	assert.deepEqual(result.data, Buffer.from([11, 12, 13, 0, 21, 22, 23, 64, 31, 32, 33, 128, 41, 42, 43, 254]));
	assert.deepEqual(original, untouched);
	assert.deepEqual(
		decodePng(cropPng(original, { x: 0, y: 0, ...viewport, scale: 1 }, viewport)).data,
		decodePng(original).data,
	);
});

test("cropPng accepts RGB8 with consecutive IDAT chunks and preserves RGB values with opaque alpha", () => {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(3);
	header.writeUInt32BE(2, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const compressed = deflateSync(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12, 13, 14, 15, 16, 17, 18]));
	const source = Buffer.concat([
		encodePng(image(1, 1, [0, 0, 0, 255])).subarray(0, 8),
		pngChunk("IHDR", header),
		pngChunk("IDAT", compressed.subarray(0, 5)),
		pngChunk("IDAT", compressed.subarray(5)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
	const colorProfile = iccp();
	const output = cropPng(
		withMetadata(source, [colorProfile]),
		{ x: 1, y: 0, width: 2, height: 2 },
		{ width: 3, height: 2 },
	);
	assert.deepEqual(
		decodePng(output).data,
		Buffer.from([4, 5, 6, 255, 7, 8, 9, 255, 13, 14, 15, 255, 16, 17, 18, 255]),
	);
	assert.deepEqual(pngParts(output)[1].bytes, colorProfile);
});

test("cropPng rejects invalid coordinates, scale, expected viewport, bounds and source dimensions", () => {
	const source = encodePng(image(3, 3, [0, 0, 0, 255]));
	for (const patch of [
		{ x: -1 },
		{ y: -1 },
		{ x: 0.5 },
		{ y: NaN },
		{ x: Infinity },
		{ width: 0 },
		{ height: -1 },
		{ width: 1.5 },
		{ height: Number.MAX_SAFE_INTEGER + 1 },
		{ x: 2 },
		{ y: 2 },
		{ width: 3 },
		{ scale: 0 },
		{ scale: 2 },
		{ scale: "1" },
	])
		assert.throws(() => cropPng(source, { ...clip, ...patch } as typeof clip, viewport), /cropPng:/);
	for (const expected of [
		undefined,
		{},
		{ width: 0, height: 3 },
		{ width: 3, height: NaN },
		{ width: 3.5, height: 3 },
		{ width: Number.MAX_SAFE_INTEGER + 1, height: 3 },
	])
		assert.throws(() => cropPng(source, clip, expected as typeof viewport), /expected viewport/);
	assert.throws(() => cropPng(source, clip, { width: 4, height: 3 }), /PNG dimensions/);
});

test("cropPng preserves ICC, color and safe ancillary chunks byte-for-byte, including CRC and IDAT-relative order", () => {
	const gamma = Buffer.alloc(4);
	gamma.writeUInt32BE(45455);
	const chromaticities = Buffer.alloc(32);
	[31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000].forEach((n, i) => chromaticities.writeUInt32BE(n, i * 4));
	const before = [
		iccp(),
		pngChunk("gAMA", gamma),
		pngChunk("cHRM", chromaticities),
		pngChunk("bKGD", Buffer.from([0, 1, 0, 2, 0, 3])),
		pngChunk("vpAg", Buffer.from([10, 20, 30])),
	];
	const after = [pngChunk("tEXt", Buffer.from("Comment\0capture")), pngChunk("vpBg", Buffer.from([40]))];
	const source = withMetadata(encodePng(image(3, 3, [1, 2, 3, 128])), before, after);
	const parts = pngParts(cropPng(source, clip, viewport));
	assert.deepEqual(
		parts.map(({ type }) => type),
		["IHDR", "iCCP", "gAMA", "cHRM", "bKGD", "vpAg", "IDAT", "tEXt", "vpBg", "IEND"],
	);
	assert.deepEqual(
		parts.filter(({ type }) => !["IHDR", "IDAT", "IEND"].includes(type)).map(({ bytes }) => bytes),
		[...before, ...after],
	);
	const srgb = pngChunk("sRGB", Buffer.from([0]));
	assert.deepEqual(
		pngParts(cropPng(withMetadata(encodePng(image(3, 3, [1, 2, 3, 255])), [srgb]), clip, viewport))[1].bytes,
		srgb,
	);
});

test("cropPng rejects unsupported pixel semantics and unknown unsafe or critical chunks", () => {
	const source = encodePng(image(3, 3, [1, 2, 3, 255]));
	for (const type of ["tRNS", "sBIT", "PLTE", "acTL", "fcTL", "fdAT", "vpAG", "ABCD", "cICP"])
		assert.throws(
			() => cropPng(withMetadata(source, [pngChunk(type, Buffer.alloc(6))]), clip, viewport),
			/unsupported PNG chunk/,
		);
});

test("cropPng rejects malformed chunks, CRCs and PNG ordering before producing an image", () => {
	const source = encodePng(image(3, 3, [1, 2, 3, 255]));
	const parts = pngParts(source);
	const sig = source.subarray(0, 8);
	const badCrc = Buffer.from(source);
	badCrc[badCrc.length - 1] ^= 1;
	const malformed = [
		source.subarray(0, -1),
		Buffer.concat([source, Buffer.from([0])]),
		badCrc,
		Buffer.from("not PNG"),
		Buffer.concat([sig, parts[1].bytes, parts[0].bytes, parts[2].bytes]),
		Buffer.concat([sig, parts[0].bytes, parts[0].bytes, parts[1].bytes, parts[2].bytes]),
		Buffer.concat([sig, parts[0].bytes, parts[2].bytes]),
		Buffer.concat([sig, parts[0].bytes, parts[1].bytes, pngChunk("IEND", Buffer.from([0]))]),
		Buffer.concat([
			sig,
			parts[0].bytes,
			parts[1].bytes,
			pngChunk("tEXt", Buffer.from("K\0V")),
			parts[1].bytes,
			parts[2].bytes,
		]),
		withMetadata(source, [pngChunk("vpbg", Buffer.alloc(0))]),
	];
	for (const value of malformed) assert.throws(() => cropPng(value, clip, viewport));
	assert.throws(() => cropPng(withMetadata(source, [], [iccp()]), clip, viewport), /late/);
	assert.throws(() => cropPng(withMetadata(source, [iccp(), iccp()]), clip, viewport), /duplicate/);
	assert.throws(
		() => cropPng(withMetadata(source, [iccp(), pngChunk("sRGB", Buffer.from([0]))]), clip, viewport),
		/conflicting/,
	);
});

test("cropPng refuses damaged or incompatible ICC envelopes rather than stripping their profile", () => {
	const source = encodePng(image(3, 3, [1, 2, 3, 255]));
	const damagedProfiles = [
		Buffer.alloc(10),
		(() => {
			const p = profile();
			p.writeUInt32BE(p.length + 1);
			return p;
		})(),
		(() => {
			const p = profile();
			p.write("oops", 36);
			return p;
		})(),
		(() => {
			const p = profile();
			p.write("GRAY", 16);
			return p;
		})(),
		(() => {
			const p = profile();
			p[16] |= 128;
			return p;
		})(),
		(() => {
			const p = profile();
			p.writeUInt32BE(100, 128);
			return p;
		})(),
		(() => {
			const p = profile();
			p.writeUInt32BE(p.length, 136);
			return p;
		})(),
	];
	for (const bytes of damagedProfiles)
		assert.throws(() => cropPng(withMetadata(source, [iccp(bytes)]), clip, viewport), /iCCP/);
	for (const body of [
		Buffer.from("\0\0"),
		Buffer.from(" name\0\0"),
		Buffer.from("name\0\x01bad"),
		Buffer.from("name\0\0bad"),
	])
		assert.throws(() => cropPng(withMetadata(source, [pngChunk("iCCP", body)]), clip, viewport), /iCCP/);
	for (const [type, body] of [
		["gAMA", Buffer.alloc(0)],
		["gAMA", Buffer.alloc(4)],
		["cHRM", Buffer.alloc(4)],
		["sRGB", Buffer.from([4])],
		["bKGD", Buffer.from([1, 0, 0, 0, 0, 0])],
	] as const)
		assert.throws(() => cropPng(withMetadata(source, [pngChunk(type, body)]), clip, viewport), /malformed/);
});
