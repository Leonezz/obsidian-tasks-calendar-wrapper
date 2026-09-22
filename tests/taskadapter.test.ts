import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";

import { ObsidianTaskAdapter } from "../Obsidian-Tasks-Timeline/src/taskadapter";

const line = "- [ ] a task";

/** Builds an app whose file reads resolve after the given delays, like a real disk read does. */
function fakeApp(files: Record<string, number>, failing: string[] = []) {
    const list = Object.keys(files).map(path => ({ path }));
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    return {
        vault: {
            getMarkdownFiles: () => list,
            cachedRead: async (file: { path: string }) => {
                await wait(files[file.path]);
                if (failing.includes(file.path)) throw new Error(`cannot read ${file.path}`);
                return line;
            },
        },
        metadataCache: {
            getFileCache: () => ({
                listItems: [{
                    task: " ",
                    parent: -1,
                    position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: line.length, offset: line.length } },
                }],
                sections: [], links: [], tags: [],
            }),
        },
    } as never;
}

// Issue #80: files that were not already cached were dropped without any error

test("tasks from slow files are collected too", async () => {
    const adapter = new ObsidianTaskAdapter(fakeApp({ "fast.md": 0, "slow.md": 25 }));
    await adapter.generateTasksList([], [], [], []);
    assert.deepEqual(adapter.getTaskList().map(t => t.path).sort(), ["fast.md", "slow.md"]);
});

test("a file that cannot be read does not drop the other files", async () => {
    const adapter = new ObsidianTaskAdapter(fakeApp({ "good.md": 0, "broken.md": 5 }, ["broken.md"]));
    await adapter.generateTasksList([], [], [], []);
    assert.deepEqual(adapter.getTaskList().map(t => t.path), ["good.md"]);
});

test("reloading does not pile up the tasks of earlier runs", async () => {
    const adapter = new ObsidianTaskAdapter(fakeApp({ "one.md": 5, "two.md": 0 }));
    await adapter.generateTasksList([], [], [], []);
    await adapter.generateTasksList([], [], [], []);
    assert.equal(adapter.getTaskList().length, 2);
});
