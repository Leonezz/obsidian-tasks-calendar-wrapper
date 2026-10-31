import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { createNoticePresenter } from "../timeline/src/notices";
import { createUndoNotices } from "../timeline/src/undonotices";
import type { WriteResult } from "../timeline/src/taskwriter";
import { FakeElement, Notice } from "./stubs/obsidian";
import { flush, writerHarness } from "./writer-harness";

const documentStub = {
	createDocumentFragment: () => new FakeElement("#fragment"),
	createElement: (tag: string) => new FakeElement(tag),
	createTextNode: (text: string) => new FakeElement("#text", { text }),
} as unknown as Document;

test("undo notices retain hovered records, forget disconnected notices, and stop polling", async (t) => {
	const h = writerHarness({ "Note.md": "- [ ] Pay" });
	const writer = { ...h.create() };
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	const forgotten = t.mock.method(writer, "forgetUndo");
	let timers = 0;
	const notices = createUndoNotices(writer, presenter, {
		onWriteResult: () => {},
		setTimeout: (run, delay) => {
			timers++;
			return h.clock.setTimeout(run, delay);
		},
		clearTimeout: h.clock.clearTimeout,
	});
	t.after(() => {
		notices.close();
		writer.dispose();
		presenter.dispose();
	});
	const result = await writer.write(() => h.target(0, "Note.md"), { kind: "toggle" });
	assert.equal(result.kind, "written");
	if (result.kind !== "written") return;
	notices.show(result);
	const notice = Notice.instances.at(-1)!;
	assert.equal(notice.duration, 10000);
	await h.clock.advance(11000);
	assert.equal(forgotten.mock.callCount(), 0, "a hovered notice is still connected");
	notice.hide();
	await h.clock.advance(1000);
	assert.equal(forgotten.mock.callCount(), 1);
	assert.equal(forgotten.mock.calls[0].arguments[0], result.undo);
	const before = timers;
	await h.clock.advance(1000);
	assert.equal(timers, before, "no notices means no polling");
});

test("writer eviction hides its undo notice and closing a view forgets its remaining records", async (t) => {
	const h = writerHarness({ "Note.md": "- [ ] Pay\n- [ ] Call" });
	const writer = { ...h.create() };
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	const notices = createUndoNotices(writer, presenter, {
		onWriteResult: () => {},
		setTimeout: h.clock.setTimeout,
		clearTimeout: h.clock.clearTimeout,
	});
	t.after(() => {
		notices.close();
		writer.dispose();
		presenter.dispose();
	});
	const first = await writer.write(() => h.target(0, "Note.md"), { kind: "toggle" });
	assert.equal(first.kind, "written");
	if (first.kind !== "written" || !first.undo) return;
	notices.show(first);
	const firstNotice = Notice.instances.at(-1)!;
	writer.forgetUndo(first.undo);
	assert.equal(firstNotice.hidden, true);
	const second = await writer.write(() => h.target(1, "Note.md"), { kind: "toggle" });
	notices.show(second);
	const secondNotice = Notice.instances.at(-1)!;
	const forgotten = t.mock.method(writer, "forgetUndo");
	notices.close();
	assert.equal(secondNotice.hidden, true);
	assert.equal(forgotten.mock.callCount(), 1);
	notices.show(first);
	assert.equal(Notice.instances.at(-1), secondNotice, "a write finishing after close cannot show a notice");
});

test("an Undo notice runs once and reports its own write result", async (t) => {
	const h = writerHarness({ "Note.md": "- [ ] Pay" });
	const writer = { ...h.create() };
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	const results: WriteResult[] = [];
	const notices = createUndoNotices(writer, presenter, {
		onWriteResult: (_target, result) => results.push(result),
		setTimeout: h.clock.setTimeout,
		clearTimeout: h.clock.clearTimeout,
	});
	t.after(() => {
		notices.close();
		writer.dispose();
		presenter.dispose();
	});
	const result = await writer.write(() => h.target(0, "Note.md"), { kind: "toggle" });
	notices.show(result);
	const notice = Notice.instances.at(-1)!;
	const message = notice.message as FakeElement;
	assert.equal((message.children[0] as FakeElement).textContent, "Completed “Pay” in Note.");
	const buttons = message.children.filter(
		(child): child is FakeElement => child instanceof FakeElement && child.tag === "button",
	);
	assert.deepEqual(
		buttons.map((button) => button.textContent),
		["Undo", "Open note"],
	);
	const write = t.mock.method(writer, "write");
	buttons[0].click();
	buttons[0].click();
	await flush();
	assert.equal(write.mock.callCount(), 1);
	assert.equal(results.length, 1);
	assert.equal(results[0].kind, "written");
	assert.equal(h.text("Note.md"), "- [ ] Pay");
});

test("undo notices describe deletion, recurrence and un-completion from the written lines", async (t) => {
	for (const [source, replacement, expected] of [
		["- [ ] Pay 🏁 delete", "", "Completed “Pay 🏁 delete” and removed it from Note."],
		[
			"- [ ] Pay 🔁 every day",
			"- [ ] Pay 🔁 every day 📅 2026-10-25",
			"Completed “Pay” in Note; it was replaced by the next occurrence.",
		],
		[
			"- [ ] Pay 🔁 every day",
			"- [ ] Pay 🔁 every day\n- [x] Pay 🔁 every day",
			"Completed “Pay” in Note; the next occurrence was added.",
		],
		["- [x] Pay", "- [ ] Pay", "Marked “Pay” not done in Note."],
		["- [x] Pay 🔁 every day", "- [ ] Pay 🔁 every day", "Marked “Pay” not done in Note."],
	] as const) {
		const h = writerHarness({ "Note.md": source });
		const writer = { ...h.create({ tasks: () => ({ kind: "toggle", toggle: () => replacement }) }) };
		const presenter = createNoticePresenter({} as App, { document: documentStub });
		const notices = createUndoNotices(writer, presenter, {
			onWriteResult: () => {},
			setTimeout: h.clock.setTimeout,
			clearTimeout: h.clock.clearTimeout,
		});
		t.after(() => {
			notices.close();
			writer.dispose();
			presenter.dispose();
		});
		const result = await writer.write(() => h.target(0, "Note.md"), { kind: "toggle" });
		assert.equal(result.kind, "written");
		notices.show(result);
		assert.equal(
			((Notice.instances.at(-1)!.message as FakeElement).children[0] as FakeElement).textContent,
			expected,
		);
	}
});
