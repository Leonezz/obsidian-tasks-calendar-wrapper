import { test } from "node:test";
import assert from "node:assert/strict";
import type { TFile, TFolder } from "obsidian";

import { appendTaskToNote } from "../timeline/src/appendtask";

const task = "- [ ] new";

/** A vault holding the given notes and folders, which records the writes made to it. */
function fakeVault(notes: Record<string, string>, folders: string[] = []) {
	const contents = new Map(Object.entries(notes));
	const writes: string[] = [];
	const vault = {
		getFileByPath: (path: string) => (contents.has(path) ? ({ path } as TFile) : null),
		getFolderByPath: (path: string) => (folders.includes(path) ? ({ path } as TFolder) : null),
		getMarkdownFiles: () => [...contents.keys()].map((path) => ({ path }) as TFile),
		getAllFolders: () => folders.map((path) => ({ path }) as TFolder),
		process: async (file: TFile, fn: (data: string) => string) => {
			writes.push(`process ${file.path}`);
			const data = fn(contents.get(file.path) ?? "");
			contents.set(file.path, data);
			return data;
		},
		create: async (path: string, data: string) => {
			writes.push(`create ${path}`);
			contents.set(path, data);
			return { path } as TFile;
		},
		createFolder: async (path: string) => {
			writes.push(`createFolder ${path}`);
			return { path } as TFolder;
		},
	};
	return { vault, contents, writes };
}

const neverAsked = async (): Promise<boolean> => {
	throw new Error("the user should not be asked");
};

// Vault.process reads and writes in one step, so an edit made in between is not lost

test("an existing note gets the task under its section through Vault.process", async () => {
	const { vault, contents, writes } = fakeVault({ "Inbox.md": "# Inbox\n## Tasks\n- [ ] older\n" });
	assert.equal(await appendTaskToNote(vault, "Inbox.md", "## Tasks", task, neverAsked), true);
	assert.deepEqual(writes, ["process Inbox.md"]);
	assert.equal(contents.get("Inbox.md"), "# Inbox\n## Tasks\n- [ ] new\n- [ ] older\n");
});

test("a missing note is created only after the user agrees, and the question names it", async () => {
	const { vault, writes } = fakeVault({});
	const asked: string[] = [];
	const declined = await appendTaskToNote(vault, "Inbox.md", "## Tasks", task, async (path) => {
		asked.push(path);
		return false;
	});
	assert.equal(declined, false);
	assert.deepEqual(asked, ["Inbox.md"]);
	assert.deepEqual(writes, []);
});

test("a new note gets the section and the task, and its missing folder is created first", async () => {
	const { vault, contents, writes } = fakeVault({});
	assert.equal(await appendTaskToNote(vault, "01 Tasks/Inbox.md", "## Tasks", task, async () => true), true);
	assert.deepEqual(writes, ["createFolder 01 Tasks", "create 01 Tasks/Inbox.md"]);
	assert.equal(contents.get("01 Tasks/Inbox.md"), "## Tasks\n- [ ] new\n");
});

test("a new note in an existing folder, or at the top of the vault, creates no folder", async () => {
	const inFolder = fakeVault({}, ["01 Tasks"]);
	await appendTaskToNote(inFolder.vault, "01 Tasks/Inbox.md", "## Tasks", task, async () => true);
	assert.deepEqual(inFolder.writes, ["create 01 Tasks/Inbox.md"]);

	const atTop = fakeVault({});
	await appendTaskToNote(atTop.vault, "Inbox.md", "## Tasks", task, async () => true);
	assert.deepEqual(atTop.writes, ["create Inbox.md"]);
});

// On macOS and Windows a path that differs only in letter case names the same file, so creating it again fails

test("a note whose path differs only in letter case gets the task instead of a failing new note", async () => {
	const { vault, contents, writes } = fakeVault({ "Inbox.md": "## Tasks\n" });
	assert.equal(await appendTaskToNote(vault, "inbox.md", "## Tasks", task, neverAsked), true);
	assert.deepEqual(writes, ["process Inbox.md"]);
	assert.equal(contents.get("Inbox.md"), "## Tasks\n- [ ] new\n");
});

test("a new note goes into the folder that exists under another letter case, instead of creating that folder", async () => {
	const { vault, writes } = fakeVault({}, ["Daily"]);
	await appendTaskToNote(vault, "daily/2026-10-17.md", "## Tasks", task, async () => true);
	assert.deepEqual(writes, ["create Daily/2026-10-17.md"]);
});
