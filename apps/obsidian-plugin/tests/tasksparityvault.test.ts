import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// These modules locate fixtures relative to import.meta.url. Native imports preserve that location when the test
// runner bundles this file as CommonJS, and never run the scripts' CLI entry points.
const corpusUrl = pathToFileURL(path.resolve("scripts/tasks-parity-notes.mjs")).href;
const vaultUrl = pathToFileURL(path.resolve("scripts/tasks-parity-vault.mjs")).href;
const corpus = () => import(corpusUrl) as Promise<typeof import("../scripts/tasks-parity-notes.mjs")>;
const writer = () => import(vaultUrl) as Promise<typeof import("../scripts/tasks-parity-vault.mjs")>;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fingerprint = (notes: Map<string, Buffer>) => {
	const hash = createHash("sha256");
	for (const [file, bytes] of notes) hash.update(file).update("\0").update(bytes).update("\0");
	return hash.digest("hex");
};
const decode = (bytes: Buffer) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const taskRegex = /^([\s\t>]*)([-*+]|[0-9]+[.)]) +\[(.)\] *(.*)/u;

const requiredKinds = [
	"field-order",
	"field-position",
	"block-link",
	"hard-break",
	"variation-selector",
	"callout",
	"indentation",
	"numbered-list",
	"bullet",
	"multiline",
	"status-todo",
	"status-done",
	"status-uppercase",
	"status-in-progress",
	"status-cancelled",
	"status-exclamation",
	"status-question",
	"status-forwarded",
	"status-backward",
	"status-capital-d",
	"status-lower-c",
	"status-lower-h",
	"status-lower-n",
	"surplus-dates",
	"impossible-date",
	"on-completion",
	"id-dependency",
	"dataview-square",
	"dataview-parens",
	"double-bracket",
	"mixed-fields",
	"global-filter",
	"plain",
	"priority-only",
	"scheduled-date",
	"created-date",
	"recurring-dataview",
	"recurring-variation-selector",
	"recurring-on-completion",
	"recurring-all-dates",
	"recurring-no-date",
	"recurring-done",
	"lf",
	"crlf",
	"mixed",
	"no-final-eol",
	"bom",
	"middle-bom",
	"frontmatter",
	"on-completion-archive",
];

test("the tasks-parity corpus is the one the capture was made from", async () => {
	const { tasksParityNotes, tasksParityCases, RECURRENCE_RULES } = await corpus();
	const notes = tasksParityNotes();
	const cases = tasksParityCases();
	assert.ok(cases.length >= 540);
	assert.ok(cases.filter((entry) => entry.recurring).length >= 140);
	assert.ok(new Set(RECURRENCE_RULES.map(({ rule }) => rule)).size >= 40);
	// Once the capture exists, these counts and bytes must keep identifying the vault it was made from.
	assert.equal(notes.size, 52);
	assert.equal(cases.length, 724);
	assert.equal(cases.filter((entry) => entry.recurring).length, 172);
	assert.equal(RECURRENCE_RULES.length, 42);
	assert.equal(fingerprint(notes), "db5fb8bcdda1aef75e5d0f9871f62cf6ae1b6abded83464156a17fbb4c9570a0");
	assert.equal(fingerprint(tasksParityNotes()), fingerprint(notes));
	const actualRules = new Set(
		cases.flatMap(({ sourceLine }) =>
			[...sourceLine.matchAll(/(?:🔁\uFE0F? *|[[(]repeat:: *)([a-zA-Z0-9, !-]+)/giu)].map((match) =>
				match[1].trim(),
			),
		),
	);
	assert.equal(actualRules.size, 42);
	assert.deepEqual([...actualRules].sort(), RECURRENCE_RULES.map(({ rule }) => rule).sort());
	const expectedCounts: Record<string, number> = {
		golden: 198,
		...Object.fromEntries(requiredKinds.map((kind) => [kind, 6])),
	};
	for (const kind of requiredKinds.filter((kind) => kind.startsWith("status-"))) expectedCounts[kind] = 3;
	for (const kind of ["recurring-variation-selector", "recurring-all-dates", "recurring-no-date", "recurring-done"])
		expectedCounts[kind] = 3;
	for (const kind of ["lf", "crlf", "mixed", "no-final-eol", "bom", "middle-bom", "frontmatter"])
		expectedCounts[kind] = 18;
	expectedCounts["on-completion"] = 24;
	expectedCounts["dataview-square"] = 33;
	expectedCounts["dataview-parens"] = 33;
	expectedCounts["on-completion-archive"] = 1;
	for (const { id } of RECURRENCE_RULES) expectedCounts[`recurring:${id}`] = 3;
	const actualCounts: Record<string, number> = {};
	for (const { kind } of cases) actualCounts[kind] = (actualCounts[kind] ?? 0) + 1;
	assert.deepEqual(actualCounts, expectedCounts);
	for (const { id, rule } of RECURRENCE_RULES) {
		const variants = cases.filter((entry) => entry.kind === `recurring:${id}`);
		assert.equal(variants.length, 3, rule);
		assert.equal(new Set(variants.map((entry) => entry.sourceLine)).size, 3, rule);
		for (const entry of variants) assert.ok(entry.sourceLine.includes(rule), entry.sourceLine);
	}
});

function visibleFiles(dir: string, prefix = ""): string[] {
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			if (name.startsWith(".")) return [];
			const full = path.join(dir, name);
			const relative = prefix ? `${prefix}/${name}` : name;
			return statSync(full).isDirectory() ? visibleFiles(full, relative) : [relative];
		});
}

