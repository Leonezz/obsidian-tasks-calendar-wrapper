import { test } from "node:test";
import assert from "node:assert/strict";
import type { TFile, TFolder } from "obsidian";

import { appendTaskToNote } from "../timeline/src/appendtask";
import { createStore } from "@tasks-calendar-wrapper/core";
import { ConfirmModal } from "../src/confirm-modal";
import { initialTimelineState } from "../src/state/timeline";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import type { TaskWriter } from "../timeline/src/taskwriter";
import { ButtonComponent, FakeElement } from "./stubs/obsidian";
import { deferred, flush, writerHarness } from "./writer-harness";

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
	const writer: Pick<TaskWriter, "insert"> = {
		async insert(path, edit) {
			await vault.process({ path } as TFile, edit);
			return { kind: "written", id: 1, delta: 1, indexed: Promise.resolve() };
		},
	};
	return { vault, writer, contents, writes };
}

const neverAsked = async (): Promise<boolean> => {
	throw new Error("the user should not be asked");
};

// Vault.process reads and writes in one step, so an edit made in between is not lost

test("an existing note gets the task under its section through Vault.process", async () => {
	const { vault, writer, contents, writes } = fakeVault({ "Inbox.md": "# Inbox\n## Tasks\n- [ ] older\n" });
	assert.equal(await appendTaskToNote(vault, writer, "Inbox.md", "## Tasks", task, neverAsked), true);
	assert.deepEqual(writes, ["process Inbox.md"]);
	assert.equal(contents.get("Inbox.md"), "# Inbox\n## Tasks\n- [ ] new\n- [ ] older\n");
});

test("a missing note is created only after the user agrees, and the question names it", async () => {
	const { vault, writer, writes } = fakeVault({});
	const asked: string[] = [];
	const declined = await appendTaskToNote(vault, writer, "Inbox.md", "## Tasks", task, async (path) => {
		asked.push(path);
		return false;
	});
	assert.equal(declined, false);
	assert.deepEqual(asked, ["Inbox.md"]);
	assert.deepEqual(writes, []);
});

test("a new note gets the section and the task, and its missing folder is created first", async () => {
	const { vault, writer, contents, writes } = fakeVault({});
	assert.equal(await appendTaskToNote(vault, writer, "01 Tasks/Inbox.md", "## Tasks", task, async () => true), true);
	assert.deepEqual(writes, ["createFolder 01 Tasks", "create 01 Tasks/Inbox.md"]);
	assert.equal(contents.get("01 Tasks/Inbox.md"), "## Tasks\n- [ ] new\n");
});

test("a new note in an existing folder, or at the top of the vault, creates no folder", async () => {
	const inFolder = fakeVault({}, ["01 Tasks"]);
	await appendTaskToNote(inFolder.vault, inFolder.writer, "01 Tasks/Inbox.md", "## Tasks", task, async () => true);
	assert.deepEqual(inFolder.writes, ["create 01 Tasks/Inbox.md"]);

	const atTop = fakeVault({});
	await appendTaskToNote(atTop.vault, atTop.writer, "Inbox.md", "## Tasks", task, async () => true);
	assert.deepEqual(atTop.writes, ["create Inbox.md"]);
});

// On macOS and Windows a path that differs only in letter case names the same file, so creating it again fails

test("a note whose path differs only in letter case gets the task instead of a failing new note", async () => {
	const { vault, writer, contents, writes } = fakeVault({ "Inbox.md": "## Tasks\n" });
	assert.equal(await appendTaskToNote(vault, writer, "inbox.md", "## Tasks", task, neverAsked), true);
	assert.deepEqual(writes, ["process Inbox.md"]);
	assert.equal(contents.get("Inbox.md"), "## Tasks\n- [ ] new\n");
});

test("a new note goes into the folder that exists under another letter case, instead of creating that folder", async () => {
	const { vault, writer, writes } = fakeVault({}, ["Daily"]);
	await appendTaskToNote(vault, writer, "daily/2026-10-17.md", "## Tasks", task, async () => true);
	assert.deepEqual(writes, ["create Daily/2026-10-17.md"]);
});

test("quick entry into a GBK note refused, bytes unchanged, input text kept", async (t) => {
	const bytes = new Uint8Array([...new TextEncoder().encode("## Tasks\n- [ ] "), 0xd6, 0xd0]);
	const harness = writerHarness({ "Inbox.md": bytes });
	const writer = harness.create();
	t.after(() => writer.dispose());
	const vault = { ...fakeVault({}).vault, ...harness.app.vault };
	assert.equal(await appendTaskToNote(vault, writer, "Inbox.md", "## Tasks", task, neverAsked), false);
	assert.deepEqual(harness.bytes.get("Inbox.md"), bytes);
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.processCalls, ["Inbox.md"]);
	assert.deepEqual(harness.binaryCalls, ["Inbox.md"]);
	assert.deepEqual(harness.dirty, []);
	assert.equal(harness.holds.get("Inbox.md"), 0);
	assert.deepEqual(harness.notices, [
		"Inbox is not saved as UTF-8. Nothing was written: writing would replace its unreadable characters (shown as �) for good. Convert the note to UTF-8 to edit its tasks from the timeline.",
	]);
});

