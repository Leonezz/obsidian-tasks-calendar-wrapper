// Pin dates and locale before mounting the real golden view.
import "./golden-clock";
import "./setup";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { act } from "react";
import { flushSync } from "react-dom";

import {
	applyExpandedFilter,
	collectExpandedFilter,
	assertExpandedFilter,
	type ExpandedFilterCollection,
} from "../scripts/screenshots-expanded-filter.mjs";
import { TIMELINE_VIEW } from "../src/views";
import { defaultUserOptions } from "../src/useroptions";
import { mountView } from "./component-harness";

async function expandedPage(t: TestContext) {
	const fixture = await mountView(t, {
		options: {
			...structuredClone(defaultUserOptions),
			defaultFilters: "",
			defaultTodayFocus: false,
			entryPosition: "top",
			counterBehavior: "Filter",
		},
	});
	const leaf = document.createElement("div");
	leaf.className = "workspace-leaf-content";
	leaf.dataset.type = TIMELINE_VIEW;
	fixture.container.className = "view-content";
	fixture.container.before(leaf);
	leaf.append(fixture.container);
	t.after(() => leaf.remove());
	const panel = fixture.root().querySelector<HTMLElement>(".quickEntryPanel");
	assert.ok(panel);
	fixture.container.getBoundingClientRect = () => new window.DOMRect(20, 24, 556, 560);
	panel.getBoundingClientRect = () => new window.DOMRect(30, 50, 536, 120);
	fixture.container.scrollTop = 0;
	const browser = {
		document,
		app: {
			workspace: {
				getLeavesOfType: (type: string) => (type === TIMELINE_VIEW ? [{ view: fixture.view }] : []),
			},
		},
		innerWidth: 600,
		innerHeight: 600,
		devicePixelRatio: 1,
		argument: { viewType: TIMELINE_VIEW },
	};
	const collect = () =>
		JSON.parse(
			JSON.stringify(runInNewContext(`(${collectExpandedFilter.toString()})(argument)`, browser)),
		) as ExpandedFilterCollection;
	const drive = async () => {
		// Browser timers normally allow React to commit between events; act retains that work in jsdom.
		const setTimeout = window.setTimeout.bind(window);
		const timer = t.mock.method(window, "setTimeout", (handler: TimerHandler, delay?: number) =>
			setTimeout(() => {
				flushSync(() => {});
				assert.equal(typeof handler, "function");
				(handler as () => void)();
			}, delay),
		);
		try {
			await act(async () => {
				assert.equal(await runInNewContext(`(${applyExpandedFilter.toString()})(argument)`, browser), true);
			});
		} finally {
			timer.mock.restore();
		}
	};
	return { ...fixture, collect, drive };
}

