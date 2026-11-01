import { GOLDEN_NOW } from "./golden-clock";
import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createStore,
	dayKey,
	parseTaskLine,
	resolveTasks,
	type DateField,
	type LineTarget,
	type TaskRowModel,
} from "@tasks-calendar-wrapper/core";
import { initialTimelineState } from "../src/state/timeline";
import { DateModal, type DateAnswer } from "../timeline/src/datemodal";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import type { TaskEdit } from "../timeline/src/taskwriter";
import { moment } from "../utils/moment";
import { ButtonComponent, FakeElement, Menu } from "./stubs/obsidian";
import { flush } from "./writer-harness";

function controls(modal: DateModal) {
	const content = modal.contentEl as unknown as FakeElement;
	const input = content.children.find((child) => child instanceof FakeElement && child.tag === "input");
	assert.ok(input instanceof FakeElement);
	const buttons = content.children.flatMap((child) =>
		child instanceof FakeElement ? child.children.filter((button) => button instanceof ButtonComponent) : [],
	);
	const save = buttons.find((button) => button.buttonText === "Save");
	assert.ok(save);
	return { input, save, clear: buttons.find((button) => button.buttonText === "Clear") };
}

function picking(sourceLine: string, field: DateField = "due", path = "Note.md") {
	let modal: DateModal | undefined;
	let answer: Promise<DateAnswer> | undefined;
	const writes: { target: LineTarget; edit: TaskEdit }[] = [];
	const bridge = new ObsidianBridge({
		plugin: { app: {} } as never,
		store: createStore(initialTimelineState()),
		writer: {
			insert: async () => ({ kind: "unchanged" }),
			editInTasksDialog: async () => ({ kind: "unchanged" }),
			refuseIfNotReread: () => undefined,
			write: async (target, edit) => {
				writes.push({ target: target(), edit });
				return { kind: "unchanged" };
			},
		},
		askDate: (selected, source) => {
			modal = new DateModal({} as never, selected, source);
			answer = modal.ask();
			return answer;
		},
	});
	bridge.handleRowMenu({ path, line: 0, sourceLine } as TaskRowModel, {} as MouseEvent);
	const pick = Menu.instances.at(-1)!.items.find((item) => item.title === `Pick ${field} date…`);
	assert.ok(pick);
	void pick.click();
	assert.ok(modal);
	assert.ok(answer);
	return { modal, answer, writes, ...controls(modal) };
}

function enter(input: FakeElement): void {
	const event = new Event("keydown", { cancelable: true });
	Object.defineProperty(event, "key", { value: "Enter" });
	input.dispatchEvent(event);
	assert.equal(event.defaultPrevented, true);
}

