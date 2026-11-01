/**
 * Checks the write-path tests against `--base <rev>` when PR_LABELS contains "pure-refactor". Only top-level
 * imports and their leading trivia lines may change; assertions and the rest of each file stay byte-identical.
 * The checker, its tests and the CI workflow must also stay byte-identical under that label.
 * `--report` lists the non-import changes without enforcing the label, for the one-time harness move in step 0a.
 * The comparison and label parsing are plain functions so tests/frozentests.test.ts can exercise them in memory.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const FROZEN_FILES = Object.freeze([
	"apps/obsidian-plugin/tests/render.dom.test.ts",
	"apps/obsidian-plugin/tests/render-timeline.dom.test.ts",
	"apps/obsidian-plugin/tests/views.test.ts",
	"apps/obsidian-plugin/tests/rowmenu.test.ts",
	"apps/obsidian-plugin/tests/datemodal.test.ts",
	"apps/obsidian-plugin/tests/notices*.test.ts",
]);

const GUARD_FILES = Object.freeze([
	"apps/obsidian-plugin/scripts/frozen-tests.mjs",
	"apps/obsidian-plugin/tests/frozentests.test.ts",
	".github/workflows/ci.yml",
]);

const patterns = FROZEN_FILES.map(
	(file) =>
		new RegExp(
			`^${file
				.split("*")
				.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join("[^/]*")}$`,
		),
);
const isFrozen = (file) => patterns.some((pattern) => pattern.test(file));

/** Remove imports, keeping original line numbers and line endings for the remaining bytes. */
export function stripImports(source) {
	const parsed = ts.createSourceFile("frozen.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const ranges = parsed.statements.filter(ts.isImportDeclaration).map((statement) => {
		let start = statement.getFullStart();
		const lineStart = source.lastIndexOf("\n", start - 1) + 1;
		// The previous statement's newline and trailing comment belong to that statement, not this import.
		if (/\S/.test(source.slice(lineStart, start))) {
			for (const comment of ts.getTrailingCommentRanges(source, start) ?? []) start = comment.end;
			const newline = source.indexOf("\n", start);
			if (newline !== -1 && newline < statement.getStart(parsed)) start = newline + 1;
		}
		let end = statement.getEnd();
		const newline = source.indexOf("\n", end);
		const lineEnd = newline === -1 ? source.length : newline + 1;
		if (/^[\t \r\n]*$/.test(source.slice(end, lineEnd))) end = lineEnd;
		return { start, end };
	});
	const chunks = [];
	let offset = 0;
	for (const { start, end } of ranges) {
		if (start > offset) chunks.push({ start: offset, text: source.slice(offset, start) });
		offset = Math.max(offset, end);
	}
	if (offset < source.length) chunks.push({ start: offset, text: source.slice(offset) });
	const lines = [];
	for (const chunk of chunks) {
		for (const match of chunk.text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
			const previous = lines.at(-1);
			if (previous && !previous.text.endsWith("\n")) previous.text += match[0];
			else
				lines.push({
					number: parsed.getLineAndCharacterOfPosition(chunk.start + match.index).line + 1,
					text: match[0],
				});
		}
	}
	return { text: chunks.map((chunk) => chunk.text).join(""), lines };
}

