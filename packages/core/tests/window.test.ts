import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { focusToday, query, type QueryResult, type ViewState } from "../src/arrange";
import { parseTaskLine } from "../src/parse";
import {
	createWindowGeometry,
	flattenWindowSegments,
	windowingEnabled,
	windowRowKey,
	WINDOW_MIN_ROWS,
	WINDOW_RELEASE_ROWS,
	type WindowSegment,
} from "../src/window";

type Line = readonly [path: string, text: string];
type RowSegment = Extract<WindowSegment, { readonly kind: "row" }>;

function arranged(lines: readonly Line[], extra: Partial<ViewState["settings"]> = {}): QueryResult {
	const tasks = lines.map(([path, line]) => {
		const task = parseTaskLine(line, { moment, path });
		assert.ok(task, line);
		return task;
	});
	return query(
		tasks,
		{ settings: { forward: false, dateFormat: "YYYY-MM-DD", hideStatusTasks: [], ...extra }, counter: "" },
		{ now: moment("2026-01-15 12:00", "YYYY-MM-DD HH:mm", true), moment },
	);
}

const todayLines = (count: number): Line[] =>
	Array.from({ length: count }, (_, i) => [`Task ${i}.md`, `- [ ] task ${i} 📅 2026-01-15`] as const);
const segmentsWithRows = (count: number) => flattenWindowSegments(arranged(todayLines(count)));
const rowsOf = (segments: readonly WindowSegment[]): RowSegment[] =>
	segments.filter((segment): segment is RowSegment => segment.kind === "row");

/** Fixed-seed property cases, kept repeatable when a failure is reported. */
function random(seed: number) {
	return (max: number) => {
		seed = (Math.imul(1_664_525, seed) + 1_013_904_223) >>> 0;
		return Math.floor((seed / 0x1_0000_0000) * max);
	};
}

test("flattened segments keep the arranged year/day order and distinguish a task's date-column instances", () => {
	const result = arranged([
		["Old.md", "- [ ] old 📅 2025-12-31"],
		["A path/with spaces:#.md", "- [ ] twice 🛫 2026-01-14 📅 2026-01-15"],
		["Future.md", "- [ ] future 📅 2027-01-01"],
	]);
	const before = JSON.stringify(result);
	const segments = flattenWindowSegments(result);
	assert.ok(Object.isFrozen(segments));
	assert.ok(segments.every(Object.isFrozen));
	assert.equal(new Set(segments.map((segment) => segment.key)).size, segments.length);
	assert.deepEqual(
		segments.filter((segment) => segment.kind === "year").map((segment) => segment.year.year),
		[2025, 2026, 2027],
	);
	const repeated = rowsOf(segments).filter((segment) => segment.taskId === "A path/with spaces:#.md:0");
	assert.equal(repeated.length, 2);
	assert.notEqual(repeated[0].key, repeated[1].key);
	for (const segment of repeated) {
		const instanceId = `${encodeURIComponent(segment.dayKey)}-${encodeURIComponent(segment.taskId)}`;
		assert.equal(segment.instanceId, instanceId);
		assert.equal(segment.key, `t:${instanceId}`);
		assert.equal(windowRowKey(segment.dayKey, segment.taskId), segment.key);
		assert.strictEqual(segment.task, segment.day.tasks[segment.rowIndex]);
		assert.strictEqual(segment.day, result.years[segment.yearIndex].days[segment.dayIndex]);
	}
	const entry = segments.findIndex((segment) => segment.kind === "entry");
	assert.equal(segments[entry].key, "entry");
	assert.equal(segments[entry + 1].key, "d:2026-01-15");
	assert.equal(JSON.stringify(result), before, "flattening changes none of the query data");
	assert.equal(result.tasks.length, 3);
	assert.equal(rowsOf(segments).length, 4, "the threshold counts row instances, not unique tasks");
	assert.equal(windowingEnabled(rowsOf(segments).length, false, 3), true);
});

test("flattening follows reverse display order and keeps an entry with no task rows", () => {
	const lines: Line[] = [
		["Old.md", "- [ ] old 📅 2025-12-31"],
		["Today.md", "- [ ] today 📅 2026-01-15"],
		["Future.md", "- [ ] future 📅 2027-01-01"],
	];
	const reverse = flattenWindowSegments(arranged(lines, { newestFirst: true, entryPosition: "bottom" }));
	assert.deepEqual(
		reverse.filter((segment) => segment.kind === "year").map((segment) => segment.year.year),
		[2027, 2026, 2025],
	);
	const focused = flattenWindowSegments(focusToday(arranged(lines, { entryPosition: "top" })));
	assert.deepEqual(
		focused.map((segment) => segment.kind),
		["entry", "day", "row"],
	);
	assert.equal(focused[0].key, "entry");
	assert.equal(rowsOf(focused)[0].taskId, "Today.md:0");
	assert.equal(focused.filter((segment) => segment.kind === "year").length, 0);
	assert.deepEqual(
		segmentsWithRows(0).map((segment) => segment.key),
		["entry"],
	);
});

