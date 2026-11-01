import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { act } from "react";
import { obsidianMarkupStates } from "../scripts/markup.mjs";
import type { UserOption } from "../src/useroptions";
import type { WriteEvent } from "../timeline/src/taskwriter";
import { mountView } from "./component-harness";
import { settingsOf, stateNames, stateOf } from "./visible-states";

export const defaultMarkupState = "light-today-all-days-no-counter";
const optionNames = [
	"useCounters",
	"useQuickEntry",
	"useYearHeader",
	"useRelative",
	"useRecurrence",
	"usePriority",
	"useTags",
	"useFileBadge",
	"useSection",
	"useModifyBadge",
	"useBuiltinStyle",
] as const;

// Fourteen today states, two entry positions, and the two extra exact states used by the Obsidian comparison.
export const markupStateNames = [
	...new Set([
		...stateNames.filter((name) => name.startsWith("light-today-")),
		"light-top-all-days-no-counter",
		"light-bottom-all-days-no-counter",
		...obsidianMarkupStates,
	]),
	...optionNames.map((name) => `option-${name}-off`),
	"mobile",
	"quick-filter",
	"overlay-pending",
	"row-dimmed",
];

type ViewFixture = Awaited<ReturnType<typeof mountView>>;

export function markupOptions(name: string): UserOption {
	assert.ok(markupStateNames.includes(name), `Unknown markup state: ${name}`);
	const options = settingsOf(stateOf(name.startsWith("light-") ? name : defaultMarkupState));
	const option = optionNames.find((key) => name === `option-${key}-off`);
	if (option) options[option] = false;
	return options;
}

async function select(fixture: ViewFixture, selector: string, value: string) {
	const input = fixture.root().querySelector<HTMLSelectElement>(selector);
	assert.ok(input, selector);
	await act(() => {
		input.value = value;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

/** Use the quick-entry controls, including its apply button, rather than injecting bridge state. */
export async function applyQuickFilter(fixture: ViewFixture) {
	await select(fixture, "select.actionName", "filter");
	await select(fixture, "select.filterSelector", "date");
	await select(fixture, "select.filterSelector", "priority");
	const dates = fixture.root().querySelectorAll<HTMLInputElement>('input[type="date"]');
	assert.equal(dates.length, 2);
	await act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
			setter.call(dates[index], value);
			dates[index].dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
	const apply = fixture.root().querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(apply);
	await act(() => apply.click());
}

export function pendingMarkupEvent(fixture: ViewFixture): WriteEvent {
	const task = fixture.store.getSnapshot().tasks.find((task) => task.path === "Inbox.md" && task.line === 3);
	assert.ok(task, "the overlay uses Inbox.md's first task");
	return {
		id: 1,
		kind: "pending",
		action: "toggle",
		path: task.path,
		line: task.line,
		sourceLine: task.sourceLine,
		lines: [task.sourceLine.replace("[ ]", "[x]")],
	};
}

/** Every state starts with its options, then follows the same clicks as screenshots.mjs or the writer event path. */
export async function reachMarkupState(fixture: ViewFixture, name: string) {
	if (name.startsWith("light-")) {
		const state = stateOf(name);
		for (const selector of [
			...(state.todayFocus ? ['[aria-label="Focus today"]'] : []),
			...(state.counter ? [`#${state.counter}`] : []),
		]) {
			const control = fixture.root().querySelector<HTMLElement>(selector);
			assert.ok(control, selector);
			await act(() => control.click());
		}
	} else if (name === "quick-filter") await applyQuickFilter(fixture);
	else if (name === "overlay-pending" || name === "row-dimmed") {
		const event = pendingMarkupEvent(fixture);
		await fixture.feed(event);
		if (name === "overlay-pending") await fixture.feed({ ...event, kind: "slow" });
	}
}

export async function mountMarkupState(t: TestContext, name: string) {
	const fixture = await mountView(t, { options: markupOptions(name) });
	await reachMarkupState(fixture, name);
	return fixture;
}
