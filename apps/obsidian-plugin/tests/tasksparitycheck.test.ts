import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Keep import.meta-based fixture paths in the actual scripts; importing never runs their native CLI entry points.
const checkUrl = pathToFileURL(path.resolve("scripts/tasks-parity-check.mjs")).href;
const captureUrl = pathToFileURL(path.resolve("scripts/capture-tasks-toggle-lib.mjs")).href;
const library = () => import(checkUrl) as Promise<typeof import("../scripts/tasks-parity-check.mjs")>;
const captureLibrary = () => import(captureUrl) as Promise<typeof import("../scripts/capture-tasks-toggle-lib.mjs")>;
type Entry = ReturnType<typeof import("../scripts/tasks-parity-check.mjs").planParityCases>[number];
type Args = ReturnType<typeof import("../scripts/tasks-parity-check.mjs").parseParityArgs>;
type Backup = ReturnType<typeof import("../scripts/tasks-parity-check.mjs").backupParityFixture>;
type CorpusCase = ReturnType<typeof import("../scripts/capture-tasks-toggle-lib.mjs").captureCases>[number];
type Fixture = {
	format: number;
	group: string;
	tasksVersion: string;
	settings: Record<string, unknown>;
	day: string;
	notes: Record<string, string>;
	cases: (CorpusCase & { api: string; after: { prefix: number; suffix: number; text: string } })[];
};

const refusedIds = [
	"Dataview fields.md:11",
	"Emoji dates.md:19",
	"Emoji dates.md:20",
	"Parity/Fields 01.md:6",
	"Parity/Fields 01.md:15",
	"Parity/Fields 01.md:24",
	"Parity/Fields 02.md:8",
	"Parity/Fields 02.md:17",
	"Parity/Fields 03.md:1",
	"Parity/Recurrence 04.md:3",
	"Parity/Recurrence 04.md:6",
	"Parity/Recurrence 05.md:11",
	"Parity/Recurrence 05.md:12",
	"Parity/Recurrence 05.md:13",
];
const hiddenIds = [
	"Comments.md:12",
	"Structure.md:23",
	"Structure.md:31",
	"Structure.md:32",
	"Structure.md:33",
	"Structure.md:35",
	"Structure.md:38",
	"Structure.md:76",
	"Parity/Syntax 01.md:18",
	"Parity/Syntax 01.md:19",
	"Parity/Syntax 02.md:14",
	"Parity/Syntax 02.md:15",
	"Parity/Syntax 03.md:10",
	"Parity/Syntax 03.md:11",
];
const sessionIds = [
	"Emoji dates.md:37",
	"Parity/Recurrence 04.md:12",
	"Parity/Recurrence 04.md:13",
	"Parity/Recurrence 04.md:15",
	"Parity/Recurrence 04.md:16",
	"Parity/Recurrence 04.md:18",
	"Parity/Recurrence 04.md:19",
	"Parity/Recurrence 04.md:21",
	"Parity/Recurrence 04.md:22",
	"Parity/Recurrence 04.md:24",
	"Parity/Recurrence 05.md:0",
	"Parity/Recurrence 05.md:2",
	"Parity/Recurrence 05.md:3",
	"Parity/Recurrence 05.md:5",
	"Parity/Recurrence 05.md:6",
	"Parity/Recurrence 05.md:8",
	"Parity/Recurrence 05.md:9",
];
const sorted = (values: readonly string[]) => [...values].sort();
const loadFixture = () => JSON.parse(readFileSync("../../fixtures/tasks-toggle/default.json", "utf8")) as Fixture;

function folder(t: TestContext): string {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "tcw-parity-check-test-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function argumentsFor(root: string, mode: Args["mode"] = "check"): Args {
	return { mode, report: path.join(root, "report.json"), backupdir: path.join(root, "backup") };
}

