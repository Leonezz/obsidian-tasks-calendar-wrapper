/** Every rule of a stylesheet, inside at-rules too: its selectors, without the prefix that scopes them to the view. */
export function cssRules(css: string): { selectors: string[]; body: string }[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: { selectors: string[]; body: string }[] = [];
	let prelude = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "{") {
			// An at-rule such as @media opens a block of rules, which are read as any other.
			if (!prelude.trim().startsWith("@")) {
				const end = text.indexOf("}", i);
				rules.push({ selectors: selectorsOf(prelude), body: text.slice(i + 1, end) });
				i = end;
			}
			prelude = "";
		} else if (char === "}") prelude = "";
		else prelude += char;
	}
	return rules;
}

/** A rule's selectors, split at the commas outside parentheses, with their spaces collapsed. */
export function selectorsOf(prelude: string): string[] {
	const selectors: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of prelude) {
		depth += char === "(" ? 1 : char === ")" ? -1 : 0;
		if (char === "," && depth === 0) {
			selectors.push(current);
			current = "";
		} else current += char;
	}
	return [...selectors, current]
		.map((selector) =>
			selector
				.replace(/\s+/g, " ")
				.replace(/\( /g, "(")
				.replace(/ \)/g, ")")
				.trim()
				.replace('.workspace-leaf-content[data-type="tasks_timeline_view"] ', ""),
		)
		.filter(Boolean);
}
