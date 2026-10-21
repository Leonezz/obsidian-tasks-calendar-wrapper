// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { ourLines } from "./indexed-vault";
import { runSequence, shrink, type Run } from "./vault-check";
import { generate, type Action } from "./vault-steps";

// The task index against readTasks, over generated sequences of changes to a fake vault, see tests/vault-check.ts for
// what each update is checked for. The defaults run in about a second and a half; for a longer run, set
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
];
const MINIMUM = 10;

/** A run whose console lines the test's mocks collect, keeping ours, as the other tests do. */
const quietRun = (t: TestContext, count?: (what: string) => void): Run => ({ lines: ourLines(t), count });

/** The first lines of a failure's message. */
const firstLines = (error: Error, count: number) => error.message.split("\n").slice(0, count).join("\n");

test(`the index gives what readTasks gives, over ${SEEDS} generated sequences of ${STEPS} steps`, async (t) => {
	const coverage = new Map<string, number>();
	const run = quietRun(t, (what) => coverage.set(what, (coverage.get(what) ?? 0) + 1));
	const started = performance.now();
	for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
		const actions = generate(seed, STEPS);
		const failure = await runSequence(actions, run);
		if (failure === null) continue;
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
	if (SEEDS < GUARDED) return;
	for (const what of COVERED) {
		const times = coverage.get(what) ?? 0;
		assert.ok(times >= MINIMUM, `the sequences cover "${what}" too rarely: ${times} times`);
	}
});

/**
 * Shrunk sequences of failures found once, each run on its own, so a rare case stays covered whatever the seeds give.
 * PATHS[0] is "a.md", CONTENTS[0] has a date, CONTENTS[1] two tasks with dates, CONTENTS[5] a date in Arabic digits;
 * ENVIRONMENTS[0] is zh-cn, [2] an updateLocale with an Arabic-digit preparse, [3] one with the identity, in place.
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
];

for (const { name, actions } of REGRESSIONS) {
	test(`regression: ${name}`, async (t) => {
		const failure = await runSequence(actions, quietRun(t));
		if (failure !== null) throw failure;
	});
}
