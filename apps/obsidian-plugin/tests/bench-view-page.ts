import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { ViewControls, ViewScenarioDeps } from "../scripts/bench-scenarios.mjs";

/** Supplies independent page actions to test missing-control orchestration without Obsidian. */
export function viewScenarioDeps(controls: ViewControls, log: (line: string) => void): ViewScenarioDeps {
	return {
		scale: 1,
		arm: "candidate",
		cpu: false,
		label: "base ",
		log,
		evaluate: ({ action }) => {
			switch (action) {
				case "controls":
					return controls;
				case "reveal":
					return { revealed: false };
				case "viewRestore":
					return { restored: [] };
				case "scroll":
					return { timestamps: [0, 1000, 2000], visibilityState: "hidden" };
				default:
					return { paintedMs: 26, blockedMs: 60, longestMs: 60 };
			}
		},
		timed: () => ({ paintedMs: 26, blockedMs: 60, longestMs: 60 }),
		runAndUndo: (work, steps) => {
			try {
				return work();
			} finally {
				for (const [, undo] of steps) undo();
			}
		},
	};
}

interface ViewOptions {
	clickDelay?: number;
	frameMs?: number;
	scrollHeight?: number;
	clientHeight?: number;
	visibilityState?: string;
	rowPresent?: boolean;
	view?: { revealTask?: (id: string) => Promise<void> };
	longTasks?: readonly { offset: number; duration: number }[];
}

