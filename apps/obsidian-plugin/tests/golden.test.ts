// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";
import "moment/locale/zh-cn";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Moment } from "moment";

import { defaultUserOptions, UserOption } from "../src/useroptions";
import { ObsidianTaskAdapter } from "../timeline/src/taskadapter";
import { groupTasksByDate, tasksListedOnDay } from "../timeline/src/taskdates";
import { moment } from "../utils/moment";
import { sortOptionLabels } from "../utils/sort";
import { filterTasks, parseTasks } from "../utils/tasklist";
import { innerDateFormat, TaskDataModel } from "../utils/tasks";

/**
 * Golden snapshots of what the plugin makes of the notes in fixtures/golden-vault today: every task's
 * parsed fields, the tasks each settings variant shows, the tasks each day lists, and their order under
 * every sort. They pin the current behaviour before the parsing moves to packages/core. A difference means
 * the behaviour changed; if that is intended, regenerate with `UPDATE_GOLDEN=1 pnpm test` and review the diff.
 * The metadata comes from Obsidian itself, see scripts/capture-golden.mjs.
 */

const FIXTURES = process.env.GOLDEN_FIXTURES ?? "";
const VAULT = path.join(FIXTURES, "golden-vault");
const METADATA = path.join(FIXTURES, "golden-vault.metadata.json");
const GOLDEN = path.join(FIXTURES, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface CapturedVault {
    obsidianVersion: string;
    /** The SHA-256 of each note the metadata was computed from. */
    notes: Record<string, string>;
    files: Record<string, unknown>;
}

function notesOnDisk(dir: string, prefix = ""): string[] {
    return readdirSync(dir).sort().flatMap(name => {
        if (name.startsWith(".")) return [];
        const relative = prefix ? `${prefix}/${name}` : name;
        if (statSync(path.join(dir, name)).isDirectory()) return notesOnDisk(path.join(dir, name), relative);
        return name.endsWith(".md") ? [relative] : [];
    });
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

let loaded: CapturedVault | undefined;

/** The captured metadata, after checking that it was computed from exactly the notes in the fixture vault. */
function loadVault(): CapturedVault {
    if (loaded) return loaded;
    if (!FIXTURES) assert.fail("GOLDEN_FIXTURES is not set. Run the tests with `pnpm test`, which sets it.");
    if (!existsSync(METADATA)) {
        assert.fail(`${METADATA} is missing. Open fixtures/golden-vault in Obsidian and run \`pnpm capture:golden\`.`);
    }
    const vault = JSON.parse(readFileSync(METADATA, "utf8")) as CapturedVault;
    const onDisk = notesOnDisk(VAULT);
    const captured = Object.keys(vault.notes ?? {}).sort();
    const stale = [...new Set([...onDisk, ...captured])].filter(note =>
        !onDisk.includes(note) || !captured.includes(note) || sha256(path.join(VAULT, note)) !== vault.notes[note]);
    if (stale.length > 0) {
        assert.fail(`the metadata does not match these fixture notes: ${JSON.stringify(stale)}. ` +
            "Recapture it with `pnpm capture:golden` (not UPDATE_GOLDEN=1), then regenerate the snapshots.");
    }
    assert.deepEqual(Object.keys(vault.files).sort(), captured, "every captured note has metadata");
    loaded = vault;
    return vault;
}

interface ReadOrder {
    /** Lists the notes in reverse, unlike the sorted list of a fresh vault. */
    reversed?: boolean;
    /** Delays each read by a different time, so reads finish out of order. */
    staggered?: boolean;
}

/** An app with just what the adapter reads: the notes of the fixture vault and the metadata Obsidian computed for them. */
function goldenApp(vault: CapturedVault, order: ReadOrder = {}) {
    const paths = Object.keys(vault.files).sort();
    if (order.reversed) paths.reverse();
    const files = paths.map(filePath => ({ path: filePath, basename: path.basename(filePath, ".md"), extension: "md" }));
    const wait = (file: string) => new Promise(resolve => setTimeout(resolve, (file.length * 7) % 13));
    return {
        vault: {
            getMarkdownFiles: () => files,
            cachedRead: async (file: { path: string }) => {
                if (order.staggered) await wait(file.path);
                return readFileSync(path.join(VAULT, file.path), "utf8");
            },
        },
        metadataCache: {
            // A copy each time, so nothing a run does to the metadata can leak into the next one.
            getFileCache: (file: { path: string }) => structuredClone(vault.files[file.path] ?? null),
        },
    } as never;
}

/** Reads, parses, sorts and filters the vault the way TasksTimelineView.onReloadTasks does. */
async function taskList(vault: CapturedVault, options: UserOption, order: ReadOrder = {}): Promise<TaskDataModel[]> {
    const adapter = new ObsidianTaskAdapter(goldenApp(vault, order));
    await adapter.generateTasksList(options.includePaths, options.excludePaths, options.fileIncludeTags,
        options.fileExcludeTags, options.excludeProperties);
    const parsed = await parseTasks(adapter.getTaskList(), options, moment());
    return filterTasks(parsed, options);
}

const id = (task: TaskDataModel) => `${task.path}:${task.line}`;

function day(date: Moment | undefined): string | null {
    if (!date) return null;
    return date.format(date.hours() || date.minutes() ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD");
}

/** Every field of a task that the views, the sorting or opening and toggling the task read. */
function details(task: TaskDataModel) {
    return {
        id: id(task),
        position: task.position,
        lineCount: task.lineCount,
        text: task.text,
        visual: task.visual,
        symbol: task.symbol,
        statusMarker: task.statusMarker,
        status: task.status,
        completed: task.completed,
        checked: task.checked,
        fullyCompleted: task.fullyCompleted,
        isTasksTask: task.isTasksTask,
        priority: task.priority,
        recurrence: task.recurrence,
        tags: task.tags,
        dailyNote: task.dailyNote,
        order: task.order,
        due: day(task.due),
        scheduled: day(task.scheduled),
        start: day(task.start),
        created: day(task.created),
        completion: day(task.completion),
        dates: [...task.dates].map(([key, date]) => [key, day(date)]),
        section: task.section.toObject(),
        outlinks: task.outlinks.map(link => link.toObject()),
        frontmatter: task.fontMatter,
    };
}

/** One line per task: enough to see what a settings variant changes, short enough to review. */
function summary(task: TaskDataModel): string {
    const dates = ([["due", task.due], ["scheduled", task.scheduled], ["start", task.start], ["created", task.created],
        ["completion", task.completion], ...task.dates] as [string, Moment | undefined][])
        .filter(([, date]) => date)
        .map(([key, date]) => `${key}=${day(date)}`)
        .join(" ");
    return `${id(task)} | ${task.status} | ${dates} | ${task.visual}`;
}

/** The tasks each day of the timeline lists, as DateView lists them. */
function days(tasks: TaskDataModel[], options: UserOption): Record<string, string[]> {
    const today = moment().format(innerDateFormat);
    const byDate = groupTasksByDate(tasks);
    return Object.fromEntries([...byDate.keys()].sort().map(date =>
        [date, tasksListedOnDay(byDate.get(date)!, date === today, options.forward).map(id)]));
}

function expectGolden(name: string, actual: unknown) {
    const file = path.join(GOLDEN, `${name}.json`);
    const text = JSON.stringify(actual, null, "\t") + "\n";
    if (UPDATE) {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, text);
        return;
    }
    if (!existsSync(file)) assert.fail(`${file} is missing. Create it with \`UPDATE_GOLDEN=1 pnpm test\`.`);
    assert.deepEqual(JSON.parse(text), JSON.parse(readFileSync(file, "utf8")),
        `the result differs from fixtures/golden/${name}.json. If the change is intended, run \`UPDATE_GOLDEN=1 pnpm test\` and review the diff.`);
}

const defaults = (): UserOption => structuredClone(defaultUserOptions);
const withOptions = (changes: Partial<UserOption>): UserOption => ({ ...defaults(), ...changes });

/** Shows every task, so the details snapshot covers all of them. */
const everything = withOptions({ hideStatusTasks: [], filterEmpty: false });

const variants: Record<string, UserOption> = {
    "default": defaults(),
    "forward-off": withOptions({ forward: false }),
    "forward-past-start-and-scheduled": withOptions({ forwardPastStartAndScheduled: true }),
    "show-all-statuses": withOptions({ hideStatusTasks: [] }),
    "hide-in-progress-and-forwarded": withOptions({ hideStatusTasks: ["/", ">"] }),
    "hide-subtasks": withOptions({ hideSubTasks: true }),
    "keep-empty": withOptions({ filterEmpty: false, hideStatusTasks: [] }),
    "include-tags": withOptions({ useIncludeTags: true, taskIncludeTags: ["#work"] }),
    "include-tags-empty": withOptions({ useIncludeTags: true, taskIncludeTags: [] }),
    "exclude-tags": withOptions({ useExcludeTags: true, taskExcludeTags: ["#work", "#project"] }),
    "exclude-tags-empty": withOptions({ useExcludeTags: true, taskExcludeTags: [] }),
    "include-paths": withOptions({ includePaths: ["Daily", "Frontmatter/Active.md"] }),
    "include-paths-trailing-slash": withOptions({ includePaths: ["Daily/"] }),
    "exclude-paths": withOptions({ excludePaths: ["Excluded", "Big note.md"] }),
    "exclude-paths-root": withOptions({ excludePaths: ["/"] }),
    "file-include-tags": withOptions({ fileIncludeTags: ["#project"] }),
    "file-exclude-tags": withOptions({ fileExcludeTags: ["#project"] }),
    "exclude-properties": withOptions({ excludeProperties: { status: ["archived"] } }),
    "exclude-properties-list": withOptions({ excludeProperties: { tags: ["project"] } }),
    "exclude-properties-number": withOptions({ excludeProperties: { priority: ["2"] } }),
    "exclude-properties-boolean": withOptions({ excludeProperties: { pinned: ["true"] } }),
    "daily-note-format-folders": withOptions({ dailyNoteFormat: "YYYY/MM/DD" }),
    "daily-note-format-iso": withOptions({ dailyNoteFormat: "YYYY-MM-DD" }),
    "daily-note-format-weeks": withOptions({ dailyNoteFormat: "YYYY/MMM/Wo/ddd" }),
    "convert-24-hour-time-prefix": withOptions({ convert24HourTimePrefix: true }),
    "status-order": withOptions({ taskStatusOrder: ["done", "cancelled", "unplanned", "overdue", "due", "scheduled", "start", "process"] }),
};

test("golden: the metadata was captured from Obsidian from exactly the fixture notes", () => {
    const vault = loadVault();
    assert.match(vault.obsidianVersion, /^\d+\.\d+/, "the capture records the Obsidian version it came from");
});

test("golden: every task's parsed fields", async () => {
    const tasks = await taskList(loadVault(), everything);
    expectGolden("tasks", tasks.map(details));
});

for (const [name, options] of Object.entries(variants)) {
    test(`golden: tasks shown with the ${name} settings`, async () => {
        const tasks = await taskList(loadVault(), options);
        expectGolden(`variant-${name}`, { shown: tasks.map(summary), days: days(tasks, options) });
    });
}

// Obsidian sets its moment to the app's language, which decides which note names are daily notes.
test("golden: tasks shown with Obsidian set to Chinese", async () => {
    moment.locale("zh-cn");
    try {
        const tasks = await taskList(loadVault(), defaults());
        expectGolden("variant-locale-zh-cn", { shown: tasks.map(summary), days: days(tasks, defaults()) });
    } finally {
        moment.locale("en");
    }
});

test("golden: the order under every sort option", async () => {
    const vault = loadVault();
    const orders: Record<string, string[]> = {};
    for (const sort of [...Object.keys(sortOptionLabels), "no-such-sort"]) {
        orders[sort] = (await taskList(vault, { ...everything, sort })).map(id);
    }
    expectGolden("sort-orders", orders);
});

test("golden: the result does not depend on the order or timing of the reads", async () => {
    const vault = loadVault();
    const usual = (await taskList(vault, everything)).map(details);
    const shuffled = (await taskList(vault, everything, { reversed: true, staggered: true })).map(details);
    assert.deepEqual(shuffled, usual);
});
