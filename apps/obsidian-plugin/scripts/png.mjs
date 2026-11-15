/**
 * Just enough PNG for screenshots.mjs, without dependencies: decodes the 8-bit RGB/RGBA images Chrome's
 * screenshots are, encodes RGBA, compares two images pixel by pixel, and says what a difference means.
 */
import { deflateSync, inflateSync } from "zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a),
		pb = Math.abs(p - b),
		pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Returns { width, height, data } with data as RGBA bytes. */
export function decodePng(buffer) {
	if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file");
	let width = 0,
		height = 0,
		bitDepth = 0,
		colorType = 0,
		interlace = 0;
	const idat = [];
	for (let pos = 8; pos < buffer.length;) {
		const length = buffer.readUInt32BE(pos);
		const type = buffer.toString("latin1", pos + 4, pos + 8);
		const body = buffer.subarray(pos + 8, pos + 8 + length);
		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			[bitDepth, colorType, , , interlace] = body.subarray(8, 13);
		} else if (type === "IDAT") {
			idat.push(body);
		} else if (type === "IEND") {
			break;
		}
		pos += 12 + length;
	}
	if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
		throw new Error(
			`unsupported PNG (bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace}); only 8-bit RGB and RGBA are read`,
		);
	}
	const channels = colorType === 6 ? 4 : 3;
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(idat));
	if (raw.length !== height * (stride + 1))
		throw new Error(`PNG data has ${raw.length} bytes, a ${width}×${height} image needs ${height * (stride + 1)}`);
	const data = Buffer.alloc(width * height * 4);
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		if (filter > 4) throw new Error(`unknown PNG filter ${filter}`);
		const current = Buffer.alloc(stride);
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? current[x - channels] : 0;
			const up = previous[x];
			let predictor = 0;
			if (filter === 1) predictor = left;
			else if (filter === 2) predictor = up;
			else if (filter === 3) predictor = (left + up) >> 1;
			else if (filter === 4) predictor = paeth(left, up, x >= channels ? previous[x - channels] : 0);
			current[x] = (line[x] + predictor) & 0xff;
		}
		for (let x = 0; x < width; x++) {
			const to = (y * width + x) * 4;
			current.copy(data, to, x * channels, x * channels + 3);
			data[to + 3] = channels === 4 ? current[x * channels + 3] : 255;
		}
		previous = current;
	}
	return { width, height, data };
}

