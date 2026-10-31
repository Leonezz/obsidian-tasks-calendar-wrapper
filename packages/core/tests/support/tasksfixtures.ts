import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface NoteDiff {
	readonly prefix: number;
	readonly suffix: number;
	readonly text: string;
}

export interface TasksToggleCase {
	readonly path: string;
	readonly line: number;
	readonly sourceLine: string;
	readonly kind: string;
	readonly recurring: boolean;
	readonly lineEnding: "lf" | "crlf" | "mixed";
	readonly api: string;
	readonly after: NoteDiff;
}

export interface TasksToggleFixture {
	readonly format: 1;
	readonly group: string;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly tasksVersion: string;
	readonly obsidianVersion: string;
	readonly timeZone: string;
	readonly momentLocale: string;
	readonly day: string;
	readonly notes: Readonly<Record<string, string>>;
	readonly cases: readonly TasksToggleCase[];
}

export const TASKS_TOGGLE_GROUPS = [
	"default",
	"dataview",
	"next-line",
	"remove-scheduled",
	"no-done-cancelled-dates",
	"created-date",
	"global-filter",
	"custom-statuses",
] as const;

export function applyNoteDiff(before: string, diff: NoteDiff): string {
	return before.slice(0, diff.prefix) + diff.text + before.slice(before.length - diff.suffix);
}

function missing(what: string): Error {
	return new Error(
		`fixtures/tasks-toggle is missing ${what}: run \`pnpm capture:tasks-toggle\` with the tasks-parity vault open in Obsidian (see apps/obsidian-plugin/scripts/capture-tasks-toggle.mjs).`,
	);
}

function repositoryRoot(): string {
	// The runner bundles these tests into a temporary folder, so their source paths cannot locate the fixtures.
	const usual = path.resolve(process.cwd(), "../..");
	if (existsSync(path.join(usual, "pnpm-workspace.yaml"))) return usual;
	for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
		if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
		if (path.dirname(dir) === dir) throw missing("the repository root (pnpm-workspace.yaml)");
	}
}

export function loadTasksToggleFixtures(): ReadonlyMap<string, TasksToggleFixture> {
	const folder = path.join(repositoryRoot(), "fixtures", "tasks-toggle");
	if (!existsSync(folder)) throw missing("the folder");
	const fixtures = new Map<string, TasksToggleFixture>();
	for (const group of TASKS_TOGGLE_GROUPS) {
		const name = `${group}.json`;
		const file = path.join(folder, name);
		if (!existsSync(file)) throw missing(name);
		const fixture = JSON.parse(readFileSync(file, "utf8")) as TasksToggleFixture | null;
		if (fixture?.format !== 1) throw missing(`format 1 in ${name}`);
		fixtures.set(group, fixture);
	}
	return fixtures;
}
