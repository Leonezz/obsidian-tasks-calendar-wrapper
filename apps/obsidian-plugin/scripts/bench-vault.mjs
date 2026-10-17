/**
 * Generates the benchmark vault: 2,000 notes with 4,000 tasks in the formats of fixtures/golden-vault (emoji dates,
 * dataview fields, daily notes, nested tasks, CRLF notes), placed around 2026-01-15, the "today" the benchmark pins.
 * The notes are the same on every run, so `pnpm bench` can check that the vault it measures is this one.
 *
 * Run `pnpm bench:vault <folder>`, with a folder named bench-vault that is empty or was made by this script,
 * e.g. ~/Documents/projects/tcw-fixtures/bench-vault. Then open that folder in Obsidian once ("Open folder as vault").
 * The notes are not committed: this script is their source.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { markdownFiles } from "./fixture-app.mjs";

export const BENCH_VAULT_NAME = "bench-vault";
/** Marks a folder as made by this script, so it is the only kind of folder the script writes into besides empty ones. */
const MARKER = ".bench-vault";

const DAILY_NOTES = 400;
const PROJECT_NOTES = 1400;
const PLAIN_NOTES = 200;
const EXPECTED_TASKS = 4000;
/** The dates span 943 days, like the vault the 0.3.7 numbers were measured in, from 2024-09-01 to 2027-03-31. */
const FIRST_DAY = Date.UTC(2024, 8, 1);
const DAYS = 943;
const DAY_MS = 86_400_000;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AREAS = ["Work", "Home", "Health", "Finance", "Garden", "Travel", "Reading", "Music", "Learning", "Errands"];
const TAGS = ["#work", "#home", "#urgent", "#later", "#idea", "#errand", "#call", "#writing"];

/** The notes `pnpm bench` saves: the first task of one note gets a new text, the other note has no tasks. */
export const BENCH_TARGETS = {
	withTasks: "Projects/Work/Project 0010.md",
	withoutTasks: "Reference/Note 0001.md",
};

/** mulberry32: a small seeded generator, so the vault is the same on every machine. */
function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pad = (n, width = 2) => String(n).padStart(width, "0");
const isoDay = ms => {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
/** The plugin's default daily note format, "YYYY, MMMM DD - dddd". */
const dailyTitle = ms => {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}, ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} - ${WEEKDAYS[d.getUTCDay()]}`;
};

function projectTasks(id, kind, day, pick) {
	const d = offset => isoDay(day + offset * DAY_MS);
	const tag = pick(TAGS);
	switch (kind) {
		case 0: return [`- [ ] Task ${id} a 📅 ${d(0)}`, `- [ ] Task ${id} b ⏳ ${d(-2)} 📅 ${d(3)} ${tag}`];
		case 1: return [`- [ ] Task ${id} a [due:: ${d(0)}]`, `- [ ] Task ${id} b [scheduled:: ${d(2)}] [start:: ${d(-1)}]`];
		case 2: return [`- [ ] Task ${id} a 🛫 ${d(-3)} 📅 ${d(0)}`, `    - [ ] Task ${id} b ⏳ ${d(1)} ${tag}`];
		case 3: return [`- [x] Task ${id} a 📅 ${d(0)} ✅ ${d(0)}`, `- [-] Task ${id} b 📅 ${d(4)}`];
		case 4: return [`- [ ] Task ${id} a ⏫ 🔁 every week 📅 ${d(0)}`, `- [ ] Task ${id} b 🔽 ➕ ${d(-7)} ⏳ ${d(2)}`];
		case 5: return [`- [ ] Task ${id} a ${tag}`, `- [ ] Task ${id} b 🔼 #someday`];
		case 6: return [`- [ ] 09:30 Task ${id} a 📅 ${d(0)}`, `- [x] Task ${id} b [completion:: ${d(1)}] [due:: ${d(1)}]`];
		default: return [`- [ ] Task ${id} a 📅 ${d(0)} [scheduled:: ${d(-1)}]`, `\t- [ ] Task ${id} b 📅 ${d(5)} ${tag}`];
	}
}

function projectNote(i, pick, day) {
	const id = pad(i, 4);
	const area = AREAS[i % AREAS.length];
	const frontmatter = i % 3 === 0 ? `---\narea: ${area}\ntags:\n  - project\n---\n` : "";
	const lines = [
		`${frontmatter}# Project ${id}`,
		"",
		`Notes about project ${id}, see [[Project ${pad((i % PROJECT_NOTES) + 1, 4)}]].`,
		"",
		"## Tasks",
		"",
		...projectTasks(id, i % 8, day, pick),
		"",
		"## Log",
		"",
		`- met about ${pick(TAGS).slice(1)}`,
		`- wrote ${(i * 37) % 900 + 100} words`,
		"",
	];
	return { path: `Projects/${area}/Project ${id}.md`, lines };
}

