/**
 * What scripts/bench-nightly.mjs decides: its options, which open PRs it measures, whether a PR's last measurement is
 * still up to date, and the one comment it keeps on each PR. Plain code, so tests/benchnightly.test.ts can test it.
 */
import { percentChange } from "./bench-ab.mjs";
import { BENCH_SCALES } from "./bench-notes.mjs";

export const COMMENT_MARKER = "<!-- tcw-bench-ab";
/** The first line of the comment says what it measured, so the next night can tell whether anything changed. */
const METADATA = /^<!-- tcw-bench-ab head=(\S+) base=(\S+) scales=([\d,]*) -->/;

const NIGHTLY_DEFAULTS = {
	label: "bench",
	scales: BENCH_SCALES,
	dryRun: false,
	force: false,
	maxWaitMinutes: 180,
	load: 2.5,
	idleMinutes: 15,
	harness: "origin/master",
};
const NIGHTLY_SWITCHES = { "--dry-run": "dryRun", "--force": "force" };
const NIGHTLY_VALUES = {
	"--label": ["label", (value) => value],
	"--scales": [
		"scales",
		(value) => {
			const scales = value.split(",").map(Number);
			if (!scales.every((scale) => BENCH_SCALES.includes(scale)))
				throw new Error(`--scales takes ${BENCH_SCALES.join(", ")} or both, got ${JSON.stringify(value)}.`);
			return scales;
		},
	],
	"--max-wait": ["maxWaitMinutes", (value) => minutes("--max-wait", value)],
	"--load": [
		"load",
		(value) => {
			const load = Number(value);
			if (!(load > 0)) throw new Error(`--load needs a number above 0, got ${JSON.stringify(value)}.`);
			return load;
		},
	],
	"--idle": ["idleMinutes", (value) => minutes("--idle", value)],
	"--harness": ["harness", (value) => value],
};

function minutes(flag, value) {
	const number = Number(value);
	if (!(number >= 0)) throw new Error(`${flag} needs a number of minutes, got ${JSON.stringify(value)}.`);
	return number;
}

/**
 * The options of bench-nightly.mjs: `--label <name>`, `--scales 1,10`, `--dry-run`, `--force`, `--max-wait <minutes>`,
 * `--load <n>`, `--idle <minutes>` and `--harness <ref>`, with or without "=" before a value.
 */
