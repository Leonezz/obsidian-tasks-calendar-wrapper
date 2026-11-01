// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	compareMarkup,
	deserializeMarkup,
	obsidianMarkupStates,
	parseVisibleState,
	serializeMarkup,
} from "../scripts/markup.mjs";
import { moment } from "../utils/moment";
import { mountView } from "./component-harness";
import { FIXTURES } from "./golden-vault";
import { defaultMarkupState, markupOptions, markupStateNames, mountMarkupState } from "./markup-states";
import { Platform } from "./stubs/obsidian";
import { SCREENSHOT_NOW, stateOf } from "./visible-states";

moment.now = () => SCREENSHOT_NOW;
moment.locale("en");
const MARKUP = path.join(FIXTURES, "markup");
const UPDATE = process.env.UPDATE_MARKUP === "1";
const updateCommand = "UPDATE_MARKUP=1 pnpm test";

test("markup: every state matches fixtures/markup", async (t) => {
	for (const name of markupStateNames) {
		await t.test(name, async (stateTest) => {
			const mobile = Platform.isMobile;
			try {
				if (name === "mobile") Platform.isMobile = true;
				const fixture = await mountMarkupState(stateTest, name);
				const actual = serializeMarkup(fixture.root());
				const file = path.join(MARKUP, `${name}.html`);
				if (UPDATE) {
					mkdirSync(MARKUP, { recursive: true });
					writeFileSync(file, actual);
				} else {
					assert.ok(existsSync(file), `${file} is missing; create it with \`${updateCommand}\`.`);
					assert.equal(
						actual,
						readFileSync(file, "utf8"),
						`${file} differs; update it with \`${updateCommand}\`.`,
					);
				}
				await fixture.unmount();
			} finally {
				Platform.isMobile = mobile;
			}
		});
	}
});

test("markup: fixtures/markup holds exactly the states the tests produce", () => {
	const expected = [...markupStateNames.map((name) => `${name}.html`), "render-counts.json"].sort();
	assert.ok(existsSync(MARKUP), `${MARKUP} is missing; create it with \`${updateCommand}\`.`);
	const actual = readdirSync(MARKUP).sort();
	if (UPDATE) {
		for (const orphan of actual.filter((name) => !expected.includes(name))) rmSync(path.join(MARKUP, orphan));
		// render-counts.json is produced by another test process in the same update run.
		assert.deepEqual(
			readdirSync(MARKUP)
				.filter((name) => name !== "render-counts.json")
				.sort(),
			expected.filter((name) => name !== "render-counts.json"),
			`${MARKUP} must contain every produced markup state`,
		);
		return;
	}
	assert.deepEqual(
		actual,
		expected,
		`${MARKUP} must contain exactly the produced fixtures; run \`${updateCommand}\`.`,
	);
});

test("markup: the real view's mount renders the same markup as the bridge with the view's props", async (t) => {
	const options = markupOptions(defaultMarkupState);
	const view = await mountView(t, { options });
	const bridge = await mountView(t, { options, mode: "bridge" });
	assert.equal(serializeMarkup(view.root()), serializeMarkup(bridge.root()));
});

test("markup: serialization preserves text nodes, attributes and namespaces without formatting whitespace", () => {
	const root = document.createElement("div");
	root.setAttribute("data-z", 'quotes " & < >\n\r');
	root.setAttribute("class", "first");
	root.append(" before\n\t", document.createTextNode(""), "after & <entity>");
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.appendChild(document.createElementNS(svg.namespaceURI, "linearGradient"));
	root.append(svg, document.createElement("input"), document.createComment("comment\n&"));
	const serialized = serializeMarkup(root);
	const restored = deserializeMarkup(serialized, document);
	assert.equal(serializeMarkup(restored), serialized);
	assert.equal(restored.childNodes.length, root.childNodes.length);
	assert.equal(restored.textContent, root.textContent);
	assert.deepEqual(
		[...restored.attributes].map((attribute) => [attribute.name, attribute.value]),
		[...root.attributes].map((attribute) => [attribute.name, attribute.value]),
	);
	assert.equal(restored.querySelector("linearGradient")?.namespaceURI, svg.namespaceURI);
	assert.throws(() => deserializeMarkup("<div>\n</span>\n", document), /Mismatched/);
});

test("markup: Obsidian comparison normalizes only row markdown and reports every other difference", () => {
	const expected = document.createElement("div");
	expected.innerHTML =
		'<div class="content"><div class="task" aria-busy="true"><div class="lines"><div class="content"><a>stub</a></div><a class="file">Inbox</a></div></div></div>';
	const actual = expected.cloneNode(true) as Element;
	actual.querySelector(".task .content")!.innerHTML = "<p><strong>real markdown</strong></p>";
	assert.equal(compareMarkup(expected, actual).diff, "");
	assert.match(expected.innerHTML, /stub/);
	assert.match(actual.innerHTML, /real markdown/);
	actual.querySelector(".task")!.removeAttribute("aria-busy");
	assert.match(compareMarkup(expected, actual).diff, /aria-busy/);
	actual.querySelector(".task")!.setAttribute("aria-busy", "true");
	actual.querySelector(".file")!.textContent = "Changed";
	assert.match(compareMarkup(expected, actual).diff, /Inbox|Changed/);
	for (const name of obsidianMarkupStates) {
		assert.ok(markupStateNames.includes(name));
		assert.deepEqual(parseVisibleState(name), stateOf(name));
	}
	assert.throws(() => parseVisibleState("mobile"), /Not a visible markup state/);
});