test("parity arguments require explicit absolute report and backup paths in either option form", async () => {
	const { parseParityArgs } = await library();
	const report = path.resolve("/tmp/parity/report.json");
	const backupdir = path.resolve("/tmp/parity/backup");
	assert.deepEqual(parseParityArgs(["--report", report, "--backupdir", backupdir]), {
		mode: "check",
		report,
		backupdir,
	});
	assert.deepEqual(parseParityArgs([`--backupdir=${backupdir}`, `--report=${report}`, "--restore"]), {
		mode: "restore",
		report,
		backupdir,
	});
	assert.deepEqual(parseParityArgs(["--restore", "--backupdir", backupdir, `--report=${report}`]), {
		mode: "restore",
		report,
		backupdir,
	});
	const valid = [`--report=${report}`, `--backupdir=${backupdir}`];
	for (const args of [
		[],
		["--report", report],
		["--backupdir", backupdir],
		["--report"],
		["--report=", `--backupdir=${backupdir}`],
		[...valid, "--unknown"],
		[...valid, "--update"],
		[...valid, "--only=one"],
		[...valid, "--restore=true"],
		[...valid, "--report", report],
		[...valid, `--backupdir=${backupdir}`],
		[...valid, "--restore", "--restore"],
		["--report=relative.json", `--backupdir=${backupdir}`],
		[`--report=${report}`, "--backupdir=../backup"],
		["--report", "--backupdir", backupdir],
		[...valid, "trailing"],
	])
		assert.throws(() => parseParityArgs(args), JSON.stringify(args));
});

test("the parity plan pins every real corpus identity and the independent 696/14/14 and 17-session manifests", async () => {
	const { planParityCases } = await library();
	const { captureCases } = await captureLibrary();
	const fixture = loadFixture();
	const before = JSON.stringify(fixture);
	const corpus = captureCases();
	const entries = planParityCases(fixture, corpus);
	assert.equal(entries.length, 724);
	assert.deepEqual(
		entries.map(({ id }) => id),
		fixture.cases.map(({ path, line }) => `${path}:${line}`),
	);
	assert.deepEqual(
		sorted(entries.filter(({ expected }) => expected === "refused").map(({ id }) => id)),
		sorted(refusedIds),
	);
	assert.deepEqual(
		sorted(entries.filter(({ expected }) => expected === "hidden").map(({ id }) => id)),
		sorted(hiddenIds),
	);
	assert.equal(entries.filter(({ expected }) => expected === "written").length, 696);
	assert.deepEqual(
		sorted(entries.filter(({ oracle }) => oracle === "session").map(({ id }) => id)),
		sorted(sessionIds),
	);
	assert.equal(entries.filter(({ oracle }) => oracle === "recorded").length, 707);
	for (let i = 0; i < entries.length; i++) {
		const { id, expected, reason, oracle, ...captured } = entries[i];
		assert.deepEqual(captured, fixture.cases[i], id);
		assert.ok(
			expected === "written" || typeof reason === "string",
			`${id}: exceptional cases explain their reason`,
		);
		assert.equal(oracle, sessionIds.includes(id) ? "session" : "recorded");
	}
	assert.equal(JSON.stringify(fixture), before, "planning must not mutate the stored oracle");
});

test("the parity plan refuses changed oracle schema, dates, identities and source bytes instead of adapting its counts", async () => {
	const { planParityCases } = await library();
	const { captureCases } = await captureLibrary();
	const corpus = captureCases();
	const badFixtures: ((fixture: Fixture) => void)[] = [
		(f) => {
			f.format = 2;
		},
		(f) => {
			f.group = "dataview";
		},
		(f) => {
			f.tasksVersion = "8.5.0";
		},
		(f) => {
			f.day = "2026-02-30";
		},
		(f) => {
			f.day = "2026-1-01";
		},
		(f) => {
			f.day = "2026-10-31T00:00:00Z";
		},
		(f) => {
			f.cases.pop();
		},
		(f) => {
			f.cases[1] = structuredClone(f.cases[0]);
		},
		(f) => {
			f.cases[0].sourceLine += " changed";
		},
		(f) => {
			f.cases[0].line += 0.5;
		},
		(f) => {
			f.cases[0].path = "../outside.md";
		},
		(f) => {
			delete f.notes[f.cases[0].path];
		},
		(f) => {
			f.cases[0].after.prefix = -1;
		},
	];
	for (const mutate of badFixtures) {
		const fixture = loadFixture();
		mutate(fixture);
		assert.throws(() => planParityCases(fixture, corpus), mutate.toString());
	}
	for (const mutate of [
		(c: CorpusCase[]) => {
			c.pop();
		},
		(c: CorpusCase[]) => {
			c[1] = structuredClone(c[0]);
		},
		(c: CorpusCase[]) => {
			c[0].sourceLine += " changed";
		},
	]) {
		const changed = structuredClone(corpus);
		mutate(changed);
		assert.throws(() => planParityCases(loadFixture(), changed), mutate.toString());
	}
	const changedWhenDone = loadFixture();
	const entry = changedWhenDone.cases.find(({ path, line }) => `${path}:${line}` === sessionIds[0])!;
	entry.sourceLine = entry.sourceLine.replace("when done", "");
	const lines = changedWhenDone.notes[entry.path].split("\n");
	lines[entry.line] = entry.sourceLine;
	changedWhenDone.notes[entry.path] = lines.join("\n");
	const changedCorpus = corpus.map((c) =>
		c.path === entry.path && c.line === entry.line ? { ...c, sourceLine: entry.sourceLine } : c,
	);
	assert.throws(
		() => planParityCases(changedWhenDone, changedCorpus),
		"the explicit session ID set must not silently shrink",
	);
});

