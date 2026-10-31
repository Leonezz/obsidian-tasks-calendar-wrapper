import { test } from "node:test";
import assert from "node:assert/strict";

import { abArgs, abOrder, compareAb, type Slot } from "../scripts/bench-ab.mjs";
import { counts } from "../scripts/bench-results.mjs";

// `pnpm bench --ab <ref>` measures the base and the candidate in turn and judges the candidate against the base, round
// by round. The order, the pairing and the verdict are plain code in scripts/bench-ab.mjs, tested here.

test("without --ab the arguments are left as they are", () => {
	assert.deepEqual(abArgs([], 1), { ab: null, rest: [] });
	assert.deepEqual(abArgs(["--update"], 1), { ab: null, rest: ["--update"] });
});

test("--ab takes the base, and the rounds default to the scale's", () => {
	assert.deepEqual(abArgs(["--ab", "master"], 1), {
		ab: { base: "master", candidate: null, rounds: 8, seed: null, report: null },
		rest: [],
	});
	assert.equal(abArgs(["--ab=master"], 10).ab?.rounds, 6);
	assert.deepEqual(
		abArgs(
			["--ab=master", "--candidate=abc123", "--rounds", "10", "--seed", "42", "--report", "out.json", "--update"],
			1,
		),
		{
			ab: { base: "master", candidate: "abc123", rounds: 10, seed: 42, report: "out.json" },
			rest: ["--update"],
		},
	);
});

test("wrong A/B arguments are errors that say what is wanted", () => {
	assert.throws(() => abArgs(["--ab"], 1), /--ab needs a git ref/);
	assert.throws(() => abArgs(["--ab", "--rounds", "8"], 1), /--ab needs a git ref/);
	assert.throws(() => abArgs(["--rounds", "8"], 1), /only go with --ab/);
	assert.throws(() => abArgs(["--ab", "x", "--rounds", "7"], 1), /an even whole number of at least 6/);
	assert.throws(() => abArgs(["--ab", "x", "--rounds", "4"], 1), /an even whole number of at least 6/);
	assert.throws(() => abArgs(["--ab", "x", "--seed", "-1"], 1), /--seed must be a whole number/);
	assert.throws(() => abArgs(["--ab", "x", "--seed", "abc"], 1), /--seed must be a whole number/);
	assert.throws(() => abArgs(["--ab", "x", "--report"], 1), /--report needs a file/);
});

test("half the rounds start with the base and half with the candidate, in an order the seed decides", () => {
	const order = abOrder(8, 7);
	assert.equal(order.length, 8);
	for (const round of order) assert.deepEqual([...round].sort(), ["base", "candidate"]);
	assert.equal(order.filter((round) => round[0] === "base").length, 4);
	assert.deepEqual(abOrder(8, 7), order);
	const orders = new Set(
		Array.from({ length: 50 }, (_, seed) =>
			abOrder(8, seed)
				.map((round) => round[0])
				.join(),
		),
	);
	assert.ok(orders.size > 10, `only ${orders.size} different orders from 50 seeds`);
	assert.throws(() => abOrder(7, 1), /an even whole number of at least 6/);
	assert.throws(() => abOrder(4, 1), /an even whole number of at least 6/);
});

const timing = (minMs: number, medianMs = minMs) => ({
	minMs,
	medianMs,
	maxMs: medianMs,
	samplesMs: [minMs, medianMs],
});

type Results = Record<string, Record<string, unknown>>;

function resultsWith(results: Results): Results {
	return {
		...results,
		initialLoad: { rows: 100, ...results.initialLoad },
		saveWithoutTasks: { runs: 3, reloads: 0, ...results.saveWithoutTasks },
	};
}

/** Rounds in which the base and the candidate measured these results, the base first. */
function slotsOf(base: Results[], candidate: Results[]): Slot[] {
	return base.flatMap((results, i) => [
		{ round: i + 1, arm: "base" as const, results: resultsWith(results) },
		{ round: i + 1, arm: "candidate" as const, results: resultsWith(candidate[i]) },
	]);
}

/** Rounds of one timing, `scenario.metric`, from its fastest run in each arm. */
function timingSlots(base: number[], candidate: number[], name = "saveWithTasks.renderedMs"): Slot[] {
	const [scenario, metric] = name.split(".");
	const of = (ms: number) => ({ [scenario]: { [metric]: timing(ms) } });
	return slotsOf(base.map(of), candidate.map(of));
}

const BASE = [200, 210, 190, 205, 195, 202, 198, 201];
const scaled = (factors: number[]) => BASE.map((ms, i) => ms * factors[i]);
const rowOf = (verdict: ReturnType<typeof compareAb>, name = "saveWithTasks.renderedMs") => {
	const row = verdict.rows.find((candidate) => candidate.name === name);
	assert.ok(row, `no row ${name}`);
	return row;
};

