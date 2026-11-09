/** Pins mobile measurements to rendered golden targets and centre hits, without opening Obsidian. */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { deserializeMarkup } from "../scripts/markup.mjs";
import { TOUCH_TARGETS, collectTouchTargets, type TouchTargetMeasurement } from "../scripts/screenshots-mobile.mjs";
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

function stubGeometry(root: Element) {
	const matches = TOUCH_TARGETS.flatMap((target) =>
		[...root.querySelectorAll(target.selector)].map((element, index) => ({ target, element, index: index + 1 })),
	);
	const expected: TouchTargetMeasurement[] = [];
	const visibilityCalls: Element[] = [];
	const rectCalls: Element[] = [];
	const points = new Map<string, Element | null>();
	const hitCalls: string[] = [];
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
		const hit = [element, element.firstElementChild ?? element, root, null][expected.length % 4];
		points.set(`${rect.left + rect.width / 2},${rect.top + rect.height / 2}`, hit);
		expected.push({
			target: target.name,
			index,
			width: rect.width,
			height: rect.height,
			hit: element.contains(hit),
		});
	}
	Object.defineProperty(document, "elementFromPoint", {
		configurable: true,
		value: (x: number, y: number) => {
			const point = `${x},${y}`;
			assert.ok(points.has(point), `hit testing must use the target centre: ${point}`);
			hitCalls.push(point);
			return points.get(point) ?? null;
		},
	});
	return { matches, expected, visibilityCalls, rectCalls, points, hitCalls };
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
	const measurements = runInNewContext(`(${collectTouchTargets.toString()})(argument)`, {
		document,
		argument: { container: "#mobile-measurement", targets: TOUCH_TARGETS },
	}) as TouchTargetMeasurement[];
	assert.deepEqual(
		Array.from(measurements, (measurement) => ({ ...measurement })),
		geometry.expected,
	);
	assert.deepEqual(
		geometry.visibilityCalls,
		geometry.matches.map(({ element }) => element),
	);
	assert.deepEqual(
		geometry.rectCalls,
		geometry.matches.filter(({ element }) => !element.closest("[hidden]")).map(({ element }) => element),
	);
	assert.deepEqual(geometry.hitCalls, [...geometry.points.keys()]);
});