test("applying a Tasks API answer preserves BOM, mixed endings, untouched bytes and unterminated deletion semantics", async () => {
	const { applyOracleLine } = await library();
	const examples: [string, number, string, string][] = [
		["before\n- [ ] Pay\nafter\n", 1, "- [x] Pay", "before\n- [x] Pay\nafter\n"],
		["before\r\n- [ ] Pay\r\nafter\n", 1, "- [x] Pay\n- [ ] Next", "before\r\n- [x] Pay\r\n- [ ] Next\r\nafter\n"],
		["before\r\n- [ ] Pay", 1, "- [x] Pay\n- [ ] Next", "before\r\n- [x] Pay\r\n- [ ] Next"],
		["\uFEFF- [ ] Pay\r\nafter\n", 0, "- [x] Pay", "\uFEFF- [x] Pay\r\nafter\n"],
		["before\n- [ ] Pay\nafter\n", 1, "", "before\nafter\n"],
		["before\r\n- [ ] Pay\r\nafter\n", 1, "", "before\r\nafter\n"],
		["before\n- [ ] Pay", 1, "", "before\n"],
		["- [ ] Pay", 0, "", ""],
		["\uFEFF- [ ] Pay", 0, "", "\uFEFF"],
	];
	for (const [before, line, api, expected] of examples) assert.equal(applyOracleLine(before, line, api), expected);
	for (const line of [-1, 0.5, 5]) assert.throws(() => applyOracleLine("- [ ] Pay", line, "- [x] Pay"));
});

function comparisonEntry(overrides: Partial<Entry> = {}): Entry {
	return {
		path: "Note.md",
		line: 1,
		id: "Note.md:1",
		kind: "golden",
		recurring: false,
		lineEnding: "lf",
		sourceLine: "- [ ] Pay",
		api: "- [x] Pay ✅ 2026-10-31",
		after: { prefix: 10, suffix: 7, text: "x] Pay ✅ 2026-10-31" },
		expected: "written",
		oracle: "recorded",
		...overrides,
	};
}

test("recorded LF notes compare the complete editor oracle, including all bytes outside the changed line", async () => {
	const { compareParityNote } = await library();
	const before = "before\n- [ ] Pay\nafter\n";
	const after = "before\n- [x] Pay ✅ 2026-10-31\nafter\n";
	const entry = comparisonEntry();
	const result = compareParityNote(before, after, entry, entry.api);
	assert.equal(result.matches, true);
	assert.equal(result.mode, "whole-note");
	for (const changed of [after.replace("before", "BEFORE"), after.replace("Pay", "Wrong"), after.slice(0, -1)]) {
		const result = compareParityNote(before, changed, entry, entry.api);
		assert.equal(result.matches, false);
		assert.equal(result.mode, "whole-note");
		assert.ok(result.detail);
	}
});

