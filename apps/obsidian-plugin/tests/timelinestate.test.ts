// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "backbone";

import { parseTaskLine } from "@tasks-calendar-wrapper/core";
import { loadedSettings } from "../src/state/settings";
import { initialTimelineState, withOptions, withReload, type TimelineState } from "../src/state/timeline";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { moment } from "../utils/moment";
import { deeplyFrozen, nothingFrozen } from "./frozen";

// The timeline view's state, which replaced two Backbone models. A reload hands the bridge a new list shown exactly
// when Backbone saw the list change, which is when the old view rendered again and dropped the quick filter.

const task = (line: string) => {
	const parsed = parseTaskLine(line, { moment, path: "Inbox.md" });
	assert.ok(parsed, line);
	return parsed;
};

const state = (overrides: Partial<TimelineState> = {}): TimelineState =>
	Object.freeze({ ...initialTimelineState(), ...overrides });

test("the state starts with copies of the defaults and nothing read", () => {
	const first = initialTimelineState();
	assert.deepEqual(first, { options: defaultUserOptions, tasks: [], shown: [] });
	assert.notEqual(first.options, defaultUserOptions);
	assert.notEqual(initialTimelineState().options, first.options);
});

test("new options make a new state, also when they are the same, and keep the tasks and the list shown", () => {
	const before = state({ tasks: [task("- [ ] call")], shown: [{ id: "Inbox.md:0" }] as never });
	const options: UserOption = { ...defaultUserOptions, dateFormat: "YYYY" };
	const after = withOptions(before, options);
	assert.deepEqual(after.options, options);
	assert.notEqual(after.options, options, "a copy of what was handed in");
	assert.ok(deeplyFrozen(after.options));
	assert.ok(nothingFrozen(options), "what was handed in is not frozen");
	assert.equal(after.tasks, before.tasks);
	assert.equal(after.shown, before.shown);
	const again = withOptions(after, options);
	assert.notEqual(again, after);
	assert.notEqual(again.options, after.options);
	// Frozen options, as the plugin hands them, are copied too, so every push renders again.
	const frozen = loadedSettings({ dateFormat: "YYYY" });
	assert.notEqual(withOptions(after, frozen).options, frozen);
	assert.deepEqual(withOptions(after, frozen).options, frozen);
});

test("a reload takes the tasks read, and keeps the list shown when it holds the same", () => {
	const tasks = [task("- [ ] call 📅 2026-01-20")];
	const held = () => [{ id: "Inbox.md:0", text: "call", dates: { due: moment("2026-01-20", "YYYY-MM-DD", true) } }];
	const shown = held();
	const before = state({ tasks, shown: shown as never });
	const reread = [task("- [ ] call 📅 2026-01-20")];
	const same = withReload(before, reread, held() as never);
	assert.deepEqual(same.tasks, reread, "the tasks read last, though they are the same");
	assert.notEqual(same.tasks, reread, "in a new array");
	assert.notEqual(same.tasks, before.tasks);
	assert.ok(Object.isFrozen(same.tasks));
	assert.ok(!Object.isFrozen(reread), "what was handed in is not frozen");
	assert.equal(same.shown, before.shown, "the list shown is the one before");
	const changed = [{ ...shown[0], text: "call again" }];
	const after = withReload(before, reread, changed as never);
	assert.equal(after.shown, changed);
});

test("a reload sets missing task files to none, as the old view did, and keeps them otherwise", () => {
	for (const missing of [undefined, null, ""]) {
		const before = state({ options: { ...defaultUserOptions, taskFiles: missing as never } });
		assert.deepEqual(withReload(before, [], []).options.taskFiles, [], String(missing));
	}
	const files = ["Inbox.md"];
	const before = state({ options: { ...defaultUserOptions, taskFiles: files } });
	const after = withReload(before, [], []);
	assert.equal(after.options, before.options, "the same options when nothing is set");
});