test("the tasks-parity vault holds golden-vault byte for byte", async () => {
	const { goldenVaultNotes, generatedNotes, tasksParityNotes, GENERATED_FOLDER, TASKS_PARITY_VAULT } = await corpus();
	assert.equal(TASKS_PARITY_VAULT, "tasks-parity");
	assert.equal(GENERATED_FOLDER, "Parity");
	const goldenDir = path.resolve("../../fixtures/golden-vault");
	const golden = goldenVaultNotes();
	const generated = generatedNotes();
	const notes = tasksParityNotes();
	assert.equal(golden.size, 24);
	assert.deepEqual([...golden.keys()], visibleFiles(goldenDir));
	assert.deepEqual([...notes.keys()], [...golden.keys(), ...generated.keys()]);
	for (const [file, bytes] of golden) {
		assert.ok(Buffer.isBuffer(bytes));
		assert.deepEqual(bytes, readFileSync(path.join(goldenDir, file)), file);
		assert.deepEqual(notes.get(file), bytes, file);
	}
	for (const [file, bytes] of generated) {
		assert.ok(file.startsWith("Parity/"), file);
		assert.equal(golden.has(file), false, file);
		assert.ok(Buffer.isBuffer(bytes));
		assert.ok(bytes.length <= 8192, file);
	}
});

test("every generated line kind is in the corpus", async () => {
	const { tasksParityCases, generatedNotes, ENCODING_NOTES, GENERATED_KINDS } = await corpus();
	const cases = tasksParityCases();
	const counts = new Map<string, number>();
	for (const entry of cases) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
	assert.deepEqual([...GENERATED_KINDS].sort(), [...requiredKinds].sort());
	for (const kind of requiredKinds)
		assert.ok((counts.get(kind) ?? 0) >= (kind === "on-completion-archive" ? 1 : 3), kind);
	const archive = cases.filter((entry) => entry.sourceLine === "- [ ] a 🏁 archive");
	assert.equal(archive.length, 1);
	assert.deepEqual(generatedNotes().get(archive[0].path), Buffer.from("- [ ] a 🏁 archive\n"));
	assert.equal(archive[0].lineEnding, "lf");
	assert.deepEqual([...ENCODING_NOTES].sort(), [
		"Parity/Encoding/GBK.md",
		"Parity/Encoding/Latin-1.md",
		"Parity/Encoding/Shift-JIS.md",
	]);
	for (const file of ENCODING_NOTES) {
		assert.throws(() => decode(generatedNotes().get(file)!));
		assert.equal(
			cases.some((entry) => entry.path === file),
			false,
			file,
		);
	}
	for (const [name, ending] of [
		["LF", "lf"],
		["CRLF", "crlf"],
		["Mixed", "mixed"],
		["No final EOL", "lf"],
		["BOM", "lf"],
	] as const) {
		const file = `Parity/Layouts/${name}.md`;
		const text = decode(generatedNotes().get(file)!);
		const lines = text.split("\n");
		if (lines[lines.length - 1] === "") lines.pop();
		const entries = cases.filter((entry) => entry.path === file);
		assert.ok(entries.length >= 3, file);
		assert.equal(entries[0].line, 0, file);
		assert.equal(entries[entries.length - 1].line, lines.length - 1, file);
		assert.ok(
			entries.every((entry) => entry.lineEnding === ending),
			file,
		);
		if (name === "No final EOL") assert.equal(text.endsWith("\n"), false);
		if (name === "BOM") assert.equal(text.charCodeAt(0), 0xfeff);
	}
});