test("session, CRLF and BOM comparisons use the selected API answer while requiring exact surrounding bytes", async () => {
	const { compareParityNote } = await library();
	const api = "- [x] Pay ✅ 2026-11-16\n- [ ] Next";
	for (const [before, after, overrides] of [
		["before\n- [ ] Pay\nafter\n", "before\n- [x] Pay ✅ 2026-11-16\n- [ ] Next\nafter\n", { oracle: "session" }],
		[
			"before\r\n- [ ] Pay\r\nafter\n",
			"before\r\n- [x] Pay ✅ 2026-11-16\r\n- [ ] Next\r\nafter\n",
			{ lineEnding: "mixed" },
		],
		["\uFEFFbefore\n- [ ] Pay\nafter\n", "\uFEFFbefore\n- [x] Pay ✅ 2026-11-16\n- [ ] Next\nafter\n", {}],
	] as [string, string, Partial<Entry>][]) {
		const entry = comparisonEntry(overrides);
		const result = compareParityNote(before, after, entry, api);
		assert.equal(result.matches, true);
		assert.equal(result.mode, "changed-lines");
		for (const changed of [after.replace("before", "BEFORE"), after.replace("Pay", "Wrong"), after + "\n"]) {
			const result = compareParityNote(before, changed, entry, api);
			assert.equal(result.matches, false, "a changed-lines comparison still checks every untouched byte");
			assert.equal(result.mode, "changed-lines");
			assert.ok(result.detail);
		}
	}
});

test("parity outputs require new files and backup directories, while restore accepts only an existing real directory", async (t) => {
	const { validateParityPaths } = await library();
	const root = folder(t);
	const args = argumentsFor(root);
	assert.deepEqual(validateParityPaths(args, []), { report: args.report, backupdir: args.backupdir });
	writeFileSync(args.report, "existing report\n");
	assert.throws(() => validateParityPaths(args, []));
	assert.equal(readFileSync(args.report, "utf8"), "existing report\n");
	rmSync(args.report);
	mkdirSync(args.backupdir);
	assert.throws(() => validateParityPaths(args, []));
	assert.deepEqual(validateParityPaths({ ...args, mode: "restore" }, []), {
		report: args.report,
		backupdir: args.backupdir,
	});
	rmSync(args.backupdir, { recursive: true });
	assert.throws(() => validateParityPaths({ ...args, mode: "restore" }, []));
	writeFileSync(args.backupdir, "not a directory");
	assert.throws(() => validateParityPaths({ ...args, mode: "restore" }, []));
	for (const field of ["report", "backupdir"] as const)
		assert.throws(() =>
			validateParityPaths({ ...argumentsFor(root), [field]: path.join(root, "missing", "out") }, []),
		);
});

test("real-path guards reject worktrees, vaults and symlink-parent aliases before writing anything", async (t) => {
	const { validateParityPaths } = await library();
	const root = folder(t);
	const worktree = path.join(root, "worktree"),
		vault = path.join(root, "vault");
	mkdirSync(path.join(worktree, "artifacts"), { recursive: true });
	mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
	const workAlias = path.join(root, "work-alias"),
		vaultAlias = path.join(root, "vault-alias");
	symlinkSync(worktree, workAlias, "dir");
	symlinkSync(vault, vaultAlias, "dir");
	for (const directory of [worktree, path.join(worktree, "artifacts"), vault, workAlias, vaultAlias])
		for (const field of ["report", "backupdir"] as const) {
			const args = {
				...argumentsFor(root),
				[field]: path.join(directory, field === "report" ? "report.json" : "backup"),
			};
			assert.throws(() => validateParityPaths(args, [worktree]), `${field}: ${directory}`);
		}
	const target = path.join(root, "real-backup");
	mkdirSync(target);
	const link = path.join(root, "backup-link");
	symlinkSync(target, link, "dir");
	assert.throws(
		() => validateParityPaths({ ...argumentsFor(root, "restore"), backupdir: link }, []),
		"restore must not follow a backup leaf symlink",
	);
});

test("dangling artifact leaf symlinks are not treated as new report files or backup directories", async (t) => {
	const { validateParityPaths } = await library();
	const root = folder(t);
	const args = argumentsFor(root);
	const missingReport = path.join(root, "not-created-report.json");
	symlinkSync(missingReport, args.report, "file");
	assert.equal(existsSync(args.report), false, "existsSync alone cannot distinguish this link from a new path");
	assert.throws(() => validateParityPaths(args, []), "check must reject an existing dangling report leaf");
	const restoreBackup = path.join(root, "restore-backup");
	mkdirSync(restoreBackup);
	assert.throws(
		() => validateParityPaths({ ...args, mode: "restore", backupdir: restoreBackup }, []),
		"restore also needs a genuinely new report path",
	);
	assert.ok(lstatSync(args.report).isSymbolicLink());
	assert.equal(existsSync(missingReport), false);
	rmSync(args.report);
	const missingBackup = path.join(root, "not-created-backup");
	symlinkSync(missingBackup, args.backupdir, "dir");
	assert.equal(existsSync(args.backupdir), false);
	assert.throws(() => validateParityPaths(args, []), "check must reject an existing dangling backup leaf");
	assert.throws(() => validateParityPaths({ ...args, mode: "restore" }, []));
	assert.ok(lstatSync(args.backupdir).isSymbolicLink());
	assert.equal(existsSync(missingBackup), false);
});

