import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { createNoticePresenter } from "../timeline/src/notices";
import { FakeElement, Notice } from "./stubs/obsidian";

const documentStub = {
	createDocumentFragment: () => new FakeElement("#fragment"),
	createElement: (tag: string) => new FakeElement(tag),
	createTextNode: (text: string) => new FakeElement("#text", { text }),
} as unknown as Document;

test("the revert notice does not auto-hide and has Redo and Open note with exact text", async () => {
	Notice.instances = [];
	let redone = 0;
	const opened: unknown[] = [];
	const presenter = createNoticePresenter({} as App, {
		document: documentStub,
		openNote: async (...args) => {
			opened.push(args);
		},
	});
	presenter.overwritten({ path: "Notes/Home.md", line: 3, text: "Buy milk" }, 1, async () => {
		redone++;
	});
	assert.equal(Notice.instances.length, 1);
	const notice = Notice.instances[0];
	assert.equal(notice.duration, 0);
	const message = notice.message as FakeElement;
	assert.equal(
		(message.children[0] as FakeElement).textContent,
		"“Buy milk” in Home is back to how it was before the timeline changed it (another save, a sync, or a change made in the note). Redo?",
	);
	const buttons = message.children.filter(
		(child): child is FakeElement => child instanceof FakeElement && child.tag === "button",
	);
	assert.deepEqual(
		buttons.map((button) => button.textContent),
		["Redo", "Open note"],
	);
	await buttons[0].click();
	buttons[1].click();
	assert.equal(redone, 1);
	assert.deepEqual(opened, [["Notes/Home.md", 3]]);
	presenter.dispose();
});

test("a revert containing Undo or a dialog edit offers only Open note and truncates display text", () => {
	Notice.instances = [];
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	presenter.overwritten({ path: "Home.md", line: 0, text: "A".repeat(61), action: "undo" }, 1);
	const message = Notice.instances[0].message as FakeElement;
	assert.ok(message.textContent.startsWith(`“${"A".repeat(60)}…” in Home`));
	assert.deepEqual(
		message.children
			.filter((child): child is FakeElement => child instanceof FakeElement && child.tag === "button")
			.map((button) => button.textContent),
		["Open note"],
	);
	presenter.overwritten({ path: "Home.md", line: 0, text: "edit", action: "replace" }, 2);
	assert.equal((Notice.instances[1].message as FakeElement).children[0] instanceof FakeElement, true);
	assert.ok(
		(Notice.instances[1].message as FakeElement).textContent.startsWith(
			"2 timeline changes in Home are back to how they were before (another save, a sync, or a change made in the note). Redo?",
		),
	);
	presenter.dispose();
});
