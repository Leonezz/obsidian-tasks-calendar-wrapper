/**
 * Runs `bench.mjs --ab` at night on the maintainer's Mac for open PRs, and keeps one comment on each PR with the result.
 * A LaunchAgent starts it; scripts/bench-nightly.plist says how to install one, which is never done for you.
 *
 * Which PRs: the open ones with the label "bench" whose head branch is in this repository itself. A PR from a fork is
 * never built or run: the benchmark runs the PR's code with the maintainer's rights, and GitHub advises against
 * self-hosted runners for public repositories for that reason; this repository asks for approval only of first-time
 * contributors' workflow runs. Each PR's head is measured against its merge base with its base branch, so what landed on
 * master since the branch was cut does not count. A PR whose comment already reports this head against this base at
 * these scales is skipped.
 *
 * The benchmark's own code comes from `--harness`, origin/master by default, checked out in a temporary worktree, so a
 * PR that changes the benchmark is not judged by its own changes. bench.mjs builds both arms in worktrees of their own.
 *
 * Before measuring, it waits up to `--max-wait` minutes until the Mac is idle (bench-host.mjs): on AC power, not in Low
 * Power Mode, a 1-minute load average of at most `--load`, no input for `--idle` minutes, and no other benchmark or
 * screenshot run driving Obsidian. Between runs it waits again, except for the input. From then until it ends,
 * `caffeinate -dis` keeps the Mac and its display awake: the timings wait for painted frames, which a sleeping display
 * may stop.
 *
 * A scale whose run fails is named as failed in the comment; when every scale fails, nothing is posted and the old
 * comment stays. Every failure is in the log and makes the exit code 1.
 *
 * Options (bench-pr.mjs): --label <name>, --scales 1,10, --dry-run (lists what it would measure, then stops), --force
 * (measures PRs whose comment is up to date too), --max-wait <minutes>, --load <n>, --idle <minutes>, --harness <ref>.
 *
 * Installing it, which nothing does for you; from the root of a checkout that stays on master:
 * 1. Copy scripts/bench-nightly.plist with its paths filled in, and the PATH that finds node, pnpm, git and gh:
 *      sed -e "s|__REPO__|$PWD|g" -e "s|__HOME__|$HOME|g" -e "s|__PATH__|$PATH|g" \
 *        apps/obsidian-plugin/scripts/bench-nightly.plist > ~/Library/LaunchAgents/com.github.leonezz.tcw-bench-nightly.plist
 * 2. Load it into the GUI session, where Obsidian runs:
 *      launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.github.leonezz.tcw-bench-nightly.plist
 * 3. Wake the Mac at 02:55 every day. A Mac keeps one repeating schedule, so this replaces any other; `pmset -g sched`
 *    shows it:
 *      sudo pmset repeat wakeorpoweron MTWRFSU 02:55:00
 * 4. Create the label, and put it on the PRs to measure:
 *      gh label create bench --description "Measure with the nightly A/B benchmark"
 * Try it with `node apps/obsidian-plugin/scripts/bench-nightly.mjs --dry-run`, or start the job now with
 * `launchctl kickstart gui/$(id -u)/com.github.leonezz.tcw-bench-nightly`; it logs to ~/Library/Logs/tcw-bench-nightly.log.
 * To remove it: `launchctl bootout gui/$(id -u)/com.github.leonezz.tcw-bench-nightly`, delete the plist, and
 * `sudo pmset repeat cancel`.
 *
 * The Mac is a laptop, so:
 * - Leave it logged in, with Obsidian running and bench-vault and bench-vault-x10 open; the screen can be locked. After
 *   a restart nobody is logged in, and the job waits until someone is.
 * - Leave the lid open. A MacBook with its lid closed sleeps unless an external display, power and a keyboard are
 *   connected; neither the scheduled wake nor caffeinate keeps it awake then, and the wake is only a dark wake.
 * - Leave it plugged in. On battery the script waits rather than measure a Mac that slows down to save power, and
 *   `caffeinate -s` only holds on AC power.
 * - `caffeinate -dis -w <pid>` keeps the Mac (-i, -s) and its display (-d) awake from the wait for idle until the script
 *   ends; it does not turn a display that is already off back on. The 15 minutes without input are counted from the
 *   last keypress or click, which a scheduled wake is not.
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { hidIdleSeconds, idleProblems, lowPowerMode, otherBenchProcesses, powerSource } from "./bench-host.mjs";
import { benchablePrs, benchComment, commentPlan, nightlyArgs, upToDate } from "./bench-pr.mjs";
import { repoRoot, runScript, ScriptError } from "./fixture-app.mjs";

const log = (message) => console.log(`bench-nightly ${new Date().toISOString()}: ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { cwd = repoRoot } = {}) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.error) throw new ScriptError(`could not run ${command}: ${result.error.message}`);
	if (result.status !== 0)
		throw new ScriptError(
			`${command} ${args.join(" ")} failed: ${`${result.stderr}\n${result.stdout}`.trim().slice(-2000)}`,
		);
	return result.stdout.trim();
}
const git = (...args) => run("git", args);
const gh = (...args) => run("gh", args);

function hostState() {
	return {
		loadAverage: os.loadavg()[0],
		idleSeconds: hidIdleSeconds(run("ioreg", ["-c", "IOHIDSystem"])),
		power: powerSource(run("pmset", ["-g", "batt"])),
		lowPower: lowPowerMode(run("pmset", ["-g"])),
		others: otherBenchProcesses(run("ps", ["-A", "-o", "pid=,ppid=,command="]), process.pid),
	};
}

/** Waits until idleProblems finds nothing, checking every minute, for at most `maxWaitMinutes`. */
async function waitUntilIdle(limits, maxWaitMinutes) {
	const deadline = Date.now() + maxWaitMinutes * 60_000;
	for (;;) {
		const problems = idleProblems(hostState(), limits);
		if (problems.length === 0) return;
		if (Date.now() >= deadline)
			throw new ScriptError(
				`the Mac was not idle enough within ${maxWaitMinutes} minutes: ${problems.join("; ")}.`,
			);
		log(`waiting, as ${problems.join("; ")}`);
		await sleep(60_000);
	}
}

