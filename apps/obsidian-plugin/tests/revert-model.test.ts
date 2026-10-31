import "./setup";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { generateReverts, runReverts, shrinkReverts } from "./revert-model";
import { disagreementClasses } from "./revert-oracle";

function setting(name: string, fallback: number, minimum: number): number {
	const text = process.env[name];
	if (text === undefined || text.trim() === "") return fallback;
	const value = Number(text);
	if (!Number.isInteger(value) || value < minimum)
		throw new Error(`${name} must be a whole number of at least ${minimum}`);
	return value;
}

const first = setting("REVERT_SEED", 1, 0);
const seeds = setting("REVERT_SEEDS", 300, 1);
const steps = setting("REVERT_STEPS", 40, 0);

async function soak(t: TestContext, duplicated: boolean): Promise<void> {
	const coverage = new Map<string, number>();
	const count = (key: string): void => {
		coverage.set(key, (coverage.get(key) ?? 0) + 1);
	};
	const started = performance.now();
	let attempted = 0;
	t.after(() => {
		t.diagnostic(
			`${duplicated ? "duplicated" : "distinct"}: attempted ${attempted}/${seeds} sequences × ${steps} steps in ${Math.round(performance.now() - started)} ms; ` +
				disagreementClasses.map((kind) => `${kind}=${coverage.get(`disagreement:${kind}`) ?? 0}`).join(", "),
		);
		t.diagnostic(
			"coverage: " +
				[...coverage]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([kind, n]) => `${kind}=${n}`)
					.join(", "),
		);
	});
	for (let seed = first; seed < first + seeds; seed++) {
		attempted++;
		const sequence = generateReverts(seed, steps);
		let failure;
		try {
			failure = await runReverts(sequence, { duplicated, count });
		} catch (error) {
			throw new Error(
				`seed ${seed}: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(sequence)}`,
			);
		}
		if (!failure || !failure.classes.includes("other")) continue;
		const minimal = await shrinkReverts(sequence.slice(0, failure.step + 1), { duplicated });
		t.diagnostic(`other seed ${seed} (${duplicated ? "duplicated" : "distinct"}): ${JSON.stringify(minimal)}`);
		t.diagnostic(
			`seed ${seed}: ${failure.message}; replay REVERT_SEED=${seed} REVERT_SEEDS=1 REVERT_STEPS=${steps}`,
		);
	}
	assert.ok(
		(coverage.get("disagreement:other") ?? 0) <= Math.ceil((seeds * (duplicated ? 10 : 25)) / 32000),
		"other disagreements exceed the fuzz5 sequence bound",
	);
}

test(`the real writer agrees with independent line identity truth: ${seeds} distinct sequences of ${steps} steps`, (t) =>
	soak(t, false));
test(`the real writer agrees with independent line identity truth: ${seeds} duplicated sequences of ${steps} steps`, (t) =>
	soak(t, true));

test("seed 222: Redo after an external deletion and a stale copy reapplies the timeline write", async () => {
	assert.equal(
		await runReverts(
			[
				{ kind: "due", note: 1, value: 0, mode: "preview" },
				{ kind: "delete-task", note: 1 },
				{ kind: "stale", note: 1, at: 0 },
				{
					kind: "custom",
					note: 1,
					custom: async ({ h }) => {
						assert.deepEqual(
							h.events.filter((event) => event.kind === "overwritten").map((event) => event.id),
							[1],
						);
					},
				},
				{ kind: "redo", note: 1 },
				{ kind: "changed", note: 1 },
				{
					kind: "custom",
					note: 1,
					custom: async ({ h, note, currentText }) => {
						assert.equal(currentText(note), "other header\n- [ ] C 📅 2026-10-31\nother footer");
						assert.equal(h.reverts.length, 1);
					},
				},
			],
			{ duplicated: true },
		),
		null,
	);
});

test("seed 59: Ctrl+Z belongs to an open source editor, never a process write", async () => {
	const coverage = new Map<string, number>();
	assert.equal(
		await runReverts(
			[
				{ kind: "toggle", note: 1, mode: "preview" },
				{ kind: "ctrlz", note: 1, save: false },
				{
					kind: "custom",
					note: 1,
					custom: async ({ note, currentText }) => {
						assert.match(currentText(note), /- \[x\] C/u);
					},
				},
				{ kind: "save-again", note: 1, at: 5 },
				{ kind: "ctrlz", note: 1, save: false },
				{ kind: "due", note: 1, value: 0, mode: "closed" },
			],
			{ count: (key) => coverage.set(key, (coverage.get(key) ?? 0) + 1) },
		),
		null,
	);
	assert.equal(coverage.get("ctrlz:own-editor-transaction"), 1);
	assert.equal(
		await runReverts([
			{ kind: "quick-entry", note: 1, at: 26 },
			{ kind: "toggle", note: 1, at: 27, mode: "preview" },
			{ kind: "save-again", note: 1, at: 5 },
			{ kind: "ctrlz", note: 1, save: false, deliver: false },
			{ kind: "due", note: 1, at: 4, value: 0, mode: "closed" },
		]),
		null,
	);
});

test("seed 120: Redo reapplies the date and preserves a newer own toggle", async () => {
	assert.equal(
		await runReverts(
			[
				{ kind: "due", mode: "source" },
				{ kind: "changed" },
				{ kind: "stale", at: 0 },
				{ kind: "toggle", mode: "closed" },
				{ kind: "redo" },
				{
					kind: "custom",
					custom: async ({ h, note, currentText }) => {
						assert.equal(currentText(note), "header\n- [x] A ✅ 2026-10-31\n- [ ] A 📅 2026-10-31\nfooter");
						assert.equal(h.reverts.length, 1);
					},
				},
			],
			{ initial: ["header", "- [ ] A", "- [ ] A", "footer"] },
		),
		null,
	);
});

test("seed 1156: an unwritten identical line can change counts while written identities stay as intended", async () => {
	const failure = await runReverts(
		[
			{ kind: "toggle", at: 1, mode: "closed" },
			{
				kind: "custom",
				custom: async ({ note, external }) => {
					const changed = note.lines[1];
					await external(
						note,
						note.lines.map((line) =>
							line.id === changed.id ? { ...line, text: "- [x] A ✅ 2026-10-31" } : line,
						),
						"user",
						true,
						[changed.id],
					);
				},
			},
		],
		{ initial: ["header", "- [ ] A", "- [x] A ✅ 2026-10-31", "footer"], duplicated: true },
	);
	assert.deepEqual(failure?.actual, [1]);
	assert.deepEqual(failure?.expected, []);
	assert.deepEqual(failure?.classes, ["identical"]);
	assert.deepEqual((await runReverts(generateReverts(1156, 60), { duplicated: true }))?.classes, ["identical"]);
});
