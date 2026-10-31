import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { BENCH_TARGETS, benchVaultName, benchVaultNotes, scaleOf, withoutScale } from "../scripts/bench-notes.mjs";

// scripts/bench-notes.mjs generates the vaults `pnpm bench` measures. The user generates each once and keeps it open in
// Obsidian, and its baseline was measured in it, so the notes must not change by accident.

const fingerprint = (notes: Map<string, string>) => {
	const hash = createHash("sha256");
	for (const [path, content] of notes) hash.update(`${path}\0${content}\0`);
	return hash.digest("hex");
};
const taskCount = (notes: Map<string, string>) =>
	[...notes.values()].reduce((sum, text) => sum + (text.match(/^\s*[-*+] \[.\]/gm)?.length ?? 0), 0);

const vault = benchVaultNotes(1);
const large = benchVaultNotes(10);

test("the 4,000-task vault is the one bench-vault was generated from", () => {
	assert.equal(vault.size, 2000);
	assert.equal(taskCount(vault), 4000);
	assert.equal(fingerprint(vault), "b475e27935ad6910a1967f0b594cec7f70c234d9ae4327e56022edde229d172a");
	assert.equal(fingerprint(benchVaultNotes()), fingerprint(vault));
});

test("the 40,000-task vault is that vault and nine more sets of notes in folders of their own", () => {
	assert.equal(large.size, 20000);
	assert.equal(taskCount(large), 40000);
	assert.equal(fingerprint(large), "86399c72b50665719ab6494d8ff8879d5cb73005806b45386174ff27038bf37c");
	assert.deepEqual([...large].slice(0, vault.size), [...vault]);
	for (let set = 2; set <= 10; set++) {
		const folder = `Copy ${String(set).padStart(2, "0")}/`;
		const notes = [...large.keys()].filter((path) => path.startsWith(folder));
		assert.equal(notes.length, 2000, folder);
	}
});

test("each set of the large vault has its own dates", () => {
	const projects = [...vault.keys()].filter((path) => path.startsWith("Projects/"));
	const copy = (set: number, path: string) => large.get(`Copy ${String(set).padStart(2, "0")}/${path}`);
	// A project's dates all follow from one day, so its first date stands for them. Days drawn independently from 943
	// match about once in 943; the tags and texts would differ anyway.
	const day = (text?: string) => text?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
	const dated = projects.filter((path) => day(vault.get(path)) !== undefined);
	assert.ok(dated.length > 1000, `${dated.length} projects have dates`);
	for (let set = 2; set <= 10; set++) {
		const sameDay = dated.filter((path) => day(copy(set, path)) === day(vault.get(path))).length;
		assert.ok(
			sameDay < dated.length / 20,
			`${sameDay} of ${dated.length} projects of set ${set} have the same day`,
		);
	}
	// The daily notes of each set are a day later than those of the set before.
	assert.ok(vault.has("Daily/2024/2024, September 01 - Sunday.md"));
	assert.ok(large.has("Copy 02/Daily/2024/2024, September 02 - Monday.md"));
	assert.ok(large.has("Copy 10/Daily/2024/2024, September 10 - Tuesday.md"));
	// The plain notes have no dates, so they are the same in every set.
	assert.equal(copy(5, "Reference/Note 0001.md"), vault.get("Reference/Note 0001.md"));
});

test("the notes the benchmark saves are in both vaults, at the same paths", () => {
	for (const target of Object.values(BENCH_TARGETS)) {
		assert.ok(vault.has(target), target);
		assert.equal(large.get(target), vault.get(target), target);
	}
	assert.match(vault.get(BENCH_TARGETS.withTasks) ?? "", /^- \[ \] Task \d{4} a/m);
	assert.doesNotMatch(vault.get(BENCH_TARGETS.withoutTasks) ?? "", /^\s*[-*+] \[.\]/m);
});

test("the toggle target is an existing LF note separate from the save targets", () => {
	assert.equal(BENCH_TARGETS.toggle, "Reference/Note 0002.md");
	assert.ok(vault.has(BENCH_TARGETS.toggle));
	assert.equal(large.get(BENCH_TARGETS.toggle), vault.get(BENCH_TARGETS.toggle));
	assert.doesNotMatch(vault.get(BENCH_TARGETS.toggle) ?? "", /\r/);
	assert.notEqual(BENCH_TARGETS.toggle, BENCH_TARGETS.withTasks);
	assert.notEqual(BENCH_TARGETS.toggle, BENCH_TARGETS.withoutTasks);
});

test("only whole scales from 1 generate a vault", () => {
	for (const scale of [0, -1, 1.5, Number.NaN]) assert.throws(() => benchVaultNotes(scale), /whole number/);
});

test("each vault is named after its scale, as its folder and baseline file are", () => {
	assert.equal(benchVaultName(1), "bench-vault");
	assert.equal(benchVaultName(10), "bench-vault-x10");
});

test("--scale takes 1 or 10, written with a space or an equals sign", () => {
	assert.equal(scaleOf([]), 1);
	assert.equal(scaleOf(["folder"]), 1);
	assert.equal(scaleOf(["folder", "--scale", "10"]), 10);
	assert.equal(scaleOf(["--scale=10", "folder"]), 10);
	assert.equal(scaleOf(["--update", "--scale", "1"]), 1);
	assert.throws(() => scaleOf(["--scale", "3"]), /one of 1, 10, got "3"/);
	assert.throws(() => scaleOf(["--scale"]), /one of 1, 10, got undefined/);
	assert.throws(() => scaleOf(["--scale=ten"]), /got "ten"/);
});

test("the other arguments are left when --scale and its value are taken out", () => {
	assert.deepEqual(withoutScale(["folder"]), ["folder"]);
	assert.deepEqual(withoutScale(["folder", "--scale", "10"]), ["folder"]);
	assert.deepEqual(withoutScale(["--scale", "10", "--update"]), ["--update"]);
	assert.deepEqual(withoutScale(["--scale=10", "--update"]), ["--update"]);
});
