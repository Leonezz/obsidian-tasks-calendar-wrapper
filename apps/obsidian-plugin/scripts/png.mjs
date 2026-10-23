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