export function nightlyArgs(args) {
	let options = NIGHTLY_DEFAULTS;
	for (let i = 0; i < args.length; i++) {
		const equals = args[i].indexOf("=");
		const flag = equals === -1 ? args[i] : args[i].slice(0, equals);
		if (NIGHTLY_SWITCHES[flag] && equals === -1) {
			options = { ...options, [NIGHTLY_SWITCHES[flag]]: true };
			continue;
		}
		if (!NIGHTLY_VALUES[flag])
			throw new Error(
				`unknown argument ${JSON.stringify(args[i])}; the options are ${[...Object.keys(NIGHTLY_VALUES), ...Object.keys(NIGHTLY_SWITCHES)].join(", ")}.`,
			);
		const value = equals === -1 ? args[++i] : args[i].slice(equals + 1);
		if (value === undefined || value === "" || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
		const [key, parse] = NIGHTLY_VALUES[flag];
		options = { ...options, [key]: parse(value) };
	}
	return options;
}

/**
 * The open PRs to measure: those with the label whose head branch is in the repository itself, sorted by number. A PR
 * from a fork brings code that nobody with write access has looked at, and the benchmark builds and runs it on the
 * maintainer's Mac; labelled forks are refused, never measured. GitHub says the same of self-hosted runners for public
 * repositories.
 */
export function benchablePrs(prs, { label, owner }) {
	const labelled = prs
		.filter((pr) => pr.labels.some((candidate) => candidate.name === label))
		.sort((a, b) => a.number - b.number);
	const ownBranch = (pr) => pr.isCrossRepository === false && pr.headRepositoryOwner?.login === owner;
	return { measure: labelled.filter(ownBranch), refused: labelled.filter((pr) => !ownBranch(pr)) };
}

/** The viewer's comments the benchmark wrote, oldest first. */
function benchComments(comments, viewer) {
	return comments
		.filter((comment) => comment.author?.login === viewer && METADATA.test(comment.body))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * How to post: update the benchmark's last comment by its id, or create one. Not `gh pr comment --edit-last`, which
 * edits the viewer's last comment whatever it is, so the maintainer's own reply after the benchmark's would be
 * overwritten.
 */
export function commentPlan(comments, viewer) {
	const ours = benchComments(comments, viewer);
	if (ours.length === 0) return { action: "create" };
	const { url } = ours[ours.length - 1];
	const id = url.match(/#issuecomment-(\d+)$/)?.[1];
	if (!id) throw new Error(`no comment id in ${url}`);
	return { action: "update", id };
}

/** Whether the benchmark's last comment already measured this head against this base at all these scales. */
export function upToDate(comments, viewer, { head, base, scales }) {
	const ours = benchComments(comments, viewer);
	if (ours.length === 0) return false;
	const [, measuredHead, measuredBase, measuredScales] = ours[ours.length - 1].body.match(METADATA);
	const measured = measuredScales ? measuredScales.split(",").map(Number) : [];
	return measuredHead === head && measuredBase === base && scales.every((scale) => measured.includes(scale));
}

const tasks = (scale) => `${(4000 * scale).toLocaleString("en-US")} tasks`;
const short = (sha) => sha.slice(0, 7);
const ms = (value) => String(value >= 100 ? Math.round(value) : value);
const VERDICTS = {
	slower: "**slower**",
	faster: "faster",
	small: "small change",
	"not judged": "not judged",
	none: "",
};

function headline(run) {
	if (!run.report) return `**${tasks(run.scale)}:** the run failed: ${String(run.error).split("\n")[0]}`;
	const { verdict, rounds } = run.report;
	const slower = verdict.rows.filter((row) => row.verdict === "slower").map((row) => row.name);
	if (verdict.reloads.candidate > 0) slower.push("saves without tasks reloaded the timeline");
	const faster = verdict.rows.filter((row) => row.verdict === "faster").map((row) => row.name);
	const what =
		slower.length === 0
			? "nothing got slower"
			: `${slower.length} measurement${slower.length === 1 ? "" : "s"} got slower: ${slower.join(", ")}`;
	return `**${tasks(run.scale)}:** ${what}${faster.length ? `; faster: ${faster.join(", ")}` : ""} (${rounds} rounds).`;
}

function details(report) {
	const { verdict } = report;
	const level = verdict.rows[0] ? `${Math.floor(verdict.rows[0].level * 100)} % interval` : "Interval";
	const timings = [
		`| Measurement | Base (ms) | PR (ms) | Change | ${level} | p | PR slower in | |`,
		"| --- | --: | --: | --: | --- | --: | --: | --- |",
		...verdict.rows.map(
			(row) =>
				`| ${row.name} | ${ms(row.base)} | ${ms(row.candidate)} | ${percentChange(row.ratio)} | ${percentChange(row.low)} to ${percentChange(row.high)} | ${row.p < 0.001 ? "<0.001" : row.p.toFixed(3)} | ${row.slowerRounds} of ${row.rounds} | ${VERDICTS[row.verdict]} |`,
		),
	].join("\n");
	const countTable = [
		"| Count, median | Base | PR | |",
		"| --- | --: | --: | --- |",
		...verdict.counts.map(
			(row) => `| ${row.name} | ${row.base.median} | ${row.candidate.median} | ${row.changed ? "changed" : ""} |`,
		),
	].join("\n");
	const { env, loadAverage } = report;
	return [
		`<details><summary>${tasks(report.scale)}: every measurement</summary>`,
		timings,
		...(verdict.counts.length ? [countTable] : []),
		...verdict.warnings.map((warning) => warning.replace(/^bench: warning: /, "Warning: ")),
		`Obsidian ${env.obsidianVersion} on ${env.machine.cpu}; 1-minute load average ${loadAverage.before} before and ${loadAverage.after} after (${loadAverage.cores} cores). ${report.rounds} rounds in the order of seed ${report.seed}; main.js sha256 ${report.base.mainJsSha256.slice(0, 12)} (base) and ${report.candidate.mainJsSha256.slice(0, 12)} (PR).`,
		"</details>",
	].join("\n\n");
}

/**
 * The comment for one PR: a line per scale saying what got slower, or that the run failed, then each scale's table,
 * then how the numbers are judged. Its first line records what was measured, for upToDate.
 */
export function benchComment({ head, base, baseRefName, runs }) {
	const measured = runs.filter((run) => run.report).map((run) => run.scale);
	const identical = runs.some((run) => run.report?.identicalBuilds);
	return [
		`${COMMENT_MARKER} head=${head} base=${base} scales=${measured.join(",")} -->\n### Benchmark against the base`,
		`This PR's build (${short(head)}) against its merge base with \`${baseRefName}\` (${short(base)}), measured in turn in one Obsidian session on the maintainer's Mac by \`scripts/bench-nightly.mjs\`.`,
		runs.map((run) => `- ${headline(run)}`).join("\n"),
		...(identical
			? ["The two builds are identical, so this run shows only the noise between runs of the same build."]
			: []),
		...runs.filter((run) => run.report).map((run) => details(run.report)),
		"Each round measures the base and the PR once each, the base first in half of the rounds, in a seeded random order. A round's value is each arm's fastest run. The change is the Hodges-Lehmann estimate of the paired ratios with its interval, and p is the two-sided Wilcoxon signed-rank test's: a measurement got slower when p < 0.05 and it grew by more than 25 % and 50 ms.",
	].join("\n\n");
}
