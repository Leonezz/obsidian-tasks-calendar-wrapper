import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";

import {
	COPY_FAILURE_TEXT,
	EditRecoveryModal,
	createNoticePresenter,
	displayTask,
	noteName,
	refusalText,
	writeFailureText,
	mayNotSavedText,
	slowText,
	tasksDialogTooOldText,
	tasksDialogErrorText,
	tasksDialogFailureText,
	tasksDialogDeleteText,
	undoNoticeText,
	undoDoneText,
	undoAlreadyText,
	undoExpiredText,
	overwrittenText,
	type NoticeContext,
	type RefuseReason,
} from "../timeline/src/notices";
import { prepareEdit } from "../timeline/src/writerchecks";
import { ButtonComponent, FakeElement, Notice, Platform } from "./stubs/obsidian";
import { writerHarness } from "./writer-harness";

const context: NoticeContext = { path: "Notes/Home.md", line: 3, text: "Buy milk" };

test("Tasks dialog notice texts are byte-exact", () => {
	assert.equal(tasksDialogTooOldText(), "Tasks 7.21 or later edits here");
	assert.equal(tasksDialogErrorText("unavailable"), "Could not reach the Tasks plugin: unavailable");
	assert.equal(tasksDialogFailureText("broken"), "Tasks' edit dialog failed: broken");
	assert.equal(
		tasksDialogDeleteText(),
		"Nothing was written. If you completed this task in the dialog: Tasks returns nothing for a task set to delete itself, so use the checkbox to complete it.",
	);
});

test("Tasks dialog notices last eight seconds without buttons", () => {
	Notice.instances = [];
	const presenter = createNoticePresenter({} as App);
	const cases = [
		["too-old", tasksDialogTooOldText()],
		["error", tasksDialogErrorText("broken")],
		["failed", tasksDialogFailureText("broken")],
		["delete", tasksDialogDeleteText()],
	] as const;
	for (const [kind, expected] of cases) {
		assert.equal(presenter.tasksDialog(kind, context, "broken"), expected);
		const notice = Notice.instances.at(-1)!;
		assert.equal(notice.message, expected);
		assert.equal(notice.duration, 8000);
	}
	presenter.dispose();
	assert.ok(Notice.instances.every((notice) => notice.hidden));
});