function chunk(type, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "latin1");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA bytes as a PNG. */
export function encodePng({ width, height, data }) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	const raw = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	return Buffer.concat([
		SIGNATURE,
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/** Validates the RGB profile envelope without interpreting or rewriting its color transform. */
function checkCropProfile(body) {
	const end = body.indexOf(0);
	const name = body.subarray(0, end).toString("latin1");
	if (end < 1 || end > 79 || /[^\x20-\x7e\xa1-\xff]|^ | $|  /.test(name) || body[end + 1] !== 0)
		throw new Error("cropPng: malformed iCCP name or compression method");
	let profile;
	try {
		profile = inflateSync(body.subarray(end + 2), { maxOutputLength: 16 * 1024 * 1024 });
	} catch {
		throw new Error("cropPng: malformed or unsupported iCCP compressed profile (maximum 16 MiB)");
	}
	if (
		profile.length < 132 ||
		profile.readUInt32BE(0) !== profile.length ||
		profile.toString("latin1", 36, 40) !== "acsp" ||
		profile.toString("latin1", 16, 20) !== "RGB "
	)
		throw new Error("cropPng: malformed or non-RGB iCCP profile header");
	const tags = profile.readUInt32BE(128);
	const tableEnd = 132 + tags * 12;
	if (tableEnd > profile.length) throw new Error("cropPng: malformed iCCP tag table");
	for (let i = 0; i < tags; i++) {
		const offset = profile.readUInt32BE(136 + i * 12);
		const length = profile.readUInt32BE(140 + i * 12);
		if (offset < tableEnd || offset % 4 || length < 8 || offset + length > profile.length)
			throw new Error("cropPng: malformed iCCP tag bounds");
	}
}

/** Metadata the screenshot codec can retain across an RGB/RGBA integer crop, in its original IDAT-relative order. */
function cropMetadata(buffer, expectedViewport) {
	if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file");
	const before = [],
		after = [],
		colors = new Set();
	let header = false,
		data = false,
		dataEnded = false,
		ended = false;
	for (let pos = 8; pos < buffer.length;) {
		if (pos + 12 > buffer.length) throw new Error("cropPng: truncated PNG chunk");
		const length = buffer.readUInt32BE(pos);
		const end = pos + 12 + length;
		if (length > 0x7fffffff || end > buffer.length) throw new Error("cropPng: truncated or oversized PNG chunk");
		const type = buffer.toString("latin1", pos + 4, pos + 8);
		const body = buffer.subarray(pos + 8, end - 4);
		if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw new Error("cropPng: invalid PNG chunk type");
		if (crc32(buffer.subarray(pos + 4, end - 4)) !== buffer.readUInt32BE(end - 4))
			throw new Error(`cropPng: invalid ${type} CRC`);
		if (!header && type !== "IHDR") throw new Error("cropPng: IHDR must be first");
		if (type === "IHDR") {
			if (header || length !== 13) throw new Error("cropPng: malformed or duplicate IHDR");
			header = true;
			if (body.readUInt32BE(0) !== expectedViewport.width || body.readUInt32BE(4) !== expectedViewport.height)
				throw new Error("cropPng: PNG dimensions do not match the expected viewport");
			if (body[8] !== 8 || ![2, 6].includes(body[9]) || body[10] || body[11] || body[12])
				throw new Error("cropPng: only non-interlaced 8-bit RGB/RGBA screenshots are supported");
		} else if (type === "IDAT") {
			if (dataEnded) throw new Error("cropPng: IDAT chunks must be consecutive");
			data = true;
		} else if (type === "IEND") {
			if (!data || length || end !== buffer.length)
				throw new Error("cropPng: malformed IEND or trailing PNG data");
			ended = true;
		} else {
			if (data) dataEnded = true;
			if (["iCCP", "gAMA", "cHRM", "sRGB", "bKGD"].includes(type)) {
				if (data || colors.has(type)) throw new Error(`cropPng: late or duplicate ${type}`);
				colors.add(type);
				const lengths = { gAMA: 4, cHRM: 32, sRGB: 1, bKGD: 6 };
				if (type === "iCCP") checkCropProfile(body);
				else if (
					length !== lengths[type] ||
					(type === "gAMA" && !body.readUInt32BE(0)) ||
					(type === "sRGB" && body[0] > 3) ||
					(type === "bKGD" && [0, 2, 4].some((at) => body.readUInt16BE(at) > 255))
				)
					throw new Error(`cropPng: malformed ${type}`);
			} else if (
				!/^[a-z]/.test(type) ||
				!/[a-z]$/.test(type) ||
				["tRNS", "sBIT", "acTL", "fcTL", "fdAT"].includes(type)
			) {
				// tRNS and animation alter decoded pixels; sBIT depends on the source color type. None is silently dropped.
				throw new Error(`cropPng: unsupported PNG chunk ${type}`);
			}
			(data ? after : before).push(buffer.subarray(pos, end));
		}
		pos = end;
	}
	if (!header || !data || !ended) throw new Error("cropPng: incomplete PNG");
	if (colors.has("iCCP") && colors.has("sRGB")) throw new Error("cropPng: conflicting iCCP and sRGB profiles");
	return { before, after };
}

/** Copies integer RGBA rows without scaling, preserving supported color metadata and safe-to-copy ancillary chunks. */
export function cropPng(buffer, rect, expectedViewport) {
	const positive = (n) => Number.isSafeInteger(n) && n > 0;
	if (!positive(expectedViewport?.width) || !positive(expectedViewport?.height))
		throw new Error("cropPng: expected viewport width and height must be positive safe integers");
	if (
		!Number.isSafeInteger(rect?.x) ||
		!Number.isSafeInteger(rect?.y) ||
		rect.x < 0 ||
		rect.y < 0 ||
		!positive(rect?.width) ||
		!positive(rect?.height) ||
		(rect.scale !== undefined && rect.scale !== 1)
	)
		throw new Error("cropPng: clip coordinates must be integers, dimensions positive, and scale 1");
	if (rect.width > expectedViewport.width - rect.x || rect.height > expectedViewport.height - rect.y)
		throw new Error("cropPng: clip is outside the expected viewport");
	const { before, after } = cropMetadata(buffer, expectedViewport);
	const full = decodePng(buffer);
	const data = Buffer.alloc(rect.width * rect.height * 4);
	for (let y = 0; y < rect.height; y++) {
		const from = ((rect.y + y) * full.width + rect.x) * 4;
		full.data.copy(data, y * rect.width * 4, from, from + rect.width * 4);
	}
	const encoded = encodePng({ width: rect.width, height: rect.height, data });
	// The existing encoder writes signature, 13-byte IHDR, one IDAT, and empty IEND.
	return Buffer.concat([
		encoded.subarray(0, 33),
		...before,
		encoded.subarray(33, -12),
		...after,
		encoded.subarray(-12),
	]);
}

/**
 * Counts the pixels that differ between two images and the largest difference of a colour channel. Where the sizes
 * differ, the area only one image covers counts as different, by 255. The diff image shows the expected image faded,
 * with the differing pixels in red.
 */
export function comparePngs(expected, actual) {
	const width = Math.max(expected.width, actual.width);
	const height = Math.max(expected.height, actual.height);
	const sameSize = expected.width === actual.width && expected.height === actual.height;
	if (sameSize && expected.data.equals(actual.data))
		return { differing: 0, maxDelta: 0, total: width * height, sameSize, diff: null };
	const diff = Buffer.alloc(width * height * 4);
	let differing = 0;
	let maxDelta = sameSize ? 0 : 255;
	const inside = (image, x, y) => x < image.width && y < image.height;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			const a = (y * expected.width + x) * 4;
			const b = (y * actual.width + x) * 4;
			const same =
				inside(expected, x, y) &&
				inside(actual, x, y) &&
				expected.data.readUInt32BE(a) === actual.data.readUInt32BE(b);
			if (!same) {
				differing++;
				if (inside(expected, x, y) && inside(actual, x, y)) {
					for (let c = 0; c < 4; c++)
						maxDelta = Math.max(maxDelta, Math.abs(expected.data[a + c] - actual.data[b + c]));
				}
				diff[at] = 255;
				diff[at + 3] = 255;
				continue;
			}
			const gray = Math.round(
				(expected.data[a] * 0.3 + expected.data[a + 1] * 0.59 + expected.data[a + 2] * 0.11) / 4 + 191,
			);
			diff[at] = diff[at + 1] = diff[at + 2] = gray;
			diff[at + 3] = 255;
		}
	}
	return { differing, maxDelta, total: width * height, sameSize, diff: { width, height, data: diff } };
}

