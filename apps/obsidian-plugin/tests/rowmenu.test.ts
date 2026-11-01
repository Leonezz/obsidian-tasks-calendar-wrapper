import { GOLDEN_NOW } from "./golden-clock";
import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, parseTaskLine, resolveTasks, taskRowModel, type LineTarget } from "@tasks-calendar-wrapper/core";
import { initialTimelineState } from "../src/state/timeline";
import { defaultUserOptions } from "../src/useroptions";
import { bridgeActions, type BridgeProps } from "./component-harness";
import { rowMenuItems } from "../timeline/src/rowmenu";
import { changesInPlace } from "../timeline/src/taskactions";
import { createShiftLedger, type WriteResult } from "../timeline/src/taskwriter";
import { moment } from "../utils/moment";
import { Menu } from "./stubs/obsidian";
import { flush, writerHarness } from "./writer-harness";

const source = "- [ ] Pay 📅 2026-10-25 ⏳ 2026-10-20 🛫 2026-10-19";
const items = (line: string) => rowMenuItems(line, { changesInPlace: true, moment });
const titles = (line: string) => items(line).map(({ title, section }) => [title, section]);
const removes = (line: string) =>
	items(line)
		.filter(({ action }) => action.kind === "remove")
		.map(({ title }) => title);

function modelOf(sourceLine = source, path = "Note.md") {
	const task = parseTaskLine(sourceLine, { moment, path });
	assert.ok(task);
	const env = { now: moment(), moment, warn: () => {} };
	return taskRowModel(resolveTasks([task], {}, env).shown[0], { ...defaultUserOptions, tagPalette: {} }, env);
}

function bridgeOf(props: Partial<BridgeProps> = {}) {
	const bridgeProps = {
		plugin: { app: {} } as never,
		store: createStore(initialTimelineState()),
		writer: {
			write: async () => {
				throw new Error("Unexpected write");
			},
			insert: async () => {
				throw new Error("Unexpected insert");
			},
			editInTasksDialog: async () => {
				throw new Error("Unexpected dialog");
			},
			refuseIfNotReread: () => undefined,
		},
		...props,
	} satisfies BridgeProps;
	return bridgeActions(bridgeProps, { mount: false });
}

test("menu offers Remove only for own dates", () => {
	const daily = modelOf("- [ ] undated task in today's ISO daily note", "Daily/2026-01-15.md");
	assert.ok(daily.badges.some(({ kind }) => kind === "scheduled"));
	assert.ok(daily.badges.some(({ kind }) => kind === "start"));
	assert.deepEqual(removes(daily.sourceLine), []);
	assert.deepEqual(removes("- [ ] a 📅 2026-10-25 [scheduled:: 2026-10-20]"), [
		"Remove due date",
		"Remove scheduled date",
	]);
	for (const marker of ["+", "1)"])
		assert.deepEqual(removes(`${marker} [ ] b ⏳ 2026-10-20`), ["Remove scheduled date"]);
	assert.deepEqual(titles(source), [
		["Due today", "due"],
		["Due tomorrow", "due"],
		["Pick due date…", "due"],
		["Remove due date", "due"],
		["Pick scheduled date…", "scheduled"],
		["Remove scheduled date", "scheduled"],
		["Pick start date…", "start"],
		["Remove start date", "start"],
	]);
	assert.ok(Object.isFrozen(items(source)));
	assert.ok(items(source).every((item) => Object.isFrozen(item) && Object.isFrozen(item.action)));
});

test("switch hides date items", async () => {
	const bridge = bridgeOf();
	const enabled = bridge.getTaskItemHandlers();
	assert.equal(typeof enabled.handleRowMenu, "function");
	assert.equal(typeof enabled.handleDateBadge, "function");
	assert.equal(bridge.getTaskItemHandlers(), enabled);
	const options = { ...defaultUserOptions, openNoteInsteadOfInPlace: true };
	bridge.state = { ...bridge.state, userOptions: options };
	assert.deepEqual(rowMenuItems(source, { changesInPlace: changesInPlace(options), moment }), []);
	const disabled = bridge.getTaskItemHandlers();
	assert.equal(disabled.handleRowMenu, undefined);
	assert.equal(disabled.handleDateBadge, undefined);
	assert.equal(bridge.getTaskItemHandlers(), disabled);
	const count = Menu.instances.length;
	bridge.handleRowMenu(modelOf(), {} as MouseEvent);
	await bridge.handleSetDate(modelOf(), "due", "2026-10-24");
	await bridge.handleDateBadge(modelOf(), "scheduled");
	assert.equal(Menu.instances.length, count);
	bridge.state = { ...bridge.state, userOptions: { ...defaultUserOptions } };
	const restored = bridge.getTaskItemHandlers();
	assert.equal(restored.handleRowMenu, enabled.handleRowMenu);
	assert.equal(restored.handleDateBadge, enabled.handleDateBadge);
	assert.equal(bridge.getTaskItemHandlers(), restored);
});