const refusals: readonly [RefuseReason, Partial<NoticeContext>, string][] = [
	[
		"impossible-date",
		{ field: "due", value: "2026-02-30", menuFixable: true },
		"“Buy milk” has a due date that does not exist (2026-02-30). Nothing was written. Change it with right-click → Pick due date….",
	],
	[
		"unreadable-date",
		{ action: "toggle", token: "Fecha inválida" },
		"Tasks returned a date the timeline cannot read back (“Fecha inválida”) for “Buy milk”. Nothing was written.",
	],
	[
		"unreadable-date",
		{ action: "date", token: "tomorrow" },
		"“Buy milk” would get a date the timeline cannot read back (“tomorrow”). Nothing was written.",
	],
	[
		"unreadable-date",
		{ action: "date", token: "۱۲۳۴", localDigits: true, locale: "fa" },
		"“Buy milk” would get a date the timeline cannot read back (“۱۲۳۴”). Nothing was written. Tasks wrote it in the digits of Obsidian's language (fa).",
	],
	[
		"unreadable-date",
		{ action: "toggle", token: "۱۲۳۴", localDigits: true, locale: "fa" },
		"Tasks returned a date the timeline cannot read back (“۱۲۳۴”) for “Buy milk”. Nothing was written. Tasks wrote it in the digits of Obsidian's language (fa).",
	],
	[
		"recurrence-lost",
		{},
		"Tasks could not read the recurrence rule in “Buy milk” and would drop it. Nothing was written. Fix the rule in the note, then try again.",
	],
	["recurring-needs-tasks", {}, "Recurring tasks need the Tasks plugin. Nothing was written."],
	[
		"not-task-line",
		{},
		"The timeline can't change “Buy milk” safely because it isn't a plain task line. Open the note to change it.",
	],
	[
		"ambiguous",
		{},
		"“Buy milk” appears more than once near here in Home, and the timeline can't tell which one you clicked. Nothing was written.",
	],
	["moved-or-deleted", {}, "Home was moved or deleted. Nothing was written."],
	["moved-or-deleted", { action: "undo" }, "Could not undo: Home was moved or deleted. Nothing was written."],
	[
		"not-utf8",
		{},
		"Home is not saved as UTF-8. Nothing was written: writing would replace its unreadable characters (shown as �) for good. Convert the note to UTF-8 to edit its tasks from the timeline.",
	],
	[
		"queue-blocked",
		{},
		"Home may not have been saved yet. The timeline won't change it until the note changes or two minutes pass.",
	],
	[
		"date-ambiguous",
		{ field: "due", a: "2026-10-25", b: "2026-10-26" },
		"“Buy milk” has more than one due date (2026-10-25 and 2026-10-26). Nothing was changed. Keep one of them in the note, then try again.",
	],
	[
		"date-unreadable",
		{ field: "scheduled", found: "tomorrow" },
		"“Buy milk” has its scheduled date written as tomorrow, which the timeline cannot change. Nothing was changed. Edit it in the note.",
	],
	[
		"date-style-mixed",
		{ field: "start" },
		"“Buy milk” uses both emoji dates and [key:: value] fields, so the timeline cannot tell which style to add. Nothing was changed. Add the start date in the note.",
	],
	[
		"line-changed",
		{},
		"“Buy milk” changed in Home since the timeline read it. Nothing was written. The timeline updates once Obsidian has re-read the note; then try again.",
	],
	[
		"not-reread",
		{},
		"Obsidian hasn't re-read Home yet, so the timeline can't change “Buy milk” again. Try again in a moment.",
	],
	[
		"tasks-too-old",
		{},
		"Completing from the timeline needs Tasks 7.2.0 or newer, so the note was opened at the task.",
	],
	["tasks-error", { message: "broken" }, "Tasks could not change “Buy milk”: broken. Nothing was written."],
	[
		"bad-output",
		{},
		"Tasks returned something the timeline cannot write safely for “Buy milk”. Nothing was written.",
	],
	[
		"undo-changed",
		{},
		"Could not undo: “Buy milk” in Home changed or moved after the timeline wrote it. Nothing was written.",
	],
];

for (const [reason, extra, expected] of refusals) {
	test(`${reason} notice text${extra.action ? ` (${extra.action}${extra.localDigits ? ", local digits" : ""})` : ""}`, () => {
		assert.equal(refusalText(reason, { ...context, ...extra }), expected);
	});
}

test("impossible-date menu suffix follows the field and token form", () => {
	const harness = writerHarness();
	const cases = [
		["📅", "due", true],
		["📆", "due", true],
		["🗓", "due", true],
		["⏳", "scheduled", true],
		["⌛", "scheduled", true],
		["🛫", "start", true],
		["✅", "completion", false],
		["❌", "cancelled", false],
		["➕", "created", false],
	] as const;
	const tokens: (readonly [string, string, boolean])[] = cases.flatMap(([symbol, field, fixable]) =>
		["", "\uFE0F"].map((variation) => [`${symbol}${variation} 2026-02-31`, field, fixable] as const),
	);
	for (const field of ["due", "scheduled", "start", "completion", "cancelled", "created"] as const) {
		tokens.push([`[${field}:: 2026-02-31]`, field, ["due", "scheduled", "start"].includes(field)]);
		tokens.push([`(${field}:: 2026-02-31)`, field, false]);
	}
	for (const [token, field, menuFixable] of tokens) {
		const prepared = prepareEdit(`- [ ] Buy milk ${token}`, context.path, { kind: "toggle" }, harness.deps);
		assert.equal(prepared.kind, "refused", token);
		if (prepared.kind !== "refused") continue;
		assert.equal(prepared.reason, "impossible-date", token);
		assert.deepEqual(prepared.details, { field, value: "2026-02-31", menuFixable }, token);
		for (const touch of [false, true]) {
			assert.equal(
				refusalText(prepared.reason, { ...context, ...prepared.details }, touch),
				`“Buy milk” has a ${field} date that does not exist (2026-02-31). Nothing was written.` +
					(menuFixable
						? ` Change it with ${touch ? "⋯" : "right-click"} → Pick ${field} date….`
						: " Fix it in the note."),
				token,
			);
		}
	}
});

