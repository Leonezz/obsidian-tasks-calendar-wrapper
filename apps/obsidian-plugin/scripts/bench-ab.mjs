/**
 * The A/B mode of scripts/bench.mjs, `pnpm bench --ab <ref>`: it measures the base, built from the ref, and the
 * candidate, this checkout's build, in turn in one Obsidian session, and judges the candidate against the base round by
 * round instead of against the stored baseline. A baseline measured days before carries how busy and how warm the
 * machine was then: the same build came out 7 % faster and 40 % slower against it a few hours apart. Measuring both in
 * turn, in an order that changes from round to round, cancels that, as Chromium's Pinpoint does; Abedi and Brecht
 * (ICPE 2017) found back-to-back trials put two identical systems 38 % apart, and randomised interleaved ones did not.
 * Plain code, apart from the measuring, so tests/benchab.test.ts can test it.
 */
import { random } from "./bench-notes.mjs";
import { counts, notJudgedAt, round, SLOWER_MS, SLOWER_RATIO } from "./bench-results.mjs";
import { hodgesLehmann, signedRank } from "./bench-stats.mjs";

/**
 * The rounds at each scale; each round measures both arms. Six is the fewest in which a signed-rank test can find a
 * change at all: with all six rounds agreeing, p = 2/64.
 */
export const AB_ROUNDS = { 1: 8, 10: 6 };
export const MIN_ROUNDS = 6;
/** The runs each arm measures in a round, after its warm-ups; the round's value is the fastest of them. */
export const AB_RUNS = { 1: { loads: 2, saves: 3, optionChanges: 2 }, 10: { loads: 1, saves: 2, optionChanges: 1 } };
/** A change counts when the signed-rank test's p is below this, and it is larger than SLOWER_RATIO and SLOWER_MS. */
export const SIGNIFICANCE = 0.05;

const ARMS = ["base", "candidate"];
const AB_ONLY = ["--candidate", "--rounds", "--seed", "--report", "--any-base"];

const median = (values) => counts(values).median;

/**
 * The value of `--name value` or `--name=value` and the arguments without them: undefined without the option, null when
 * it has no value.
 */
function takeOption(args, name) {
	const at = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
	if (at === -1) return { value: undefined, rest: args };
	const inline = args[at].startsWith(`${name}=`);
	const value = inline ? args[at].slice(name.length + 1) : args[at + 1];
	const missing = value === undefined || value === "" || value.startsWith("--");
	const rest = args.filter((_, i) => i !== at && !(i === at + 1 && !inline && !missing));
	return { value: missing ? null : value, rest };
}

function checkRounds(rounds, given = rounds) {
	if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds % 2 !== 0)
		throw new Error(
			`the rounds must be an even whole number of at least ${MIN_ROUNDS}, so that each arm goes first in half of them; got ${JSON.stringify(given)}.`,
		);
}

/**
 * `--ab <ref>` and the options that go with it, from the arguments without `--scale`: the base to measure against, the
 * candidate (this checkout's build without `--candidate <ref>`), the rounds (the scale's by default), the seed of the
 * order (null for a random one) and the file to write the report to. Returns the other arguments as `rest`.
 */
export function abArgs(args, scale) {
	const values = {};
	let rest = args;
	for (const name of ["--ab", ...AB_ONLY]) {
		if (name === "--any-base") {
			values[name] = rest.includes(name) ? true : undefined;
			rest = rest.filter((arg) => arg !== name);
			continue;
		}
		const taken = takeOption(rest, name);
		values[name] = taken.value;
		rest = taken.rest;
	}
	if (values["--ab"] === undefined) {
		const stray = AB_ONLY.filter((name) => values[name] !== undefined);
		if (stray.length) throw new Error(`${stray.join(", ")} only go with --ab <ref>.`);
		return { ab: null, rest };
	}
	if (values["--ab"] === null) throw new Error("--ab needs a git ref to measure against, such as --ab master.");
	if (values["--candidate"] === null) throw new Error("--candidate needs a git ref to build the candidate from.");
	if (values["--report"] === null) throw new Error("--report needs a file to write the report to.");
	if (values["--rounds"] === null) throw new Error("--rounds needs a number.");
	if (values["--seed"] === null) throw new Error("--seed needs a number.");
	const rounds = values["--rounds"] === undefined ? AB_ROUNDS[scale] : Number(values["--rounds"]);
	checkRounds(rounds, values["--rounds"]);
	const seed = values["--seed"] === undefined ? null : Number(values["--seed"]);
	if (seed !== null && !(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32))
		throw new Error(
			`--seed must be a whole number from 0 to ${2 ** 32 - 1}, got ${JSON.stringify(values["--seed"])}.`,
		);
	return {
		ab: {
			base: values["--ab"],
			candidate: values["--candidate"] ?? null,
			rounds,
			seed,
			report: values["--report"] ?? null,
			allowOtherBase: values["--any-base"] === true,
		},
		rest,
	};
}

