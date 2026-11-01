const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const MATH = "http://www.w3.org/1998/Math/MathML";
const voidTags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const escape = (value) =>
	value.replace(/[&<>"\u0000-\u001f\u007f]/g, (character) => {
		const named = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
		return named[character] ?? `&#${character.codePointAt(0)};`;
	});
const unescape = (value) =>
	value.replace(/&(amp|lt|gt|quot|#\d+);/g, (_, entity) =>
		entity.startsWith("#")
			? String.fromCodePoint(Number(entity.slice(1)))
			: { amp: "&", lt: "<", gt: ">", quot: '"' }[entity],
	);

/** One node per line; entities retain text newlines and empty nodes, with sorted attributes and no layout whitespace. */
export function serializeMarkup(element) {
	const lines = [];
	const visit = (node, depth) => {
		const indent = "  ".repeat(depth);
		if (node.nodeType === 3) lines.push(indent + escape(node.nodeValue ?? ""));
		else if (node.nodeType === 8) lines.push(`${indent}<!--${escape(node.nodeValue ?? "")}-->`);
		else if (node.nodeType === 1) {
			const tag = node.namespaceURI === HTML ? node.localName : node.tagName;
			const attributes = [...node.attributes]
				.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
				.map((attribute) => ` ${attribute.name}="${escape(attribute.value)}"`)
				.join("");
			lines.push(`${indent}<${tag}${attributes}>`);
			for (const child of node.childNodes) visit(child, depth + 1);
			if (node.namespaceURI !== HTML || !voidTags.has(tag)) lines.push(`${indent}</${tag}>`);
		} else throw new Error(`Unsupported markup node type ${node.nodeType}`);
	};
	visit(element, 0);
	return lines.join("\n") + "\n";
}

/** Read our line format without turning its indentation into DOM text or merging adjacent text nodes. */
export function deserializeMarkup(serialized, document) {
	if (!serialized.endsWith("\n")) throw new Error("Serialized markup must end with a newline");
	const stack = [];
	let root;
	for (const line of serialized.slice(0, -1).split("\n")) {
		const closing = /^ *<\/([^>]+)>$/.exec(line);
		const depth = stack.length - (closing ? 1 : 0);
		const indent = "  ".repeat(Math.max(0, depth));
		if (!line.startsWith(indent)) throw new Error("Invalid serialized markup indentation");
		const value = line.slice(indent.length);
		if (closing) {
			const element = stack.pop();
			if (!element || value !== `</${element.namespaceURI === HTML ? element.localName : element.tagName}>`)
				throw new Error(`Mismatched markup end tag: ${value}`);
			continue;
		}
		const parent = stack.at(-1);
		let node;
		if (value.startsWith("<!--") && value.endsWith("-->"))
			node = document.createComment(unescape(value.slice(4, -3)));
		else if (value.startsWith("<")) {
			const opening = /^<([^\s>]+)((?: [^\s=]+="[^"]*")*)>$/.exec(value);
			if (!opening) throw new Error(`Invalid markup start tag: ${value}`);
			const [, tag, attributes] = opening;
			const namespace =
				tag === "svg"
					? SVG
					: tag === "math"
						? MATH
						: parent?.localName === "foreignObject"
							? HTML
							: (parent?.namespaceURI ?? HTML);
			node = document.createElementNS(namespace, tag);
			for (const [, name, escaped] of attributes.matchAll(/ ([^\s=]+)="([^"]*)"/g)) {
				const ns = name.startsWith("xlink:")
					? "http://www.w3.org/1999/xlink"
					: name.startsWith("xml:")
						? "http://www.w3.org/XML/1998/namespace"
						: name === "xmlns" || name.startsWith("xmlns:")
							? "http://www.w3.org/2000/xmlns/"
							: null;
				if (ns) node.setAttributeNS(ns, name, unescape(escaped));
				else node.setAttribute(name, unescape(escaped));
			}
			if (namespace !== HTML || !voidTags.has(tag)) stack.push(node);
		} else node = document.createTextNode(unescape(value));
		if (parent) parent.appendChild(node);
		else if (!root && node.nodeType === 1) root = node;
		else throw new Error("Serialized markup must contain one root element");
	}
	if (!root || stack.length) throw new Error("Incomplete serialized markup");
	return root;
}

/** Only the row's MarkdownRenderer output differs from the stub; date groups also use .content and must stay. */
export function normalizeContent(element) {
	const clone = element.cloneNode(true);
	for (const content of clone.querySelectorAll(".task .lines > .content")) content.textContent = "[markdown]";
	return clone;
}

/** A first-difference report retains context without dumping an entire timeline on a failed comparison. */
export function compareMarkup(expectedElement, actualElement) {
	const expected = serializeMarkup(normalizeContent(expectedElement));
	const actual = serializeMarkup(normalizeContent(actualElement));
	if (expected === actual) return { expected, actual, diff: "" };
	const before = expected.split("\n");
	const after = actual.split("\n");
	let at = 0;
	while (before[at] === after[at]) at++;
	const start = Math.max(0, at - 3);
	const diff =
		[
			`First difference at line ${at + 1}; expected ${before.length - 1} lines, actual ${after.length - 1} lines`,
			`@@ -${start + 1} +${start + 1} @@`,
			...before.slice(start, at).map((line) => ` ${line}`),
			...before.slice(at, at + 4).map((line) => `-${line}`),
			...after.slice(at, at + 4).map((line) => `+${line}`),
		].join("\n") + "\n";
	return { expected, actual, diff };
}

export const obsidianMarkupStates = [
	"light-today-all-days-no-counter",
	"light-top-today-focus-todo-focus",
	"light-bottom-all-days-overdue-filter",
];

export function parseVisibleState(name) {
	const match =
		/^light-(top|today|bottom)-(all-days|today-focus)-(?:no-counter|(todo|overdue|unplanned)-(filter|focus))$/.exec(
			name,
		);
	if (!match) throw new Error(`Not a visible markup state: ${name}`);
	return {
		position: match[1],
		todayFocus: match[2] === "today-focus",
		counter: match[3],
		behavior: match[4] === undefined ? undefined : match[4] === "filter" ? "Filter" : "Focus",
	};
}