/**
 * Chrome draws some pixels of the status icons slightly differently from run to run: in 84 states up to 132 pixels,
 * by up to 13 levels. A screenshot counts as the same when no more than NOISE_PIXELS differ, by no more than
 * NOISE_DELTA. Real changes are far larger: a highlighted row is about 22,000 pixels, a changed digit differs by over 100.
 */
export const NOISE_PIXELS = 500;
export const NOISE_DELTA = 24;
/**
 * Colour drift: the same pixels in slightly other colours, as when the colour management between the page and the
 * screenshot differs a little from the baselines'. Seen on 2026-10-22 in all 84 states: up to 35,000 pixels, in the
 * accent colour only, by up to 15 levels, both on the display the baselines record and on another one, with the
 * visible/*.txt records unchanged. A screenshot whose every pixel differs by no more than DRIFT_DELTA counts as the same,
 * however many differ: a moved, added or changed element differs by far more where it changed. What is displayed is
 * checked exactly by visible/*.txt; a colour change this small is the one change neither sees.
 */
export const DRIFT_DELTA = 16;

/**
 * What a comparison of a screenshot with its baseline means: "same" when no pixel differs, "noise" or "drift" when the
 * difference is rendering noise or colour drift and the screenshot counts as the same, "changed" otherwise.
 */
export function screenshotVerdict({ differing, maxDelta, sameSize }) {
	if (differing === 0) return "same";
	if (differing <= NOISE_PIXELS && maxDelta <= NOISE_DELTA) return "noise";
	if (sameSize && maxDelta <= DRIFT_DELTA) return "drift";
	return "changed";
}