test("impossible-date menuFixable uses the token position with comments masked", () => {
	const harness = writerHarness();
	for (const [fields, menuFixable] of [
		["(due:: 2026-02-01) [due:: 2026-02-31]", true],
		["[due:: 2026-02-01] (due:: 2026-02-31)", false],
		["(due:: 2026-02-31) [due:: 2026-02-31]", false],
		["[due:: 2026-02-31] (due:: 2026-02-31)", true],
		["(due:: 📅 2026-02-31 )", false],
		["(reminder 📅 2026-02-31 )", true],
		["(see [due:: 2026-02-31])", true],
		["%% (due:: 2026-02-01) %% [due:: 2026-02-31]", true],
		["%% (due:: 2026-02-31) %% [due:: 2026-02-31]", false],
		["%% [due:: 2026-02-31] %% (due:: 2026-02-31)", false],
	] as const) {
		const prepared = prepareEdit(`- [ ] Buy milk ${fields}`, context.path, { kind: "toggle" }, harness.deps);
		assert.equal(prepared.kind, "refused");
		if (prepared.kind !== "refused") continue;
		assert.deepEqual(prepared.details, { field: "due", value: "2026-02-31", menuFixable }, fields);
	}
});

test("impossible-date without menuFixable keeps the note instruction", () => {
	assert.equal(
		refusalText("impossible-date", { ...context, field: "due", value: "2026-02-31" }),
		"“Buy milk” has a due date that does not exist (2026-02-31). Nothing was written. Fix it in the note.",
	);
});

test("write failure, unknown outcome and slow notice texts", () => {
	assert.equal(writeFailureText(context, new Error("disk full")), "Could not write to Home: disk full");
	assert.equal(writeFailureText(context, "denied"), "Could not write to Home: denied");
	assert.equal(
		mayNotSavedText(context, "timeout"),
		"Home may not have been saved: the file system didn't answer within 60 s. Check the note before trying again.",
	);
	assert.equal(
		mayNotSavedText(context, "editor"),
		"Home may not have been saved: Obsidian could not save it, and the line changed in its editor afterwards. The change is still in the open note and is saved with it. Check the note before trying again.",
	);
	assert.equal(
		slowText(context),
		"Saved in Home. The timeline will show the change once Obsidian has re-read the note.",
	);
});

test("every undo notice text", () => {
	assert.equal(undoNoticeText(context, { kind: "complete" }), "Completed “Buy milk” in Home.");
	assert.equal(
		undoNoticeText(context, { kind: "recurring-replaced" }),
		"Completed “Buy milk” in Home; it was replaced by the next occurrence.",
	);
	assert.equal(
		undoNoticeText(context, { kind: "recurring-added" }),
		"Completed “Buy milk” in Home; the next occurrence was added.",
	);
	assert.equal(undoNoticeText(context, { kind: "deleted" }), "Completed “Buy milk” and removed it from Home.");
	assert.equal(undoNoticeText(context, { kind: "uncomplete" }), "Marked “Buy milk” not done in Home.");
	assert.equal(
		undoNoticeText(context, { kind: "date", field: "due", day: "2026-10-31" }),
		"Set the due date of “Buy milk” to 2026-10-31.",
	);
	assert.equal(
		undoNoticeText(context, { kind: "date", field: "scheduled", day: null }),
		"Removed the scheduled date from “Buy milk”.",
	);
	assert.equal(undoNoticeText(context, { kind: "cancel" }), "Cancelled “Buy milk” in Home.");
	assert.equal(undoNoticeText(context, { kind: "replace" }), "Saved your edit to “Buy milk” in Home.");
	assert.equal(undoAlreadyText(context), "“Buy milk” in Home is already back to how it was.");
	assert.equal(
		undoExpiredText(context),
		"Could not undo: the change to “Buy milk” was too long ago. Nothing was written.",
	);
	assert.equal(undoDoneText(context), "Undid the change to “Buy milk”.");
	assert.equal(
		undoDoneText(context, true),
		"Undid the change to “Buy milk”. Changes the Tasks dialog made to other tasks are not undone.",
	);
});

