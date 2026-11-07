// Pins the state a timeline opens with across pushes, and the entry day's keys.
// Must stay green, unchanged, when TimelineView becomes a function component.
import "./golden-clock";
import "./setup";

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseTaskLine } from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { readTasks } from "../timeline/src/taskadapter";
import { moment } from "../utils/moment";
import { timelineElement } from "./component-harness";
import { goldenApp, loadVault } from "./golden-vault";

async function mountTimeline(t: TestContext, props: Parameters<typeof timelineElement>[0]) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	const render = async (next: typeof props) => {
		await act(() => root.render(timelineElement(next)));
	};
	await render(props);
	return { container, render };
}

test("an open timeline keeps the filter and today focus it opened with, and takes other options when they change", async (t) => {
	const opened: UserOption = { ...defaultUserOptions, defaultFilters: "todoFilter", defaultTodayFocus: true };
	const pushed: UserOption = { ...defaultUserOptions, useCounters: false };
	const { container, render } = await mountTimeline(t, { userOptions: opened, tasks: [] });
	const timeline = container.querySelector(".taskido");
	assert.ok(timeline);
	assert.match(timeline.className, /todoFilter/);
	assert.match(timeline.className, /todayFocus/);
	assert.doesNotMatch(timeline.className, /noCounters/);
	const stateClasses = () => [...timeline.classList].filter((name) => /Filter$|Focus$/.test(name));
	// Counters are active through the root's Filter/Focus class and their id, as styles.css selects them.
	const counters = () =>
		[...container.querySelectorAll(".counter")].map((counter) => ({
			id: counter.id,
			active: counter.matches(
				`.taskido.${counter.id}Filter .counter#${counter.id}, .taskido.${counter.id}Focus .counter#${counter.id}`,
			),
		}));
	const beforeClasses = stateClasses();
	const beforeCounters = counters();
	assert.deepEqual(beforeClasses, ["todoFilter", "todayFocus"]);
	assert.deepEqual(beforeCounters, [
		{ id: "todo", active: true },
		{ id: "overdue", active: false },
		{ id: "unplanned", active: false },
	]);
	assert.ok(container.querySelector(".taskido.todayFocus .todayHeader"));

	await render({ userOptions: pushed, tasks: [] });
	assert.equal(container.querySelector(".taskido"), timeline);
	assert.match(timeline.className, /todoFilter/, "the filter it opened with");
	assert.match(timeline.className, /todayFocus/, "the today focus it opened with");
	assert.match(timeline.className, /noCounters/, "an option read on every push");
	assert.deepEqual(stateClasses(), beforeClasses, "the counter and Focus classes survive the push");
	assert.deepEqual(counters(), beforeCounters, "the counters keep their active state even when hidden by CSS");
	assert.ok(container.querySelector(".taskido.todayFocus .todayHeader"));

	const reopened = await mountTimeline(t, { userOptions: pushed, tasks: [] });
	const newTimeline = reopened.container.querySelector(".taskido");
	assert.ok(newTimeline);
	assert.doesNotMatch(newTimeline.className, /todoFilter|todayFocus/, "a timeline opened after the change");
});

test("the entry day is rebuilt when a year is inserted before it and kept when one is appended", async (t) => {
	const tasks = await readTasks(goldenApp(loadVault()), defaultUserOptions, moment);
	// Keep overdue rows in their dated year so each added year also has its task row.
	const userOptions = { ...defaultUserOptions, forward: false };
	const { container, render } = await mountTimeline(t, { userOptions, tasks });
	const years = () => [...container.querySelectorAll(".year")].map((header) => Number(header.textContent));
	const entryPanel = () => {
		const panels = container.querySelectorAll(".quickEntryPanel");
		assert.equal(panels.length, 1);
		return panels[0];
	};
	const originalYears = years();
	assert.ok(originalYears.includes(moment().year()), "the entry's year is present in the golden timeline");
	assert.ok(container.querySelectorAll(".task").length > 0, "the golden tasks are rendered");
	const originalEntry = entryPanel();
	const beforeYear = Math.min(...originalYears) - 1;
	const before = parseTaskLine(`- [ ] before all years 📅 ${beforeYear}-01-01`, { moment, path: "Before.md" });
	assert.ok(before);
	const withBefore = [...tasks, before];
	await render({ userOptions, tasks: withBefore });
	assert.deepEqual(
		years(),
		[beforeYear, ...originalYears],
		"the earlier task adds a year before every existing year",
	);
	assert.equal(
		container.querySelector(`.details[data-year="${beforeYear}"] .task .content`)?.textContent,
		"before all years",
	);
	const rebuiltEntry = entryPanel();
	assert.notEqual(rebuiltEntry, originalEntry, "inserting a year before the entry rebuilds it");

	const afterYear = Math.max(...years()) + 1;
	const after = parseTaskLine(`- [ ] after all years 📅 ${afterYear}-01-01`, { moment, path: "After.md" });
	assert.ok(after);
	await render({ userOptions, tasks: [...withBefore, after] });
	assert.deepEqual(
		years(),
		[beforeYear, ...originalYears, afterYear],
		"the later task appends a year after all others",
	);
	assert.equal(
		container.querySelector(`.details[data-year="${afterYear}"] .task .content`)?.textContent,
		"after all years",
	);
	assert.equal(entryPanel(), rebuiltEntry, "appending a year keeps the entry day");
});
