import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { encodePng } from "../scripts/png.mjs";
import {
	expandedFilterPlan,
	reviewExpandedFilter,
	readExpandedFilterReview,
	recordExpandedFilter,
	compareExpandedFilter,
	runExpandedFilter,
	type ExpandedFilterRecord,
	type ExpandedFilterSemantic,
	type ExpandedFilterHelpers,
} from "../scripts/screenshots-expanded-filter.mjs";
import { plan } from "../scripts/screenshots-themes.mjs";

const manifestName = "expanded-filter.json";
const build = {
	ref: "reviewed-checkout",
	commit: "0123456789abcdef",
	mainJsSha256: "a".repeat(64),
	stylesCssSha256: "b".repeat(64),
	uncommittedChanges: false,
};
const env = { obsidianVersion: "1.12.3", viewport: { width: 420, height: 720, deviceScaleFactor: 1 } };
// The artifact layer preserves these bytes; canonical browser assertions run before collection.
const semantic: ExpandedFilterSemantic = {
	counter: "",
	todayFocus: false,
	entryPosition: "top",
	counterBehavior: "Filter",
	controls: {
		dateScope: "all",
		dates: [],
		priorityOptions: [],
		priorityOpen: false,
		prioritySummary: "Priority",
		entryText: "",
	},
	applied: null,
	rows: [],
};
const styles = '{"priority summary":{"color":"rgb(1, 2, 3)"}}\n';

function temporary(t: TestContext) {
	const folder = mkdtempSync(path.join(tmpdir(), "screenshots-expanded-filter-"));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	return folder;
}

function png(level = 0, size = 1, changedPixels = size * size) {
	const data = Buffer.alloc(size * size * 4);
	for (let index = 0; index < data.length; index += 4) {
		data[index] = index / 4 < changedPixels ? level : 0;
		data[index + 3] = 255;
	}
	return encodePng({ width: size, height: size, data });
}

type Capture = ExpandedFilterRecord;

async function review(
	outDir: string,
	themes: "default" | "all" = "default",
	capture: Capture = { png: png(), styles, semantic },
) {
	return reviewExpandedFilter({
		outDir,
		themes,
		build,
		run: (shots, onState) => {
			for (const shot of shots) onState(shot.name, capture);
			return env;
		},
	});
}