test("overwritten notice texts", () => {
	assert.equal(
		overwrittenText(context, 1),
		"“Buy milk” in Home is back to how it was before the timeline changed it (another save, a sync, or a change made in the note). Redo?",
	);
	assert.equal(
		overwrittenText(context, 2),
		"2 timeline changes in Home are back to how they were before (another save, a sync, or a change made in the note). Redo?",
	);
});

test("{task} truncates past 60 characters with …", () => {
	assert.equal(displayTask("a".repeat(60)), "a".repeat(60));
	assert.equal(displayTask("a".repeat(61)), "a".repeat(60) + "…");
	assert.equal(displayTask("😀".repeat(61)), "😀".repeat(60) + "…");
	assert.equal(
		undoAlreadyText({ ...context, text: "a".repeat(61) }),
		`“${"a".repeat(60)}…” in Home is already back to how it was.`,
	);
});

test("{note} is the file name without .md", () => {
	assert.equal(noteName("a/b/Home.md"), "Home");
	assert.equal(noteName("Home.md.md"), "Home.md");
	assert.equal(noteName("Home"), "Home");
});

const documentStub = {
	createDocumentFragment: () => new FakeElement("#fragment"),
	createElement: (tag: string) => new FakeElement(tag),
	createTextNode: (text: string) => new FakeElement("#text", { text }),
} as unknown as Document;

test("the presenter uses the touch override for impossible dates", () => {
	Notice.instances = [];
	const presenter = createNoticePresenter({} as App, { document: documentStub, touch: () => true });
	const expected =
		"“Buy milk” has a due date that does not exist (2026-02-31). Nothing was written. Change it with ⋯ → Pick due date….";
	assert.equal(
		presenter.refuse("impossible-date", { ...context, field: "due", value: "2026-02-31", menuFixable: true }),
		expected,
	);
	assert.ok((Notice.instances[0].message as FakeElement).textContent.startsWith(expected));
	presenter.dispose();
});

test("the default presenter reads Platform.isMobile when showing an impossible date", () => {
	Notice.instances = [];
	const previous = Platform.isMobile;
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	try {
		for (const [touch, gesture] of [
			[false, "right-click"],
			[true, "⋯"],
		] as const) {
			Platform.isMobile = touch;
			const expected = `“Buy milk” has a due date that does not exist (2026-02-31). Nothing was written. Change it with ${gesture} → Pick due date….`;
			assert.equal(
				presenter.refuse("impossible-date", {
					...context,
					field: "due",
					value: "2026-02-31",
					menuFixable: true,
				}),
				expected,
			);
			assert.ok((Notice.instances[0].message as FakeElement).textContent.startsWith(expected));
		}
	} finally {
		Platform.isMobile = previous;
		presenter.dispose();
	}
});

function elementButtons(element: FakeElement): FakeElement[] {
	return element.children.flatMap((child) =>
		child instanceof FakeElement ? [...(child.tag === "button" ? [child] : []), ...elementButtons(child)] : [],
	);
}

function componentButtons(element: FakeElement): ButtonComponent[] {
	return element.children.flatMap((child) => (child instanceof FakeElement ? componentButtons(child) : [child]));
}

test("two line-changed on one note make 1 Notice and 1 setMessage", () => {
	Notice.instances = [];
	const opened: unknown[] = [];
	const presenter = createNoticePresenter({} as App, {
		document: documentStub,
		openNote: async (...args) => {
			opened.push(args);
		},
	});
	presenter.refuse("line-changed", context);
	presenter.refuse("line-changed", { ...context, line: 5, text: "Buy bread" });
	assert.equal(Notice.instances.length, 1);
	assert.equal(Notice.instances[0].setMessages.length, 1);
	assert.equal(Notice.instances[0].duration, 8000);
	const buttons = elementButtons(Notice.instances[0].message as FakeElement);
	assert.deepEqual(
		buttons.map((button) => button.textContent),
		["Open note"],
	);
	buttons[0].click();
	assert.deepEqual(opened, [["Notes/Home.md", 5]]);
	Notice.instances[0].hide();
	presenter.refuse("line-changed", context);
	assert.equal(Notice.instances.length, 2);
	presenter.dispose();
});