async function select(root: HTMLElement, selector: string, value: string) {
	const element = root.querySelector<HTMLSelectElement>(selector);
	assert.ok(element, selector);
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(element, value);
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function draft(root: HTMLElement) {
	await select(root, "select.actionName", "filter");
	await select(root, "select.filterSelector", "date");
	await select(root, "select.filterSelector", "priority");
	const dates = root.querySelectorAll<HTMLInputElement>('input[type="date"]');
	assert.equal(dates.length, 2);
	await act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
			setter.call(dates[index], value);
			dates[index].dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
	await select(root, 'select[name="priorityFilter"]', "High");
	await select(root, 'select[name="priorityFilter"]', "No");
	await select(root, "select.filterSelector", "+");
	await select(root, 'select[name="priorityFilter"]', "+");
}

test("serialized collector distinguishes real unsubmitted controls from the applied filter and rows", async (t) => {
	const fixture = await expandedPage(t);
	const initial = fixture.collect();
	assert.equal(initial.semantic.controls.action, "append");
	assert.equal(initial.semantic.applied, null);
	assert.ok(initial.semantic.rows.length > 0, "the golden timeline is fully mounted");
	await draft(fixture.root());
	const unsubmitted = fixture.collect();
	assert.equal(unsubmitted.semantic.applied, null, "editing controls must not impersonate an applied filter");
	assert.deepEqual(unsubmitted.semantic.controls.dates, ["2026-01-10", "2026-01-20"]);
	assert.deepEqual(unsubmitted.semantic.controls.priorityChips, ["High🎯", "None🎯"]);
	assert.deepEqual(unsubmitted.semantic.rows, initial.semantic.rows);
	assert.throws(() => assertExpandedFilter(unsubmitted), /applied|actual|expected|Expected/i);
	const button = fixture.root().querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(button);
	await act(() => button.click());
	const applied = fixture.collect();
	assertExpandedFilter(applied);
	assert.deepEqual(applied.semantic.applied, {
		from: "2026-01-10",
		to: "2026-01-20",
		priorities: ["High", "No", ""],
		tags: [],
	});
	assert.ok(applied.semantic.rows.length < initial.semantic.rows.length);
	assert.deepEqual(applied.geometry, {
		content: { x: 20, y: 24, width: 556, height: 560 },
		panel: { x: 30, y: 50, width: 536, height: 120 },
		scrollTop: 0,
		viewport: { width: 600, height: 600, deviceScaleFactor: 1 },
	});
});

test("serialized browser driver selects High and None, resets closed selects and clicks the real apply button", async (t) => {
	const fixture = await expandedPage(t);
	assert.equal(fixture.collect().semantic.applied, null);
	await fixture.drive();
	const record = fixture.collect();
	assertExpandedFilter(record);
	assert.equal(record.semantic.controls.priorityClosedValue, "+");
	assert.equal(record.semantic.controls.filterClosedValue, "+");
	assert.deepEqual(record.semantic.controls.priorityOptions, [
		{ value: "+", label: "Add priority" },
		{ value: "Highest", label: "Highest" },
		{ value: "High", label: "High🎯" },
		{ value: "Medium", label: "Medium" },
		{ value: "No", label: "None🎯" },
		{ value: "Low", label: "Low" },
		{ value: "Lowest", label: "Lowest" },
	]);
});

test("collected row identity ignores React owner prefixes and rejects ambiguous DOM identities", async (t) => {
	const fixture = await expandedPage(t);
	await draft(fixture.root());
	const button = fixture.root().querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(button);
	await act(() => button.click());
	const before = fixture.collect();
	const rows = [...fixture.root().querySelectorAll<HTMLElement>(".task")];
	assert.equal(rows.length, before.semantic.rows.length);
	for (const [index, row] of rows.entries()) {
		const { day, path, line } = before.semantic.rows[index];
		const instance = `${day}-${encodeURIComponent(`${path}:${line}`)}`;
		row.setAttribute(
			"aria-labelledby",
			`another-react-owner-${instance}-text another-react-owner-${instance}-summary`,
		);
	}
	assert.deepEqual(fixture.collect(), before);
	const first = rows[0];
	assert.ok(first);
	const file = first.querySelector<HTMLElement>("a.file[aria-label]");
	assert.ok(file);
	const label = file.getAttribute("aria-label")!;
	file.removeAttribute("aria-label");
	assert.throws(() => fixture.collect(), /identity/i);
	file.setAttribute("aria-label", label);
	const line = first.getAttribute("data-line")!;
	first.setAttribute("data-line", "1.5");
	assert.throws(() => fixture.collect(), /identity/i);
	first.setAttribute("data-line", line);
	first.setAttribute("aria-labelledby", "unrelated-react-text");
	assert.throws(() => fixture.collect(), /date instance/i);
});

test("canonical assertions reject busy or duplicate rows, noncanonical controls and viewport settings", async (t) => {
	const fixture = await expandedPage(t);
	await draft(fixture.root());
	const button = fixture.root().querySelector<HTMLButtonElement>(".quickEntryPanel button.ok");
	assert.ok(button);
	await act(() => button.click());
	const valid = fixture.collect();
	assertExpandedFilter(valid);
	for (const change of [
		(record: ExpandedFilterCollection) => {
			record.semantic.rows[0].busy = true;
		},
		(record: ExpandedFilterCollection) => {
			record.semantic.rows.push({ ...record.semantic.rows[0] });
		},
		(record: ExpandedFilterCollection) => {
			record.semantic.controls.priorityClosedValue = "No";
		},
		(record: ExpandedFilterCollection) => {
			record.semantic.entryPosition = "today";
		},
		(record: ExpandedFilterCollection) => {
			record.geometry.viewport.width = 599;
		},
		(record: ExpandedFilterCollection) => {
			record.geometry.scrollTop = 10;
		},
	]) {
		const invalid = structuredClone(valid);
		change(invalid);
		assert.throws(() => assertExpandedFilter(invalid));
	}
});
