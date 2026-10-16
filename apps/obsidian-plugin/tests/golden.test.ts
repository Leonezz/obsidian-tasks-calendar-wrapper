// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Moment } from "moment";

import { defaultUserOptions, UserOption } from "../src/useroptions";
import { ObsidianTaskAdapter } from "../timeline/src/taskadapter";
import { groupTasksByDate } from "../timeline/src/taskdates";
import { sortOptionLabels } from "../utils/sort";
import { filterTasks, parseTasks } from "../utils/tasklist";
import { TaskDataModel } from "../utils/tasks";
import { moment } from "../utils/moment";

/**
 * Golden snapshots of what the plugin makes of the notes in fixtures/golden-vault today: every task's
 * parsed fields, the tasks each settings variant shows, their days and their order under every sort.
 * They pin the current behaviour before the parsing moves to packages/core. A difference means the
 * behaviour changed; if that is intended, regenerate with `UPDATE_GOLDEN=1 pnpm test` and review the diff.
 * The metadata comes from Obsidian itself, see scripts/capture-golden.mjs.
 */

// Tests run from apps/obsidian-plugin, like the release notes test that reads the manifest.
const FIXTURES = path.resolve(process.cwd(), "../../fixtures");
const VAULT = path.join(FIXTURES, "golden-vault");
const METADATA = path.join(FIXTURES, "golden-vault.metadata.json");
const GOLDEN = path.join(FIXTURES, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface CapturedVault {
    obsidianVersion: string;
    files: Record<string, unknown>;
}

function loadVault(): CapturedVault {
    if (!existsSync(METADATA)) {
        assert.fail(`${METADATA} is missing. Open fixtures/golden-vault in Obsidian and run \`pnpm capture:golden\`.`);
    }
    return JSON.parse(readFileSync(METADATA, "utf8")) as CapturedVault;
}

/** An app with just what the adapter reads: the notes of the fixture vault and the metadata Obsidian computed for them. */
function goldenApp(vault: CapturedVault) {
    const files = Object.keys(vault.files).sort().map(filePath => ({
        path: filePath,
        basename: path.basename(filePath, ".md"),
        extension: "md",
    }));
    return {
        vault: {
            getMarkdownFiles: () => files,
            cachedRead: async (file: { path: string }) => readFileSync(path.join(VAULT, file.path), "utf8"),
        },
        metadataCache: {
            getFileCache: (file: { path: string }) => vault.files[file.path] ?? null,
        },
    } as never;
}

/** Reads, parses, sorts and filters the vault the way TasksTimelineView.onReloadTasks does. */
async function taskList(vault: CapturedVault, options: UserOption): Promise<TaskDataModel[]> {
    const adapter = new ObsidianTaskAdapter(goldenApp(vault));
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

/** Every field of a task that the views or the sorting read. */
function details(task: TaskDataModel) {
    return {
        id: id(task),
        col: task.position.start.col,
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

function days(tasks: TaskDataModel[]): Record<string, string[]> {
    const byDate = groupTasksByDate(tasks);
    return Object.fromEntries([...byDate.keys()].sort().map(date => [date, byDate.get(date)!.map(id)]));
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
    "exclude-tags": withOptions({ useExcludeTags: true, taskExcludeTags: ["#work", "#project"] }),
    "include-paths": withOptions({ includePaths: ["Daily", "Frontmatter/Active.md"] }),
    "exclude-paths": withOptions({ excludePaths: ["Excluded", "Big note.md"] }),
    "file-include-tags": withOptions({ fileIncludeTags: ["#project"] }),
    "file-exclude-tags": withOptions({ fileExcludeTags: ["#project"] }),
    "exclude-properties": withOptions({ excludeProperties: { status: ["archived"] } }),
    "daily-note-format-folders": withOptions({ dailyNoteFormat: "YYYY/MM/DD" }),
    "daily-note-format-iso": withOptions({ dailyNoteFormat: "YYYY-MM-DD" }),
    "convert-24-hour-time-prefix": withOptions({ convert24HourTimePrefix: true }),
    "status-order": withOptions({ taskStatusOrder: ["done", "cancelled", "unplanned", "overdue", "due", "scheduled", "start", "process"] }),
};

test("golden: the metadata was captured from Obsidian for every fixture note", () => {
    const vault = loadVault();
    assert.match(vault.obsidianVersion, /^\d+\.\d+/, "the capture records the Obsidian version it came from");
    assert.ok(Object.keys(vault.files).length > 0);
});

test("golden: every task's parsed fields", async () => {
    const tasks = await taskList(loadVault(), everything);
    expectGolden("tasks", tasks.map(details));
});

for (const [name, options] of Object.entries(variants)) {
    test(`golden: tasks shown with the ${name} settings`, async () => {
        const tasks = await taskList(loadVault(), options);
        expectGolden(`variant-${name}`, { shown: tasks.map(summary), days: days(tasks) });
    });
}

test("golden: the order under every sort option", async () => {
    const vault = loadVault();
    const orders: Record<string, string[]> = {};
    for (const sort of Object.keys(sortOptionLabels)) {
        orders[sort] = (await taskList(vault, { ...everything, sort })).map(id);
    }
    expectGolden("sort-orders", orders);
});

test("golden: the same vault gives the same result twice", async () => {
    const vault = loadVault();
    const first = (await taskList(vault, everything)).map(details);
    const second = (await taskList(vault, everything)).map(details);
    assert.deepEqual(second, first);
});