/** The error a failed bench.mjs printed: from its last line that is not a warning. */
function benchError(stderr, status) {
	const lines = stderr.split("\n");
	const last = lines.findLastIndex((line) => line.startsWith("bench: ") && !line.startsWith("bench: warning:"));
	return last === -1
		? `bench.mjs exited with ${status} and printed no error`
		: lines
				.slice(last)
				.join("\n")
				.replace(/^bench: /, "");
}

/** One scale of one PR: bench.mjs --ab from the harness, which writes its report; a failure is returned, not thrown. */
function measurePr({ harness, workDir, pr, base, scale }) {
	const reportFile = path.join(workDir, `pr${pr.number}-scale${scale}.json`);
	rmSync(reportFile, { force: true });
	log(`measuring #${pr.number} at scale ${scale}: ${pr.headRefOid.slice(0, 7)} against ${base.slice(0, 7)}`);
	const result = spawnSync(
		process.execPath,
		[
			path.join(harness, "apps", "obsidian-plugin", "scripts", "bench.mjs"),
			"--ab",
			base,
			"--candidate",
			pr.headRefOid,
			"--scale",
			String(scale),
			// The same order for the same head, so a run can be repeated.
			"--seed",
			String(parseInt(pr.headRefOid.slice(0, 8), 16)),
			"--report",
			reportFile,
		],
		{
			cwd: path.join(harness, "apps", "obsidian-plugin"),
			stdio: ["ignore", "inherit", "pipe"],
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.error) return { scale, error: `could not run bench.mjs: ${result.error.message}` };
	// bench.mjs exits with 1 when something got slower, and writes the report first.
	if (existsSync(reportFile)) return { scale, report: JSON.parse(readFileSync(reportFile, "utf8")) };
	return { scale, error: benchError(result.stderr ?? "", result.status) };
}

/** Creates the PR's benchmark comment, or updates it by its id. */
function post(repo, pr, viewer, bodyFile) {
	const { comments } = JSON.parse(gh("pr", "view", String(pr.number), "--json", "comments"));
	const plan = commentPlan(comments, viewer);
	if (plan.action === "create") gh("pr", "comment", String(pr.number), "--body-file", bodyFile);
	else gh("api", "--method", "PATCH", `repos/${repo}/issues/comments/${plan.id}`, "-F", `body=@${bodyFile}`);
	log(`${plan.action === "create" ? "commented on" : "updated the comment on"} #${pr.number}`);
}

/**
 * What to measure: each labelled PR of this repository with its merge base, and whether its comment is up to date, and
 * how many PRs could not be planned; one PR's failure is logged and leaves the others.
 */
function plan(options, owner, viewer) {
	const prs = JSON.parse(
		gh(
			"pr",
			"list",
			"--state",
			"open",
			"--label",
			options.label,
			"--limit",
			"100",
			"--json",
			"number,title,url,headRefName,headRefOid,baseRefName,isCrossRepository,headRepositoryOwner,labels",
		),
	);
	const { measure, refused } = benchablePrs(prs, { label: options.label, owner });
	for (const pr of refused)
		log(`not measuring #${pr.number}: its branch is in ${pr.headRepositoryOwner?.login ?? "another"}'s fork`);
	// After listing, so the heads listed are fetched.
	git("fetch", "--prune", "--quiet", "origin");
	let failures = 0;
	const work = measure.flatMap((pr) => {
		if (spawnSync("git", ["cat-file", "-e", `${pr.headRefOid}^{commit}`], { cwd: repoRoot }).status !== 0) {
			log(`not measuring #${pr.number}: its head ${pr.headRefOid.slice(0, 7)} moved while it was fetched`);
			return [];
		}
		try {
			const base = git("merge-base", `origin/${pr.baseRefName}`, pr.headRefOid);
			const { comments } = JSON.parse(gh("pr", "view", String(pr.number), "--json", "comments"));
			const current = upToDate(comments, viewer, { head: pr.headRefOid, base, scales: options.scales });
			return [{ pr, base, skip: current && !options.force }];
		} catch (error) {
			failures++;
			log(`not measuring #${pr.number}: ${error.message}`);
			return [];
		}
	});
	return { work, failures };
}

/**
 * Measures each PR at each scale and posts its comment; returns how many runs or posts failed. When the Mac does not
 * become idle again between runs, it posts what it measured for the PR at hand and stops.
 */
async function measureEach(todo, { options, limits, harness, workDir, repo, viewer }) {
	let failures = 0;
	let busy = null;
	for (const [i, { pr, base }] of todo.entries()) {
		const runs = [];
		for (const [j, scale] of options.scales.entries()) {
			if (busy) break;
			try {
				// Our own last run raised the load average; the input was checked once, before the first.
				if (i > 0 || j > 0) await waitUntilIdle({ ...limits, idleMinutes: 0 }, options.maxWaitMinutes);
			} catch (error) {
				busy = error;
				runs.push({ scale, error: error.message });
				break;
			}
			runs.push(measurePr({ harness, workDir, pr, base, scale }));
		}
		if (runs.length === 0) break;
		for (const failed of runs.filter((result) => result.error)) {
			failures++;
			log(`#${pr.number} at scale ${failed.scale} failed: ${failed.error}`);
		}
		if (runs.every((result) => result.error)) {
			log(`#${pr.number}: no scale was measured; its comment is left as it was.`);
			continue;
		}
		const bodyFile = path.join(workDir, `pr${pr.number}-comment.md`);
		writeFileSync(bodyFile, benchComment({ head: pr.headRefOid, base, baseRefName: pr.baseRefName, runs }) + "\n");
		try {
			post(repo.nameWithOwner, pr, viewer, bodyFile);
		} catch (error) {
			failures++;
			log(`#${pr.number}: posting the comment failed: ${error.message}`);
		}
	}
	// The scale it gave up on is counted among the failed runs above.
	if (busy) log(`stopped measuring: ${busy.message}`);
	return failures;
}

await runScript("bench-nightly", async () => {
	if (process.platform !== "darwin") throw new ScriptError("this runs on the maintainer's Mac, where Obsidian is.");
	let options;
	try {
		options = nightlyArgs(process.argv.slice(2));
	} catch (error) {
		throw new ScriptError(error.message);
	}
	log(`started with ${JSON.stringify(options)}`);
	const repo = JSON.parse(gh("repo", "view", "--json", "owner,nameWithOwner"));
	const viewer = gh("api", "user", "--jq", ".login");
	const { work, failures: unplanned } = plan(options, repo.owner.login, viewer);
	for (const { pr, base, skip } of work)
		log(
			`#${pr.number} ${pr.title}: ${skip ? "up to date, skipped" : `to measure, ${pr.headRefOid.slice(0, 7)} against ${base.slice(0, 7)}`}`,
		);
	const todo = work.filter((item) => !item.skip);
	if (options.dryRun || todo.length === 0) {
		log(todo.length === 0 ? `nothing to measure for the label "${options.label}".` : "dry run, stopping here.");
		return unplanned ? 1 : 0;
	}

	// Keeps the Mac and its display awake until this process ends, the wait for idle included.
	spawn("caffeinate", ["-dis", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
	const limits = { load: options.load, idleMinutes: options.idleMinutes };
	await waitUntilIdle(limits, options.maxWaitMinutes);
	const workDir = mkdtempSync(path.join(os.tmpdir(), "tcw-bench-nightly-"));
	const harness = path.join(workDir, "harness");
	let outcome;
	try {
		git("worktree", "add", "--detach", "--quiet", harness, options.harness);
		outcome = { failures: await measureEach(todo, { options, limits, harness, workDir, repo, viewer }) };
	} catch (error) {
		outcome = { error };
	}
	const leftovers = [];
	if (existsSync(harness)) {
		try {
			git("worktree", "remove", "--force", harness);
		} catch (error) {
			leftovers.push(error.message);
		}
	}
	rmSync(workDir, { recursive: true, force: true });
	for (const leftover of leftovers) log(`could not remove the harness worktree: ${leftover}`);
	if (outcome.error) throw outcome.error;
	const failures = unplanned + outcome.failures + leftovers.length;
	log(failures ? `done, with ${failures} failure(s).` : "done.");
	return failures ? 1 : 0;
});
