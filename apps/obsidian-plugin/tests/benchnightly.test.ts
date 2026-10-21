import { test } from "node:test";
import assert from "node:assert/strict";

import { compareAb, type AbReport, type Slot } from "../scripts/bench-ab.mjs";
import {
	hidIdleSeconds,
	idleProblems,
	lowPowerMode,
	otherBenchProcesses,
	powerSource,
} from "../scripts/bench-host.mjs";
import {
	benchablePrs,
	benchComment,
	commentPlan,
	nightlyArgs,
	upToDate,
	type PrComment,
	type PullRequest,
} from "../scripts/bench-pr.mjs";

// scripts/bench-nightly.mjs runs `bench.mjs --ab` for open PRs at night. What it decides, which PRs to measure, whether
// the Mac is idle, and what it posts, is plain code in scripts/bench-pr.mjs and scripts/bench-host.mjs, tested here.

test("the nightly run measures both scales of PRs labelled bench, against master's benchmark, by default", () => {
	assert.deepEqual(nightlyArgs([]), {
		label: "bench",
		scales: [1, 10],
		dryRun: false,
		force: false,
		maxWaitMinutes: 180,
		load: 2.5,
		idleMinutes: 15,
		harness: "origin/master",
	});
	assert.deepEqual(
		nightlyArgs([
			"--label=perf",
			"--scales",
			"10",
			"--dry-run",
			"--force",
			"--max-wait",
			"0",
			"--load=4",
			"--idle",
			"5",
			"--harness",
			"HEAD",
		]),
		{
			label: "perf",
			scales: [10],
			dryRun: true,
			force: true,
			maxWaitMinutes: 0,
			load: 4,
			idleMinutes: 5,
			harness: "HEAD",
		},
	);
});

test("wrong nightly arguments are errors that say what is wanted", () => {
	assert.throws(() => nightlyArgs(["--scales", "1,2"]), /--scales takes 1, 10 or both, got "1,2"/);
	assert.throws(() => nightlyArgs(["--load", "-1"]), /--load needs a number above 0/);
	assert.throws(() => nightlyArgs(["--idle", "x"]), /--idle needs a number of minutes/);
	assert.throws(() => nightlyArgs(["--label"]), /--label needs a value/);
	assert.throws(() => nightlyArgs(["--dry-run=yes"]), /unknown argument "--dry-run=yes"/);
	assert.throws(() => nightlyArgs(["--bogus"]), /unknown argument "--bogus"/);
});

const pr = (number: number, changes: Partial<PullRequest> = {}): PullRequest => ({
	number,
	title: `PR ${number}`,
	url: `https://github.com/Leonezz/obsidian-tasks-calendar-wrapper/pull/${number}`,
	headRefName: `branch-${number}`,
	headRefOid: `${number}`.padEnd(40, "a"),
	baseRefName: "master",
	isCrossRepository: false,
	headRepositoryOwner: { login: "Leonezz" },
	labels: [{ name: "bench" }],
	...changes,
});

test("only labelled PRs from branches of the repository itself are measured, never a fork's", () => {
	const fork = pr(3, { isCrossRepository: true, headRepositoryOwner: { login: "someone" } });
	// GitHub calls a PR from another owner's copy cross-repository; both are checked.
	const otherOwner = pr(4, { headRepositoryOwner: { login: "someone" } });
	const unlabelled = pr(5, { labels: [{ name: "enhancement" }] });
	const { measure, refused } = benchablePrs([pr(9), fork, otherOwner, unlabelled, pr(2)], {
		label: "bench",
		owner: "Leonezz",
	});
	assert.deepEqual(
		measure.map((candidate) => candidate.number),
		[2, 9],
	);
	assert.deepEqual(
		refused.map((candidate) => candidate.number),
		[3, 4],
	);
});

const comment = (login: string, body: string, id: number, createdAt: string): PrComment => ({
	author: { login },
	body,
	url: `https://github.com/Leonezz/obsidian-tasks-calendar-wrapper/pull/9#issuecomment-${id}`,
	createdAt,
});
const benchBody = (head: string, base: string, scales: string) =>
	`<!-- tcw-bench-ab head=${head} base=${base} scales=${scales} -->\n### Benchmark`;

