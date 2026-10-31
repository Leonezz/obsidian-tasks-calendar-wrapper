/**
 * The notes whose task lines will be toggled in Tasks 8.6.0. Golden notes retain their original bytes; generated
 * notes exercise the serializers, statuses, recurrence rules and byte layouts the capture needs. Keep notes small:
 * the capture saves the whole note after each toggle, and its fingerprint fixes this corpus once it is captured.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { markdownFiles, repoRoot } from "./fixture-app.mjs";

export const TASKS_PARITY_VAULT = "tasks-parity";
export const GENERATED_FOLDER = "Parity";
export const ENCODING_NOTES = ["Parity/Encoding/GBK.md", "Parity/Encoding/Latin-1.md", "Parity/Encoding/Shift-JIS.md"];

// Tasks' recurrence tests cover the monthly ordinals and "February the 29th". Other spellings deliberately include
// parser disagreements and invalid rules: the capture records what Tasks does, rather than presuming acceptance.
export const RECURRENCE_RULES = [
	{ id: "every-day", rule: "every day" },
	{ id: "every-2-days", rule: "every 2 days" },
	{ id: "every-3-days", rule: "every 3 days" },
	{ id: "every-weekday", rule: "every weekday" },
	{ id: "every-week", rule: "every week" },
	{ id: "every-2-weeks", rule: "every 2 weeks" },
	{ id: "every-3-weeks", rule: "every 3 weeks" },
	{ id: "every-week-monday", rule: "every week on Monday" },
	{ id: "every-week-tuesday-friday", rule: "every week on Tuesday, Friday" },
	{ id: "every-week-sunday", rule: "every week on Sunday" },
	{ id: "every-month", rule: "every month" },
	{ id: "every-2-months", rule: "every 2 months" },
	{ id: "every-3-months", rule: "every 3 months" },
	{ id: "every-6-months", rule: "every 6 months" },
	{ id: "every-month-1st", rule: "every month on the 1st" },
	{ id: "every-month-15th", rule: "every month on the 15th" },
	{ id: "every-month-31st", rule: "every month on the 31st" },
	{ id: "every-month-last-day", rule: "every month on the last day" },
	{ id: "every-month-last-friday", rule: "every month on the last Friday" },
	{ id: "every-month-2nd-wednesday", rule: "every month on the 2nd Wednesday" },
	{ id: "every-year", rule: "every year" },
	{ id: "every-2-years", rule: "every 2 years" },
	{ id: "every-3-years", rule: "every 3 years" },
	{ id: "every-year-february-29", rule: "every year on February 29" },
	{ id: "every-year-february-the-29th", rule: "every year on February the 29th" },
	{ id: "every-january-31", rule: "every January 31" },
	{ id: "every-february-28", rule: "every February 28" },
	{ id: "every-april-30", rule: "every April 30" },
	{ id: "every-october-31", rule: "every October 31" },
	{ id: "every-day-when-done", rule: "every day when done" },
	{ id: "every-week-when-done", rule: "every week when done" },
	{ id: "every-month-when-done", rule: "every month when done" },
	{ id: "every-year-when-done", rule: "every year when done" },
	{ id: "every-2-days-when-done", rule: "every 2 days when done" },
	{ id: "every-2-weeks-when-done", rule: "every 2 weeks when done" },
	{ id: "every-3-months-when-done", rule: "every 3 months when done" },
	{ id: "every-2-years-when-done", rule: "every 2 years when done" },
	{ id: "every-blue-moon", rule: "every blue moon" },
	{ id: "fortnightly-ish", rule: "fortnightly-ish" },
	{ id: "mixed-case-week", rule: "Every Week" },
	{ id: "uppercase-day", rule: "EVERY DAY" },
	{ id: "every-monday", rule: "every Monday" },
];

export const GENERATED_KINDS = [
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

const taskRegex = /^([\s\t>]*)([-*+]|[0-9]+[.)]) +\[(.)\] *(.*)/u;
const days = ["2026-10-31", "2026-11-01", "2026-11-02"];
const entry = (kind, text) => ({ kind, text });
const numbered = (n) => String(n).padStart(2, "0");

function syntaxLines() {
	const lines = [];
	const add = (kind, variants) => variants.forEach((text) => lines.push(entry(kind, text)));
	for (let i = 0; i < 6; i++) {
		const date = days[i % days.length];
		const name = `sample ${i + 1}`;
		add("field-order", [
			i % 2 === 0 ? `- [ ] ${name} 📅 ${date} ⏫ #later` : `- [x] ${name} ✅ 2026-10-30 📅 ${date} #task`,
		]);
		add("field-position", [
			i % 2 === 0
				? `- [ ] ${name} 📅 ${date} is mentioned in the description #task ⏫`
				: `- [ ] ${name} #task in the middle ⏳ ${date} 📅 2026-11-03`,
		]);
		add("block-link", [`- [ ] ${name}${i % 2 === 0 ? ` 📅 ${date}` : ""} ^abc-${i + 1}`]);
		add("hard-break", [`- [ ] ${name} 📅 ${date}${" ".repeat(2 + (i % 3))}`]);
		add("variation-selector", [
			`- [ ] ${name} ⏫\uFE0F 🏁\uFE0F keep ➕\uFE0F 2026-10-01 🛫\uFE0F ${date} ⏳\uFE0F ${date} 📅\uFE0F ${date}`,
		]);
		lines.push(entry(null, `${i % 2 === 0 ? ">" : "> >"} [!note] Callout ${i + 1}`));
		add("callout", [`${i % 2 === 0 ? ">" : "> >"} - [ ] ${name} 📅 ${date}`]);
		add("indentation", [`${i % 2 === 0 ? "\t" : "    "}- [ ] ${name} 📅 ${date}`]);
		add("numbered-list", [`1${i % 2 === 0 ? "." : ")"} [ ] ${name} 📅 ${date}`]);
		add("bullet", [`${i % 2 === 0 ? "*" : "+"} [ ] ${name} 📅 ${date}`]);
	}
	for (let i = 0; i < 3; i++) {
		lines.push(
			entry("multiline", `- [ ] Parent ${i + 1} 📅 ${days[i]}`),
			entry(null, `  Continuation of parent ${i + 1}, with ordinary prose.`),
			entry("multiline", `    - [ ] Child ${i + 1} ⏳ ${days[i]}`),
		);
	}
	lines.push(entry(null, "- - [ ] x"), entry(null, "1. - [ ] x"));
	return lines;
}

function statusLines() {
	const statuses = [
		["todo", " "],
		["done", "x"],
		["uppercase", "X"],
		["in-progress", "/"],
		["cancelled", "-"],
		["exclamation", "!"],
		["question", "?"],
		["forwarded", ">"],
		["backward", "<"],
		["capital-d", "D"],
		["lower-c", "c"],
		["lower-h", "h"],
		["lower-n", "n"],
	];
	return statuses.flatMap(([name, symbol]) =>
		days.map((date, i) =>
			entry(
				`status-${name}`,
				`- [${symbol}] Status ${name} ${i + 1}${i === 1 ? " #task" : ""} 📅 ${date}${symbol === "x" || symbol === "X" ? " ✅ 2026-10-30" : symbol === "-" ? " ❌ 2026-10-30" : ""}`,
			),
		),
	);
}

function fieldLines() {
	const lines = [];
	const add = (kind, text) => lines.push(entry(kind, text));
	const surplus = [
		"- [ ] Todo with completion ✅ 2026-10-01",
		"- [x] Done with cancellation ❌ 2026-10-01",
		"- [ ] Todo with both ✅ 2026-10-01 ❌ 2026-10-02",
		"- [x] Done with both ✅ 2026-10-01 ❌ 2026-10-02",
		"- [ ] Todo with two completions ✅ 2026-10-01 ✅ 2026-10-02",
		"- [X] Uppercase done with completion ✅ 2026-10-01",
	];
	surplus.forEach((text) => add("surplus-dates", text));
	for (let i = 0; i < 6; i++) {
		const date = days[i % days.length];
		const name = `field ${i + 1}`;
		add("impossible-date", `- [ ] ${name} ${["📅 2026-02-31", "⏳ 2026-13-01", "[due:: 2026-02-30]"][i % 3]}`);
		add("id-dependency", `- [ ] ${name} 🆔 abc123 ⛔ ${i % 2 === 0 ? "abc123,def456" : "a, b"}`);
		add(
			"double-bracket",
			i % 2 === 0
				? `- [x] ${name} [[completion:: 2026-10-01]]${i === 2 ? " ^id" : ""}`
				: `- [-] ${name} [due:: ${date}] [[cancelled:: 2026-10-01]]`,
		);
		add("mixed-fields", `- [ ] ${name} ⏫ 📅 ${date} [scheduled:: 2026-11-02] (start:: 2026-10-31)`);
		add(
			"global-filter",
			[
				`- [ ] #task ${name} 📅 ${date}`,
				`- [ ] ${name} #task in the middle 📅 ${date}`,
				`- [ ] ${name} 📅 ${date} #task`,
			][i % 3],
		);
		add("plain", `- [ ] Plain ${i + 1} without fields`);
		add("priority-only", `- [ ] Priority ${i + 1} ${["🔺", "⏫", "🔼", "🔽", "⏬", "⏫"][i]}`);
		add("scheduled-date", `- [ ] Scheduled ${i + 1} ⏳ ${date}`);
		add("created-date", `- [ ] Created ${i + 1} ➕ ${date}`);
	}
	for (const action of ["delete", "keep", "archive", "DELETE"]) {
		for (let i = 0; i < 3; i++) {
			add("on-completion", `- [ ] Action ${action} ${i + 1} 🏁 ${action} 📅 ${days[i]}`);
			add("on-completion", `- [ ] Action ${action} recurring ${i + 1} 🔁 every day 🏁 ${action} 📅 ${days[i]}`);
		}
	}
	const fields = [
		["due", "2026-11-02"],
		["scheduled", "2026-11-01"],
		["start", "2026-10-31"],
		["created", "2026-10-01"],
		["completion", "2026-10-01"],
		["cancelled", "2026-10-01"],
		["priority", "high"],
		["repeat", "every day"],
		["onCompletion", "delete"],
		["id", "abc123"],
		["dependsOn", "abc123,def456"],
	];
	for (const [kind, open, close] of [
		["dataview-square", "[", "]"],
		["dataview-parens", "(", ")"],
	]) {
		for (const [key, value] of fields) {
			for (let i = 0; i < 3; i++) {
				const status = key === "completion" ? "x" : key === "cancelled" ? "-" : " ";
				add(kind, `- [${status}] ${key} ${i + 1}${i === 1 ? " #task" : ""} ${open}${key}:: ${value}${close}`);
			}
		}
	}
	return lines;
}

function recurrenceLines() {
	const lines = RECURRENCE_RULES.flatMap(({ id, rule }) => {
		const dates =
			rule.includes("February") && rule.includes("29") ? ["2028-02-29", "2032-02-29", "2024-02-29"] : days;
		return [
			entry(`recurring:${id}`, `- [ ] Recurrence ${id} a 🔁 ${rule} 📅 ${dates[0]}`),
			entry(
				`recurring:${id}`,
				`- [/] #task Recurrence ${id} b ⏫ 🔁 ${rule} 🛫 ${dates[0]} ⏳ ${dates[1]} 📅 ${dates[2]}`,
			),
			entry(`recurring:${id}`, `- [x] Recurrence ${id} c 🔁 ${rule} 📅 ${dates[1]} ✅ ${dates[2]}`),
		];
	});
	for (let i = 0; i < 3; i++) {
		lines.push(
			entry("recurring-dataview", `- [ ] Square recurrence ${i + 1} [repeat:: every day] [due:: ${days[i]}]`),
			entry(
				"recurring-dataview",
				`- [ ] Parenthesis recurrence ${i + 1} (repeat:: every week) (scheduled:: ${days[i]})`,
			),
			entry(
				"recurring-variation-selector",
				`- [ ] Variant recurrence ${i + 1} 🔁\uFE0F every day 📅\uFE0F ${days[i]}`,
			),
			entry("recurring-on-completion", `- [ ] Delete recurrence ${i + 1} 🔁 every week 🏁 delete 📅 ${days[i]}`),
			entry("recurring-on-completion", `- [ ] Keep recurrence ${i + 1} 🔁 every week 🏁 keep 📅 ${days[i]}`),
			entry(
				"recurring-all-dates",
				`- [ ] DST recurrence ${i + 1} 🔁 every day 🛫 ${days[i]} ⏳ ${days[i]} 📅 ${days[i]}`,
			),
			entry("recurring-no-date", `- [ ] Undated recurrence ${i + 1} 🔁 every month`),
			entry("recurring-done", `- [x] Completed recurrence ${i + 1} 🔁 every day 📅 ${days[i]} ✅ ${days[i]}`),
		);
	}
	return lines;
}

function generatedCorpus() {
	const notes = new Map();
	const kinds = new Map();
	const add = (file, lines, ending = "lf", finalEnding = true) => {
		const relative = `${GENERATED_FOLDER}/${file}`;
		const text = lines
			.map(
				({ text }, i) =>
					text +
					(i === lines.length - 1 && !finalEnding
						? ""
						: ending === "crlf" || (ending === "mixed" && i % 2 === 0)
							? "\r\n"
							: "\n"),
			)
			.join("");
		notes.set(relative, Buffer.from(text, "utf8"));
		kinds.set(
			relative,
			lines.map(({ kind }) => kind),
		);
	};
	const addSeries = (name, lines) => {
		const size = Math.ceil(lines.length / Math.ceil(lines.length / 28));
		for (let offset = 0; offset < lines.length; offset += size) {
			add(`${name} ${numbered(offset / size + 1)}.md`, lines.slice(offset, offset + size));
		}
	};
	addSeries("Syntax", syntaxLines());
	addSeries("Statuses", statusLines());
	addSeries("Fields", fieldLines());
	addSeries("Recurrence", recurrenceLines());
	for (const [name, kind, ending] of [
		["LF", "lf", "lf"],
		["CRLF", "crlf", "crlf"],
		["Mixed", "mixed", "mixed"],
		["No final EOL", "no-final-eol", "lf"],
		["BOM", "bom", "lf"],
		["Middle BOM", "middle-bom", "lf"],
		["Frontmatter", "frontmatter", "lf"],
	]) {
		const lines = Array.from({ length: 18 }, (_, i) =>
			entry(
				kind,
				`${name === "BOM" && i === 0 ? "\uFEFF" : ""}- [ ] Layout ${name} ${i + 1}${name === "Middle BOM" ? " before\uFEFFafter" : ""} 📅 ${days[i % 3]}`,
			),
		);
		if (name === "Frontmatter")
			lines.unshift(...["---", "tags: [task]", "area: parity", "---"].map((text) => entry(null, text)));
		add(`Layouts/${name}.md`, lines, ending, name !== "No final EOL");
	}
	add("On completion archive.md", [entry("on-completion-archive", "- [ ] a 🏁 archive")]);
	// These originals must survive vault creation without UTF-8 replacement characters. They are manual checks,
	// excluded from apiV1 cases because decoding them as UTF-8 would change what is actually stored in the note.
	// GBK: - [ ] 中文任务 [due:: 2026-11-02]\n
	notes.set(
		ENCODING_NOTES[0],
		Buffer.from("2d205b205d20d6d0cec4c8cecef1205b6475653a3a20323032362d31312d30325d0a", "hex"),
	);
	notes.set(ENCODING_NOTES[1], Buffer.from("- [ ] café ... [due:: 2026-11-02]\n", "latin1"));
	// Shift-JIS: - [ ] 日本語の予定 [due:: 2026-11-02]\n
	notes.set(
		ENCODING_NOTES[2],
		Buffer.from("2d205b205d2093fa967b8cea82cc975c92e8205b6475653a3a20323032362d31312d30325d0a", "hex"),
	);
	return { notes, kinds };
}

export function goldenVaultNotes() {
	const folder = path.join(repoRoot, "fixtures", "golden-vault");
	return new Map(markdownFiles(folder).map((file) => [file, readFileSync(path.join(folder, file))]));
}

export function generatedNotes() {
	return generatedCorpus().notes;
}

export function tasksParityNotes() {
	return new Map([...goldenVaultNotes(), ...generatedNotes()]);
}

function lineEnding(text) {
	const crlf = text.includes("\r\n");
	const lf = text.replace(/\r\n/g, "").includes("\n");
	return crlf ? (lf ? "mixed" : "crlf") : "lf";
}

export function tasksParityCases() {
	const { notes, kinds } = generatedCorpus();
	const cases = [];
	for (const [file, bytes] of [...goldenVaultNotes(), ...notes]) {
		let text;
		try {
			text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		} catch {
			continue;
		}
		const ending = lineEnding(text);
		text.split("\n").forEach((raw, line) => {
			let sourceLine = raw.replace(/\r$/, "");
			if (line === 0) sourceLine = sourceLine.replace(/^\uFEFF/, "");
			if (!taskRegex.test(sourceLine)) return;
			const kind = kinds.has(file) ? kinds.get(file)[line] : "golden";
			if (!kind) throw new Error(`tasks-parity-notes: ${file}:${line} has no task kind.`);
			cases.push({
				path: file,
				line,
				sourceLine,
				kind,
				recurring: /🔁|repeat::/iu.test(sourceLine),
				lineEnding: ending,
			});
		});
	}
	return cases;
}