/** A different base needs an explicit override so a stale local ref cannot silently change the comparison. */
export function checkAbBase({ ref, baseCommit, mergeBase, allowOtherBase = false }) {
	if (baseCommit === mergeBase) return null;
	const warning = `bench: warning: base ref ${ref} resolves to ${baseCommit.slice(0, 7)}, but the candidate's merge base is ${mergeBase.slice(0, 7)}. Use --any-base to compare against this other base.`;
	if (!allowOtherBase) throw new Error(warning);
	return warning;
}

/**
 * Which arm goes first in each round: the base in half of the rounds and the candidate in the other half, shuffled by
 * the seeded generator, so neither arm is always measured on a warmer or busier machine.
 */
export function abOrder(rounds, seed) {
	checkRounds(rounds);
	const firsts = Array.from({ length: rounds }, (_, i) => (i < rounds / 2 ? "base" : "candidate"));
	const next = random(seed);
	for (let i = rounds - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[firsts[i], firsts[j]] = [firsts[j], firsts[i]];
	}
	return firsts.map((first) => (first === "base" ? ["base", "candidate"] : ["candidate", "base"]));
}

const isTiming = (value) => typeof value === "object" && value !== null && "minMs" in value;
const isCount = (value) => typeof value === "object" && value !== null && "min" in value && "samples" in value;

/** The slots as rounds, { base, candidate } results in the order of their numbers; each round needs both arms once. */
function pairedRounds(slots) {
	const byRound = new Map();
	for (const slot of slots) {
		const pair = byRound.get(slot.round) ?? {};
		if (pair[slot.arm]) throw new Error(`round ${slot.round} has two ${slot.arm} slots`);
		byRound.set(slot.round, { ...pair, [slot.arm]: slot.results });
	}
	if (byRound.size === 0) throw new Error("there are no rounds to compare");
	const numbers = [...byRound.keys()].sort((a, b) => a - b);
	for (const number of numbers) {
		for (const arm of ARMS) if (!byRound.get(number)[arm]) throw new Error(`round ${number} has no ${arm} slot`);
	}
	return numbers.map((number) => byRound.get(number));
}

/**
 * One timing over the rounds, from each arm's fastest run in each: other work on the machine only adds time, so the
 * fastest run is the one least disturbed. The change is judged on log((candidate + 1 ms) / (base + 1 ms)), the 1 ms so
 * that a step without long tasks (0 ms) has a ratio too; over 100 ms it moves the ratio by under 1 %.
 */
function timingRow(name, base, candidate, judged) {
	const logs = base.map((ms, i) => Math.log((candidate[i] + 1) / (ms + 1)));
	const { p } = signedRank(logs);
	const { estimate, low, high, level } = hodgesLehmann(logs);
	const deltaMs = hodgesLehmann(candidate.map((ms, i) => ms - base[i])).estimate;
	const ratio = Math.exp(estimate);
	const beyondFloor = (grew, grewMs) => grew > SLOWER_RATIO && grewMs > SLOWER_MS;
	let verdict = "not judged";
	if (judged) {
		if (p >= SIGNIFICANCE) verdict = "none";
		else if (beyondFloor(ratio, deltaMs)) verdict = "slower";
		else if (beyondFloor(1 / ratio, -deltaMs)) verdict = "faster";
		else verdict = "small";
	}
	return {
		name,
		judged,
		base: round(median(base)),
		candidate: round(median(candidate)),
		ratio,
		low: Math.exp(low),
		high: Math.exp(high),
		level,
		deltaMs: round(deltaMs),
		p,
		rounds: base.length,
		slowerRounds: candidate.filter((ms, i) => ms > base[i]).length,
		verdict,
	};
}