test("the benchmark's comment is created once and then updated by its id, whoever commented since", () => {
	assert.deepEqual(commentPlan([], "Leonezz"), { action: "create" });
	const mine = comment("Leonezz", benchBody("h", "b", "1"), 101, "2026-10-21T03:00:00Z");
	assert.deepEqual(commentPlan([mine], "Leonezz"), { action: "update", id: "101" });
	// The maintainer's own comment after it is never edited.
	const later = comment("Leonezz", "Looks good.", 102, "2026-10-21T09:00:00Z");
	assert.deepEqual(commentPlan([later, mine], "Leonezz"), { action: "update", id: "101" });
	// A comment by someone else that quotes the marker is not the benchmark's.
	const quoted = comment("someone", benchBody("h", "b", "1"), 103, "2026-10-21T10:00:00Z");
	assert.deepEqual(commentPlan([quoted], "Leonezz"), { action: "create" });
	assert.throws(
		() => commentPlan([{ ...mine, url: "https://github.com/x" }], "Leonezz"),
		/no comment id in https:\/\/github.com\/x/,
	);
});

test("a PR is measured again only when its head, its base or the scales changed", () => {
	const comments = [comment("Leonezz", benchBody("h1", "b1", "1,10"), 101, "2026-10-21T03:00:00Z")];
	const wanted = { head: "h1", base: "b1", scales: [1, 10] };
	assert.equal(upToDate(comments, "Leonezz", wanted), true);
	assert.equal(upToDate(comments, "Leonezz", { ...wanted, scales: [1] }), true);
	assert.equal(upToDate(comments, "Leonezz", { ...wanted, head: "h2" }), false);
	assert.equal(upToDate(comments, "Leonezz", { ...wanted, base: "b2" }), false);
	const oneScale = [comment("Leonezz", benchBody("h1", "b1", "1"), 101, "2026-10-21T03:00:00Z")];
	assert.equal(upToDate(oneScale, "Leonezz", wanted), false);
	assert.equal(upToDate([], "Leonezz", wanted), false);
	assert.equal(upToDate(comments, "someone", wanted), false);
});

const timing = (minMs: number) => ({ minMs, medianMs: minMs, maxMs: minMs, samplesMs: [minMs] });

/** Eight rounds in which the candidate's saves take `factor` times as long as the base's, and its loads as long. */
function slots(factor: number): Slot[] {
	return [200, 210, 190, 205, 195, 202, 198, 201].flatMap((ms, i) => {
		const results = (saveMs: number) => ({
			initialLoad: {
				rows: 3486,
				renderedMs: timing(ms * 10),
				filesRead: { min: 4000, median: 4000, max: 4000, samples: [4000] },
			},
			saveWithTasks: { renderedMs: timing(saveMs) },
			saveWithoutTasks: { runs: 3, reloads: 0 },
		});
		return [
			{ round: i + 1, arm: "base" as const, results: results(ms) },
			{ round: i + 1, arm: "candidate" as const, results: results(ms * factor) },
		];
	});
}

function report(scale: number, factor: number, identicalBuilds = factor === 1): AbReport {
	const measured = slots(factor);
	return {
		measuredAt: "2026-10-22",
		scale,
		vault: scale === 1 ? "bench-vault" : "bench-vault-x10",
		rounds: 8,
		seed: 1234,
		order: [],
		base: { ref: "b1", commit: "b1", mainJsSha256: "x" },
		candidate: { ref: "h1", commit: "h1", mainJsSha256: identicalBuilds ? "x" : "y" },
		identicalBuilds,
		env: { obsidianVersion: "1.14.4 (installer 1.13.7)", machine: { cpu: "Apple M4 Pro" } },
		loadAverage: { before: 1.2, after: 1.6, cores: 14 },
		slots: measured,
		verdict: compareAb(measured, scale),
	};
}

test("the comment says first what got slower at each scale, and that a failed run failed", () => {
	const body = benchComment({
		head: "h1".padEnd(40, "0"),
		base: "b1".padEnd(40, "0"),
		baseRefName: "master",
		runs: [
			{ scale: 1, report: report(1, 1) },
			{ scale: 10, error: 'the Obsidian CLI did not answer "vault" within 20 s.\nmore detail' },
		],
	});
	const lines = body.split("\n");
	assert.equal(lines[0], `<!-- tcw-bench-ab head=${"h1".padEnd(40, "0")} base=${"b1".padEnd(40, "0")} scales=1 -->`);
	assert.ok(body.includes("**4,000 tasks:** nothing got slower"), body);
	assert.ok(
		body.includes('**40,000 tasks:** the run failed: the Obsidian CLI did not answer "vault" within 20 s.'),
		body,
	);
	assert.ok(!body.includes("more detail"), body);
	assert.ok(body.includes("The two builds are identical"), body);
});