test("two builds that differ only by noise are not slower", () => {
	const verdict = compareAb(timingSlots(BASE, scaled([1.01, 0.99, 1.02, 0.98, 1, 1.01, 0.99, 1.005])), 1);
	assert.equal(verdict.slower, 0);
	const row = rowOf(verdict);
	assert.equal(row.verdict, "none");
	assert.ok(row.p > 0.05, `p = ${row.p}`);
	assert.ok(Math.abs(row.ratio - 1) < 0.02, `ratio ${row.ratio}`);
	assert.ok(row.low < 1 && row.high > 1, `${row.low} to ${row.high}`);
});

test("a candidate slower in every round by more than 25 % and 50 ms is slower", () => {
	const verdict = compareAb(timingSlots(BASE, scaled(Array(8).fill(1.5))), 1);
	assert.equal(verdict.slower, 1);
	const row = rowOf(verdict);
	assert.equal(row.verdict, "slower");
	assert.equal(row.p, 2 / 256);
	assert.equal(row.slowerRounds, 8);
	assert.equal(row.rounds, 8);
	assert.ok(Math.abs(row.ratio - 1.5) < 0.01, `ratio ${row.ratio}`);
	assert.ok(Math.abs(row.deltaMs - 100) < 3, `delta ${row.deltaMs}`);
	assert.equal(row.base, 200.5);
	assert.ok(verdict.lines.some((line) => line.includes("saveWithTasks.renderedMs") && line.endsWith("  SLOWER")));
});

test("a change that is significant but under 25 % or under 50 ms does not fail", () => {
	// 10 % is 100 ms at 1 s.
	const tenPercent = compareAb(
		timingSlots(
			BASE.map((ms) => ms * 5),
			BASE.map((ms) => ms * 5 * 1.1),
		),
		1,
	);
	assert.equal(tenPercent.slower, 0);
	assert.equal(rowOf(tenPercent).verdict, "small");
	// 60 % is 24 ms at 40 ms.
	const short = compareAb(
		timingSlots(
			BASE.map((ms) => ms / 5),
			BASE.map((ms) => (ms / 5) * 1.6),
		),
		1,
	);
	assert.equal(short.slower, 0);
	assert.equal(rowOf(short).verdict, "small");
});

test("a large change that the rounds do not agree on is shown and not counted", () => {
	// 50 % slower in five rounds of six and 10 % faster in one: p = 0.0625.
	const verdict = compareAb(timingSlots(BASE.slice(0, 6), scaled([1.5, 1.5, 1.5, 1.5, 1.5, 0.9]).slice(0, 6)), 1);
	const row = rowOf(verdict);
	assert.equal(verdict.slower, 0);
	assert.equal(row.verdict, "none");
	assert.equal(row.p, 4 / 64);
	assert.ok(row.ratio > 1.4, `ratio ${row.ratio}`);
	assert.equal(row.slowerRounds, 5);
});

test("a candidate faster in every round by more than 25 % and 50 ms is faster, and passes", () => {
	const verdict = compareAb(timingSlots(BASE, scaled(Array(8).fill(0.6))), 1);
	assert.equal(verdict.slower, 0);
	assert.equal(rowOf(verdict).verdict, "faster");
});

test("each round compares the fastest run of each arm, not the median", () => {
	const of = (minMs: number, medianMs: number) => ({ saveWithTasks: { renderedMs: timing(minMs, medianMs) } });
	const verdict = compareAb(
		slotsOf(
			BASE.map((ms) => of(ms, ms * 2)),
			BASE.map((ms) => of(ms, ms * 4)),
		),
		1,
	);
	const row = rowOf(verdict);
	assert.equal(row.verdict, "none");
	assert.equal(row.ratio, 1);
	assert.equal(row.p, 1);
});

test("what is not judged at a scale is shown and never slower", () => {
	const doubled = scaled(Array(8).fill(2));
	const indexed = compareAb(timingSlots(BASE, doubled, "saveWithTasks.indexedMs"), 1);
	assert.equal(indexed.slower, 0);
	assert.equal(rowOf(indexed, "saveWithTasks.indexedMs").verdict, "not judged");
	const later = (scale: number) => compareAb(timingSlots(BASE, doubled, "initialLoad.laterBlockedMs"), scale);
	assert.equal(later(10).slower, 0);
	assert.equal(rowOf(later(10), "initialLoad.laterBlockedMs").verdict, "not judged");
	assert.equal(later(1).slower, 1);
});

test("counts are shown for both arms, and a count that changed is a warning, not a failure", () => {
	const of = (filesRead: number) => ({ saveWithTasks: { filesRead: counts([filesRead, filesRead]) } });
	const verdict = compareAb(slotsOf(Array(6).fill(of(2000)), Array(6).fill(of(1))), 1);
	assert.equal(verdict.slower, 0);
	const row = verdict.counts.find((candidate) => candidate.name === "saveWithTasks.filesRead");
	assert.deepEqual(row, {
		name: "saveWithTasks.filesRead",
		base: { min: 2000, median: 2000, max: 2000 },
		candidate: { min: 1, median: 1, max: 1 },
		changed: true,
	});
	assert.deepEqual(verdict.warnings, [
		"bench: warning: saveWithTasks.filesRead changed: median 2000 with the base, 1 with the candidate.",
	]);
});