function fakeParityVault(t: TestContext) {
	const root = folder(t);
	const vaultPath = path.join(root, "tasks-parity");
	const backupdir = path.join(root, "backup");
	const notes = new Map([
		["Nested/Unicode.md", Buffer.from("\uFEFF# Work\r\n- [ ] Buy tea 🍵\r\nnext\n")],
		["No final EOL.md", Buffer.from("- [ ] Pay")],
	]);
	const originals = new Map([
		...notes,
		[".obsidian/workspace.json", Buffer.from('{"layout":"original"}\n')],
		[".obsidian/community-plugins.json", Buffer.from('["obsidian-tasks-plugin"]\n')],
		[".obsidian/plugins/tasks-calendar-wrapper/main.js", Buffer.from("original TCW bytes\n")],
		[".obsidian/plugins/tasks-calendar-wrapper/cache/binary.dat", Buffer.from([0, 255, 128, 42])],
		[".obsidian/plugins/obsidian-tasks-plugin/main.js", Buffer.from("original Tasks bytes\n")],
		[".obsidian/plugins/obsidian-tasks-plugin/data.json", Buffer.from('{"setDoneDate":false}\n')],
	]);
	for (const [file, bytes] of originals) {
		const target = path.join(vaultPath, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, bytes);
	}
	return { root, vaultPath, backupdir, notes, originals, runtime: { pluginEnabled: false, tasksEnabled: true } };
}

function writeBackupIndex(directory: string, index: Backup): void {
	writeFileSync(path.join(directory, "backup.json"), JSON.stringify(index, null, "\t") + "\n");
}

test("a durable parity backup keeps exact note, configuration and nested plugin bytes and detects an unrestored vault", async (t) => {
	const { backupParityFixture, readParityBackup, verifyParityBackup } = await library();
	const f = fakeParityVault(t);
	const index = backupParityFixture(f.backupdir, f.vaultPath, f.notes, f.runtime);
	assert.equal(index.complete, true);
	assert.equal(index.vaultPath, f.vaultPath);
	assert.deepEqual(index.folders, [
		".obsidian/plugins/tasks-calendar-wrapper",
		".obsidian/plugins/obsidian-tasks-plugin",
	]);
	for (const [file, bytes] of f.originals) {
		assert.equal(index.files[file], createHash("sha256").update(bytes).digest("hex"), file);
		assert.deepEqual(readFileSync(path.join(f.backupdir, "files", file)), bytes, file);
		assert.deepEqual(readFileSync(path.join(f.vaultPath, file)), bytes, "backup must not alter its source");
	}
	assert.equal(index.files[".obsidian/appearance.json"], null, "missing configuration is recorded as absent");
	assert.equal(index.files[".obsidian/app.json"], null);
	assert.deepEqual(readParityBackup(f.backupdir, f.notes), index);
	assert.doesNotThrow(() => verifyParityBackup(index));
	assert.throws(
		() => backupParityFixture(f.backupdir, f.vaultPath, f.notes, f.runtime),
		"existing backup evidence is not overwritten",
	);
	const note = [...f.notes.keys()][0];
	writeFileSync(path.join(f.vaultPath, note), "a later write\n");
	assert.throws(() => verifyParityBackup(index), /restored|byte/i);
	assert.equal(
		readFileSync(path.join(f.vaultPath, note), "utf8"),
		"a later write\n",
		"verification never repairs files itself",
	);
	writeFileSync(path.join(f.vaultPath, note), f.notes.get(note)!);
	const extra = path.join(f.vaultPath, ".obsidian/plugins/tasks-calendar-wrapper/extra.js");
	writeFileSync(extra, "an unbacked file");
	assert.throws(() => verifyParityBackup(index), /file set|file.*changed/i);
	rmSync(extra);
	assert.doesNotThrow(() => verifyParityBackup(index));
});

