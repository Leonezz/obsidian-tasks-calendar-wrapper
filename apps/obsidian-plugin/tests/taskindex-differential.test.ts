// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { ourLines } from "./indexed-vault";
import { runSequence, shrink, type Run } from "./vault-check";
import { generate, generateShared, type Action } from "./vault-steps";

// The task index against readTasks, over generated sequences of changes to a fake vault, see tests/vault-check.ts for
// what each update is checked for: sequences of one reader, as one timeline has, and of up to three readers sharing
// the index, as the plugin's timelines do. The defaults run in about three seconds; for a longer run, set
// TASKINDEX_SEEDS and TASKINDEX_STEPS, and to replay one seed, TASKINDEX_SEED=<seed> TASKINDEX_SEEDS=1:
//   TASKINDEX_SEEDS=3000 TASKINDEX_STEPS=60 pnpm --filter @tasks-calendar-wrapper/obsidian-plugin test

/** A whole number from the environment, or the default; anything else is an error, not a silent default. */
function setting(name: string, fallback: number, least: number): number {
	const text = process.env[name];
	if (text === undefined || text.trim() === "") return fallback;
	const value = Number(text);
	if (!Number.isInteger(value) || value < least) {
		throw new Error(`${name} must be a whole number of at least ${least}, but it is "${text}"`);
	}
	return value;
}

const FIRST = setting("TASKINDEX_SEED", 1, 0);
const SEEDS = setting("TASKINDEX_SEEDS", 300, 1);
const STEPS = setting("TASKINDEX_STEPS", 40, 0);

/** Below this many sequences the coverage guard is left out, as when one seed is replayed. */
const GUARDED = 100;
/** Each of these must happen at least MINIMUM times over the sequences, or they no longer test what they should. */
const COVERED = [
	"at rest",
	"at rest with failures",
	"broken listing",
	"checked against its own",
	"during reads",
	"env",
	"filters",
	"folder rename with notes",
	"full",
	"identity kept",
	"index",
	"missed event",
	"rejected with readTasks",
	"remove",
	"rename",
	"rename md/txt",
	"write unindexed",
	"content ids at rest",
	"warnings told",
	"warnings told before",
	"same failures",
];
/** And these too, over the sequences of several readers. */
const COVERED_SHARED = [
	...COVERED,
	"at rest beside other filters",
	"close",
	"closed during",
	"closed reader update",
	"failure kept for another reader",
	"not listed, not kept",
	"open",
	"queued",
	"shared read",
	"silent failure",
	"silent remove",
	"other failures",
];
const MINIMUM = 10;

/** A run whose console lines the test's mocks collect, keeping ours, as the other tests do. */
const quietRun = (t: TestContext, count?: (what: string) => void, exact = false): Run => ({
	lines: ourLines(t),
	count,
	exact,
});

/**
 * Lets go of what a sequence that passed left behind: its console lines, and the calls the console mocks record, so a
 * long soak does not run out of memory.
 */
function forget(run: Run): void {
	run.lines.length = 0;
	for (const method of [console.warn, console.error])
		(method as unknown as { mock: { resetCalls(): void } }).mock.resetCalls();
}

/** The first lines of a failure's message. */
const firstLines = (error: Error, count: number) => error.message.split("\n").slice(0, count).join("\n");

/** How often a reader read more, or fewer, notes than an index of its own would have. */
const ORACLE = [
	"checked against its own",
	"fewer than its own",
	"more than its own: the key changed and back",
	"more than its own: a file gone unheard",
	"more than its own: again, a note it could not read then",
];

/**
 * Runs the generated sequences, shrinks the first that fails, and checks what they covered. `exact` holds every update
 * to the reads of an index of its own, for sequences of one reader, where nothing may differ.
 */
async function soak(
	t: TestContext,
	generator: (seed: number, steps: number) => Action[],
	covered: readonly string[],
	exact: boolean,
): Promise<void> {
	const coverage = new Map<string, number>();
	const run = quietRun(t, (what) => coverage.set(what, (coverage.get(what) ?? 0) + 1), exact);
	const started = performance.now();
	for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
		const actions = generator(seed, STEPS);
		const failure = await runSequence(actions, run);
		if (failure === null) {
			forget(run);
			continue;
		}
		const shrunk = await shrink(actions, run);
		const again = (await runSequence(shrunk, run)) ?? failure;
		assert.fail(
			`seed ${seed} fails: ${firstLines(failure, 1)}\n` +
				`Replay it with TASKINDEX_SEED=${seed} TASKINDEX_SEEDS=1 TASKINDEX_STEPS=${STEPS} ` +
				"pnpm --filter @tasks-calendar-wrapper/obsidian-plugin test\n" +
				`Shrunk from ${actions.length} to ${shrunk.length} actions: ${JSON.stringify(shrunk)}\n` +
				`which fails with: ${firstLines(again, 12)}`,
		);
	}
	t.diagnostic(`${SEEDS} sequences of ${STEPS} steps in ${Math.round(performance.now() - started)} ms`);
	t.diagnostic(ORACLE.map((what) => `${what}: ${coverage.get(what) ?? 0}`).join(", "));
	if (SEEDS < GUARDED) return;
	for (const what of covered) {
		const times = coverage.get(what) ?? 0;
		assert.ok(times >= MINIMUM, `the sequences cover "${what}" too rarely: ${times} times`);
	}
}