test("unmeasured offsets use the per-kind estimates, and an unchanged source preserves the geometry snapshot", () => {
	const segments = segmentsWithRows(3);
	const model = createWindowGeometry(segments);
	const estimates = { year: 22, entry: 180, day: 38, row: 60 };
	let expected = 0;
	segments.forEach((segment, i) => {
		assert.equal(model.offsetAt(i), expected);
		assert.equal(model.heightAt(i), estimates[segment.kind]);
		expected += estimates[segment.kind];
		assert.equal(model.indexOf(segment.key), i);
	});
	assert.equal(model.offsetAt(segments.length), expected);
	assert.equal(model.totalHeight(), expected);
	assert.equal(model.indexOf("not a segment"), -1);
	const snapshot = model.segments;
	model.setSegments(segments);
	assert.strictEqual(model.segments, snapshot);
	model.setSegments(model.segments);
	assert.strictEqual(model.segments, snapshot);
	assert.throws(() => model.offsetAt(-1), RangeError);
	assert.throws(() => model.offsetAt(segments.length + 1), RangeError);
	assert.throws(() => model.heightAt(segments.length), RangeError);
});

test("measurements keep each known height and use a rolling median for its unmeasured kind", () => {
	const segments = segmentsWithRows(36);
	const rows = rowsOf(segments);
	const model = createWindowGeometry(segments);
	assert.equal(model.measure(rows[0].key, 20), true);
	assert.equal(model.heightAt(model.indexOf(rows[35].key)), 20);
	assert.equal(model.measure(rows[1].key, 40), true);
	assert.equal(model.heightAt(model.indexOf(rows[35].key)), 30);
	assert.equal(model.measure(rows[2].key, 80), true);
	assert.equal(model.heightAt(model.indexOf(rows[35].key)), 40);
	assert.equal(model.heightAt(model.indexOf(rows[0].key)), 20);
	assert.equal(model.heightAt(model.indexOf(rows[1].key)), 40);
	assert.equal(model.measure(rows[2].key, 80), false);
	model.invalidateMeasurements();
	model.measureBatch(rows.slice(0, 31).map((row, index) => [row.key, index + 1] as const));
	assert.equal(model.heightAt(model.indexOf(rows[35].key)), 16);
	model.measure(rows[31].key, 1_000);
	assert.equal(model.heightAt(model.indexOf(rows[35].key)), 17, "the oldest sample leaves the 31-key rolling median");
	assert.equal(
		model.measureBatch(Array.from({ length: 20 }, () => [rows[31].key, 1_000] as const)),
		false,
		"repeated observations of one key do not outweigh other measured rows",
	);
	assert.equal(model.heightAt(model.indexOf(rows[35].key)), 17);
	assert.equal(model.heightAt(model.indexOf(rows[0].key)), 1, "an old exact height outlives its rolling sample");
});

test("invalid measurements are ignored, width invalidation resets estimates, and inputs stay unchanged", () => {
	const segments = segmentsWithRows(2);
	const model = createWindowGeometry(segments, { row: 44 });
	const row = rowsOf(segments)[0];
	const input = Object.freeze([Object.freeze([row.key, 71] as const)]);
	assert.equal(model.measureBatch(input), true);
	assert.equal(input[0][1], 71);
	const before = model.totalHeight();
	for (const height of [0, -1, NaN, Infinity, -Infinity]) assert.equal(model.measure(row.key, height), false);
	assert.equal(model.measure("missing", 1_000), false);
	assert.equal(model.totalHeight(), before);
	assert.equal(model.invalidateMeasurements(), true);
	assert.equal(model.heightAt(model.indexOf(row.key)), 44);
	assert.equal(model.invalidateMeasurements(), false);
	assert.throws(() => createWindowGeometry(segments, { row: 0 }), RangeError);
	assert.throws(() => createWindowGeometry(segments, { day: NaN }), RangeError);
	assert.throws(() => model.setSegments([segments[0], segments[0]]), /duplicate window segment key/);
	assert.deepEqual(
		model.segments.map((segment) => segment.key),
		segments.map((segment) => segment.key),
		"a rejected replacement does not partly replace the current layout",
	);
});