/** One count, such as the notes read, over every run of each arm. */
function countRow(name, base, candidate) {
	const range = (list) => {
		const all = counts(list.flatMap((value) => value.samples));
		return { min: all.min, median: all.median, max: all.max };
	};
	const was = range(base);
	const now = range(candidate);
	return { name, base: was, candidate: now, changed: was.median !== now.median };
}

/** Measurements with no base value in any round are shown without a comparison. */
function unpairedRows(rounds) {
	const rows = [];
	const seen = new Set();
	for (const pair of rounds) {
		for (const [scenario, metrics] of Object.entries(pair.candidate)) {
			for (const [metric, value] of Object.entries(metrics)) {
				if (!isTiming(value) && !isCount(value)) continue;
				const name = `${scenario}.${metric}`;
				if (seen.has(name) || rounds.some((round) => round.base[scenario]?.[metric] !== undefined)) continue;
				seen.add(name);
				const timing = isTiming(value);
				const values = rounds
					.map((round) => round.candidate[scenario]?.[metric])
					.filter(timing ? isTiming : isCount);
				rows.push({
					name,
					kind: timing ? "timing" : "count",
					base: null,
					candidate: timing
						? round(median(values.map((value) => value.minMs)))
						: median(values.flatMap((value) => value.samples)),
					judged: false,
					verdict: "not judged",
				});
			}
		}
	}
	return rows;
}

/** A ratio as a change in percent, "+6.2 %" or "-3 %". */
export function percentChange(ratio) {
	const percent = round(100 * (ratio - 1));
	return `${percent >= 0 ? "+" : ""}${percent} %`;
}

const MARKS = { slower: "SLOWER", faster: "faster", small: "small change", "not judged": "not judged", none: "" };

function tableLines(entries, rounds) {
	const level = hodgesLehmann(new Array(rounds).fill(0)).level;
	const row = (name, base, candidate, change, interval, p, slowerIn) =>
		`bench: ${name.padEnd(44)} ${String(base).padStart(9)} ${String(candidate).padStart(9)} ${change.padStart(9)} ${interval.padStart(22)} ${p.padStart(6)} ${slowerIn.padStart(10)}`;
	const lines = [
		row(
			"(ms, the fastest run of each arm per round)",
			"base",
			"candidate",
			"change",
			`${Math.floor(level * 100)} % interval`,
			"p",
			"slower in",
		),
	];
	for (const entry of entries) {
		if (entry.kind === "unpaired") {
			const { name, kind, candidate } = entry.row;
			lines.push(
				row(name + (kind === "count" ? " (count)" : ""), "-", candidate, "-", "-", "-", "-") + "  not judged",
			);
			continue;
		}
		if (entry.kind === "count") {
			const { name, base, candidate, changed } = entry.row;
			lines.push(
				row(`${name} (count)`, base.median, candidate.median, "", "", "", "") + (changed ? "  changed" : ""),
			);
			continue;
		}
		const timing = entry.row;
		const mark = MARKS[timing.verdict];
		lines.push(
			row(
				timing.name,
				timing.base,
				timing.candidate,
				percentChange(timing.ratio),
				`${percentChange(timing.low)} to ${percentChange(timing.high)}`,
				timing.p.toFixed(3),
				`${timing.slowerRounds} of ${timing.rounds}`,
			) + (mark ? `  ${mark}` : ""),
		);
	}
	return lines;
}