test("tasksParityCases reads lines as Tasks hands them", async () => {
	const { tasksParityNotes, tasksParityCases, ENCODING_NOTES } = await corpus();
	const cases = tasksParityCases();
	const expected: { path: string; line: number; sourceLine: string; recurring: boolean; lineEnding: string }[] = [];
	for (const [file, bytes] of tasksParityNotes()) {
		if (ENCODING_NOTES.includes(file)) continue;
		const text = decode(bytes);
		const crlf = text.includes("\r\n");
		const lf = text.replace(/\r\n/g, "").includes("\n");
		const lineEnding = crlf ? (lf ? "mixed" : "crlf") : "lf";
		text.split("\n").forEach((raw, line) => {
			const sourceLine = raw.replace(/\r$/, "").replace(line === 0 ? /^\uFEFF/ : /$^/, "");
			if (taskRegex.test(sourceLine))
				expected.push({
					path: file,
					line,
					sourceLine,
					recurring: /🔁|repeat::/iu.test(sourceLine),
					lineEnding,
				});
		});
	}
	assert.deepEqual(
		cases.map(({ path, line, sourceLine, recurring, lineEnding }) => ({
			path,
			line,
			sourceLine,
			recurring,
			lineEnding,
		})),
		expected,
	);
	// The exact Tasks regex also accepts quoted/numbered lines; the current golden bytes contain 198 matches.
	assert.equal(cases.filter((entry) => entry.kind === "golden").length, 198);
	assert.ok(
		cases.some((entry) => entry.sourceLine.includes("\uFEFF")),
		"a middle BOM stays in the line",
	);
	assert.ok(cases.filter((entry) => entry.line === 0).every((entry) => !entry.sourceLine.startsWith("\uFEFF")));
	for (const line of ["- - [ ] x", "1. - [ ] x"]) {
		assert.ok(
			[...tasksParityNotes().values()].some((bytes) => bytes.includes(Buffer.from(line))),
			line,
		);
		assert.equal(
			cases.some((entry) => entry.sourceLine === line),
			false,
		);
	}
});