test("Due today and Due tomorrow read the clock at click", () => {
	const previousTZ = process.env.TZ;
	const previousNow = moment.now;
	try {
		process.env.TZ = "America/Los_Angeles";
		moment.now = () => Date.parse("2026-03-07T23:59:00-08:00");
		const opened = items(source);
		moment.now = () => Date.parse("2026-03-08T00:01:00-08:00");
		for (const [index, expected] of [
			[0, "2026-03-08"],
			[1, "2026-03-09"],
		] as const) {
			const action = opened[index].action;
			assert.equal(action.kind, "set");
			if (action.kind === "set") assert.equal(action.day(), expected);
		}
	} finally {
		moment.now = previousNow;
		if (previousTZ === undefined) delete process.env.TZ;
		else process.env.TZ = previousTZ;
	}
	assert.equal(moment.now(), GOLDEN_NOW);
});

test("parenthesized and impossible dates offer Pick but no Remove", () => {
	for (const line of ["- [ ] a (due:: 2026-01-20)", "- [ ] a 📅 2024-02-31", "- [ ] a [due:: 2026-02-31]"]) {
		assert.deepEqual(removes(line), []);
		assert.ok(items(line).some(({ title }) => title === "Pick due date…"));
	}
});

test("each menu item writes its field and reports the shifted target", async () => {
	for (const [title, field, day] of [
		["Due today", "due", "2026-01-15"],
		["Due tomorrow", "due", "2026-01-16"],
		["Pick due date…", "due", "2026-10-24"],
		["Remove due date", "due", null],
		["Pick scheduled date…", "scheduled", "2026-10-24"],
		["Remove scheduled date", "scheduled", null],
		["Pick start date…", "start", "2026-10-24"],
		["Remove start date", "start", null],
	] as const) {
		const ledger = createShiftLedger();
		const model = { ...modelOf(), line: 2 };
		const writes: unknown[] = [];
		const reports: unknown[] = [];
		const picks: unknown[] = [];
		const result: WriteResult = { kind: "unchanged" };
		const bridge = bridgeOf({
			ledger,
			writer: {
				...bridgeOf().props.writer,
				write: async (target, edit) => {
					ledger.record("Note.md", 0, 1, 1);
					writes.push([target(), edit]);
					return result;
				},
			},
			askDate: async (...args) => {
				picks.push(args);
				return { kind: "day", day: "2026-10-24" };
			},
			onWriteResult: (...args) => reports.push(args),
		});
		const event = { view: { name: "popout" } } as unknown as MouseEvent;
		bridge.handleRowMenu(model, event);
		const menu = Menu.instances.at(-1)!;
		assert.equal(menu.event, event);
		assert.deepEqual(
			menu.items.map(({ title, section }) => [title, section]),
			titles(source),
		);
		menu.items.find((item) => item.title === title)!.click();
		await flush();
		const target = { path: "Note.md", line: 3, sourceLine: source };
		assert.deepEqual(writes, [[target, { kind: "date", field, day }]], title);
		assert.deepEqual(reports, [[target, result]], title);
		assert.deepEqual(picks, title.startsWith("Pick") ? [[field, source]] : [], title);
	}
});

test("slow date writes refuse menu items and Pick before opening the modal", async () => {
	const h = writerHarness({ "Note.md": source });
	const writer = h.create();
	const reports: [LineTarget, WriteResult][] = [];
	let asked = 0;
	const bridge = bridgeOf({
		writer,
		askDate: async () => {
			asked++;
			return null;
		},
		onWriteResult: (...args) => reports.push(args),
	});
	const model = modelOf();
	try {
		assert.equal((await bridge.handleSetDate(model, "due", "2026-10-26"))?.kind, "written");
		await h.clock.advance(10_000);
		const before = h.text("Note.md");
		bridge.handleRowMenu(model, {} as MouseEvent);
		for (const item of Menu.instances.at(-1)!.items) {
			const count = h.refusals.length;
			item.click();
			await flush();
			assert.equal(h.refusals.length, count + 1, item.title);
			assert.deepEqual(reports.at(-1), [
				{ path: "Note.md", line: 0, sourceLine: source },
				{
					kind: "refused",
					reason: "not-reread",
					message:
						"Obsidian hasn't re-read Note yet, so the timeline can't change “Pay” again. Try again in a moment.",
				},
			]);
		}
		await bridge.handleDateBadge(model, "due");
		assert.equal(asked, 0);
		assert.equal(h.text("Note.md"), before);
		assert.equal(h.processCalls.length, 1);
	} finally {
		writer.dispose();
	}
});

test("Pick reports a refusal at the shifted target before opening the modal", async () => {
	const ledger = createShiftLedger();
	ledger.record("Note.md", 0, 2, 1);
	const model = { ...modelOf(), line: 1 };
	const target = { path: "Note.md", line: 3, sourceLine: source };
	const result: WriteResult = { kind: "refused", reason: "not-reread", message: "not re-read" };
	const reports: unknown[] = [];
	const bridge = bridgeOf({
		ledger,
		writer: {
			...bridgeOf().props.writer,
			refuseIfNotReread: (at, action) => {
				assert.deepEqual(at, target);
				assert.equal(action, "date");
				return result;
			},
		},
		askDate: async () => {
			throw new Error("Must refuse before opening");
		},
		onWriteResult: (...args) => reports.push(args),
	});
	await bridge.handleDateBadge(model, "scheduled");
	assert.deepEqual(reports, [[target, result]]);
});
