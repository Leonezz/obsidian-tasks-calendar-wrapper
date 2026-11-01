/**
 * The notes of the benchmark vault, generated: 2,000 notes with 4,000 tasks in the formats of fixtures/golden-vault (emoji
 * dates, dataview fields, daily notes, nested tasks, CRLF notes), placed around 2026-01-15, the "today" the benchmark
 * pins. They are the same on every run, so `pnpm bench` can check that the vault it measures is this one. At scale 10,
 * the large vault bench-vault-x10: these notes, and nine more sets of them in the folders "Copy 02" to "Copy 10", each
 * with its own dates, 20,000 notes with 40,000 tasks in all. scripts/bench-vault.mjs writes them into a folder; this
 * module only computes them, so tests/benchvault.test.ts can check them.
 */
/** The name of the vault at a scale, which is also the name of its folder and of its baseline file. */
export const benchVaultName = (scale) => (scale === 1 ? "bench-vault" : `bench-vault-x${scale}`);
/** The scales `pnpm bench` has a baseline for: the 4,000-task vault and the 40,000-task one. */
export const BENCH_SCALES = [1, 10];

const DAILY_NOTES = 400;
const PROJECT_NOTES = 1400;
const PLAIN_NOTES = 200;
const EXPECTED_TASKS = 4000;
/** The dates span 943 days, like the vault the 0.3.7 numbers were measured in, from 2024-09-01 to 2027-03-31. */
const FIRST_DAY = Date.UTC(2024, 8, 1);
const DAYS = 943;
const DAY_MS = 86_400_000;

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AREAS = ["Work", "Home", "Health", "Finance", "Garden", "Travel", "Reading", "Music", "Learning", "Errands"];
const TAGS = ["#work", "#home", "#urgent", "#later", "#idea", "#errand", "#call", "#writing"];

/** The notes `pnpm bench` saves; toggle temporarily adds five same-day tasks to its own note. */
export const BENCH_TARGETS = {
	withTasks: "Projects/Learning/Project 0228.md",
	withoutTasks: "Reference/Note 0001.md",
	toggle: "Reference/Note 0002.md",
};

/** The task line edited by saveWithTasks, identified by its vault path and zero-based line. */
export const SAVE_MARKER = Object.freeze({ path: BENCH_TARGETS.withTasks, line: 12, text: "Task 0228 b" });

/** Inserts a save token after the marker's task text while preserving every other byte of the note. */
export function withSaveToken(original, token) {
	const lines = original.split("\n");
	const task = `- [ ] ${SAVE_MARKER.text}`;
	const line = lines[SAVE_MARKER.line];
	if (!line?.startsWith(task) || (line.length > task.length && !/\s/.test(line[task.length])))
		throw new Error(`${SAVE_MARKER.path} has no "${task}" task to edit.`);
	lines[SAVE_MARKER.line] = `${task} ${token}${line.slice(task.length)}`;
	return lines.join("\n");
}

