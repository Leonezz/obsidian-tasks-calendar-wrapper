// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import type { App } from "obsidian";
import { parseNote, taskRowModel, type Task } from "@tasks-calendar-wrapper/core";
import { countRenders, mountView } from "./component-harness";
import { FIXTURES, goldenApp, loadVault } from "./golden-vault";
import { applyQuickFilter, pendingMarkupEvent } from "./markup-states";
import { SCREENSHOT_NOW, settingsOf, stateOf } from "./visible-states";
import { moment } from "../utils/moment";

moment.now = () => SCREENSHOT_NOW;
moment.locale("en");

const baseline = "light-today-all-days-no-counter";
const file = path.join(FIXTURES, "markup", "render-counts.json");
const update = process.env.UPDATE_MARKUP === "1";
type Mounted = Awaited<ReturnType<typeof mountView>>;

const isolatedFields = ["display", "statusMarker", "color", "badge ariaLabel"] as const;
type IsolatedField = (typeof isolatedFields)[number];
const targetId = "Priorities.md:11";

/** A parse-port projection isolates one rendered field without correlated source-line or position changes. */
function projectField(task: Task, field: IsolatedField): Task {
	if (field === "display") return { ...task, visual: task.visual + " changed" };
	if (field === "statusMarker") return { ...task, statusMarker: "?" };
	if (field === "color")
		return { ...task, note: { ...task.note, frontmatter: { ...task.note.frontmatter, color: "#123456" } } };
	const due = task.dates.due;
	assert.ok(due);
	const changed = Object.create(due) as typeof due;
	Object.defineProperty(changed, "format", {
		value: (format?: string) => due.format(format) + " changed",
		enumerable: true,
	});
	return { ...task, dates: { ...task.dates, due: changed } };
}

function targetModel(fixture: Mounted) {
	const state = fixture.store.getSnapshot();
	const resolved = state.resolved?.shown.shown.find(({ task }) => task.id === targetId);
	assert.ok(resolved);
	return taskRowModel(
		resolved,
		{
			dateFormat: state.options.dateFormat,
			hideTags: state.options.hideTags,
			tagPalette: state.options.tagColorPalette,
			useBuiltinStyle: state.options.useBuiltinStyle,
		},
		{ now: moment(), moment, warn: (message) => assert.fail(message) },
	);
}

async function click(fixture: Mounted, selector: string) {
	const target = fixture.container.querySelector<HTMLElement>(selector);
	assert.ok(target, selector);
	await act(() => target.click());
}

test("render counts: every operation matches fixtures/markup/render-counts.json", async (t) => {
	const counts = countRenders(t);
	const operations = [
		"mount",
		"counter click",
		"Focus on today click",
		"settings push with equal options",
		"settings push with different options",
		"reload with the list unchanged",
		"reload with one row changed",
		"checkbox overlay",
		"overlay cleared",
		"quick filter applied",
		...isolatedFields.map((field) => `reload with one row's ${field} changed`),
	] as const;
	const actual = [];
	for (const operation of operations) {
		const app: App = Object.assign(goldenApp(loadVault()), {
			plugins: { plugins: { "obsidian-tasks-plugin": { apiV1: { editTaskLineModal: async () => "" } } } },
		});
		const originalRead = app.vault.cachedRead.bind(app.vault);
		const contents = new Map<string, string>();
		app.vault.cachedRead = async (note) => contents.get(note.path) ?? originalRead(note);
		let changedField: IsolatedField | undefined;
		counts.reset();
		const fixture = await mountView(t, {
			app,
			options: settingsOf(stateOf(baseline)),
			parse: (snapshot, clock) => {
				const parsed = parseNote(snapshot, clock);
				if (!changedField) return parsed;
				const field = changedField;
				return {
					...parsed,
					tasks: parsed.tasks.map((task) => (task.id === targetId ? projectField(task, field) : task)),
				};
			},
		});
		try {
			const event = pendingMarkupEvent(fixture);
			if (operation === "overlay cleared") await fixture.feed(event);
			if (operation !== "mount") counts.reset();
			switch (operation) {
				case "mount":
					break;
				case "counter click":
					await click(fixture, "#todo");
					break;
				case "Focus on today click":
					await click(fixture, '[aria-label="Focus today"]');
					break;
				case "settings push with equal options":
					await fixture.pushOptions(structuredClone(fixture.options()));
					break;
				case "settings push with different options":
					await fixture.pushOptions({ ...fixture.options(), dateFormat: "YYYY/MM/DD" });
					break;
				case "reload with the list unchanged":
					await fixture.reload();
					break;
				case "reload with one row changed": {
					const note = app.vault.getMarkdownFiles().find((note) => note.path === event.path);
					assert.ok(note);
					contents.set(event.path, (await originalRead(note)).replace("Ground Control", "Flight Control"));
					fixture.edited(event.path);
					await fixture.reload();
					break;
				}
				case "checkbox overlay":
					await fixture.feed(event);
					break;
				case "overlay cleared":
					await fixture.feed({ ...event, kind: "released", releaseSeq: 1 });
					await fixture.reload();
					assert.equal(fixture.view.pendingWrites.getSnapshot(`${event.path}:${event.line}`), undefined);
					break;
				case "quick filter applied":
					await applyQuickFilter(fixture);
					break;
				default: {
					changedField = isolatedFields.find(
						(field) => operation === `reload with one row's ${field} changed`,
					);
					assert.ok(changedField, operation);
					const before = targetModel(fixture);
					fixture.edited("Priorities.md");
					await fixture.reload();
					const after = targetModel(fixture);
					if (changedField === "badge ariaLabel") {
						const index = before.badges.findIndex((badge) => badge.kind === "due");
						assert.notEqual(index, -1);
						assert.notEqual(after.badges[index].ariaLabel, before.badges[index].ariaLabel);
						assert.deepEqual(
							{
								...after,
								badges: after.badges.map((badge, i) =>
									i === index ? { ...badge, ariaLabel: before.badges[i].ariaLabel } : badge,
								),
							},
							before,
							"only one badge's ariaLabel changed",
						);
					} else {
						assert.notDeepEqual(after[changedField], before[changedField]);
						assert.deepEqual(
							{ ...after, [changedField]: before[changedField] },
							before,
							`only ${changedField} changed`,
						);
					}
				}
			}
			actual.push({
				operation,
				startState: operation === "overlay cleared" ? `${baseline} with one pending overlay` : baseline,
				...counts.snapshot(),
			});
		} finally {
			await fixture.unmount();
		}
	}
	counts.assertAllObserved();
	const serialized = JSON.stringify(actual, null, 2) + "\n";
	if (update) {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, serialized);
	} else {
		const message = `${file}: run UPDATE_MARKUP=1 pnpm test to update the render-count golden`;
		assert.ok(existsSync(file), message);
		const expected = JSON.parse(readFileSync(file, "utf8")) as typeof actual;
		assert.deepEqual(
			actual.map(({ operation }) => operation),
			expected.map(({ operation }) => operation),
			message,
		);
		for (const [index, operation] of actual.entries()) {
			await t.test(operation.operation, () => {
				assert.deepEqual(operation, expected[index], `${message} (${operation.operation})`);
			});
		}
		assert.equal(JSON.stringify(expected, null, 2) + "\n", readFileSync(file, "utf8"), message);
	}
});