test("quick entry goes through the writer's queue after a running write of the same note", async (t) => {
	const harness = writerHarness({ "Inbox.md": "## Tasks\n- [ ] older\n" });
	const writer = harness.create();
	t.after(() => writer.dispose());
	const waiting = deferred();
	harness.onProcess(() => waiting.promise);
	const first = writer.write(() => harness.target(1, "Inbox.md"), { kind: "toggle" });
	await flush();
	assert.deepEqual(harness.processCalls, ["Inbox.md"]);
	const vault = { ...fakeVault({}).vault, ...harness.app.vault };
	const added = appendTaskToNote(vault, writer, "Inbox.md", "## Tasks", task, neverAsked);
	await flush();
	assert.deepEqual(harness.processCalls, ["Inbox.md"]);
	waiting.resolve();
	assert.equal((await first).kind, "written");
	assert.equal(await added, true);
	assert.equal(harness.text("Inbox.md"), "## Tasks\n- [ ] new\n- [x] older ✅ 2026-10-31\n");
	assert.deepEqual(harness.processCalls, ["Inbox.md", "Inbox.md"]);
});

test("quick entry inserted before a rename is reported added", async (t) => {
	const harness = writerHarness({ "a.md": "## Tasks\n" });
	const writer = harness.create();
	t.after(() => writer.dispose());
	harness.afterProcess(() => harness.rename("a.md", "b.md"));
	const vault = { ...fakeVault({}).vault, ...harness.app.vault };
	assert.equal(await appendTaskToNote(vault, writer, "a.md", "## Tasks", task, neverAsked), true);
	assert.equal(harness.text("b.md"), "## Tasks\n- [ ] new\n");
	assert.deepEqual(harness.refusals, []);
	assert.equal(harness.holds.get("a.md"), 0);
});

test("quick entry into a missing note still asks Create note and creates it outside the writer", async (t) => {
	const { vault, contents, writes } = fakeVault({});
	const writer: Pick<TaskWriter, "insert" | "write" | "editInTasksDialog" | "refuseIfNotReread"> = {
		write: async () => {
			throw new Error("a new note must not use the writer");
		},
		insert: async () => {
			throw new Error("a new note must not use the writer");
		},
		editInTasksDialog: async () => {
			throw new Error("a new note must not use the writer");
		},
		refuseIfNotReread: () => {
			throw new Error("a new note must not use the writer");
		},
	};
	let asked = false;
	t.mock.method(ConfirmModal.prototype, "ask", function (this: ConfirmModal) {
		asked = true;
		this.open();
		assert.equal((this.titleEl as unknown as FakeElement).text, "Create note");
		assert.equal(
			(this.contentEl as unknown as FakeElement).text,
			"No such file: Inbox.md. Would you like to create it?",
		);
		assert.deepEqual(writes, []);
		const buttons = (this.contentEl as unknown as FakeElement).children
			.flatMap((child) => (child instanceof FakeElement ? child.children : []))
			.filter((child): child is ButtonComponent => child instanceof ButtonComponent);
		assert.deepEqual(
			buttons.map((button) => button.buttonText),
			["Cancel", "Create"],
		);
		this.close();
		return Promise.resolve(true);
	});
	const bridge = new ObsidianBridge({
		plugin: { app: { vault } } as never,
		store: createStore(initialTimelineState()),
		writer,
	});
	bridge.onUpdateTasks = () => {};
	assert.equal(await bridge.handleCreateNewTask("Inbox.md", "new"), true);
	assert.equal(asked, true);
	assert.deepEqual(writes, ["create Inbox.md"]);
	assert.equal(contents.get("Inbox.md"), "## Tasks\n- [ ] new\n");
});

test("quick entry failure shows Could not write to {note}: {reason}", async (t) => {
	const harness = writerHarness({ "Inbox.md": "## Tasks\n" });
	const writer = harness.create();
	t.after(() => writer.dispose());
	harness.onProcess(() => {
		throw new Error("disk full");
	});
	const vault = { ...fakeVault({}).vault, ...harness.app.vault };
	assert.equal(await appendTaskToNote(vault, writer, "Inbox.md", "## Tasks", task, neverAsked), false);
	assert.deepEqual(harness.notices, ["Could not write to Inbox: disk full"]);
	assert.deepEqual(harness.writes, []);
});