test("not-utf8 has no Open note", () => {
	Notice.instances = [];
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	presenter.refuse("not-utf8", context);
	assert.equal(typeof Notice.instances[0].message, "string");
	assert.equal(Notice.instances[0].message, refusalText("not-utf8", context));
	presenter.dispose();
});

test("expired undo notices use the exact refusal text and merge while visible", () => {
	Notice.instances = [];
	const presenter = createNoticePresenter({} as App, { document: documentStub });
	const message = "Could not undo: the change to “Buy milk” was too long ago. Nothing was written.";
	assert.equal(presenter.undoExpired(context), message);
	presenter.undoExpired(context);
	assert.equal(Notice.instances.length, 1);
	assert.equal(Notice.instances[0].duration, 8000);
	assert.equal(Notice.instances[0].setMessages.length, 1);
	assert.ok((Notice.instances[0].message as FakeElement).textContent.startsWith(message));
	presenter.dispose();
});

test("Copy failure shows the failure text, the text box stays", async () => {
	const copied: string[] = [];
	const modal = new EditRecoveryModal({} as App, "Edit not saved", context, "- [ ] edited", {
		clipboard: {
			writeText: async (text) => {
				copied.push(text);
				throw new Error("denied");
			},
		},
		openNote: async () => {},
	});
	modal.open();
	assert.equal((modal.titleEl as unknown as FakeElement).text, "Edit not saved");
	const content = modal.contentEl as unknown as FakeElement;
	const box = content.children.find(
		(child) => child instanceof FakeElement && child.tag === "textarea",
	) as FakeElement;
	assert.equal(box.value, "- [ ] edited");
	assert.equal(box.readOnly, true);
	assert.deepEqual(copied, []);
	const buttons = componentButtons(content);
	assert.deepEqual(
		buttons.map((button) => button.buttonText),
		["Copy", "Open note"],
	);
	await buttons[0].click();
	assert.deepEqual(copied, ["- [ ] edited"]);
	assert.equal(COPY_FAILURE_TEXT, "Couldn't copy. Select the text and copy it yourself.");
	assert.ok(content.textContent.includes(COPY_FAILURE_TEXT));
	assert.ok(content.children.includes(box));
	assert.equal(box.value, "- [ ] edited");
	modal.close();
});

test("Edit changed back keeps the edited line out of notices", () => {
	Notice.instances = [];
	const modal = new EditRecoveryModal({} as App, "Edit changed back", context, "- [ ] private edited line", {
		openNote: async () => {},
	});
	modal.open();
	assert.equal((modal.titleEl as unknown as FakeElement).text, "Edit changed back");
	assert.equal(Notice.instances.length, 0);
	modal.close();
});

test("slow notices merge per note and undo notices stack with their durations and buttons", () => {
	Notice.instances = [];
	let undone = 0;
	const presenter = createNoticePresenter({} as App, { document: documentStub, openNote: async () => {} });
	presenter.slow(context);
	presenter.slow(context);
	assert.equal(Notice.instances.length, 1);
	assert.equal(Notice.instances[0].duration, 8000);
	presenter.undo(context, { kind: "complete" }, () => {
		undone++;
	});
	presenter.undo(context, { kind: "complete" }, () => {
		undone++;
	});
	assert.equal(Notice.instances.length, 3);
	assert.equal(Notice.instances[1].duration, 10000);
	const buttons = elementButtons(Notice.instances[1].message as FakeElement);
	assert.deepEqual(
		buttons.map((button) => button.textContent),
		["Undo", "Open note"],
	);
	buttons[0].click();
	assert.equal(undone, 1);
	presenter.undoDone(context);
	presenter.undoAlready(context);
	assert.equal(Notice.instances[3].duration, 4000);
	assert.equal(Notice.instances[4].duration, 4000);
	presenter.dispose();
	assert.ok(Notice.instances.every((notice) => notice.hidden));
});
