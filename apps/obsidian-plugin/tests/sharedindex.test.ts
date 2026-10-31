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
	// Updates of the closed reader, which the index still runs: it keeps nothing for it, so both read the same notes.
	await a.update({});
	await a.update({});
	const unshown = ["Archive/Old.md", "Inbox.md"];
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

test("a reader asked for a full read after the unload, as by a view that opens then, reads every note each time", async () => {
	const vault = fakeVault(notes());
	const shared = sharedOf(vault);
	const a = shared.openReader();
	await a.update({});
	shared.dispose();
	a.rereadAll();
	const read = readsOf(vault);
	await a.update({});
	assert.deepEqual(read(), ALL);
	// No event marks it any more; the next update reads it all the same.
	vault.write("Inbox.md", "- [ ] after the unload");
	const later = await a.update({});
	assert.deepEqual(read(), ALL);
	assert.deepStrictEqual([...later.tasks], await readTasks(vault.app as never, {}, moment));
	a.close();
});

test("a dropped index's token releases without error; releasing twice has no effect", async () => {
	for (const drop of ["close", "dispose"] as const) {
		const vault = fakeVault({ "a.md": "- [ ] a" });
		const shared = sharedOf(vault);
		const reader = shared.openReader();
		await reader.update({});
		const token = shared.hold("a.md");
		assert.ok(Object.isFrozen(token));
		if (drop === "close") reader.close();
		else shared.dispose();
		assert.equal(watchers(vault), 0, "a hold keeps no lease alive");
		assert.doesNotThrow(() => token.release());
		assert.doesNotThrow(() => token.release());
		if (drop === "dispose") {
			vault.write("a.md", "- [ ] after unload");
			const read = readsOf(vault);
			reader.rereadAll();
			const after = await reader.update({});
			assert.deepEqual(read(), ["a.md"], "dropping the lease also ends its pin");
			assert.deepEqual(after.pinned, []);
			assert.equal(after.tasks[0].visual, "after unload");
		}
	}
	const vault = fakeVault({ "a.md": "- [ ] a" });
	const shared = sharedOf(vault);
	const reader = shared.openReader();
	const first = await reader.update({});
	const read = readsOf(vault);
	const one = shared.hold("a.md");
	const two = shared.hold("a.md");
	one.release();
	one.release();
	const still = await reader.update({});
	assert.deepEqual(read(), []);
	assert.equal(still.tasks[0], first.tasks[0]);
	assert.deepEqual(still.pinned, ["a.md"], "one token cannot release another token's claim");
	two.release();
	await reader.update({});
	assert.deepEqual(read(), ["a.md"]);
	reader.close();
});

test("hold and markDirty without an open timeline do nothing", async () => {
	const vault = fakeVault({ "a.md": "- [ ] a" });
	const shared = sharedOf(vault);
	const empty = shared.hold("a.md");
	assert.ok(Object.isFrozen(empty));
	shared.markDirty(["a.md"]);
	empty.release();
	empty.release({ markDirty: false });
	assert.equal(watchers(vault), 0);
	assert.deepEqual(vault.reads, []);
	assert.equal(vault.listings(), 0, "no index is made just for a writer");
	const reader = shared.openReader();
	const first = await reader.update({});
	assert.deepEqual(first.pinned, []);
	assert.deepEqual(vault.reads, ["a.md"]);
	const read = readsOf(vault);
	shared.markDirty(["a.md"]);
	await reader.update({});
	assert.deepEqual(read(), ["a.md"], "marks are forwarded while a timeline is open");
	shared.dispose();
	assert.doesNotThrow(() => shared.markDirty(["a.md"]));
	const disposed = shared.hold("a.md");
	assert.doesNotThrow(() => disposed.release());
	assert.doesNotThrow(() => disposed.release());
	assert.equal(watchers(vault), 0);
	assert.deepEqual(read(), []);
});

test("a token from a dropped lease does not touch the next lease's index", async () => {
	const vault = fakeVault({ "a.md": "- [ ] a" });
	const shared = sharedOf(vault);
	const oldReader = shared.openReader();
	await oldReader.update({});
	const old = shared.hold("a.md");
	const otherOld = shared.hold("a.md");
	oldReader.close();
	const reader = shared.openReader();
	const first = await reader.update({});
	const current = shared.hold("a.md");
	const read = readsOf(vault);
	old.release();
	old.release();
	const retained = await reader.update({});
	assert.deepEqual(read(), []);
	assert.equal(retained.tasks[0], first.tasks[0]);
	assert.deepEqual(retained.pinned, ["a.md"], "the old lease cannot release the new lease's pin");
	current.release({ markDirty: false });
	await reader.update({});
	assert.deepEqual(read(), ["a.md"], "the held update kept no committed entry");
	const stored = await reader.update({});
	otherOld.release();
	const unchanged = await reader.update({});
	assert.deepEqual(read(), [], "the old token cannot mark the new index");
	assert.equal(unchanged.tasks[0], stored.tasks[0]);
	const held = shared.hold("a.md");
	vault.write("a.md", "- [ ] changed", { indexed: false, pendingMetadata: "none" });
	old.release();
	const pinned = await reader.update({});
	assert.deepEqual(read(), []);
	assert.equal(pinned.tasks[0], stored.tasks[0]);
	assert.deepEqual(pinned.pinned, ["a.md"]);
	vault.indexPending();
	held.release();
	const changed = await reader.update({});
	assert.deepEqual(read(), ["a.md"]);
	assert.equal(changed.tasks[0].visual, "changed");
	assert.deepEqual(changed.pinned, []);
	reader.close();
});