/**
 * Judges the candidate against the base from the slots of an A/B run, at `scale`. A timing got slower when the
 * candidate was slower across the rounds by the two-sided Wilcoxon signed-rank test on the paired log ratios (p below
 * SIGNIFICANCE), and the Hodges-Lehmann estimate of the change is over both SLOWER_RATIO and SLOWER_MS, as against the
 * baseline; a significant change under those is a "small" one and does not fail. The timings notJudgedAt(scale) leaves
 * out are shown, not judged. Counts are shown for both arms, and one that changed is a warning, as is another number
 * of task rows; a save without tasks that reloads the timeline is a failure.
 */
export function compareAb(slots, scale) {
	const rounds = pairedRounds(slots);
	const notJudged = notJudgedAt(scale);
	const entries = [];
	for (const [scenario, metrics] of Object.entries(rounds[0].base)) {
		for (const [metric, value] of Object.entries(metrics)) {
			const name = `${scenario}.${metric}`;
			const of = (arm) =>
				rounds.map((pair, i) => {
					const found = pair[arm][scenario]?.[metric];
					if (found === undefined) throw new Error(`round ${i + 1}'s ${arm} slot has no ${name}`);
					return found;
				});
			if (isTiming(value)) {
				const fastest = (arm) => of(arm).map((timing) => timing.minMs);
				entries.push({
					kind: "timing",
					row: timingRow(name, fastest("base"), fastest("candidate"), !notJudged.has(metric)),
				});
			} else if (isCount(value)) {
				entries.push({ kind: "count", row: countRow(name, of("base"), of("candidate")) });
			}
		}
	}
	const rows = entries.filter((entry) => entry.kind === "timing").map((entry) => entry.row);
	const countRows = entries.filter((entry) => entry.kind === "count").map((entry) => entry.row);
	const unpaired = unpairedRows(rounds);
	entries.push(...unpaired.map((row) => ({ kind: "unpaired", row })));

	const warnings = [];
	const taskRows = (arm) => [...new Set(rounds.map((pair) => pair[arm].initialLoad?.rows))].sort((a, b) => a - b);
	if (taskRows("base").join() !== taskRows("candidate").join()) {
		warnings.push(
			`bench: warning: the timeline shows ${taskRows("candidate").join(" or ")} task rows with the candidate, ${taskRows("base").join(" or ")} with the base; it renders something else now.`,
		);
	}
	for (const row of countRows.filter((candidate) => candidate.changed)) {
		warnings.push(
			`bench: warning: ${row.name} changed: median ${row.base.median} with the base, ${row.candidate.median} with the candidate.`,
		);
	}

	const lines = tableLines(entries, rounds.length);
	let slower = rows.filter((row) => row.verdict === "slower").length;
	const reloadsOf = (arm) => rounds.reduce((sum, pair) => sum + (pair[arm].saveWithoutTasks?.reloads ?? 0), 0);
	const reloads = {
		base: reloadsOf("base"),
		candidate: reloadsOf("candidate"),
		runs: rounds.reduce((sum, pair) => sum + (pair.candidate.saveWithoutTasks?.runs ?? 0), 0),
	};
	if (reloads.candidate > 0) {
		lines.push(
			`bench: saving a note without tasks reloaded the timeline ${reloads.candidate} of ${reloads.runs} times with the candidate, ${reloads.base} with the base.  SLOWER`,
		);
		slower++;
	}
	return { rows, counts: countRows, unpaired, reloads, warnings, lines, slower };
}

/** The upstream of a local branch, or the ref itself when the injected git runner cannot resolve an upstream. */
export function upstreamOf(ref, git) {
	try {
		return git(["rev-parse", "--abbrev-ref", `${ref}@{upstream}`]).trim();
	} catch {
		return ref; // not a local branch with an upstream (a tag, a commit, origin/master itself)
	}
}

/** Resolves the base commit and its upstream's merge base with the candidate, or HEAD for the local build. */
export function abMergeBase({ base, candidate, git }) {
	const baseCommit = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]).trim();
	// A stale local branch is an ancestor of the candidate, so compare against its upstream to catch that too.
	const mergeBase = git(["merge-base", "--", upstreamOf(base, git), candidate ?? "HEAD"]).trim();
	return { baseCommit, mergeBase };
}
