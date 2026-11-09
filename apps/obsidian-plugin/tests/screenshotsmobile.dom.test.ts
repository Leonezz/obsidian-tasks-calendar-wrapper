/** Pins mobile measurements to rendered golden targets, clipping and edge hits, without opening Obsidian. */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { deserializeMarkup } from "../scripts/markup.mjs";
import {
	TOUCH_TARGETS,
	collectTouchTargets,
	touchTargetProblems,
	type TouchTarget,
	type TouchTargetMeasurement,
} from "../scripts/screenshots-mobile.mjs";
import { FIXTURES } from "./golden-vault";

function mobilePage(t: TestContext) {
	const root = deserializeMarkup(readFileSync(path.join(FIXTURES, "markup", "mobile.html"), "utf8"), document);
	const bodyBefore = [...document.body.childNodes];
	const hitBefore = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
	t.after(() => {
		if (hitBefore) Object.defineProperty(document, "elementFromPoint", hitBefore);
		else Reflect.deleteProperty(document, "elementFromPoint");
		document.body.replaceChildren(...bodyBefore);
	});
	const container = document.createElement("div");
	container.id = "mobile-measurement";
	container.append(root);
	document.body.replaceChildren(root.cloneNode(true), container);
	const hiddenDay = root.querySelector(".tcw-day");
	assert.ok(hiddenDay);
	hiddenDay.setAttribute("hidden", "");
	const hiddenMenu = [...root.querySelectorAll("a.menu")].find((element) => !element.closest("[hidden]"));
	assert.ok(hiddenMenu);
	hiddenMenu.setAttribute("hidden", "");
	return root;
}

function stubHitTesting(points: Map<string, Element | null>) {
	const calls: string[] = [];
	Object.defineProperty(document, "elementFromPoint", {
		configurable: true,
		value: (x: number, y: number) => {
			const point = `${x},${y}`;
			assert.ok(points.has(point), `hit testing must use the tappable rect's centre or inset edge: ${point}`);
			calls.push(point);
			return points.get(point) ?? null;
		},
	});
	return calls;
}

function measure(targets: readonly TouchTarget[] = TOUCH_TARGETS) {
	const measurements = runInNewContext(`(${collectTouchTargets.toString()})(argument)`, {
		document,
		argument: { container: "#mobile-measurement", targets },
	}) as TouchTargetMeasurement[];
	return Array.from(measurements, (measurement) => ({ ...measurement }));
}

function stubGeometry(root: Element) {
	const matches = TOUCH_TARGETS.flatMap((target) =>
		[...root.querySelectorAll(target.selector)].map((element, index) => ({ target, element, index: index + 1 })),
	);
	const expected: TouchTargetMeasurement[] = [];
	const visibilityCalls: Element[] = [];
	const rectCalls: Element[] = [];
	const points = new Map<string, Element | null>();
	const expectedHitCalls: string[] = [];
	for (const [number, { target, element, index }] of matches.entries()) {
		const rendered = element.closest("[hidden]") === null;
		const rect = new window.DOMRect(10 + number * 100, 20 + number * 100, 44 + (number % 7), 50 + (number % 5));
		Object.defineProperty(element, "checkVisibility", {
			value: (options: { checkVisibilityCSS?: boolean }) => {
				assert.equal(options.checkVisibilityCSS, true);
				visibilityCalls.push(element);
				return rendered;
			},
		});
		element.getBoundingClientRect = () => {
			assert.ok(rendered, "hidden targets must not be measured");
			rectCalls.push(element);
			return rect;
		};
		if (!rendered) continue;
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const samples = [
			`${x},${y}`,
			`${x},${rect.top + 1}`,
			`${rect.right - 1},${y}`,
			`${x},${rect.bottom - 1}`,
			`${rect.left + 1},${y}`,
		];
		const pattern = expected.length % 7;
		const answers = samples.map((point, sample) => {
			const answer =
				sample === pattern - 2 ? (pattern % 2 ? null : root) : (element.firstElementChild ?? element);
			points.set(point, answer);
			return answer;
		});
		const firstMiss = answers.findIndex((answer) => !element.contains(answer));
		expectedHitCalls.push(...samples.slice(0, firstMiss < 0 ? samples.length : firstMiss + 1));
		expected.push({
			target: target.name,
			index,
			width: rect.width,
			height: rect.height,
			hit: answers.every((answer) => element.contains(answer)),
		});
	}
	return { matches, expected, visibilityCalls, rectCalls, expectedHitCalls, hitCalls: stubHitTesting(points) };
}

test("collectTouchTargets measures every rendered target in a markup golden", (t) => {
	const root = mobilePage(t);
	const geometry = stubGeometry(root);
	for (const target of TOUCH_TARGETS.filter(({ required }) => required))
		assert.ok(
			geometry.expected.some(({ target: name }) => name === target.name),
			target.selector,
		);
	assert.ok(geometry.matches.some(({ element }) => element.matches("a.menu")));
	assert.ok(geometry.matches.length > geometry.expected.length, "the golden includes hidden targets");
	assert.deepEqual(measure(), geometry.expected);
	assert.deepEqual(
		geometry.visibilityCalls,
		geometry.matches.map(({ element }) => element),
	);
	assert.deepEqual(
		geometry.rectCalls,
		geometry.matches.filter(({ element }) => !element.closest("[hidden]")).map(({ element }) => element),
	);
	assert.deepEqual(geometry.hitCalls, geometry.expectedHitCalls);
});

