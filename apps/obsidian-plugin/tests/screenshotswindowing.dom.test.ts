import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
	collectViewportRows,
	compareOpeningScroll,
	compareViewportRows,
	windowingPage,
	type ViewportMeasurement,
	type ViewportRect,
	type ViewportRow,
	type ViewportSample,
} from "../scripts/screenshots-windowing.mjs";

const rect = (left: number, top: number, right: number, bottom: number): ViewportRect => ({ left, top, right, bottom });
const row = (day = "2026-01-15", text = "A task"): ViewportRow => ({
	day,
	path: "Note.md",
	line: 3,
	text,
	status: " ",
	rect: rect(10, 20, 100, 60),
});
const sample = (windowed: boolean, rows: readonly ViewportRow[] = [row()]): ViewportSample => ({
	viewport: rect(0, 0, 200, 100),
	scrollTop: 0,
	scrollHeight: 60_000,
	mountedRows: windowed ? 30 : 1_000,
	rowCount: 1_000,
	windowed,
	logicalWindowed: windowed,
	rows,
});

test("both arms must open at zero before explicit top alignment", () => {
	for (const arm of ["off", "default"] as const) {
		for (const scrollTop of [0, 0.5, -0.5]) assert.deepEqual(compareOpeningScroll(arm, { scrollTop }), []);
		for (const scrollTop of [32, -1, 0.51]) {
			const problems = compareOpeningScroll(arm, { scrollTop });
			assert.equal(problems.length, 1);
			assert.equal(problems[0].kind, "opening");
			assert.ok(problems[0].detail?.includes(`${arm} opened at scrollTop=${scrollTop}`));
		}
	}
});

test("viewport parity compares day/path/line instances and text, not all mounted DOM", () => {
	const rows = [row(), row("2026-01-16")];
	assert.deepEqual(compareViewportRows(sample(false, rows), sample(true, rows)), []);
	const changed = sample(true, [row(), row("2026-01-16", "Changed task")]);
	assert.deepEqual(
		compareViewportRows(sample(false, rows), changed).map(({ kind, index }) => [kind, index]),
		[["row", 1]],
	);
	assert.ok(
		compareViewportRows(sample(false, rows), sample(true, [...rows].reverse())).some(({ kind }) => kind === "row"),
	);
	assert.ok(
		compareViewportRows(sample(false, rows), sample(true, [rows[0]])).some(
			({ kind, index }) => kind === "row" && index === 1,
		),
	);
});

test("empty viewports, wrong modes, duplicate instances and full mounting cannot pass parity", () => {
	const base = sample(false);
	for (const candidate of [
		{ ...sample(true), rows: [] },
		{ ...sample(true), windowed: false },
		{ ...sample(true), logicalWindowed: false },
		{ ...sample(true), mountedRows: 1_000 },
		{ ...sample(true), rowCount: 999 },
		{ ...sample(true), viewport: rect(0, 0, 250, 100) },
	])
		assert.ok(compareViewportRows(base, candidate).length);
	assert.ok(compareViewportRows({ ...base, mountedRows: 999 }, sample(true)).some(({ kind }) => kind === "mounted"));
	const duplicates = [row(), row()];
	assert.ok(
		compareViewportRows(sample(false, duplicates), sample(true, duplicates)).some(
			({ kind }) => kind === "duplicate",
		),
	);
});

function box(
	element: Element,
	area: ViewportRect,
	client: Partial<Record<"clientLeft" | "clientTop" | "clientWidth" | "clientHeight", number>> = {},
) {
	element.getBoundingClientRect = () =>
		new window.DOMRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
	for (const [name, value] of Object.entries({
		clientLeft: 0,
		clientTop: 0,
		clientWidth: area.right - area.left,
		clientHeight: area.bottom - area.top,
		...client,
	}))
		Object.defineProperty(element, name, { configurable: true, value });
}