/** A line diff over the retained bytes, with line numbers from each unstripped source. */
function changedLines(before, after) {
	const lengths = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
	for (let i = before.length - 1; i >= 0; i--)
		for (let j = after.length - 1; j >= 0; j--)
			lengths[i][j] =
				before[i].text === after[j].text
					? lengths[i + 1][j + 1] + 1
					: Math.max(lengths[i + 1][j], lengths[i][j + 1]);
	const changes = [];
	let i = 0;
	let j = 0;
	while (i < before.length || j < after.length) {
		if (i < before.length && j < after.length && before[i].text === after[j].text) {
			i++;
			j++;
		} else if (i < before.length && (j === after.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
			changes.push({ side: "base", line: before[i].number, text: before[i++].text });
		} else {
			changes.push({ side: "current", line: after[j].number, text: after[j++].text });
		}
	}
	return changes;
}

/** Resolve the frozen set on both sides, including newly added or deleted notices*.test.ts files. */
export function compareFrozenFiles(base, current) {
	const files = [...new Set([...Object.keys(base), ...Object.keys(current)])].filter(isFrozen).sort();
	const differences = [];
	for (const file of files) {
		const before = stripImports(base[file] ?? "");
		const after = stripImports(current[file] ?? "");
		if (base[file] !== undefined && current[file] !== undefined && before.text === after.text) continue;
		differences.push({
			path: file,
			deleted: current[file] === undefined,
			changes: changedLines(before.lines, after.lines),
		});
	}
	return differences;
}

/** Guard the check itself without allowing even import-only changes. */
export function compareGuardFiles(base, current) {
	return GUARD_FILES.filter((file) => {
		const before = base[file];
		const after = current[file];
		if (before === undefined || after === undefined) return before !== after;
		return !Buffer.from(before).equals(Buffer.from(after));
	}).map((file) => ({ path: file, deleted: current[file] === undefined }));
}

export function formatChanges(differences) {
	return differences
		.map(({ path: file, deleted, changes }) =>
			[
				`${file}${deleted ? " (deleted or renamed)" : ""}`,
				...changes.map(
					({ side, line, text }) =>
						`${side === "base" ? "-" : "+"} ${side}:${line} ${text.replace(/\r?\n$/, "")}${text.endsWith("\n") ? "" : " [no newline]"}`,
				),
			].join("\n"),
		)
		.join("\n");
}

/** Missing labels are allowed outside pull requests; malformed labels are never treated as an empty list. */
export function parseLabels(raw, eventName) {
	const fix =
		'Set PR_LABELS to a JSON array of label names (for example [] or ["pure-refactor"]); in CI use toJSON(github.event.pull_request.labels.*.name).';
	if (raw === undefined) {
		if (eventName === "pull_request") throw new Error(`PR_LABELS is missing on a pull request. ${fix}`);
		return [];
	}
	let labels;
	try {
		labels = JSON.parse(raw);
	} catch {
		throw new Error(`PR_LABELS is invalid JSON. ${fix}`);
	}
	if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string"))
		throw new Error(`PR_LABELS must be a JSON array of strings. ${fix}`);
	return labels;
}

function run(args) {
	let base;
	let report = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--report") report = true;
		else if (args[i] === "--base" && !base && args[i + 1] && !args[i + 1].startsWith("--")) base = args[++i];
		else throw new Error("Use --base <rev> (required) and optionally --report.");
	}
	if (!base) throw new Error("--base <rev> is required; pass a readable base revision, such as --base HEAD^1 in CI.");
	const labels = report ? [] : parseLabels(process.env.PR_LABELS, process.env.GITHUB_EVENT_NAME);
	const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	let commit;
	try {
		commit = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
	} catch {
		throw new Error(
			`Cannot read base revision ${JSON.stringify(base)}. Fetch the base (CI checkout needs fetch-depth: 2) or pass an available revision with --base <rev>.`,
		);
	}
	if (!report && !labels.includes("pure-refactor")) {
		console.log("pure-refactor label not set: frozen tests not checked");
		return 0;
	}
	const root = git("rev-parse", "--show-toplevel").trim();
	const trackedFiles = git("ls-tree", "-r", "--name-only", "-z", commit).split("\0");
	const oldFiles = trackedFiles.filter(isFrozen);
	const newFiles = [];
	for (const directory of new Set(FROZEN_FILES.map((file) => path.posix.dirname(file)))) {
		try {
			for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
				const file = `${directory}/${entry.name}`;
				if (isFrozen(file) && !entry.isDirectory()) newFiles.push(file);
			}
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	const before = Object.fromEntries(oldFiles.map((file) => [file, git("show", `${commit}:${file}`)]));
	const after = Object.fromEntries(newFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
	const differences = compareFrozenFiles(before, after);
	console.log(differences.length ? formatChanges(differences) : "Frozen tests have no non-import changes");
	if (report) return 0;
	const guardBefore = Object.fromEntries(
		GUARD_FILES.filter((file) => trackedFiles.includes(file)).map((file) => [
			file,
			execFileSync("git", ["show", `${commit}:${file}`], { stdio: ["ignore", "pipe", "pipe"] }),
		]),
	);
	const guardAfter = Object.fromEntries(
		GUARD_FILES.flatMap((file) => {
			try {
				return [[file, readFileSync(path.join(root, file))]];
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				return [];
			}
		}),
	);
	const guardDifferences = compareGuardFiles(guardBefore, guardAfter);
	for (const { path: file, deleted } of guardDifferences)
		console.error(`Frozen test guard changed: ${file}${deleted ? " (deleted or renamed)" : ""}`);
	return differences.length === 0 && guardDifferences.length === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		console.error(`frozen tests: ${error.message}`);
		process.exitCode = 1;
	}
}