test("reloads and new options leave the state they start from as it was", () => {
	const before = state({ options: Object.freeze({ ...defaultUserOptions, taskFiles: undefined as never }) });
	withOptions(before, { ...defaultUserOptions });
	withReload(before, [task("- [ ] call")], [{ id: "x" }] as never);
	assert.deepEqual(before, state({ options: { ...defaultUserOptions, taskFiles: undefined as never } }));
});

// The rule is pinned against Backbone itself: on generated lists, a reload keeps the list shown exactly when
// Backbone's Model.set finds nothing changed.

/** mulberry32, a small seeded generator, so a failure can be run again. */
function random(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Next = () => number;
const pick = <T>(next: Next, items: readonly T[]): T => items[Math.floor(next() * items.length)];

/** A date as the parser makes them, strictly or loosely parsed, or none. */
function dateOf(next: Next): unknown {
	const day = pick(next, ["2026-01-20", "2026-01-21", "2026-02-01"]);
	return pick(next, [() => moment(day, "YYYY-MM-DD", true), () => moment(day), () => undefined, () => null])();
}

/** An entry of a held list, with the kinds of values heldOf holds, and a Map, which Backbone's compare skips. */
function heldOfRandom(next: Next): Record<string, unknown> {
	const entry: Record<string, unknown> = {
		id: pick(next, ["Inbox.md:0", "Inbox.md:1", "Later.md:0"]),
		text: pick(next, ["call", "call again", ""]),
		tags: pick(next, [[], ["#a"], ["#a", "#b"], ["#b", "#a"]]),
		dates: { due: dateOf(next), start: dateOf(next) },
		frontmatter: pick(next, [undefined, {}, { color: "red" }, { color: "red", status: "open" }]),
		extra: new Map(pick(next, [[], [["unplanned", "x"]]]) as [string, string][]),
	};
	if (next() < 0.3) delete entry.frontmatter;
	if (next() < 0.2) entry.position = { start: { line: 0, col: 0, offset: 0 } };
	return entry;
}

/** The entry changed the way a reload can change it, or only copied, or with its keys in another order. */
function variantOf(next: Next, entry: Record<string, unknown>): Record<string, unknown> {
	const copy = (value: unknown): unknown =>
		moment.isMoment(value)
			? value.clone()
			: value instanceof Map
				? new Map(value)
				: Array.isArray(value)
					? value.map(copy)
					: value && typeof value === "object"
						? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]))
						: value;
	const same = copy(entry) as Record<string, unknown>;
	return pick(next, [
		() => same,
		() => Object.fromEntries(Object.entries(same).reverse()),
		() => ({ ...same, text: pick(next, ["call", "call again", ""]) }),
		() => ({ ...same, dates: { ...(same.dates as object), due: dateOf(next) } }),
		() => ({ ...same, frontmatter: undefined }),
		() => {
			const rest = { ...same };
			delete rest.frontmatter;
			return rest;
		},
		() => ({ ...same, extra: new Map([["other", "y"]]) }),
		() => ({ ...same, tags: [...(same.tags as string[])].reverse() }),
	])();
}

test("a reload keeps the list shown exactly when Backbone saw no change, on 3,000 generated lists", () => {
	const next = random(20261021);
	let kept = 0;
	for (let n = 0; n < 3000; n++) {
		const before = Array.from({ length: Math.floor(next() * 3) }, () => heldOfRandom(next));
		const after =
			next() < 0.1
				? Array.from({ length: Math.floor(next() * 3) }, () => heldOfRandom(next))
				: before.map((entry) => variantOf(next, entry));
		const model = new Model({ shown: before });
		model.set({ shown: after });
		const reloaded = withReload(state({ shown: before as never }), [], after as never);
		if ((reloaded.shown as unknown) === before) kept += 1;
		assert.equal(
			(reloaded.shown as unknown) !== before,
			model.hasChanged("shown"),
			`case ${n}: ${JSON.stringify({ before, after })}`,
		);
	}
	// Both outcomes come up often enough to mean something.
	assert.ok(kept > 600 && kept < 2400, `${kept} of 3,000 lists kept`);
});