function dailyNote(j, day) {
	const id = pad(j, 3);
	const lines = [
		`# ${dailyTitle(day)}`,
		"",
		"Morning pages.",
		"",
		"## Tasks",
		`- [ ] Daily task ${id} a`,
		`- [x] Daily task ${id} b ✅ ${isoDay(day)}`,
		`- [ ] Daily task ${id} c 📅 ${isoDay(day + 3 * DAY_MS)} #work`,
		"",
	];
	const year = new Date(day).getUTCFullYear();
	return { path: `Daily/${year}/${dailyTitle(day)}.md`, lines };
}

function plainNote(k) {
	const id = pad(k, 4);
	const lines = [
		`# Note ${id}`,
		"",
		`Reference material, see [[Project ${pad(k * 7, 4)}]].`,
		"",
		"- a plain list item",
		"- another item",
		"    - a nested plain item",
		"",
		"## Section",
		"",
		"More text without any tasks.",
		"",
	];
	return { path: `Reference/Note ${id}.md`, lines };
}

/** All notes of the vault, as a map from the path in the vault to the content. */
export function benchVaultNotes() {
	const pick = (() => {
		const next = random(4000);
		return list => list[Math.floor(next() * list.length)];
	})();
	const days = random(943);
	const notes = [];
	for (let j = 0; j < DAILY_NOTES; j++) notes.push(dailyNote(j + 1, FIRST_DAY + Math.floor(j * DAYS / DAILY_NOTES) * DAY_MS));
	for (let i = 1; i <= PROJECT_NOTES; i++) notes.push(projectNote(i, pick, FIRST_DAY + Math.floor(days() * DAYS) * DAY_MS));
	for (let k = 1; k <= PLAIN_NOTES; k++) notes.push(plainNote(k));
	// Every seventh note uses Windows line endings, like fixtures/golden-vault/CRLF note.md.
	const files = new Map(notes.map((note, n) => [note.path, note.lines.join(n % 7 === 3 ? "\r\n" : "\n")]));

	const tasks = [...files.values()].reduce((sum, text) => sum + (text.match(/^\s*([-*+]|\d+[.)]) \[.\]/gm)?.length ?? 0), 0);
	if (files.size !== DAILY_NOTES + PROJECT_NOTES + PLAIN_NOTES || tasks !== EXPECTED_TASKS) {
		throw new Error(`bench-vault: generated ${files.size} notes with ${tasks} tasks; expected ${DAILY_NOTES + PROJECT_NOTES + PLAIN_NOTES} notes with ${EXPECTED_TASKS}.`);
	}
	for (const target of Object.values(BENCH_TARGETS)) {
		if (!files.has(target)) throw new Error(`bench-vault: the benchmark's note ${target} is not generated.`);
	}
	return files;
}

function writeVault(target) {
	// pnpm runs the script in the package folder; a relative folder means one relative to where pnpm was started.
	const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), target);
	if (path.basename(dir) !== BENCH_VAULT_NAME) {
		throw new Error(`the folder must be named ${BENCH_VAULT_NAME}, which is the vault name pnpm bench looks for; got ${dir}.`);
	}
	const notes = benchVaultNotes();
	if (existsSync(dir)) {
		const entries = readdirSync(dir).filter(name => name !== ".obsidian" && name !== ".DS_Store");
		if (entries.length > 0 && !existsSync(path.join(dir, MARKER))) {
			throw new Error(`${dir} is not empty and was not made by this script. Pick an empty folder.`);
		}
		const extra = markdownFiles(dir).filter(file => !notes.has(file));
		if (extra.length > 0) throw new Error(`${dir} has notes the benchmark vault does not have; remove them first: ${JSON.stringify(extra.slice(0, 10))}`);
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, MARKER), "Made by apps/obsidian-plugin/scripts/bench-vault.mjs.\n");
	let written = 0;
	for (const [file, content] of notes) {
		const full = path.join(dir, file);
		if (existsSync(full) && readFileSync(full, "utf8") === content) continue;
		mkdirSync(path.dirname(full), { recursive: true });
		writeFileSync(full, content);
		written++;
	}
	return { dir, notes: notes.size, written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const target = process.argv[2];
	if (!target) {
		console.error(`usage: pnpm bench:vault <folder named ${BENCH_VAULT_NAME}>`);
		process.exit(1);
	}
	try {
		const { dir, notes, written } = writeVault(target);
		console.log(`bench-vault: ${dir} has the ${notes} notes of the benchmark vault (${written} written). Open it in Obsidian once with "Open folder as vault".`);
	} catch (error) {
		console.error(`bench-vault: ${error.message}`);
		process.exit(1);
	}
}
