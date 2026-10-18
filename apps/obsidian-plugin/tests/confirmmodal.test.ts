import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";

import { ConfirmModal } from "../src/confirm-modal";
import { ButtonComponent, FakeElement } from "./stubs/obsidian";

const options = {
	title: "Create note",
	message: "No such file: Inbox.md. Would you like to create it?",
	confirmText: "Create",
};

/** Every button the modal shows, in order. */
function buttons(element: FakeElement): ButtonComponent[] {
	return element.children.flatMap((child) => (child instanceof FakeElement ? buttons(child) : [child]));
}

function button(modal: ConfirmModal, text: string): ButtonComponent {
	const found = buttons(modal.contentEl as unknown as FakeElement).find((b) => b.buttonText === text);
	if (!found) throw new Error(`no button labelled ${text}`);
	return found;
}

test("the dialog shows the title, the message and both buttons", () => {
	const modal = new ConfirmModal({} as App, options);
	void modal.ask();
	assert.equal((modal.titleEl as unknown as FakeElement).text, "Create note");
	assert.equal((modal.contentEl as unknown as FakeElement).text, options.message);
	assert.deepEqual(
		buttons(modal.contentEl as unknown as FakeElement).map((b) => b.buttonText),
		["Cancel", "Create"],
	);
});

test("pressing the confirm button closes the dialog and answers yes", async () => {
	const modal = new ConfirmModal({} as App, options);
	const answer = modal.ask();
	button(modal, "Create").click();
	assert.equal(await answer, true);
});

test("the confirm button has the focus, so Enter answers yes as it did with the browser's confirm()", () => {
	const modal = new ConfirmModal({} as App, options);
	void modal.ask();
	assert.equal(button(modal, "Create").buttonEl.focused, true);
	assert.equal(button(modal, "Cancel").buttonEl.focused, false);
});

test("pressing cancel answers no", async () => {
	const modal = new ConfirmModal({} as App, options);
	const answer = modal.ask();
	button(modal, "Cancel").click();
	assert.equal(await answer, false);
});

test("closing the dialog any other way, such as with Escape, answers no", async () => {
	const modal = new ConfirmModal({} as App, options);
	const answer = modal.ask();
	modal.close();
	assert.equal(await answer, false);
});