/** mulberry32: a small seeded generator, so the vault is the same on every machine. */
export function random(seed) {
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
const isoDay = (ms) => {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
/** The plugin's default daily note format, "YYYY, MMMM DD - dddd". */
const dailyTitle = (ms) => {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}, ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} - ${WEEKDAYS[d.getUTCDay()]}`;
};

function projectTasks(id, kind, day, pick) {
	const d = (offset) => isoDay(day + offset * DAY_MS);
	const tag = pick(TAGS);
	switch (kind) {
		case 0:
			return [`- [ ] Task ${id} a 📅 ${d(0)}`, `- [ ] Task ${id} b ⏳ ${d(-2)} 📅 ${d(3)} ${tag}`];
		case 1:
			return [
				`- [ ] Task ${id} a [due:: ${d(0)}]`,
				`- [ ] Task ${id} b [scheduled:: ${d(2)}] [start:: ${d(-1)}]`,
			];
		case 2:
			return [`- [ ] Task ${id} a 🛫 ${d(-3)} 📅 ${d(0)}`, `    - [ ] Task ${id} b ⏳ ${d(1)} ${tag}`];
		case 3:
			return [`- [x] Task ${id} a 📅 ${d(0)} ✅ ${d(0)}`, `- [-] Task ${id} b 📅 ${d(4)}`];
		case 4:
			return [`- [ ] Task ${id} a ⏫ 🔁 every week 📅 ${d(0)}`, `- [ ] Task ${id} b 🔽 ➕ ${d(-7)} ⏳ ${d(2)}`];
		case 5:
			return [`- [ ] Task ${id} a ${tag}`, `- [ ] Task ${id} b 🔼 #someday`];
		case 6:
			return [`- [ ] 09:30 Task ${id} a 📅 ${d(0)}`, `- [x] Task ${id} b [completion:: ${d(1)}] [due:: ${d(1)}]`];
		default:
			return [`- [ ] Task ${id} a 📅 ${d(0)} [scheduled:: ${d(-1)}]`, `\t- [ ] Task ${id} b 📅 ${d(5)} ${tag}`];
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
		`- wrote ${((i * 37) % 900) + 100} words`,
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

/**
 * One set of the vault's notes, as [path, content] pairs. The first set is the 4,000-task vault; each later one has
 * other dates for its projects, its daily notes a day later than the set before, and its own folder.
 */
function noteSet(set) {
	const pick = (() => {
		const next = random(4000 + set);
		return (list) => list[Math.floor(next() * list.length)];
	})();
	const days = random(943 + set);
	const folder = set === 0 ? "" : `Copy ${pad(set + 1)}/`;
	const notes = [];
	for (let j = 0; j < DAILY_NOTES; j++)
		notes.push(dailyNote(j + 1, FIRST_DAY + (Math.floor((j * DAYS) / DAILY_NOTES) + set) * DAY_MS));
	for (let i = 1; i <= PROJECT_NOTES; i++)
		notes.push(projectNote(i, pick, FIRST_DAY + Math.floor(days() * DAYS) * DAY_MS));
	for (let k = 1; k <= PLAIN_NOTES; k++) notes.push(plainNote(k));
	// Every seventh note uses Windows line endings, like fixtures/golden-vault/CRLF note.md.
	return notes.map((note, n) => [folder + note.path, note.lines.join(n % 7 === 3 ? "\r\n" : "\n")]);
}

/** All notes of the vault at a scale, as a map from the path in the vault to the content. */
export function benchVaultNotes(scale = 1) {
	if (!Number.isInteger(scale) || scale < 1)
		throw new Error(`bench-vault: the scale must be a whole number from 1, got ${scale}.`);
	const files = new Map(Array.from({ length: scale }, (_, set) => noteSet(set)).flat());

	const tasks = [...files.values()].reduce(
		(sum, text) => sum + (text.match(/^\s*([-*+]|\d+[.)]) \[.\]/gm)?.length ?? 0),
		0,
	);
	const expectedNotes = (DAILY_NOTES + PROJECT_NOTES + PLAIN_NOTES) * scale;
	if (files.size !== expectedNotes || tasks !== EXPECTED_TASKS * scale) {
		throw new Error(
			`bench-vault: generated ${files.size} notes with ${tasks} tasks; expected ${expectedNotes} notes with ${EXPECTED_TASKS * scale}.`,
		);
	}
	for (const target of Object.values(BENCH_TARGETS)) {
		if (!files.has(target)) throw new Error(`bench-vault: the benchmark's note ${target} is not generated.`);
	}
	return files;
}

/** The scale of `--scale N` or `--scale=N` among the arguments, 1 without it; only the scales with a baseline. */
export function scaleOf(args) {
	const at = args.findIndex((arg) => arg === "--scale" || arg.startsWith("--scale="));
	if (at === -1) return 1;
	const value = args[at].includes("=") ? args[at].slice("--scale=".length) : args[at + 1];
	const scale = Number(value);
	if (!BENCH_SCALES.includes(scale))
		throw new Error(`--scale must be one of ${BENCH_SCALES.join(", ")}, got ${JSON.stringify(value)}.`);
	return scale;
}

/** The arguments without `--scale` and its value. */
export function withoutScale(args) {
	const at = args.findIndex((arg) => arg === "--scale" || arg.startsWith("--scale="));
	if (at === -1) return args;
	return args.filter((_, i) => i !== at && !(i === at + 1 && args[at] === "--scale"));
}