test(`the index gives what readTasks gives, over ${SEEDS} generated sequences of ${STEPS} steps`, (t) =>
	soak(t, generate, COVERED, true));

test(`readers sharing the index each give what readTasks gives, over ${SEEDS} sequences of ${STEPS} steps`, (t) =>
	soak(t, generateShared, COVERED_SHARED, false));

/**
 * Shrunk sequences of failures found once, each run on its own, so a rare case stays covered whatever the seeds give.
 * PATHS[0] is "a.md", CONTENTS[0] has a date, CONTENTS[1] two tasks with dates, CONTENTS[5] a date in Arabic digits;
 * ENVIRONMENTS[0] is zh-cn, [2] an updateLocale with an Arabic-digit preparse, [3] one with the identity, in place.
 * CONTENTS[4] is a note tagged #skip; FILTERS[0] is none, as the first reader starts with, [2] leaves out the archive,
 * and [3] keeps the notes tagged #work.
 */
const REGRESSIONS: readonly { readonly name: string; readonly actions: readonly Action[] }[] = [
	{
		// The random sequences almost never reach it: the parse key must see a locale's _config change in place.
		name: "a second updateLocale changes the locale in place, and the preparse with it",
		actions: [
			{ op: "write", path: 0, content: 5, indexed: true },
			{ op: "env", pick: 2 },
			{ op: "update" },
			{ op: "env", pick: 3 },
			{ op: "update" },
		],
	},
	{
		// The key is checked again after the reads: notes parsed under zh-cn must not be kept as parsed under en.
		name: "the locale changes while the notes are read and is back before the next update",
		actions: [
			{ op: "write", path: 0, content: 0, indexed: true },
			{ op: "write", path: 2, content: 1, indexed: true },
			{ op: "updateDuring", ticks: 0, during: [{ op: "env", pick: 0 }] },
			{ op: "restoreEnv" },
			{ op: "update" },
		],
	},
	{
		// Found at seed 845 of 3,000 sequences of several readers: a new reader's full read failed to read a note, with
		// no mark or full read since the other's update; its next update must read the note again, not take the
		// other's entry, as it holds the note no more.
		name: "a reader uses only the entries of notes its last update gave without failure",
		actions: [
			{ op: "open", filters: 0 },
			{ op: "write", path: 38, content: 1, indexed: true },
			{ op: "update", reader: 6 },
			{ op: "silentFail", pick: 260 },
			{ op: "updateDuring", reader: 4, ticks: 5, during: [{ op: "update", reader: 1 }] },
			{ op: "pair", a: 0, b: 1 },
		],
	},
	{
		// The random sequences seldom reach it: a file that went with no event is listed no more, so its entry goes,
		// although another reader showed it, and a note made at its path, which fires only "create", is read.
		name: "an entry another reader showed is not kept once its file is no longer listed",
		actions: [
			{ op: "write", path: 0, content: 0, indexed: true },
			{ op: "open", filters: 0 },
			{ op: "update", reader: 0 },
			{ op: "update", reader: 1 },
			{ op: "silentRemove", pick: 0 },
			{ op: "update", reader: 0 },
			{ op: "write", path: 0, content: 1, indexed: false },
			{ op: "update", reader: 1 },
		],
	},
	{
		// Found at seed 98 of 1,000 sequences of several readers: the first reader closes, and its late update, which
		// shows nothing, is the only reader of the index then; it must keep the note the open reader holds.
		name: "an update of a closed reader keeps the notes the open readers hold",
		actions: [
			{ op: "write", path: 0, content: 4, indexed: true },
			{ op: "filters", pick: 3, reader: 0 },
			{ op: "open", filters: 2 },
			{ op: "close", pick: 2 },
			{ op: "pair", a: 6, b: 8 },
			{ op: "closedUpdate", pick: 3 },
			{
				op: "updateDuring",
				reader: 3,
				ticks: 2,
				during: [
					{ op: "renameFolder", pick: 138, to: 5 },
					{ op: "rename", pick: 583, to: 43 },
				],
			},
		],
	},
];

for (const { name, actions } of REGRESSIONS) {
	test(`regression: ${name}`, async (t) => {
		const failure = await runSequence(actions, quietRun(t));
		if (failure !== null) throw failure;
	});
}