function page(t: TestContext) {
	const previous = [...document.body.childNodes];
	const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
	const height = Object.getOwnPropertyDescriptor(window, "innerHeight");
	t.after(() => {
		document.body.replaceChildren(...previous);
		if (width) Object.defineProperty(window, "innerWidth", width);
		if (height) Object.defineProperty(window, "innerHeight", height);
	});
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 190 });
	Object.defineProperty(window, "innerHeight", { configurable: true, value: 130 });
	t.mock.method(
		window,
		"getComputedStyle",
		(element: Element) =>
			({
				overflowX: element.getAttribute("data-clip-x") ?? "visible",
				overflowY: element.getAttribute("data-clip-y") ?? "visible",
			}) as CSSStyleDeclaration,
	);
	const outer = document.createElement("div");
	outer.setAttribute("data-clip-x", "hidden");
	outer.setAttribute("data-clip-y", "hidden");
	box(outer, rect(5, 5, 180, 125));
	const content = outer.appendChild(document.createElement("div"));
	content.id = "windowing-viewport";
	box(content, rect(10, 20, 218, 148), { clientLeft: 4, clientTop: 4, clientWidth: 200, clientHeight: 120 });
	const root = content.appendChild(document.createElement("div"));
	root.className = "taskido tcw-windowed";
	document.body.replaceChildren(outer);
	const add = (area: ViewportRect, text: string, day = "2026-01-15", parent: Element = root) => {
		const element = parent.appendChild(document.createElement("div"));
		element.className = "task";
		element.setAttribute("role", "listitem");
		element.setAttribute("data-link", "Folder/Note.md");
		element.setAttribute("data-line", "3");
		element.setAttribute("data-task", " ");
		element.setAttribute(
			"aria-labelledby",
			`tcw-r2a-${day}-Folder%2FNote.md%3A3-text tcw-r2a-${day}-Folder%2FNote.md%3A3-summary`,
		);
		box(element, area);
		Object.defineProperty(element, "checkVisibility", {
			value: (options: { checkVisibilityCSS: boolean }) => {
				assert.equal(options.checkVisibilityCSS, true);
				return !element.hasAttribute("hidden");
			},
		});
		const lines = element.appendChild(document.createElement("div"));
		lines.className = "lines";
		Object.defineProperty(lines, "innerText", {
			get: () => {
				assert.notEqual(text, "must not be read", "out-of-viewport text must not be collected");
				return text;
			},
		});
		return element;
	};
	return { content, root, add };
}

function collect(): ViewportMeasurement {
	return JSON.parse(
		JSON.stringify(
			runInNewContext(`(${collectViewportRows.toString()})({ container: "#windowing-viewport" })`, { document }),
		),
	) as ViewportMeasurement;
}

test("collection uses positive intersection, the viewport client box and ancestor clipping", (t) => {
	const { root, add } = page(t);
	add(rect(15, 20, 80, 30), " first\n visible ");
	const second = add(rect(20, 120, 90, 150), "second visible", "2026-01-16");
	const day = document.createElement("div");
	day.setAttribute("data-tcw-day", "2026-01-17");
	root.insertBefore(day, second);
	day.append(second);
	add(rect(20, 125, 90, 140), "must not be read");
	add(rect(20, 5, 90, 24), "must not be read");
	add(rect(180, 40, 200, 60), "must not be read");
	add(rect(20, 50, 90, 50), "must not be read");
	add(rect(20, 40, 90, 60), "must not be read").setAttribute("hidden", "");
	const clipped = root.appendChild(document.createElement("div"));
	clipped.setAttribute("data-clip-y", "hidden");
	box(clipped, rect(20, 60, 100, 70));
	add(rect(20, 72, 90, 80), "must not be read", "2026-01-15", clipped);
	const measured = collect();
	assert.deepEqual(measured.viewport, rect(14, 24, 180, 125));
	assert.equal(measured.mountedRows, 8);
	assert.equal(measured.windowed, true);
	assert.deepEqual(
		measured.rows.map(({ day, path, line, text, rect }) => ({ day, path, line, text, rect })),
		[
			{ day: "2026-01-15", path: "Folder/Note.md", line: 3, text: "first visible", rect: rect(15, 24, 80, 30) },
			{
				day: "2026-01-17",
				path: "Folder/Note.md",
				line: 3,
				text: "second visible",
				rect: rect(20, 120, 90, 125),
			},
		],
	);
});

test("a visible row with no stable identity fails instead of disappearing from the comparison", (t) => {
	const { add } = page(t);
	add(rect(20, 30, 90, 50), "visible").removeAttribute("data-link");
	assert.throws(collect, /no stable day\/path\/line identity/);
});

