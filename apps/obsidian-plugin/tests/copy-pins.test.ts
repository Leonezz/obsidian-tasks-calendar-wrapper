// Pin verbatim user-visible strings no other test pins, so the move into the copy table (phase 4 step 11)
// is checked byte for byte. These tests must stay green, unchanged.
import "./setup";

import { beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { createStore } from "@tasks-calendar-wrapper/core";

import TasksCalendarWrapper from "../src/main";
import { initialTimelineState } from "../src/state/timeline";
import { WhatsNewModal } from "../src/whatsnew-modal";
import { bridgeActions } from "./component-harness";
import { fakeVault } from "./fakevault";
import { ButtonComponent, FakeElement, Notice, TFile, type AddedCommand } from "./stubs/obsidian";
import { openView, unusedWriter } from "./view-harness";

beforeEach(() => {
	Notice.shown = [];
	Notice.instances = [];
});

/** Every button the modal shows, in order. */
function buttons(element: FakeElement): ButtonComponent[] {
	return element.children.flatMap((child) => (child instanceof FakeElement ? buttons(child) : [child]));
}

/** Lets the command and bridge's fire-and-forget error handlers finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function startPlugin(t: TestContext) {
	const vault = fakeVault({}, { layoutReady: false });
	const plugin = new TasksCalendarWrapper(
		vault.app as never,
		{
			id: "tasks-calendar-wrapper",
			name: "Tasks Calendar Wrapper",
			version: "0.3.7",
		} as never,
	) as TasksCalendarWrapper & { commands: readonly AddedCommand[] };
	t.after(() => plugin.unload());
	await plugin.load();
	return { vault, plugin };
}

async function assertOpenFailure(t: TestContext, reason: unknown, expected: string) {
	t.mock.method(console, "error", () => {});
	const file = new TFile();
	file.setPath("Notes/a.md");
	const app = {
		vault: { getFileByPath: (path: string) => (path === file.path ? file : null) },
		workspace: {
			getLeaf: () => ({
				openFile: async () => {
					throw reason;
				},
			}),
		},
	};
	const bridge = bridgeActions({
		plugin: { app } as never,
		store: createStore(initialTimelineState()),
		writer: unusedWriter,
	});
	t.after(() => bridge.unmount());
	bridge.handleOpenFile(file.path, {
		start: { line: 0, col: 0, offset: 0 },
		end: { line: 0, col: 0, offset: 0 },
	});
	await settle();
	assert.deepEqual(Notice.shown, [expected]);
	assert.equal(Notice.instances.length, 1);
	assert.equal(Notice.instances[0].duration, 5000);
}

test("the timeline view's display text is Tasks Timeline", (t) => {
	const { view } = openView(fakeVault({}).app);
	t.after(() => view.onClose());
	assert.equal(view.getDisplayText(), "Tasks Timeline");
});

test("the what's-new modal pins its title, version headings, support text and buttons", (t) => {
	const modal = new WhatsNewModal(
		{} as App,
		[
			{ version: "1.2.0", items: ["A newer release."] },
			{ version: "1.1.0", items: ["An older release."] },
		],
		[{ label: "Support development", url: "https://example.com/support" }],
	);
	t.after(() => modal.close());
	modal.open();
	const content = modal.contentEl as unknown as FakeElement;
	const elements = content.children.filter((child): child is FakeElement => child instanceof FakeElement);
	assert.equal(modal.titleEl.textContent, "What's new in Tasks Calendar Wrapper");
	assert.deepEqual(
		elements.filter((element) => element.tag === "h4").map((element) => element.textContent),
		["Version 1.2.0", "Version 1.1.0"],
	);
	assert.deepEqual(
		elements.filter((element) => element.tag === "p").map((element) => element.textContent),
		["If you find this plugin useful, a star on GitHub or your support for its development helps a lot."],
	);
	assert.deepEqual(
		buttons(content).map((button) => button.buttonText),
		["⭐ Star on GitHub", "Support development", "Thanks!"],
	);
});

test("a failed note open shows Could not open Notes/a.md: disk gone for five seconds", async (t) => {
	await assertOpenFailure(t, new Error("disk gone"), "Could not open Notes/a.md: disk gone");
});

test("a note open rejected with a string shows Could not open Notes/a.md: nope for five seconds", async (t) => {
	await assertOpenFailure(t, "nope", "Could not open Notes/a.md: nope");
});

test("a failed timeline command pins the open-view failure notice for five seconds", async (t) => {
	t.mock.method(console, "error", () => {});
	const { vault, plugin } = await startPlugin(t);
	const leaf = vault.app.workspace.getRightLeaf(false);
	t.mock.method(leaf, "setViewState", async () => {
		throw new Error("view unavailable");
	});
	t.mock.method(vault.app.workspace, "getRightLeaf", () => leaf);
	const command = plugin.commands.find((command) => command.id === "tasks-calendar-wrapper:open-tasks-timeline-view");
	assert.ok(command?.callback);
	command.callback();
	await settle();
	assert.deepEqual(Notice.shown, ["Failed to open the timeline view. See the developer console for details."]);
	assert.equal(Notice.instances.length, 1);
	assert.equal(Notice.instances[0].duration, 5000);
});
