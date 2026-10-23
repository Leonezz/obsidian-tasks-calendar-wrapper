// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment, { type Moment } from "moment";

import { hasTaskItems, type NoteMetadata, type Task } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions } from "../src/useroptions";
import { readTasks, reportNoteReads } from "../timeline/src/taskadapter";
import type { IndexUpdate } from "../timeline/src/taskindex";
import { parseKeyOf } from "../utils/parsekey";
import { goldenApp, loadVault } from "./golden-vault";
import { ALL, indexed, notes, ourLines, soleReader, telling } from "./indexed-vault";

// The task index when the parse environment changes, the way Obsidian or the user can change it: moment's locale and
// the time zone. Each test puts them back as golden-clock set them. The last test reads the golden vault, with the
// metadata Obsidian computed for it, in every read order and in Chinese.

test("moment's locale: another one reads every note, and the moments are in it", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	try {
		moment.locale("zh-cn");
		const chinese = await t.index.update({});
		assert.deepEqual(t.since().read, ALL);
		const due = chinese.tasks.find((task) => task.path === "Inbox.md")?.dates.due;
		assert.equal((due as Moment | undefined)?.locale(), "zh-cn");
		assert.deepStrictEqual([...chinese.tasks], await t.reference());
	} finally {
		moment.locale("en");
	}
	const english = await t.index.update({});
	assert.deepEqual(t.since().read, ALL);
	assert.deepStrictEqual([...english.tasks], await t.reference());
});

test("updateLocale reads every note: the first, a second that changes the locale in place, and undoing them", async () => {
	const t = indexed();
	await t.index.update({});
	t.since();
	let updated = false;
	const readsAll = async (what: string) => {
		const result = await t.index.update({});
		assert.deepEqual(t.since().read, ALL, what);
		assert.deepStrictEqual([...result.tasks], await t.reference(), what);
	};
	try {
		moment.updateLocale("en", { week: { dow: 1, doy: 4 } });
		updated = true;
		await readsAll("the first updateLocale");
		moment.updateLocale("en", { week: { dow: 0, doy: 6 } });
		await readsAll("a second updateLocale, in place");
	} finally {
		// Undoing a locale that was never updated would delete it.
		if (updated) moment.updateLocale("en", null);
		moment.locale("en");
	}
	await readsAll("undone");
});

test("another time zone reads every note, and the dates are in it", async () => {
	const t = indexed();
	const utc = await t.index.update({});
	t.since();
	const dueOf = (result: IndexUpdate) => result.tasks.find((task) => task.path === "Inbox.md")?.dates.due?.valueOf();
	try {
		process.env.TZ = "America/New_York";
		const newYork = await t.index.update({});
		assert.deepEqual(t.since().read, ALL);
		assert.notEqual(dueOf(newYork), dueOf(utc));
		assert.deepStrictEqual([...newYork.tasks], await t.reference());
	} finally {
		process.env.TZ = "UTC";
	}
});

test("a preparse changed in place reads every note again, so a date read with it is read without it", async (t) => {
	const lines = ourLines(t);
	const i = indexed({ ...notes(), "Arabic.md": "- [ ] arabic digits [due:: ٢٠٢٦-٠١-٢٠]" });
	const arabic = (text: string) => text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660));
	const dueOf = (result: IndexUpdate) => result.tasks.find((task) => task.path === "Arabic.md")?.dates.due;
	let updated = false;
	try {
		moment.updateLocale("en", { preparse: arabic });
		updated = true;
		const read = await i.index.update({});
		i.since();
		assert.equal(dueOf(read)?.format("YYYY-MM-DD"), "2026-01-20");
		assert.deepEqual(read.warnings, []);
		assert.deepStrictEqual([...read.tasks], await i.reference());
		moment.updateLocale("en", { preparse: (text: string) => text });
		const reread = await i.index.update({});
		assert.deepEqual(i.since().read, ["Arabic.md", ...ALL]);
		assert.equal(dueOf(reread), undefined);
		assert.deepEqual(
			reread.warnings.map((warning) => warning.path),
			["Arabic.md"],
		);
		const told = await telling(lines, () => reportNoteReads(reread.warnings, reread.failures));
		let reference: Task[] = [];
		assert.deepEqual(told, await telling(lines, async () => (reference = await i.reference())));
		assert.deepStrictEqual([...reread.tasks], reference);
	} finally {
		if (updated) moment.updateLocale("en", null);
		moment.locale("en");
	}
});

test("golden: equal to readTasks in every read order, nothing read twice, one read per marked path, all in zh-cn", async () => {
	const vault = loadVault();
	const paths = Object.keys(vault.files).sort();
	assert.equal(paths.length, 24);
	// The notes with a task item, the only ones read: every golden note but "No tasks.md".
	const withTasks = paths.filter((path) => hasTaskItems(vault.files[path] as NoteMetadata));
	assert.deepEqual(
		paths.filter((path) => !withTasks.includes(path)),
		["No tasks.md"],
	);
	for (const order of [{}, { reversed: true }, { staggered: true }]) {
		const app = goldenApp(vault, order) as { vault: { cachedRead(file: { path: string }): Promise<string> } };
		const read: string[] = [];
		const cachedRead = app.vault.cachedRead;
		app.vault.cachedRead = (file) => (read.push(file.path), cachedRead(file));
		const reference = async () => {
			const before = read.length;
			const tasks = await readTasks(app as never, defaultUserOptions, moment);
			read.splice(before);
			return tasks;
		};
		const index = soleReader({ app: app as never, moment, parseKey: () => parseKeyOf(moment) });
		const first = await index.update(defaultUserOptions);
		assert.equal(read.length, withTasks.length, JSON.stringify(order));
		assert.deepStrictEqual([...first.tasks], await reference());
		const second = await index.update(defaultUserOptions);
		assert.equal(read.length, withTasks.length, "the second update reads nothing");
		assert.equal(second.tasks.length, first.tasks.length);
		second.tasks.forEach((task, i) => assert.equal(task, first.tasks[i]));
		for (const path of paths) {
			read.length = 0;
			index.markDirty([path]);
			const marked = await index.update(defaultUserOptions);
			assert.deepEqual(read, withTasks.includes(path) ? [path] : []);
			assert.deepStrictEqual([...marked.tasks], [...first.tasks], path);
		}
		read.length = 0;
		try {
			moment.locale("zh-cn");
			const chinese = await index.update(defaultUserOptions);
			assert.equal(read.length, withTasks.length, "every note with a task item, in zh-cn");
			assert.deepStrictEqual([...chinese.tasks], await reference());
		} finally {
			moment.locale("en");
		}
	}
});
