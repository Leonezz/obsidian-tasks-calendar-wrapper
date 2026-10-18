/**
 * Reads the timeline's server-rendered markup the way scripts/screenshots.mjs read the DOM: one line per displayed
 * year, entry panel element, date and task, in document order (see visible-states.ts). What is displayed is worked out
 * from the stylesheet's rules that hide those elements, applied to the markup's classes: Focus on today, and the
 * options that turn the year headers, the counters and the quick entry off. Nothing else in styles.css hides them. A
 * task is highlighted when the Focus behaviour's rule gives it a background.
 */
import assert from "node:assert/strict";

import { collapse, highlightedBy, rowLine, type Counter, type Line } from "./visible-states";

export interface Element {
	readonly tag: string;
	readonly attrs: Readonly<Record<string, string>>;
	readonly children: readonly (Element | string)[];
}

const voidElements = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"wbr",
]);

const unescape = (text: string) =>
	text
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");

/** Parses what renderToStaticMarkup writes: well-formed elements, quoted attributes, escaped text. */
export function parseMarkup(html: string): Element {
	const root = { tag: "#root", attrs: {}, children: [] as (Element | string)[] };
	const stack: { tag: string; children: (Element | string)[] }[] = [root];
	const token = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
	for (let match = token.exec(html); match; match = token.exec(html)) {
		const [, closing, tag, attributes, selfClosing, text] = match;
		const top = stack[stack.length - 1];
		if (text !== undefined) {
			top.children.push(unescape(text));
			continue;
		}
		if (closing) {
			assert.equal(stack.pop()?.tag, tag, `</${tag}> closes another element`);
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const [, name, value] of attributes.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g))
			attrs[name] = value === undefined ? "" : unescape(value);
		const element = { tag, attrs, children: [] as (Element | string)[] };
		top.children.push(element);
		if (!selfClosing && !voidElements.has(tag)) stack.push(element);
	}
	assert.equal(stack.length, 1, "an element is not closed");
	return root;
}

export const classesOf = (element: Element) => (element.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
const elements = (element: Element) => element.children.filter((child): child is Element => typeof child !== "string");

/** The element's text, with a space where the browser's innerText would break a line or a word. */
export const textOf = (node: Element | string): string =>
	typeof node === "string" ? node : collapse(node.children.map(textOf).join(" "));

/** The first element under `element` with the class, depth first. */
export function findClass(element: Element, name: string): Element | undefined {
	for (const child of elements(element)) {
		if (classesOf(child).includes(name)) return child;
		const found = findClass(child, name);
		if (found) return found;
	}
	return undefined;
}

/** Every element under `element` with the class, in document order. */
export function allWithClass(element: Element, name: string): Element[] {
	return elements(element).flatMap((child) => [
		...(classesOf(child).includes(name) ? [child] : []),
		...allWithClass(child, name),
	]);
}

/** The tasks the markup has rows for, as path:line, in document order. */
export const rowsOf = (html: string) =>
	allWithClass(parseMarkup(html), "task").map((row) => `${row.attrs["data-link"]}:${row.attrs["data-line"]}`);

/** The lines the script writes for what the markup displays, with each row's text taken out. */
export function displayedLines(html: string): Line[] {
	const taskido = findClass(parseMarkup(html), "taskido");
	assert.ok(taskido, "the timeline has no .taskido element");
	const root = classesOf(taskido);
	const focused = (["todo", "overdue", "unplanned"] as Counter[]).find((counter) => root.includes(`${counter}Focus`));
	const highlights = focused ? highlightedBy[focused] : [];
	const hides = (classes: string[]) =>
		(root.includes("todayFocus") &&
			(classes.includes("year") || (classes.includes("details") && !classes.includes("today")))) ||
		(root.includes("noYear") && classes.includes("year")) ||
		(root.includes("noCounters") && classes.includes("counters")) ||
		(root.includes("noQuickEntry") && classes.includes("quickEntryPanel"));

	const lines: Line[] = [];
	const walk = (element: Element) => {
		const classes = classesOf(element);
		if (hides(classes)) return;
		if (classes.includes("year")) lines.push({ line: `year ${textOf(element)}` });
		else if (classes.includes("todayHeader")) lines.push({ line: `today header "${textOf(element)}"` });
		else if (classes.includes("counter")) lines.push({ line: `counter ${textOf(element)}` });
		else if (classes.includes("quickEntryPanel")) lines.push({ line: "quick entry" });
		else if (classes.includes("dateLine")) lines.push({ line: `date ${textOf(element)}` });
		else if (classes.includes("task")) {
			const status = classes.filter((name) => name !== "task").join(" ");
			const info = findClass(element, "info");
			const badges = info ? elements(info).map(textOf).filter(Boolean) : [];
			const content = findClass(element, "content");
			lines.push({
				line: rowLine(
					status,
					highlights.some((s) => classes.includes(s)),
					badges,
				),
				text: content ? textOf(content) : "",
			});
			return;
		}
		elements(element).forEach(walk);
	};
	walk(taskido);
	return lines;
}