test("the generated corpus exercises the fields and settings used by the capture", async () => {
	const { tasksParityCases } = await corpus();
	const generated = tasksParityCases().filter((entry) => entry.kind !== "golden");
	const lines = generated.map((entry) => entry.sourceLine);
	const has = (pattern: RegExp) =>
		assert.ok(
			lines.some((line) => pattern.test(line)),
			String(pattern),
		);
	for (const status of [" ", "x", "X", "/", "-", "!", "?", ">", "<", "D", "c", "h", "n"]) {
		assert.ok(lines.filter((line) => taskRegex.exec(line)?.[3] === status).length >= 3, status);
	}
	for (const key of [
		"due",
		"scheduled",
		"start",
		"created",
		"completion",
		"cancelled",
		"priority",
		"repeat",
		"onCompletion",
		"id",
		"dependsOn",
	]) {
		assert.ok(
			lines.some((line) => line.includes(`[${key}::`)),
			`square ${key}`,
		);
		assert.ok(
			lines.some((line) => line.includes(`(${key}::`)),
			`parens ${key}`,
		);
	}
	for (const symbol of ["📅", "🔁", "🏁", "⏫"])
		assert.ok(
			lines.some((line) => line.includes(symbol + "\uFE0F")),
			symbol,
		);
	for (const action of ["delete", "keep", "archive", "DELETE"]) {
		for (const recurring of [false, true])
			assert.ok(
				generated.some((entry) => entry.recurring === recurring && entry.sourceLine.includes(`🏁 ${action}`)),
				`${action}, recurring=${recurring}`,
			);
	}
	for (const date of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
		for (const symbol of ["📅", "⏳", "🛫"])
			assert.ok(
				generated.some((entry) => entry.recurring && entry.sourceLine.includes(`${symbol} ${date}`)),
				`${symbol} ${date}`,
			);
	}
	for (const pattern of [
		/📅 2026-02-31/,
		/⏳ 2026-13-01/,
		/\[due:: 2026-02-30\]/,
		/\[x\].*\[\[completion:: 2026-10-01\]\]/,
		/\[-\].*\[\[cancelled:: 2026-10-01\]\]/,
		/\[X\].*✅/,
		/\[ \].*✅/,
		/\[x\].*❌/,
		/✅.*❌|❌.*✅/,
		/✅.*✅/,
		/🆔 abc123/,
		/⛔ abc123,def456/,
		/⛔ a, b/,
		/ {2,}$/,
		/ \^[a-zA-Z0-9-]+$/,
		/^> - \[/,
		/^> > - \[/,
		/^\t.*- \[/,
		/^ +.*- \[/,
		/^1\. \[/,
		/^1\) \[/,
		/^\* \[/,
		/^\+ \[/,
		/^[-*+] \[.\] #task /,
		/ #task .+/,
		/ #task$/,
		/2028-02-29/,
	])
		has(pattern);
	assert.ok(lines.some((line) => !line.includes("#task")));
});

function fixture(t: TestContext) {
	const root = mkdtempSync(path.join(tmpdir(), "tasks-parity-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const target = path.join(root, "tasks-parity");
	const assets = path.join(root, "assets");
	mkdirSync(assets);
	const tasksFiles = Object.fromEntries(
		["main.js", "manifest.json", "styles.css", "LICENSE"].map((name) => {
			const bytes = Buffer.from(`fake verified Tasks asset: ${name}\n`);
			writeFileSync(path.join(assets, name), bytes);
			return [name, { url: `https://assets.invalid/${name}`, sha256: sha256(bytes) }];
		}),
	);
	const buildPaths = { mainJs: path.join(root, "main.js"), stylesCss: path.join(root, "styles.css") };
	writeFileSync(buildPaths.mainJs, "fake plugin build\n");
	writeFileSync(buildPaths.stylesCss, "fake plugin styles\n");
	const noFetch: typeof fetch = async () => {
		throw new Error("test must not access the network");
	};
	return { root, target, assets, options: { tasksAssets: assets, tasksFiles, buildPaths, fetch: noFetch } };
}

function snapshot(dir: string, prefix = ""): Map<string, { bytes: Buffer; modified: number }> {
	const files = new Map<string, { bytes: Buffer; modified: number }>();
	for (const name of readdirSync(dir).sort()) {
		const full = path.join(dir, name);
		const relative = prefix ? `${prefix}/${name}` : name;
		const stat = statSync(full);
		if (stat.isDirectory()) for (const [file, value] of snapshot(full, relative)) files.set(file, value);
		else files.set(relative, { bytes: readFileSync(full), modified: stat.mtimeMs });
	}
	return files;
}

test("the tasks-parity vault writes once, preserves settings, and then writes nothing", async (t) => {
	const { writeTasksParityVault, TASKS_PLUGIN_ID, TASKS_PARITY_MARKER } = await writer();
	const { tasksParityNotes } = await corpus();
	const f = fixture(t);
	const first = await writeTasksParityVault(f.target, f.options);
	assert.equal(first.dir, f.target);
	assert.equal(first.notes, tasksParityNotes().size);
	assert.equal(first.written, first.notes);
	assert.equal(first.tasksWritten, 4);
	assert.equal(first.tasksKept, 0);
	assert.equal(first.pluginWritten, 4);
	assert.equal(first.pluginKept, 0);
	assert.equal(first.otherWritten, 2);
	assert.equal(first.totalWritten, first.notes + 10);
	const marker = path.join(f.target, TASKS_PARITY_MARKER);
	assert.equal(readFileSync(marker, "utf8"), "Made by apps/obsidian-plugin/scripts/tasks-parity-vault.mjs.\n");
	for (const [file, bytes] of tasksParityNotes())
		assert.deepEqual(readFileSync(path.join(f.target, file)), bytes, file);
	assert.deepEqual(visibleFiles(f.target).sort(), [...tasksParityNotes().keys()].sort());
	const manifest = JSON.parse(readFileSync(path.resolve("../../manifest.json"), "utf8"));
	const obsidian = path.join(f.target, ".obsidian");
	assert.deepEqual(readdirSync(obsidian).sort(), ["community-plugins.json", "plugins"]);
	assert.equal(
		readFileSync(path.join(obsidian, "community-plugins.json"), "utf8"),
		JSON.stringify([TASKS_PLUGIN_ID, manifest.id], null, 2),
	);
	const pluginDir = path.join(obsidian, "plugins", manifest.id);
	assert.deepEqual(readFileSync(path.join(pluginDir, "main.js")), readFileSync(f.options.buildPaths.mainJs));
	assert.deepEqual(readFileSync(path.join(pluginDir, "styles.css")), readFileSync(f.options.buildPaths.stylesCss));
	assert.deepEqual(
		readFileSync(path.join(pluginDir, "manifest.json")),
		readFileSync(path.resolve("../../manifest.json")),
	);
	assert.equal(
		readFileSync(path.join(pluginDir, "data.json"), "utf8"),
		JSON.stringify(
			{
				showWhatsNewOnUpdate: false,
				lastSeenVersion: manifest.version,
				defaultFilters: "",
				defaultTodayFocus: false,
			},
			null,
			"\t",
		),
	);
	const tasksDir = path.join(obsidian, "plugins", TASKS_PLUGIN_ID);
	for (const file of Object.keys(f.options.tasksFiles))
		assert.deepEqual(readFileSync(path.join(tasksDir, file)), readFileSync(path.join(f.assets, file)), file);
	assert.equal(existsSync(path.join(tasksDir, "data.json")), false);
	writeFileSync(path.join(tasksDir, "data.json"), "Tasks capture owns these settings\n");
	writeFileSync(path.join(pluginDir, "data.json"), "user's later settings\n");
	const before = snapshot(f.target);
	const second = await writeTasksParityVault(f.target, {
		...f.options,
		readAsset: () => {
			throw new Error("correct assets must not be read again");
		},
	});
	assert.deepEqual(second, {
		...first,
		written: 0,
		tasksWritten: 0,
		tasksKept: 4,
		pluginWritten: 0,
		pluginKept: 4,
		otherWritten: 0,
		totalWritten: 0,
	});
	assert.deepEqual(snapshot(f.target), before, "even modification times remain unchanged");
	const note = [...tasksParityNotes().keys()][0];
	writeFileSync(path.join(f.target, note), "changed note\n");
	const repaired = await writeTasksParityVault(f.target, f.options);
	assert.equal(repaired.written, 1);
	assert.deepEqual(readFileSync(path.join(f.target, note)), tasksParityNotes().get(note));
	writeFileSync(marker, "old marker text\n");
	const markerRepair = await writeTasksParityVault(f.target, f.options);
	assert.equal(markerRepair.totalWritten, 1);
	assert.equal(markerRepair.otherWritten, 1);
	assert.equal(readFileSync(marker, "utf8"), "Made by apps/obsidian-plugin/scripts/tasks-parity-vault.mjs.\n");
});

test("the tasks-parity vault refuses a wrong name, unmarked content, and extra notes", async (t) => {
	const { writeTasksParityVault } = await writer();
	const f = fixture(t);
	await assert.rejects(writeTasksParityVault(path.join(f.root, "wrong"), f.options), /must be named tasks-parity/);
	assert.equal(existsSync(path.join(f.root, "wrong")), false);
	mkdirSync(f.target);
	writeFileSync(path.join(f.target, "keep.txt"), "keep me");
	await assert.rejects(writeTasksParityVault(f.target, f.options), /not empty.*not made/);
	assert.deepEqual(readdirSync(f.target), ["keep.txt"]);
	rmSync(path.join(f.target, "keep.txt"));
	await writeTasksParityVault(f.target, f.options);
	writeFileSync(path.join(f.target, "extra.md"), "keep this note");
	const before = snapshot(f.target);
	await assert.rejects(writeTasksParityVault(f.target, f.options), /notes.*extra\.md/);
	assert.deepEqual(snapshot(f.target), before);
});

test("the tasks-parity vault refuses another vault and paths inside one, including symbolic links", async (t) => {
	const { writeTasksParityVault } = await writer();
	const f = fixture(t);
	mkdirSync(path.join(f.target, ".obsidian"), { recursive: true });
	await assert.rejects(writeTasksParityVault(f.target, f.options), /is the Obsidian vault/);
	const inner = path.join(f.target, "nested", "tasks-parity");
	await assert.rejects(writeTasksParityVault(inner, f.options), /is inside the Obsidian vault/);
	const link = path.join(f.root, "alias");
	symlinkSync(f.target, link, "dir");
	await assert.rejects(
		writeTasksParityVault(path.join(link, "tasks-parity"), f.options),
		/is inside the Obsidian vault/,
	);
	assert.deepEqual(readdirSync(f.target), [".obsidian"]);
});

test("the tasks-parity vault rejects a bad asset before writing it", async (t) => {
	const { writeTasksParityVault, TASKS_PLUGIN_ID } = await writer();
	const f = fixture(t);
	const bad = Buffer.from("bad asset");
	await assert.rejects(writeTasksParityVault(f.target, { ...f.options, readAsset: () => bad }), (error: Error) => {
		assert.match(error.message, /main\.js/);
		assert.ok(error.message.includes(f.options.tasksFiles["main.js"].sha256));
		assert.ok(error.message.includes(sha256(bad)));
		return true;
	});
	assert.equal(existsSync(path.join(f.target, ".obsidian/plugins", TASKS_PLUGIN_ID, "main.js")), false);
});

test("the tasks-parity vault checks download responses and keeps already verified assets", async (t) => {
	const { writeTasksParityVault, TASKS_PLUGIN_ID } = await writer();
	const f = fixture(t);
	const calls: string[] = [];
	const fakeFetch: typeof fetch = async (input, init) => {
		const url = String(input);
		calls.push(url);
		assert.equal(init?.redirect, "follow");
		return new Response(readFileSync(path.join(f.assets, path.basename(url))));
	};
	await writeTasksParityVault(f.target, { ...f.options, tasksAssets: undefined, fetch: fakeFetch });
	assert.equal(calls.length, 4);
	await writeTasksParityVault(f.target, { ...f.options, tasksAssets: undefined });
	assert.equal(calls.length, 4);
	const installed = path.join(f.target, ".obsidian/plugins", TASKS_PLUGIN_ID, "main.js");
	rmSync(installed);
	await assert.rejects(
		writeTasksParityVault(f.target, {
			...f.options,
			tasksAssets: undefined,
			fetch: async () => new Response("unavailable", { status: 503 }),
		}),
		/https:\/\/assets\.invalid\/main\.js.*503/,
	);
	assert.equal(existsSync(installed), false);
	await assert.rejects(
		writeTasksParityVault(f.target, {
			...f.options,
			tasksAssets: undefined,
			fetch: async () => {
				throw new TypeError("network unavailable");
			},
		}),
		/https:\/\/assets\.invalid\/main\.js.*network unavailable/,
	);
});

test("the tasks-parity vault requires the release build before fetching assets", async (t) => {
	const { writeTasksParityVault } = await writer();
	const f = fixture(t);
	rmSync(f.options.buildPaths.mainJs);
	await assert.rejects(writeTasksParityVault(f.target, f.options), /Run `pnpm build` first\./);
});

test("the vault resolves relative folders from INIT_CWD and the CLI reports errors", async (t) => {
	const { writeTasksParityVault } = await writer();
	const f = fixture(t);
	const original = process.env.INIT_CWD;
	process.env.INIT_CWD = f.root;
	try {
		const result = await writeTasksParityVault("tasks-parity", { ...f.options, tasksAssets: "assets" });
		assert.equal(result.dir, f.target);
	} finally {
		if (original === undefined) delete process.env.INIT_CWD;
		else process.env.INIT_CWD = original;
	}
	for (const args of [[path.join(f.root, "wrong")], [f.target, "--tasks-files", "unsafe.json"]]) {
		const result = spawnSync(process.execPath, [path.resolve("scripts/tasks-parity-vault.mjs"), ...args], {
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /^tasks-parity-vault: /);
		assert.match(result.stderr, /must be named tasks-parity|usage:/);
	}
});

test("Tasks release URLs and hashes are pinned independently of test assets", async () => {
	const { TASKS_PLUGIN_ID, TASKS_VERSION, TASKS_FILES } = await writer();
	assert.equal(TASKS_PLUGIN_ID, "obsidian-tasks-plugin");
	assert.equal(TASKS_VERSION, "8.6.0");
	const hashes = {
		"main.js": "500f8106d05ddb483bbfec135cac7948022bf6ba7386d1851b28f4d087866e8f",
		"manifest.json": "2efc88df9e973247360d486b420791c266c8824516919303b948d0192e159127",
		"styles.css": "d70d8ebd41fc23bfd5d59873b1a93ed9554b154546a3e637bd4e042e62d1cf23",
		LICENSE: "88debbb735b26a9f2b022da623acc41867149887e2f34ea2e8bbe94f1c9b9bad",
	};
	assert.deepEqual(Object.keys(TASKS_FILES), Object.keys(hashes));
	for (const [file, hash] of Object.entries(hashes))
		assert.deepEqual(TASKS_FILES[file], {
			sha256: hash,
			url:
				file === "LICENSE"
					? "https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/8.6.0/LICENSE"
					: `https://github.com/obsidian-tasks-group/obsidian-tasks/releases/download/8.6.0/${file}`,
		});
});