test("each new view reads the override after enable and waits for its first committed arrangement", async () => {
	for (const [arm, missingTabGroup] of [
		["off", false],
		["default", false],
		["off", true],
		["default", true],
	] as const) {
		let clock = 0;
		const order: string[] = [];
		let plugin = { debug: { windowMinRows: 777 as number | undefined } };
		const style = new Set<string>();
		const timer = (callback: () => void, ms: number) => {
			clock += ms;
			queueMicrotask(callback);
			return 1;
		};
		const win = {
			requestAnimationFrame: (callback: () => void) => timer(callback, 16),
			setTimeout: timer,
			MutationObserver: class {
				observe() {}
				disconnect() {}
			},
		};
		const root = {
			querySelectorAll: () => Array(30),
			classList: { contains: () => plugin.debug.windowMinRows !== Infinity },
		};
		const content = {
			ownerDocument: { defaultView: win, fonts: { ready: Promise.resolve() } },
			scrollTop: arm === "default" ? 32 : 0,
			scrollHeight: 60_000,
			clientHeight: 700,
			clientWidth: 1_200,
			clientTop: 0,
			getBoundingClientRect: () => ({ top: 0 }),
			querySelector: () => (clock >= 1_700 ? root : null),
		};
		const view = {
			getWindowingInfo: () =>
				clock >= 1_700 ? { rowCount: 2_000, windowed: plugin.debug.windowMinRows !== Infinity } : undefined,
		};
		const existing = { detach: () => order.push("detach") };
		const rootSplit = {};
		const newLeaf = {
			setViewState: async () => {
				order.push(`factory:${String(plugin.debug.windowMinRows)}`);
			},
		};
		const app = {
			plugins: {
				plugins: { test: plugin },
				disablePlugin: async () => {
					order.push("disable");
				},
				enablePlugin: async () => {
					order.push("enable");
					plugin = { debug: { windowMinRows: 777 } };
					app.plugins.plugins.test = plugin;
					return true;
				},
			},
			workspace: {
				detachLeavesOfType: () => order.push("close"),
				iterateRootLeaves: (callback: (leaf: object) => void) => callback(existing),
				rootSplit,
				getLeaf: (mode: string) => {
					assert.equal(mode, "tab");
					if (missingTabGroup) throw new Error("No tab group found.");
					return newLeaf;
				},
				createLeafInParent: (parent: object, index: number) => {
					assert.equal(parent, rootSplit);
					assert.equal(index, 0);
					order.push("fallback");
					return newLeaf;
				},
				getLeavesOfType: () => [{ view }],
				leftSplit: { collapse() {} },
				rightSplit: { collapse() {} },
			},
		};
		const result = (await runInNewContext(`(${windowingPage.toString()})(argument)`, {
			app,
			document: {
				querySelector: () => content,
				getElementById: (id: string) => style.has(id),
				head: { createEl: (_tag: string, value: { attr: { id: string } }) => style.add(value.attr.id) },
			},
			window: win,
			performance: { now: () => clock },
			setTimeout: timer,
			argument: { action: "open", pluginId: "test", viewType: "timeline", arm, todayKey: "2026-01-15" },
		})) as { rowCount: number; logicalWindowed: boolean; scrollTop: number };
		assert.ok(order.indexOf("enable") < order.findIndex((value) => value.startsWith("factory:")));
		assert.ok(order.includes(arm === "off" ? "factory:Infinity" : "factory:undefined"));
		assert.equal(order.includes("fallback"), missingTabGroup);
		assert.equal(result.rowCount, 2_000);
		assert.equal(result.logicalWindowed, arm === "default");
		assert.equal(result.scrollTop, arm === "default" ? 32 : 0, "open must preserve the native initial scroll");
		assert.equal(content.scrollTop, result.scrollTop);
		assert.ok(clock >= 1_700);
	}
});

test("opening a view preserves an unrelated getLeaf failure without creating another leaf", async () => {
	const failure = new Error("another workspace failure");
	let created = false;
	const app = {
		plugins: {
			plugins: { test: { debug: {} } },
			disablePlugin: async () => {},
			enablePlugin: async () => true,
		},
		workspace: {
			detachLeavesOfType() {},
			iterateRootLeaves() {},
			getLeaf() {
				throw failure;
			},
			createLeafInParent() {
				created = true;
			},
		},
	};
	await assert.rejects(
		runInNewContext(`(${windowingPage.toString()})(argument)`, {
			app,
			argument: { action: "open", pluginId: "test", viewType: "timeline", arm: "off" },
		}),
		(error: unknown) => error === failure,
	);
	assert.equal(created, false);
});