function bytesIn(folder: string, prefix = ""): Record<string, string> {
	if (!existsSync(folder)) return {};
	const result: Record<string, string> = {};
	for (const entry of readdirSync(folder, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		const file = path.join(folder, entry.name);
		if (entry.isSymbolicLink()) result[relative] = `symlink:${readlinkSync(file)}`;
		else if (entry.isDirectory()) Object.assign(result, bytesIn(file, relative));
		else result[relative] = readFileSync(file).toString("base64");
	}
	return result;
}

function editManifest(folder: string, update: (manifest: Record<string, unknown>) => void) {
	const file = path.join(folder, manifestName);
	const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	update(manifest);
	writeFileSync(file, JSON.stringify(manifest));
}

test("expanded-filter is a separate two/four-state plan and preserves the standard 42 visible states", () => {
	assert.deepEqual(expandedFilterPlan(), [
		{ name: "light-expanded-filter", theme: "light" },
		{ name: "dark-expanded-filter", theme: "dark" },
	]);
	assert.deepEqual(expandedFilterPlan("all"), [
		...expandedFilterPlan(),
		{ name: "blue-topaz-light-expanded-filter", theme: "blue-topaz-light" },
		{ name: "blue-topaz-dark-expanded-filter", theme: "blue-topaz-dark" },
	]);
	for (const [themes, pngs, fingerprints] of [
		["default", 84, 86],
		["all", 168, 172],
	] as const) {
		const shots = plan("", "ab", themes).flatMap((group) => group.shots);
		assert.equal(shots.filter(({ png }) => png).length, pngs);
		assert.equal(shots.filter(({ styles }) => styles).length, fingerprints);
		assert.equal(shots.filter(({ visible }) => visible).length, 42);
		assert.ok(shots.every(({ name }) => !name.includes("expanded-filter")));
	}
});

test("review writes a complete hashed artifact only after capture and undo finish, without touching baselines", async (t) => {
	const folder = temporary(t);
	const outDir = path.join(folder, "review");
	const baselineDir = path.join(folder, "baselines");
	mkdirSync(baselineDir);
	writeFileSync(path.join(baselineDir, "approved.txt"), "keep this stored baseline\n");
	const before = bytesIn(baselineDir);
	await reviewExpandedFilter({
		outDir,
		themes: "default",
		build,
		run: (shots, onState) => {
			assert.equal(JSON.parse(readFileSync(path.join(outDir, manifestName), "utf8")).complete, false);
			for (const shot of shots) onState(shot.name, { png: png(), styles, semantic });
			assert.equal(
				JSON.parse(readFileSync(path.join(outDir, manifestName), "utf8")).complete,
				false,
				"all captures existing must not mark the run complete before runAndUndo resolves",
			);
			return env;
		},
	});
	const manifest = readExpandedFilterReview(outDir);
	assert.equal(manifest.schema, 1);
	assert.equal(manifest.kind, "expanded-filter");
	assert.equal(manifest.complete, true);
	assert.equal(manifest.themes, "default");
	assert.deepEqual(manifest.build, build);
	assert.deepEqual(manifest.env, env);
	assert.deepEqual(manifest.states, expandedFilterPlan());
	const expected = expandedFilterPlan().flatMap(({ name }) => [
		`${name}.png`,
		`styles/${name}.json`,
		`semantic/${name}.json`,
	]);
	assert.deepEqual(Object.keys(manifest.files).sort(), expected.sort());
	for (const [relative, record] of Object.entries(manifest.files)) {
		const bytes = readFileSync(path.join(outDir, relative));
		assert.equal(record.bytes, bytes.length, relative);
		assert.equal(record.sha256, createHash("sha256").update(bytes).digest("hex"), relative);
	}
	assert.deepEqual(bytesIn(baselineDir), before);
});

test("a restore failure leaves the artifact incomplete and cannot change a stored baseline", async (t) => {
	const folder = temporary(t);
	const outDir = path.join(folder, "review");
	const baselineDir = path.join(folder, "baselines");
	mkdirSync(baselineDir);
	writeFileSync(path.join(baselineDir, "approved.txt"), "approved\n");
	const before = bytesIn(baselineDir);
	await assert.rejects(
		async () =>
			reviewExpandedFilter({
				outDir,
				themes: "default",
				build,
				run: (shots, onState) => {
					for (const shot of shots) onState(shot.name, { png: png(), styles, semantic });
					throw new Error("fixture undo failed");
				},
			}),
		/fixture undo failed/,
	);
	assert.equal(JSON.parse(readFileSync(path.join(outDir, manifestName), "utf8")).complete, false);
	await assert.rejects(async () => readExpandedFilterReview(outDir));
	await assert.rejects(async () => recordExpandedFilter(outDir, baselineDir));
	assert.deepEqual(bytesIn(baselineDir), before);
});

test("unexpected, repeated, missing or asynchronously completed states cannot become complete reviews", async (t) => {
	for (const failure of ["unexpected", "repeated", "missing", "async"] as const) {
		await t.test(failure, (t) => {
			const outDir = path.join(temporary(t), "review");
			assert.throws(() =>
				reviewExpandedFilter({
					outDir,
					build,
					run: (shots, onState) => {
						const record = { png: png(), styles, semantic };
						if (failure === "unexpected") onState("outside-the-plan", record);
						for (const shot of shots.slice(0, failure === "missing" ? 1 : undefined))
							onState(shot.name, record);
						if (failure === "repeated") onState(shots[0].name, record);
						return failure === "async" ? Promise.resolve(env) : env;
					},
				}),
			);
			assert.equal(JSON.parse(readFileSync(path.join(outDir, manifestName), "utf8")).complete, false);
			assert.throws(() => readExpandedFilterReview(outDir));
		});
	}
});

test("missing, tampered, extra and traversal manifest paths are rejected before record mutates a baseline", async (t) => {
	for (const failure of ["missing", "tampered", "extra", "traversal"] as const) {
		await t.test(failure, async (t) => {
			const folder = temporary(t);
			const outDir = path.join(folder, "review");
			const baselineDir = path.join(folder, "baselines");
			await review(outDir);
			await recordExpandedFilter(outDir, baselineDir);
			const before = bytesIn(baselineDir);
			const file = path.join(outDir, "light-expanded-filter.png");
			if (failure === "missing") rmSync(file);
			else if (failure === "tampered") writeFileSync(file, png(255));
			else
				editManifest(outDir, (manifest) => {
					const files = manifest.files as Record<string, unknown>;
					files[failure === "extra" ? "unexpected.png" : "../outside.png"] = {
						sha256: "0".repeat(64),
						bytes: 1,
					};
				});
			await assert.rejects(async () => readExpandedFilterReview(outDir), failure);
			await assert.rejects(async () => recordExpandedFilter(outDir, baselineDir), failure);
			assert.deepEqual(bytesIn(baselineDir), before);
		});
	}
});

test("record promotes the exact reviewed PNG, style, semantic and manifest bytes without recapturing", async (t) => {
	const folder = temporary(t);
	for (const themes of ["default", "all"] as const) {
		const outDir = path.join(folder, `review-${themes}`);
		const baselineDir = path.join(folder, `baselines-${themes}`);
		await review(outDir, themes);
		const reviewed = bytesIn(outDir);
		await recordExpandedFilter(outDir, baselineDir);
		assert.deepEqual(bytesIn(baselineDir), reviewed);
		assert.deepEqual(readExpandedFilterReview(baselineDir).states, expandedFilterPlan(themes));
		assert.deepEqual(compareExpandedFilter(outDir, baselineDir), []);
	}
});

test("the record action needs only repoRoot and never opens, builds or recaptures a fixture", async (t) => {
	const folder = temporary(t);
	const outDir = path.join(folder, "review");
	await review(outDir);
	const helpers = new Proxy(
		{ repoRoot: folder },
		{
			get(target, property) {
				assert.equal(property, "repoRoot", "offline record must not access any native helper");
				return target.repoRoot;
			},
		},
	) as ExpandedFilterHelpers;
	t.mock.method(console, "log", () => {});
	assert.equal(
		await runExpandedFilter(
			{
				themes: "default",
				expandedFilter: { action: "record", directory: outDir },
			},
			helpers,
		),
		0,
	);
	assert.deepEqual(bytesIn(path.join(folder, "fixtures", "screenshots", "expanded-filter")), bytesIn(outDir));
});

test("run preflight rejects unsafe or unavailable artifact destinations before accessing native helpers", async (t) => {
	for (const failure of [
		"baseline-root",
		"visible-child",
		"expanded-filter-child",
		"missing-baseline",
		"nonempty-review",
	] as const) {
		await t.test(failure, async (t) => {
			const folder = temporary(t);
			const stored = path.join(folder, "fixtures", "screenshots");
			mkdirSync(stored, { recursive: true });
			writeFileSync(path.join(stored, "approved.txt"), "keep stored screenshot bytes\n");
			let outDir = path.join(folder, "artifacts", "review");
			if (failure === "baseline-root") outDir = stored;
			else if (failure === "visible-child") outDir = path.join(stored, "visible", "review");
			else if (failure === "expanded-filter-child") outDir = path.join(stored, "expanded-filter", "review");
			else if (failure === "nonempty-review") {
				mkdirSync(outDir, { recursive: true });
				writeFileSync(path.join(outDir, "reviewed.txt"), "keep existing artifact bytes\n");
			}
			const before = bytesIn(folder);
			let nativeAccesses = 0;
			const helpers = new Proxy(
				{ repoRoot: folder },
				{
					get(target, property) {
						if (property === "repoRoot") return target.repoRoot;
						nativeAccesses++;
						throw new Error(`preflight accessed native helper ${String(property)}`);
					},
				},
			) as ExpandedFilterHelpers;
			const expected =
				failure === "missing-baseline"
					? /no expanded-filter baselines/i
					: failure === "nonempty-review"
						? /output is not empty/i
						: /outside stored screenshot baselines/i;
			await assert.rejects(
				runExpandedFilter(
					{
						themes: "default",
						expandedFilter: {
							action: failure === "missing-baseline" ? "check" : "review",
							directory: outDir,
						},
					},
					helpers,
				),
				expected,
			);
			assert.equal(nativeAccesses, 0);
			assert.deepEqual(bytesIn(folder), before, "preflight must preserve sentinels and create no artifacts");
		});
	}
});

test("review preflight resolves output and repository aliases before protecting stored screenshots", async (t) => {
	for (const alias of ["output-directory", "output-parent", "repository-parent"] as const) {
		await t.test(alias, async (t) => {
			const folder = temporary(t);
			const repoParent = path.join(folder, "projects");
			const realRepo = path.join(repoParent, "repo");
			const stored = path.join(realRepo, "fixtures", "screenshots");
			const emptyStored = path.join(stored, "unrecorded");
			mkdirSync(emptyStored, { recursive: true });
			writeFileSync(path.join(stored, "approved.txt"), "preserve stored screenshot bytes\n");
			let repoRoot = realRepo;
			let outDir = emptyStored;
			if (alias === "output-directory") {
				outDir = path.join(folder, "review-alias");
				symlinkSync(emptyStored, outDir, "dir");
			} else if (alias === "output-parent") {
				const parentAlias = path.join(folder, "review-parent-alias");
				symlinkSync(stored, parentAlias, "dir");
				outDir = path.join(parentAlias, "new", "review");
			} else {
				const parentAlias = path.join(folder, "repo-parent-alias");
				symlinkSync(repoParent, parentAlias, "dir");
				repoRoot = path.join(parentAlias, "repo");
			}
			const before = bytesIn(folder);
			let nativeAccesses = 0;
			const helpers = new Proxy(
				{ repoRoot },
				{
					get(target, property) {
						if (property === "repoRoot") return target.repoRoot;
						nativeAccesses++;
						throw new Error(`alias preflight accessed native helper ${String(property)}`);
					},
				},
			) as ExpandedFilterHelpers;
			await assert.rejects(
				runExpandedFilter(
					{ themes: "default", expandedFilter: { action: "review", directory: outDir } },
					helpers,
				),
				/outside stored screenshot baselines/i,
			);
			assert.equal(nativeAccesses, 0);
			assert.deepEqual(bytesIn(folder), before, "alias rejection must preserve files and links");
			assert.equal(existsSync(path.join(stored, "new")), false, "missing output parents must stay absent");
			assert.equal(existsSync(path.join(emptyStored, manifestName)), false);
		});
	}
});

test("record rejects source/target aliases that resolve to equal or nested directories", async (t) => {
	for (const alias of ["target-parent-equal", "target-parent-child", "source-equal", "source-child"] as const) {
		await t.test(alias, async (t) => {
			const folder = temporary(t);
			const realSource = path.join(folder, "source");
			const realTarget = path.join(folder, "target");
			let source = realSource;
			let target = realTarget;
			if (alias === "target-parent-equal" || alias === "target-parent-child") {
				await review(realSource);
				writeFileSync(path.join(realSource, "source-sentinel.txt"), "preserve reviewed artifact\n");
				const parentAlias = path.join(folder, "target-parent-alias");
				if (alias === "target-parent-equal") {
					symlinkSync(folder, parentAlias, "dir");
					target = path.join(parentAlias, "source");
				} else {
					symlinkSync(realSource, parentAlias, "dir");
					target = path.join(parentAlias, "nested-baseline");
					mkdirSync(path.join(realSource, "nested-baseline"));
					writeFileSync(
						path.join(realSource, "nested-baseline", "target-sentinel.txt"),
						"preserve nested target\n",
					);
				}
			} else {
				const reviewed = alias === "source-equal" ? realTarget : path.join(realTarget, "nested-review");
				await review(reviewed);
				writeFileSync(path.join(realTarget, "target-sentinel.txt"), "preserve stored target\n");
				writeFileSync(path.join(reviewed, "source-sentinel.txt"), "preserve reviewed artifact\n");
				source = path.join(folder, "source-alias");
				symlinkSync(reviewed, source, "dir");
			}
			const before = bytesIn(folder);
			assert.throws(() => recordExpandedFilter(source, target), /separate directories/i);
			assert.deepEqual(bytesIn(folder), before, "rejected overlap must preserve both trees and aliases");
		});
	}
});

test("record rejects a leaf target symlink even when its destination is otherwise separate", async (t) => {
	const folder = temporary(t);
	const source = path.join(folder, "review");
	const safeTarget = path.join(folder, "stored");
	const targetAlias = path.join(folder, "stored-alias");
	await review(source);
	mkdirSync(safeTarget);
	writeFileSync(path.join(source, "source-sentinel.txt"), "preserve reviewed artifact\n");
	writeFileSync(path.join(safeTarget, "target-sentinel.txt"), "preserve stored target\n");
	symlinkSync(safeTarget, targetAlias, "dir");
	const before = bytesIn(folder);
	assert.throws(() => recordExpandedFilter(source, targetAlias));
	assert.deepEqual(bytesIn(folder), before);
});

test("record allows a separate target reached through a parent directory alias", async (t) => {
	const folder = temporary(t);
	const source = path.join(folder, "review");
	const actualParent = path.join(folder, "baselines");
	const parentAlias = path.join(folder, "baselines-alias");
	await review(source);
	mkdirSync(actualParent);
	symlinkSync(actualParent, parentAlias, "dir");
	const before = bytesIn(source);
	const target = path.join(parentAlias, "expanded-filter");
	assert.equal(recordExpandedFilter(source, target).complete, true);
	assert.deepEqual(bytesIn(path.join(actualParent, "expanded-filter")), before);
	assert.deepEqual(bytesIn(source), before);
	assert.equal(readlinkSync(parentAlias), actualParent);
});

test("compare keeps the official PNG noise/drift verdict while comparing styles and semantics exactly", async (t) => {
	const folder = temporary(t);
	const baselineDir = path.join(folder, "baseline");
	await review(baselineDir, "default", { png: png(0, 30), styles, semantic });
	for (const [name, capture, changes] of [
		["same", { png: png(0, 30), styles, semantic }, false],
		["noise", { png: png(8, 30, 1), styles, semantic }, false],
		["drift", { png: png(8, 30), styles, semantic }, false],
		["changed", { png: png(80, 30), styles, semantic }, true],
		["styles", { png: png(0, 30), styles: `${styles} `, semantic }, true],
		["semantic", { png: png(0, 30), styles, semantic: { ...semantic, counter: "todoFilter" } }, true],
	] as const) {
		const outDir = path.join(folder, name);
		await review(outDir, "default", capture);
		const problems = compareExpandedFilter(outDir, baselineDir);
		assert.equal(problems.length > 0, changes, name);
	}
});