const menuTarget = [{ name: "row menu", selector: "#measured-target", required: true }];

function stubTarget(root: Element, selector = "a.menu") {
	const element = [...root.querySelectorAll(selector)].find((match) => !match.closest("[hidden]"));
	assert.ok(element);
	element.id = "measured-target";
	Object.defineProperty(element, "checkVisibility", { value: () => true });
	element.getBoundingClientRect = () => new window.DOMRect(10, 20, 44, 44);
	return element;
}

function stubClipping(t: TestContext, element: Element, overflow: string, rect: DOMRect, border = 0) {
	const styleBefore = element.getAttribute("style");
	const values = {
		getBoundingClientRect: () => rect,
		clientLeft: border,
		clientTop: border,
		clientWidth: rect.width - 2 * border,
		clientHeight: rect.height - 2 * border,
	};
	for (const [name, value] of Object.entries(values)) {
		const before = Object.getOwnPropertyDescriptor(element, name);
		Object.defineProperty(element, name, { configurable: true, value });
		t.after(() => {
			if (before) Object.defineProperty(element, name, before);
			else Reflect.deleteProperty(element, name);
		});
	}
	element.setAttribute("style", overflow);
	t.after(() => {
		if (styleBefore === null) element.removeAttribute("style");
		else element.setAttribute("style", styleBefore);
	});
}

test("collectTouchTargets reports only the area left inside overflow-clipping ancestors", async (t) => {
	for (const axis of ["height", "width"] as const) {
		await t.test(axis, (t) => {
			const element = stubTarget(mobilePage(t));
			const lines = element.closest(".lines");
			assert.ok(lines);
			// Explicit axes avoid jsdom's missing expansion of the overflow shorthand.
			stubClipping(t, lines, "overflow-x: hidden; overflow-y: hidden", new window.DOMRect(5, 15, 54, 54), 5);
			if (axis === "height")
				stubClipping(
					t,
					lines.parentElement!,
					"overflow-x: hidden; overflow-y: hidden",
					new window.DOMRect(5, 15, 54, 44),
					5,
				);
			else
				stubClipping(
					t,
					document.documentElement,
					"overflow-x: hidden; overflow-y: visible",
					new window.DOMRect(15, 100, 44, 44),
					5,
				);
			const samples =
				axis === "height"
					? ["32,37", "32,21", "53,37", "32,53", "11,37"]
					: ["37,42", "37,21", "53,42", "37,63", "21,42"];
			// Accept the unclipped centre too, so a wrong size fails independently of the sampling assertions.
			const calls = stubHitTesting(new Map([...samples, "32,42"].map((point) => [point, element])));
			const measurements = measure(menuTarget);
			const expected = { target: "row menu", index: 1, width: 44, height: 44, [axis]: 34, hit: true };
			assert.deepEqual(measurements, [expected]);
			assert.deepEqual(calls, samples);
			assert.deepEqual(
				touchTargetProblems("mobile", measurements).filter(({ target }) => target === "row menu"),
				[
					{
						state: "mobile",
						target: "row menu",
						index: 1,
						width: expected.width,
						height: expected.height,
						reason: "size",
					},
				],
			);
		});
	}
});

test("collectTouchTargets fails a target whose edge is covered by a neighbour", (t) => {
	const element = stubTarget(mobilePage(t), ".info > .relative");
	const neighbour = element.previousElementSibling;
	assert.ok(neighbour);
	const samples = ["32,42", "32,21", "53,42", "32,63", "11,42"];
	const calls = stubHitTesting(new Map(samples.map((point, index) => [point, index === 4 ? neighbour : element])));
	const measurements = measure([{ name: "badge", selector: "#measured-target", required: false }]);
	assert.deepEqual(measurements, [{ target: "badge", index: 1, width: 44, height: 44, hit: false }]);
	assert.deepEqual(calls, samples);
	assert.deepEqual(
		touchTargetProblems("mobile", measurements).filter(({ target }) => target === "badge"),
		[{ state: "mobile", target: "badge", index: 1, width: 44, height: 44, reason: "covered" }],
	);
});

test("collectTouchTargets reports an empty rect without hit testing a fully clipped target", (t) => {
	const element = stubTarget(mobilePage(t));
	const lines = element.closest(".lines");
	assert.ok(lines);
	stubClipping(t, lines, "overflow-x: hidden; overflow-y: hidden", new window.DOMRect(100, 100, 44, 44));
	const calls = stubHitTesting(new Map([["32,42", element]]));
	assert.deepEqual(measure(menuTarget), [{ target: "row menu", index: 1, width: 0, height: 0, hit: false }]);
	assert.deepEqual(calls, []);
});
