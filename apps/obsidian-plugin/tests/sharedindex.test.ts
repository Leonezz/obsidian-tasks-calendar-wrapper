// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";

import { readTasks } from "../timeline/src/taskadapter";
import { createSharedTaskIndex } from "../timeline/src/sharedindex";
import { parseKeyOf } from "../utils/parsekey";
import { fakeVault, type FakeVault } from "./fakevault";
import { ALL, notes } from "./indexed-vault";

// The task index the plugin's timelines share: made with the first reader, watching the vault once, and dropped,
// with its watching, after the last reader closes or when the plugin unloads.

/** The stub's Events count their handlers; Obsidian's typings know nothing of that. */
const handlerCount = (events: object, name: string) =>
	(events as { handlerCount(name: string): number }).handlerCount(name);

/** How many handlers the index has on the vault's events, which no view registers in these tests. */
function watchers(vault: FakeVault): number {
	const { metadataCache } = vault.app;
	const files = vault.app.vault;
	return (
		handlerCount(metadataCache, "changed") +
		handlerCount(metadataCache, "deleted") +
		handlerCount(files, "rename") +
		handlerCount(files, "modify")
	);
}

/** The plugin's holder, on the fake vault. */
const sharedOf = (vault: FakeVault) =>
	createSharedTaskIndex({ app: vault.app as never, moment, parseKey: () => parseKeyOf(moment) });

/** The notes read since the last call, in the order the reads started. */
function readsOf(vault: FakeVault): () => string[] {
	let from = vault.reads.length;
	return () => {
		const read = vault.reads.slice(from);
		from = vault.reads.length;
		return read;
	};
}

test("the first reader makes the index, which watches the vault once; the last one closed stops it and drops it", async () => {
	const vault = fakeVault(notes());
	const shared = sharedOf(vault);
	assert.equal(watchers(vault), 0, "nothing before the first timeline");
	const a = shared.openReader();
	const b = shared.openReader();
	assert.equal(watchers(vault), 4, "changed, deleted, rename and modify, once");
	const read = readsOf(vault);
	await a.update({});
	await b.update({});
	read();
	vault.write("Inbox.md", "- [ ] call the plumber again");
	await a.update({});
	await b.update({});
	assert.deepEqual(read(), ["Inbox.md"]);
	a.close();
	assert.equal(watchers(vault), 4, "one reader is left");
	b.close();
	b.close();
	assert.equal(watchers(vault), 0);
	// A new timeline: a new index, which reads every note, and watches again.
	vault.write("Inbox.md", "- [ ] while no timeline was open");
	const c = shared.openReader();
	assert.equal(watchers(vault), 4);
	const fromC = await c.update({});
	assert.deepEqual(read(), ALL);
	assert.deepStrictEqual([...fromC.tasks], await readTasks(vault.app as never, {}, moment));
	// A reader of the old index closed again leaves the new one alone.
	a.close();
	assert.equal(watchers(vault), 4);
});

test("a reader closed beside another is closed in the index: its notes go, and it reads them again", async () => {
	const vault = fakeVault(notes());
	const shared = sharedOf(vault);
	const a = shared.openReader();
	const b = shared.openReader();
	await a.update({});
	await b.update({ includePaths: ["Projects"] });
	a.close();
	await b.update({ includePaths: ["Projects"] });
	const read = readsOf(vault);
	// As a view that closed finishes the reload it was asked for: twice, as the index keeps nothing for it.
	await a.update({});
	await a.update({});
	const unshown = ["Archive/Old.md", "Inbox.md", "Reference/Plain.md"];
	assert.deepEqual(read(), [...unshown, ...unshown], "Garden stays, B shows it");
});

test("the last reader closed while its update reads: the update finishes, and a reader opened then gets a new index", async () => {
	const vault = fakeVault(notes());
	const shared = sharedOf(vault);
	const a = shared.openReader();
	await a.update({});
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] one");
	const release = vault.holdReads();
	const running = a.update({});
	a.close();
	assert.equal(watchers(vault), 0);
	const b = shared.openReader();
	const fromB = b.update({});
	release();
	assert.equal((await running).tasks.length, 4);
	await fromB;
	assert.deepEqual(read(), ["Inbox.md", ...ALL], "the new index reads every note, beside the old one's read");
	assert.equal(watchers(vault), 4);
});

test("unloading the plugin stops the watching whatever is open, and no reader can be opened after", async () => {
	const vault = fakeVault(notes());
	const shared = sharedOf(vault);
	const a = shared.openReader();
	shared.openReader();
	await a.update({});
	shared.dispose();
	shared.dispose();
	assert.equal(watchers(vault), 0);
	assert.throws(() => shared.openReader(), /the plugin unloaded/);
	// A reader is left to its view: a reload it had asked for still finishes, and keeps its notes for the next.
	const read = readsOf(vault);
	vault.write("Inbox.md", "- [ ] after the unload");
	assert.equal((await a.update({})).tasks.length, 4);
	assert.equal((await a.update({})).tasks.length, 4);
	assert.deepEqual(read(), [], "it hears nothing, and keeps what it read");
	a.close();
});