test("ranges are half-open, add entry and focused rows once, and keep a resident row's date header", () => {
	const segments = segmentsWithRows(6);
	const rows = rowsOf(segments);
	const model = createWindowGeometry(segments, { year: 10, entry: 10, day: 10, row: 10 });
	const range = model.rangeFor(30, 10, 0);
	assert.deepEqual([range.start, range.end], [3, 4]);
	assert.deepEqual(range.indices, [1, 2, 3]);
	assert.deepEqual(range.gaps, [
		{ start: 0, end: 1, height: 10 },
		{ start: 4, end: 9, height: 50 },
	]);
	const pinned = model.rangeFor(30, 10, 0, [rows[5].key, rows[5].key, "missing"]);
	assert.deepEqual(pinned.indices, [1, 2, 3, 8]);
	assert.deepEqual(pinned.gaps, [
		{ start: 0, end: 1, height: 10 },
		{ start: 4, end: 8, height: 40 },
	]);
	assert.deepEqual(model.rangeFor(40, 20, 10).indices, [1, 2, 3, 4, 5, 6]);
	assert.deepEqual(model.rangeFor(90, 10, 0).indices, [1]);
	assert.deepEqual(model.rangeFor(0, 0, 0, [rows[5].key]).indices, [1, 2, 8]);
	assert.deepEqual(model.rangeFor(NaN, -1, Infinity).indices, [1]);
	assert.deepEqual(model.rangeFor(-20, 10, 0).indices, [0, 1]);
	assert.ok(Object.isFrozen(pinned) && Object.isFrozen(pinned.indices) && Object.isFrozen(pinned.gaps));
});

test("empty geometry is safe, and a zero-row timeline still mounts its entry panel", () => {
	const empty = createWindowGeometry([]);
	assert.equal(empty.totalHeight(), 0);
	assert.equal(empty.offsetAt(0), 0);
	assert.equal(empty.captureAnchor(10), undefined);
	assert.equal(empty.restoreAnchor(undefined), 0);
	assert.deepEqual(empty.rangeFor(0, 100, 100), { start: 0, end: 0, indices: [], gaps: [], totalHeight: 0 });
	const entry = createWindowGeometry(segmentsWithRows(0));
	assert.deepEqual(entry.rangeFor(1_000, 0, 0).indices, [0]);
});

test("windowing uses strict 1000/800 hysteresis and the explicit debug overrides", () => {
	assert.equal(WINDOW_MIN_ROWS, 1_000);
	assert.equal(WINDOW_RELEASE_ROWS, 800);
	assert.equal(windowingEnabled(1_000, false), false);
	assert.equal(windowingEnabled(1_001, false), true);
	assert.equal(windowingEnabled(800, true), true);
	assert.equal(windowingEnabled(799, true), false);
	assert.equal(windowingEnabled(999, true), true);
	assert.equal(windowingEnabled(2_000, false, Infinity), false);
	assert.equal(windowingEnabled(2_000, true, Infinity), false);
	assert.equal(windowingEnabled(1, false, 0), true);
	assert.equal(windowingEnabled(0, true, 0), false);
	assert.equal(windowingEnabled(10, false, 10), false);
	assert.equal(windowingEnabled(11, false, 10), true);
	assert.equal(windowingEnabled(8, true, 10), true);
	assert.equal(windowingEnabled(7, true, 10), false);
	for (const count of [-1, 1.5, NaN, Infinity]) assert.throws(() => windowingEnabled(count, false), RangeError);
	for (const threshold of [-1, NaN, -Infinity])
		assert.throws(() => windowingEnabled(10, false, threshold), RangeError);
});