test("date input is time-zone safe", async () => {
	const previous = process.env.TZ;
	try {
		process.env.TZ = "America/Los_Angeles";
		const picked = picking("- [ ] Pay");
		let reads = 0;
		Object.defineProperty(picked.input, "valueAsDate", {
			get: () => {
				reads += 1;
				return new Date("2026-10-24T00:00:00Z");
			},
		});
		picked.input.value = "2026-10-24";
		picked.input.dispatchEvent(new Event("input"));
		picked.save.click();
		assert.deepEqual(await picked.answer, { kind: "day", day: "2026-10-24" });
		await flush();
		assert.deepEqual(picked.writes, [
			{
				target: { path: "Note.md", line: 0, sourceLine: "- [ ] Pay" },
				edit: { kind: "date", field: "due", day: "2026-10-24" },
			},
		]);
		assert.equal(reads, 0);
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("prefill", async () => {
	const path = "Daily/2026-01-12.md";
	const source = "- [ ] undated task";
	const task = parseTaskLine(source, { moment, path });
	assert.ok(task);
	assert.equal(dayKey(resolveTasks([task], {}, { now: moment(), moment }).shown[0].dates.scheduled!), "2026-01-12");
	const today = dayKey(moment(GOLDEN_NOW));
	for (const [line, expected, own] of [
		[source, today, false],
		["- [ ] a ⏳ 2026-01-12", "2026-01-12", true],
		["+ [ ] a ⏳ 2026-01-12", "2026-01-12", true],
		["1) [ ] a [scheduled:: 2026-01-12]", "2026-01-12", true],
		["- [ ] a ⏳ 2026-02-30", today, false],
		["- [ ] a (scheduled:: 2026-01-12)", today, false],
	] as const) {
		const picked = picking(line, "scheduled", path);
		assert.equal(picked.input.value, expected);
		assert.equal(picked.input.attr.type, "date");
		assert.equal(picked.input.focused, true);
		assert.equal(picked.modal.titleEl.textContent, "Pick scheduled date");
		assert.equal(Boolean(picked.clear), own);
		assert.equal(picked.save.cta, true);
		picked.modal.close();
		assert.equal(await picked.answer, null);
		await flush();
		assert.deepEqual(picked.writes, []);
	}
});

test("closing the date modal without an answer writes nothing", async () => {
	for (const gesture of ["Esc", "close button", "backdrop", "swipe", "back", "Obsidian close"]) {
		const picked = picking("- [ ] Pay 📅 2026-01-20");
		let settled = false;
		void picked.answer.then(() => {
			settled = true;
		});
		await flush();
		assert.equal(settled, false, gesture);
		assert.deepEqual(picked.writes, []);
		picked.modal.close();
		assert.equal(await picked.answer, null, gesture);
		await flush();
		assert.deepEqual(picked.writes, []);
	}
});

test("Enter and Save return a day only through the close callback; Clear removes the field", async () => {
	for (const action of ["Enter", "Save", "Clear"]) {
		const picked = picking("- [ ] Pay 🛫 2026-01-20", "start");
		picked.input.value = "2026-10-24";
		picked.input.dispatchEvent(new Event("input"));
		let settled = false;
		void picked.answer.then(() => {
			settled = true;
		});
		const close = picked.modal.close.bind(picked.modal);
		picked.modal.close = () => {};
		if (action === "Enter") enter(picked.input);
		else if (action === "Clear") picked.clear!.click();
		else picked.save.click();
		await flush();
		assert.equal(settled, false);
		assert.deepEqual(picked.writes, []);
		close();
		assert.deepEqual(
			await picked.answer,
			action === "Clear" ? { kind: "clear" } : { kind: "day", day: "2026-10-24" },
		);
		await flush();
		assert.deepEqual(
			picked.writes.map(({ edit }) => edit),
			[{ kind: "date", field: "start", day: action === "Clear" ? null : "2026-10-24" }],
		);
	}
});

test("empty and invalid date inputs disable Save and ignore Enter", async () => {
	for (const value of ["", "2026-02-30", "2026-2-03", " 2026-02-03", "2026-02-03T00:00", "２０２６-０２-０３"]) {
		const picked = picking("- [ ] Pay");
		picked.input.value = value;
		picked.input.dispatchEvent(new Event("input"));
		assert.equal(picked.save.disabled, true, value);
		picked.save.click();
		enter(picked.input);
		let settled = false;
		void picked.answer.then(() => {
			settled = true;
		});
		await flush();
		assert.equal(settled, false, value);
		assert.deepEqual(picked.writes, []);
		picked.input.value = "2026-02-28";
		picked.input.dispatchEvent(new Event("input"));
		assert.equal(picked.save.disabled, false);
		picked.modal.close();
		assert.equal(await picked.answer, null);
	}
});

test("the bridge's default modal saves only while in-place changes remain enabled", async (t) => {
	const opened: DateModal[] = [];
	const ask = DateModal.prototype.ask;
	t.mock.method(DateModal.prototype, "ask", function (this: DateModal) {
		opened.push(this);
		return ask.call(this);
	});
	for (const switchOn of [false, true]) {
		const app = {};
		const writes: TaskEdit[] = [];
		const sourceLine = "- [ ] Pay ⏳ 2026-01-12";
		const bridge = new ObsidianBridge({
			plugin: { app } as never,
			store: createStore(initialTimelineState()),
			writer: {
				insert: async () => ({ kind: "unchanged" }),
				editInTasksDialog: async () => ({ kind: "unchanged" }),
				refuseIfNotReread: () => undefined,
				write: async (_target, edit) => {
					writes.push(edit);
					return { kind: "unchanged" };
				},
			},
		});
		bridge.handleRowMenu({ path: "Note.md", line: 0, sourceLine } as TaskRowModel, {} as MouseEvent);
		void Menu.instances
			.at(-1)!
			.items.find((item) => item.title === "Pick scheduled date…")!
			.click();
		const modal = opened.at(-1);
		assert.ok(modal);
		assert.equal(modal.app, app);
		assert.equal(modal.titleEl.textContent, "Pick scheduled date");
		const { input, save } = controls(modal);
		assert.equal(input.value, "2026-01-12");
		assert.deepEqual(writes, []);
		if (switchOn)
			bridge.state = {
				...bridge.state,
				userOptions: { ...bridge.state.userOptions, openNoteInsteadOfInPlace: true },
			};
		input.value = "2026-10-24";
		input.dispatchEvent(new Event("input"));
		save.click();
		await flush();
		assert.deepEqual(writes, switchOn ? [] : [{ kind: "date", field: "scheduled", day: "2026-10-24" }]);
	}
});