/** Runs view actions against a fake DOM; only scheduled callbacks advance its clock. */
export function viewPage({
	clickDelay = 10,
	frameMs = 16,
	scrollHeight = 7000,
	clientHeight = 1000,
	visibilityState = "hidden",
	rowPresent = true,
	view = {},
	longTasks = [],
}: ViewOptions = {}) {
	let now = 1000;
	const timers: { at: number; callback: () => void }[] = [];
	const schedule = (callback: () => void, delay = 0) => timers.push({ at: now + delay, callback });
	const mutations = new Set<MutationObserverFake>();
	const performances = new Set<PerformanceObserverFake>();
	type Change = { type: string; target: object; attributeName: string; addedNodes: [] };
	type Entry = { startTime: number; duration: number };
	class MutationObserverFake {
		constructor(readonly callback: (changes: Change[]) => void) {}
		observe() {
			mutations.add(this);
		}
		disconnect() {
			mutations.delete(this);
		}
	}
	class PerformanceObserverFake {
		constructor(readonly callback: (list: { getEntries(): Entry[] }) => void) {}
		observe() {
			performances.add(this);
		}
		disconnect() {
			performances.delete(this);
		}
		takeRecords() {
			return [];
		}
	}
	const emit = () => {
		for (const observer of mutations)
			observer.callback([{ type: "attributes", target: root, attributeName: "class", addedNodes: [] }]);
	};
	const classes = new Set<string>();
	const classList = {
		contains: (name: string) => classes.has(name),
		add: (name: string) => void classes.add(name),
		remove: (name: string) => void classes.delete(name),
		toggle(name: string, force = !classes.has(name)) {
			if (force) classes.add(name);
			else classes.delete(name);
			return force;
		},
	};
	const pageWindow = {};
	const clicks: { at: number; name: string; event: object }[] = [];
	const control = (name: string) => ({
		dispatchEvent(event: object) {
			const start = now;
			clicks.push({ at: start, name, event });
			schedule(() => {
				classList.toggle(name);
				emit();
			}, clickDelay);
			for (const task of longTasks)
				schedule(
					() => {
						for (const observer of performances)
							observer.callback({
								getEntries: () => [{ startTime: start + task.offset, duration: task.duration }],
							});
					},
					Math.max(0, task.offset + task.duration),
				);
			return true;
		},
	});
	const todayHeader = control("todayFocus");
	const todoCounter = control("todoFilter");
	const scrolls: { at: number; value: number }[] = [];
	let scrollTop = 0;
	const content = {
		scrollHeight,
		clientHeight,
		get scrollTop() {
			return scrollTop;
		},
		set scrollTop(value: number) {
			scrollTop = value;
			scrolls.push({ at: now, value });
		},
		querySelector: (selector: string): unknown => select(selector),
	};
	const root = {
		nodeType: 1,
		classList,
		closest: () => content,
		querySelector: (selector: string): unknown => select(selector),
		querySelectorAll: (selector: string): unknown[] => selectAll(selector),
	};
	const taskPath = "Projects/Learning/Project 0228.md";
	const taskLine = 12;
	const link = { getAttribute: () => taskPath, closest: () => row };
	const row = {
		nodeType: 1,
		dataset: { line: String(taskLine) },
		getAttribute: (name: string) => (name === "data-line" ? String(taskLine) : null),
		closest: (selector: string) => (selector === ".task" ? row : content),
		querySelector: (selector: string): unknown => (selector.includes("a.file") ? select(selector) : null),
	};
	const leaf = {
		querySelector: (selector: string): unknown => select(selector),
		querySelectorAll: (selector: string): unknown[] => selectAll(selector),
	};
	function select(selector: string): unknown {
		if (selector.includes("a.file") || /\.task(?:\[|$)/.test(selector)) {
			if (!rowPresent) return null;
			const line = selector.match(/data-line=["']([^"']+)["']/)?.[1];
			const path = selector.match(/aria-label=["']([^"']+)["']/)?.[1];
			if ((line !== undefined && line !== String(taskLine)) || (path !== undefined && path !== taskPath))
				return null;
			return selector.includes("a.file") ? link : row;
		}
		if (selector.includes(".todayHeader")) return todayHeader;
		if (selector.includes(".counter#todo")) return todoCounter;
		if (selector.includes(".taskido")) return root;
		if (selector.includes(".view-content")) return content;
		if (selector.includes('.workspace-leaf-content[data-type="timeline"]')) return leaf;
		return null;
	}
	function selectAll(selector: string): unknown[] {
		const found = select(selector);
		return found ? [found] : [];
	}
	const source = readFileSync("scripts/bench-measure.mjs", "utf8").replace(
		"export async function measure",
		"async function measure",
	);
	const measure = runInNewContext(source + "\nmeasure", {
		app: { workspace: { getLeavesOfType: () => [{ view }] } },
		document: {
			body: leaf,
			visibilityState,
			querySelector: select,
			querySelectorAll: selectAll,
			getElementsByClassName: () => (rowPresent ? [row] : []),
		},
		window: pageWindow,
		performance: { now: () => now },
		Node: { ELEMENT_NODE: 1 },
		CSS: { escape: (value: string) => value },
		TextDecoder,
		MutationObserver: MutationObserverFake,
		PerformanceObserver: PerformanceObserverFake,
		MouseEvent: class {
			timeStamp = now;
			constructor(
				readonly type: string,
				readonly options: object,
			) {}
		},
		setTimeout: schedule,
		requestAnimationFrame: (callback: (timestamp: number) => void) => schedule(() => callback(now), frameMs),
	}) as (args: Record<string, unknown>) => Promise<unknown>;
	return {
		classList,
		clicks,
		content,
		scrolls,
		view,
		taskPath,
		taskLine,
		get now() {
			return now;
		},
		showRow() {
			rowPresent = true;
		},
		delay(ms: number) {
			return new Promise<void>((resolve) => schedule(resolve, ms));
		},
		async run<T = unknown>(args: Record<string, unknown>): Promise<T> {
			let done = false;
			let result: unknown;
			let failure: unknown;
			void measure({ viewType: "timeline", quietMs: 2, burstGapMs: 40, ...args }).then(
				(value) => {
					result = value;
					done = true;
				},
				(error: unknown) => {
					failure = error;
					done = true;
				},
			);
			for (let step = 0; !done && step < 20_000; step++) {
				for (let turn = 0; turn < 8; turn++) await Promise.resolve();
				if (done) break;
				timers.sort((a, b) => a.at - b.at);
				const timer = timers.shift();
				if (!timer) continue;
				now = Math.max(now, timer.at);
				timer.callback();
			}
			assert.ok(done, "the page did not finish");
			assert.equal(mutations.size, 0, "mutation observers were not disconnected");
			assert.equal(performances.size, 0, "performance observers were not disconnected");
			if (failure) throw failure;
			return structuredClone(result) as T;
		},
	};
}