test("a scenario only the candidate has is listed, not judged, with the base shown as -", () => {
	const verdict = compareAb(
		slotsOf(
			BASE.map(() => ({ toggle: { skipped: "the loaded plugin has no writer" } })),
			BASE.map((ms) => ({ toggle: { overlayMs: timing(ms), reloadCalls: counts([1, 2, 1]) } })),
		),
		1,
	);
	assert.equal(verdict.slower, 0);
	assert.deepEqual(verdict.warnings, []);
	assert.deepEqual(verdict.unpaired, [
		{
			name: "toggle.overlayMs",
			kind: "timing",
			base: null,
			candidate: 200.5,
			judged: false,
			verdict: "not judged",
		},
		{ name: "toggle.reloadCalls", kind: "count", base: null, candidate: 1, judged: false, verdict: "not judged" },
	]);
	assert.deepEqual(
		verdict.lines.slice(1).map((line) => line.trim().split(/\s+/)),
		[
			["bench:", "toggle.overlayMs", "-", "200.5", "-", "-", "-", "-", "not", "judged"],
			["bench:", "toggle.reloadCalls", "(count)", "-", "1", "-", "-", "-", "-", "not", "judged"],
		],
	);
	assert.equal(new Set(verdict.lines.map((line) => line.replace(/ {2}not judged$/, "").length)).size, 1);
});

test("candidate-only metrics leave shared rows and output unchanged", () => {
	const base = BASE.map((ms) => ({ saveWithTasks: { renderedMs: timing(ms), filesRead: counts([1]) } }));
	const shared = compareAb(slotsOf(base, base), 1);
	const extra = compareAb(
		slotsOf(
			base,
			base.map((result, i) => ({
				saveWithTasks: {
					...result.saveWithTasks,
					...(i > 0 ? { newMs: timing(12), newCount: counts([2]) } : {}),
				},
			})),
		),
		1,
	);
	assert.deepEqual(extra.rows, shared.rows);
	assert.deepEqual(extra.counts, shared.counts);
	assert.deepEqual(extra.warnings, shared.warnings);
	assert.equal(extra.slower, shared.slower);
	assert.deepEqual(extra.lines.slice(0, shared.lines.length), shared.lines);
	assert.deepEqual(
		extra.unpaired.map((row) => row.name),
		["saveWithTasks.newMs", "saveWithTasks.newCount"],
	);
});

test("another number of task rows than the base's is a warning", () => {
	const verdict = compareAb(slotsOf(Array(6).fill({}), Array(6).fill({ initialLoad: { rows: 99 } })), 1);
	assert.equal(verdict.slower, 0);
	assert.deepEqual(verdict.warnings, [
		"bench: warning: the timeline shows 99 task rows with the candidate, 100 with the base; it renders something else now.",
	]);
});

test("a candidate whose save without tasks reloads the timeline is slower", () => {
	const reloading = (reloads: number) => ({ saveWithoutTasks: { runs: 3, reloads } });
	const verdict = compareAb(
		slotsOf(Array(6).fill(reloading(0)), [reloading(1), ...Array(4).fill(reloading(0)), reloading(2)]),
		1,
	);
	assert.equal(verdict.slower, 1);
	assert.deepEqual(verdict.reloads, { base: 0, candidate: 3, runs: 18 });
	assert.ok(
		verdict.lines.some((line) =>
			line.endsWith(
				"saving a note without tasks reloaded the timeline 3 of 18 times with the candidate, 0 with the base.  SLOWER",
			),
		),
	);
});

test("every round needs both arms", () => {
	const slots = timingSlots(BASE.slice(0, 6), BASE.slice(0, 6));
	assert.throws(() => compareAb(slots.slice(0, -1), 1), /round 6 has no candidate/);
	assert.throws(() => compareAb([...slots, slots[0]], 1), /round 1 has two base slots/);
});

test("the table's columns line up", () => {
	const verdict = compareAb(
		slotsOf(
			BASE.map((ms) => ({
				initialLoad: { renderedMs: timing(ms * 10), filesRead: counts([4000]) },
				saveWithTasks: { renderedMs: timing(ms), blockedMs: timing(ms / 2) },
			})),
			BASE.map((ms) => ({
				initialLoad: { renderedMs: timing(ms * 10), filesRead: counts([4000]) },
				saveWithTasks: { renderedMs: timing(ms * 1.5), blockedMs: timing(ms / 2) },
			})),
		),
		1,
	);
	const table = verdict.lines
		.filter((line) => !line.includes("reloaded the timeline"))
		.map((line) => line.replace(/ {2}(SLOWER|faster|small change|not judged|changed)$/, ""));
	assert.equal(table.length, 5);
	assert.equal(new Set(table.map((line) => line.length)).size, 1, table.join("\n"));
});