test("the comment names the measurements that got slower, in a table that keeps its columns", () => {
	const body = benchComment({
		head: "h1",
		base: "b1",
		baseRefName: "master",
		runs: [
			{ scale: 1, report: report(1, 1.5) },
			// The same two builds, which differ, at the other scale.
			{ scale: 10, report: report(10, 1, false) },
		],
	});
	assert.ok(body.startsWith("<!-- tcw-bench-ab head=h1 base=b1 scales=1,10 -->\n"), body);
	assert.ok(body.includes("**4,000 tasks:** 1 measurement got slower: saveWithTasks.renderedMs"), body);
	assert.ok(body.includes("**40,000 tasks:** nothing got slower"), body);
	assert.ok(!body.includes("The two builds are identical"), body);
	const tables = body.split("\n\n").filter((block) => block.startsWith("|"));
	assert.ok(tables.length >= 2, body);
	for (const table of tables) {
		const pipes = table.split("\n").map((line) => line.split("|").length);
		assert.equal(new Set(pipes).size, 1, table);
	}
	const slower = body.split("\n").find((line) => line.startsWith("| saveWithTasks.renderedMs"));
	assert.ok(slower?.includes("**slower**"), slower);
});

test("another benchmark driving Obsidian is found, but not this one or what started it", () => {
	const ps = [
		"    1     0 /sbin/launchd",
		"  100     1 /bin/zsh",
		"  200   100 sh -c pnpm build && node scripts/bench.mjs --ab master",
		"  201   200 node scripts/bench.mjs --ab master",
		"  300     1 node /Users/x/repo/apps/obsidian-plugin/scripts/bench.mjs --scale 10",
		"  301     1 /usr/local/bin/node scripts/screenshots.mjs",
		"  400     1 rg scripts/bench.mjs",
		"  500     1 node scripts/bench-vault.mjs /tmp/bench-vault",
		"  600     1 node scripts/bench-nightly.mjs",
	].join("\n");
	assert.deepEqual(otherBenchProcesses(ps, 201), [
		{ pid: 300, command: "node /Users/x/repo/apps/obsidian-plugin/scripts/bench.mjs --scale 10" },
		{ pid: 301, command: "/usr/local/bin/node scripts/screenshots.mjs" },
	]);
	assert.deepEqual(
		otherBenchProcesses(ps, 300).map((process) => process.pid),
		[200, 201, 301],
	);
});

test("the idle time, the power source and Low Power Mode are read from ioreg and pmset", () => {
	assert.equal(hidIdleSeconds('    | |   "HIDIdleTime" = 46000820041\n'), 46.000820041);
	assert.throws(() => hidIdleSeconds("nothing"), /HIDIdleTime/);
	assert.equal(powerSource("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged;"), "AC Power");
	assert.equal(powerSource("Now drawing from 'Battery Power'\n"), "Battery Power");
	assert.throws(() => powerSource("nothing"), /power source/);
	assert.equal(lowPowerMode(" sleep                0\n lowpowermode         1\n"), true);
	assert.equal(lowPowerMode(" lowpowermode         0\n"), false);
	assert.equal(lowPowerMode(" sleep                0\n"), false);
});

test("the Mac is idle when it is plugged in, quiet, untouched and running no other benchmark", () => {
	const limits = { load: 2.5, idleMinutes: 15 };
	const idle = { loadAverage: 1.2, idleSeconds: 3600, power: "AC Power", lowPower: false, others: [] };
	assert.deepEqual(idleProblems(idle, limits), []);
	assert.deepEqual(
		idleProblems(
			{
				loadAverage: 3.44,
				idleSeconds: 30,
				power: "Battery Power",
				lowPower: true,
				others: [{ pid: 300, command: "node scripts/bench.mjs" }],
			},
			limits,
		),
		[
			"it runs on Battery Power, not AC Power",
			"Low Power Mode is on",
			"the 1-minute load average is 3.4, above 2.5",
			"it was used 30 s ago, less than 15 minutes ago",
			"another benchmark is running: 300 node scripts/bench.mjs",
		],
	);
});
