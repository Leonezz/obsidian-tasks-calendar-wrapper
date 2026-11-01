import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { deserializeMarkup } from "../scripts/markup.mjs";
import {
	STYLE_PROBES,
	STYLE_PROPERTIES,
	ROOT_CUSTOM_PROPERTIES,
	collectStyles,
} from "../scripts/screenshots-styles.mjs";
import { FIXTURES } from "./golden-vault";

const MARKUP = path.join(FIXTURES, "markup");

test("every probe finds an element in some markup golden, except the listed ones", () => {
	assert.equal(STYLE_PROBES.length, 58);
	const goldens = readdirSync(MARKUP)
		.filter((name) => name.endsWith(".html"))
		.sort()
		.map((name) => ({ name, root: deserializeMarkup(readFileSync(path.join(MARKUP, name), "utf8"), document) }));
	assert.ok(goldens.length > 0);
	const exceptions = new Map([[".task .modify", "no Tasks edit dialog in the harness"]]);
	for (const exception of exceptions.keys()) {
		assert.ok(
			STYLE_PROBES.some(({ name }) => name === exception),
			`${exception} must remain a probe`,
		);
	}
	for (const probe of STYLE_PROBES) {
		const matching = goldens.filter(({ root }) =>
			probe.selector === ".taskido" ? root.matches(probe.selector) : root.querySelector(probe.selector) !== null,
		);
		const reason = exceptions.get(probe.name);
		if (reason) assert.equal(matching.length, 0, `${probe.name} now matches; remove its exception (${reason})`);
		else assert.ok(matching.length > 0, `${probe.name} must match a markup golden`);
		if (probe.selector.includes('aria-busy="true"')) {
			assert.ok(
				matching.some(({ name }) => name === "row-dimmed.html"),
				`${probe.name} must match row-dimmed`,
			);
		}
	}
});

test("collectStyles reads the first element in document order and the ::after of the strip", () => {
	const root = deserializeMarkup(readFileSync(path.join(MARKUP, "row-dimmed.html"), "utf8"), document);
	const bodyBefore = [...document.body.childNodes];
	const getComputedStyleBefore = globalThis.getComputedStyle;
	const calls: { element: Element; pseudo: string | null | undefined }[] = [];
	try {
		document.body.replaceChildren(root);
		globalThis.getComputedStyle = (element, pseudo) => {
			calls.push({ element, pseudo });
			return { getPropertyValue: (property: string) => ` ${property} ` } as CSSStyleDeclaration;
		};
		const arg = {
			container: "body",
			probes: STYLE_PROBES,
			properties: STYLE_PROPERTIES,
			rootCustomProperties: ROOT_CUSTOM_PROPERTIES,
		};
		const record = collectStyles(arg);
		assert.equal(STYLE_PROBES.length, 58);
		assert.deepEqual(Object.keys(record).sort(), STYLE_PROBES.map(({ name }) => name).sort());
		let strips = 0;
		for (const probe of STYLE_PROBES) {
			const expected = probe.selector === ".taskido" ? root : root.querySelector(probe.selector);
			calls.length = 0;
			const single = collectStyles({ ...arg, probes: [probe] });
			assert.deepEqual(Object.keys(single), [probe.name]);
			assert.deepEqual(single[probe.name], record[probe.name]);
			if (!expected) {
				assert.equal(record[probe.name], null, probe.name);
				assert.equal(calls.length, 0, probe.name);
				continue;
			}
			assert.equal(calls.length, 1, probe.name);
			assert.equal(calls[0].element, expected, probe.name);
			assert.equal(calls[0].pseudo, probe.pseudo ?? null, probe.name);
			if (probe.pseudo === "::after") strips++;
			const properties = [...STYLE_PROPERTIES, ...(probe.selector === ".taskido" ? ROOT_CUSTOM_PROPERTIES : [])];
			const values = record[probe.name];
			assert.ok(values, probe.name);
			assert.deepEqual(Object.keys(values).sort(), properties.sort(), probe.name);
			for (const property of properties)
				assert.equal(values[property], ` ${property} `, `${probe.name} ${property}`);
		}
		assert.equal(strips, 5);
	} finally {
		globalThis.getComputedStyle = getComputedStyleBefore;
		document.body.replaceChildren(...bodyBefore);
	}
});