test("backup loading checks saved bytes and requires every corpus note to retain its original hash", async (t) => {
	const { backupParityFixture, readParityBackup } = await library();
	const f = fakeParityVault(t);
	const index = backupParityFixture(f.backupdir, f.vaultPath, f.notes, f.runtime);
	const note = [...f.notes.keys()][0];
	const saved = path.join(f.backupdir, "files", note);
	writeFileSync(saved, "tampered backup bytes\n");
	assert.throws(() => readParityBackup(f.backupdir, f.notes), /backup bytes|hash|checksum/i);
	writeFileSync(saved, f.notes.get(note)!);
	const missing = structuredClone(index);
	delete missing.files[note];
	writeBackupIndex(f.backupdir, missing);
	assert.throws(() => readParityBackup(f.backupdir, f.notes), /original corpus|missing/i);
	writeBackupIndex(f.backupdir, index);
	const changedCorpus = new Map(f.notes);
	changedCorpus.set(note, Buffer.from("a different expected corpus\n"));
	assert.throws(() => readParityBackup(f.backupdir, changedCorpus), /original corpus|hash/i);
	assert.deepEqual(readParityBackup(f.backupdir, f.notes), index);
});

test("backup loading rejects incomplete metadata, escaped paths, foreign plugin files and aliased backup bytes", async (t) => {
	const { backupParityFixture, readParityBackup } = await library();
	const f = fakeParityVault(t);
	const index = backupParityFixture(f.backupdir, f.vaultPath, f.notes, f.runtime);
	for (const mutate of [
		(i: Backup) => {
			i.schema = 2;
		},
		(i: Backup) => {
			i.complete = false;
		},
		(i: Backup) => {
			i.vault = "another-vault";
		},
		(i: Backup) => {
			i.vaultPath = "relative";
		},
		(i: Backup) => {
			i.folders = [".obsidian/plugins/other-plugin"];
		},
		(i: Backup) => {
			i.runtime.pluginEnabled = true;
		},
		(i: Backup) => {
			i.runtime.tasksEnabled = false;
		},
		(i: Backup) => {
			delete i.files[".obsidian/app.json"];
		},
	]) {
		const changed = structuredClone(index);
		mutate(changed);
		writeBackupIndex(f.backupdir, changed);
		assert.throws(() => readParityBackup(f.backupdir, f.notes), mutate.toString());
	}
	for (const file of [
		path.join(f.root, "outside.md"),
		"../escape.md",
		"Nested/../../escape.md",
		"Nested\\..\\escape.md",
		".obsidian/plugins/tasks-calendar-wrapper/../../escape.md",
		".obsidian/plugins/other-plugin/main.js",
		"untracked.md",
	]) {
		const changed = structuredClone(index);
		changed.files[file] = null;
		writeBackupIndex(f.backupdir, changed);
		assert.throws(() => readParityBackup(f.backupdir, f.notes), /unsafe/i, file);
	}
	writeBackupIndex(f.backupdir, index);
	const note = [...f.notes.keys()][0];
	const saved = path.join(f.backupdir, "files", note);
	const external = path.join(f.root, "aliased-note.md");
	writeFileSync(external, f.notes.get(note)!);
	rmSync(saved);
	symlinkSync(external, saved, "file");
	assert.throws(() => readParityBackup(f.backupdir, f.notes), /backup bytes|symlink|alias/i);
});

test("backup creation refuses note and plugin symlinks without publishing a complete backup index", async (t) => {
	const { backupParityFixture } = await library();
	for (const target of ["note", "plugin"] as const) {
		const f = fakeParityVault(t);
		const file =
			target === "note" ? [...f.notes.keys()][0] : ".obsidian/plugins/tasks-calendar-wrapper/cache/binary.dat";
		const source = path.join(f.vaultPath, file);
		const outside = path.join(f.root, "outside-file");
		writeFileSync(outside, f.originals.get(file)!);
		rmSync(source);
		symlinkSync(outside, source, "file");
		assert.throws(
			() => backupParityFixture(f.backupdir, f.vaultPath, f.notes, f.runtime),
			/symlink|fixture.*path/i,
		);
		assert.equal(
			existsSync(path.join(f.backupdir, "backup.json")),
			false,
			"a rejected source is never published as complete",
		);
		assert.deepEqual(readFileSync(outside), f.originals.get(file));
	}
});
