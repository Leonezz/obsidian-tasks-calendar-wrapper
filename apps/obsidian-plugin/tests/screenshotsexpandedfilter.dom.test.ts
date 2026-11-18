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
	const collect = () => {
		const mountedPanel = fixture.root().querySelector<HTMLElement>(".quickEntryPanel");
		assert.ok(mountedPanel);
		mountedPanel.getBoundingClientRect = () => new window.DOMRect(30, 50, 536, 120);
		return JSON.parse(
			JSON.stringify(runInNewContext(`(${collectExpandedFilter.toString()})(argument)`, browser)),
		) as ExpandedFilterCollection;
	};
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
		} catch (error) {
			throw new Error(`${String(error)}; applied: ${JSON.stringify(collect().semantic.applied)}`);
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

async function draftDates(root: HTMLElement) {
	await select(root, "select.dateScope", "custom");
	const dates = root.querySelectorAll<HTMLInputElement>(".dateRange input");
	assert.equal(dates.length, 2);
	await act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		for (const [index, value] of ["2026-01-10", "2026-01-20"].entries()) {
			setter.call(dates[index], value);
			dates[index].dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
}

async function applyDates(root: HTMLElement) {
	const button = root.querySelector<HTMLButtonElement>(".applyDateRange");
	assert.ok(button);
	await act(() => button.click());
}

async function choosePriorities(root: HTMLElement) {
	for (const value of ["High", "No"]) {
		const details = root.querySelector<HTMLDetailsElement>(".priorityFilter");
		const summary = details?.querySelector("summary");
		assert.ok(details);
		assert.ok(summary);
		if (!details.open) await act(() => summary.click());
		assert.equal(details.open, true);
		const input = details.querySelector<HTMLInputElement>(`input[value="${value}"]`);
		assert.ok(input);
		await act(() => input.click());
		assert.equal(root.querySelector<HTMLInputElement>(`.priorityOptions input[value="${value}"]`)?.checked, true);
	}
	const details = root.querySelector<HTMLDetailsElement>(".priorityFilter");
	const summary = details?.querySelector("summary");
	assert.ok(details);
	assert.ok(summary);
	if (details.open) await act(() => summary.click());
	assert.equal(details.open, false);
}

async function canonical(root: HTMLElement) {
	await draftDates(root);
	await applyDates(root);
	await choosePriorities(root);
}

test("serialized collector distinguishes an unsubmitted date draft from applied dates and immediate priorities", async (t) => {
	const fixture = await expandedPage(t);
	const initial = fixture.collect();
	assert.equal(initial.semantic.controls.dateScope, "all");
	assert.equal(initial.semantic.controls.entryText, "");
	assert.equal(initial.semantic.applied, null);
	assert.ok(initial.semantic.rows.length > 0, "the golden timeline is fully mounted");
	await draftDates(fixture.root());
	const unsubmitted = fixture.collect();
	assert.equal(unsubmitted.semantic.applied, null, "editing controls must not impersonate an applied filter");
	assert.deepEqual(unsubmitted.semantic.controls.dates, ["2026-01-10", "2026-01-20"]);
	assert.ok(unsubmitted.semantic.controls.priorityOptions.every((option) => !option.checked));
	assert.deepEqual(unsubmitted.semantic.rows, initial.semantic.rows);
	assert.throws(() => assertExpandedFilter(unsubmitted), /applied|actual|expected|Expected/i);
	await applyDates(fixture.root());
	assert.deepEqual(fixture.collect().semantic.applied, {
		from: "2026-01-10",
		to: "2026-01-20",
		priorities: [],
		tags: [],
	});
	await choosePriorities(fixture.root());
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

test("serialized browser driver applies dates, selects High and None immediately and closes the native menu", async (t) => {
	const fixture = await expandedPage(t);
	assert.equal(fixture.collect().semantic.applied, null);
	await fixture.drive();
	const record = fixture.collect();
	assertExpandedFilter(record);
	assert.equal(record.semantic.controls.priorityOpen, false);
	assert.equal(record.semantic.controls.dateScope, "custom");
	assert.equal(record.semantic.controls.prioritySummary, "Priority (2)");
	assert.deepEqual(record.semantic.controls.priorityOptions, [
		{ value: "Highest", label: "Highest", checked: false },
		{ value: "High", label: "High", checked: true },
		{ value: "Medium", label: "Medium", checked: false },
		{ value: "No", label: "None", checked: true },
		{ value: "Low", label: "Low", checked: false },
		{ value: "Lowest", label: "Lowest", checked: false },
	]);
});

test("serialized filter driver preserves a task draft instead of switching or submitting the composer", async (t) => {
	const fixture = await expandedPage(t);
	const input = fixture.root().querySelector<HTMLInputElement>("input.newTask");
	assert.ok(input);
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
			input,
			"Keep this draft",
		);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await fixture.drive();
	const record = fixture.collect();
	assert.equal(record.semantic.controls.entryText, "Keep this draft");
	assert.ok(!record.semantic.rows.some((row) => row.text === "Keep this draft"));
	record.semantic.controls.entryText = "";
	assertExpandedFilter(record);
});

test("collected row identity ignores React owner prefixes and rejects ambiguous DOM identities", async (t) => {
	const fixture = await expandedPage(t);
	await canonical(fixture.root());
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
	await canonical(fixture.root());
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
			record.semantic.controls.priorityOpen = true;
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