test("fixed-seed prefix and range properties match an independent fully measured layout", () => {
	const next = random(0x7a3f_1149);
	const segments = flattenWindowSegments(
		arranged(
			todayLines(180).map(([path, line], index) => [
				path,
				line.replace("2026-01-15", `2026-01-${14 + (index % 3)}`),
			]),
		),
	);
	const heights = segments.map(() => (next(240) + 1) / 4);
	const prefix = [0];
	for (const height of heights) prefix.push(prefix[prefix.length - 1] + height);
	const model = createWindowGeometry(segments);
	model.measureBatch(segments.map((segment, index) => [segment.key, heights[index]] as const));
	for (let i = 0; i <= segments.length; i++) assert.equal(model.offsetAt(i), prefix[i], `prefix ${i}`);
	for (let i = 0; i < segments.length; i++) assert.ok(model.offsetAt(i + 1) > model.offsetAt(i));
	const rows = rowsOf(segments);
	for (let run = 0; run < 150; run++) {
		const scrollTop = next(Math.ceil(model.totalHeight() * 1.2));
		const height = next(400) + 1;
		const overscan = next(400);
		const resident = rows[next(rows.length)].key;
		const top = Math.max(0, scrollTop - overscan);
		const bottom = scrollTop + height + overscan;
		const expected = new Set<string>(["entry", resident]);
		for (let i = 0; i < segments.length; i++)
			if (prefix[i + 1] > top && prefix[i] < bottom) expected.add(segments[i].key);
		for (const segment of segments) {
			if (segment.kind !== "row" || !expected.has(segment.key)) continue;
			expected.add(`d:${segment.dayKey}`);
		}
		const expectedIndexes = segments.flatMap((segment, i) => (expected.has(segment.key) ? [i] : []));
		const range = model.rangeFor(scrollTop, height, overscan, [resident, resident, "missing"]);
		assert.deepEqual(range.indices, expectedIndexes, `seeded viewport ${run}`);
		const covered = [...range.indices];
		for (const gap of range.gaps) {
			assert.ok(gap.start < gap.end);
			assert.equal(gap.height, prefix[gap.end] - prefix[gap.start]);
			for (let i = gap.start; i < gap.end; i++) covered.push(i);
		}
		assert.equal(new Set(covered).size, covered.length, "no segment appears as both a row and a gap");
		assert.deepEqual(
			covered.sort((a, b) => a - b),
			segments.map((_, i) => i),
			"mounted segments and omitted gaps partition the whole layout",
		);
	}
});

test("fixed-seed height changes above an anchor keep its key and offset without changing the input", () => {
	const next = random(0x3b17_240e);
	const segments = segmentsWithRows(120);
	const inputKeys = segments.map((segment) => segment.key);
	for (let run = 0; run < 75; run++) {
		const heights = segments.map(() => next(160) / 4 + 1);
		const model = createWindowGeometry(segments);
		model.measureBatch(segments.map((segment, i) => [segment.key, heights[i]] as const));
		const index = next(segments.length - 1) + 1;
		const scrollTop = heights.slice(0, index).reduce((sum, height) => sum + height, 0) + heights[index] / 2;
		const anchor = model.captureAnchor(scrollTop);
		assert.ok(anchor);
		assert.equal(anchor.key, segments[index].key);
		const changes = heights.slice(0, index).map((height) => height + next(40) / 4 + 1);
		const delta = changes.reduce((sum, height, i) => sum + height - heights[i], 0);
		model.measureBatch(changes.map((height, i) => [segments[i].key, height] as const));
		const restored = model.restoreAnchor(anchor);
		assert.equal(restored, scrollTop + delta);
		const after = model.captureAnchor(restored);
		assert.ok(after);
		assert.equal(after.key, anchor.key);
		assert.equal(after.offset, anchor.offset);
	}
	assert.deepEqual(
		segments.map((segment) => segment.key),
		inputKeys,
	);
});

test("a list change preserves measured keys and restores an anchor after rows are inserted above", () => {
	const lines = todayLines(6);
	const segments = flattenWindowSegments(arranged(lines));
	const model = createWindowGeometry(segments);
	model.measureBatch(segments.map((segment) => [segment.key, 20] as const));
	const row = rowsOf(segments)[3];
	const before = model.offsetAt(model.indexOf(row.key)) + 7;
	const anchor = model.captureAnchor(before);
	const changed = flattenWindowSegments(arranged([["Earlier.md", "- [ ] earlier 📅 2026-01-14"], ...lines]));
	model.setSegments(changed);
	assert.equal(model.heightAt(model.indexOf(row.key)), 20);
	assert.equal(model.restoreAnchor(anchor), before + 40, "the new date header and row are above the same anchor");
	assert.equal(model.captureAnchor(model.restoreAnchor(anchor))?.key, row.key);
});

test("a removed anchor uses a surviving old neighbour even across more than one list replacement", () => {
	const lines = todayLines(6);
	const segments = flattenWindowSegments(arranged(lines));
	const model = createWindowGeometry(segments, { year: 10, entry: 10, day: 10, row: 10 });
	const rows = rowsOf(segments);
	const anchor = model.captureAnchor(model.offsetAt(model.indexOf(rows[2].key)) + 3);
	assert.ok(anchor);
	model.setSegments(flattenWindowSegments(arranged(lines.filter(([path]) => path !== "Task 2.md"))));
	model.setSegments(
		flattenWindowSegments(
			arranged([
				["Earlier.md", "- [ ] earlier 📅 2026-01-14"],
				...lines.filter(([path]) => path !== "Task 2.md" && path !== "Task 3.md"),
			]),
		),
	);
	assert.equal(model.restoreAnchor(anchor), model.offsetAt(model.indexOf(rows[4].key)) + 3);
	model.setSegments([]);
	assert.equal(model.restoreAnchor(anchor), 0);
});
