/**
 * Frontmatter property rules, e.g. { status: ["archived", "done"] }: a note matches when one of its
 * properties has one of the listed values. Kept free of `obsidian` so it can move to packages/core.
 */
export type PropertyRules = Record<string, string[]>;

/**
 * Whether a note's frontmatter matches any rule. Values are compared as trimmed strings and are
 * case-sensitive, like the tag filters: a number or boolean matches its text ("2", "true"), a link
 * matches as written ("[[Note]]"), and a list property matches if any of its items does.
 * Empty values and nested objects never match.
 */
export function matchesProperties(
	frontmatter: Record<string, unknown> | null | undefined,
	rules: PropertyRules,
): boolean {
	if (!frontmatter) return false;
	return Object.entries(rules).some(([property, values]) => {
		const value = frontmatter[property];
		const items = Array.isArray(value) ? value : [value];
		return items.some((item) => {
			const text = asText(item);
			return text !== undefined && values.includes(text);
		});
	});
}

function asText(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return undefined;
}

/**
 * Reads the settings text, one property per line with comma separated values, e.g.
 * "status: archived, done". Lines without a property or a value are skipped, and a property
 * on several lines gets the values of all of them.
 */
export function parsePropertyRules(text: string): PropertyRules {
	const rules: PropertyRules = {};
	for (const line of text.split("\n")) {
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const property = line.slice(0, colon).trim();
		const values = line
			.slice(colon + 1)
			.split(",")
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		if (!property || values.length === 0) continue;
		rules[property] = [...new Set([...(rules[property] ?? []), ...values])];
	}
	return rules;
}

/** The non-blank lines parsePropertyRules skips, numbered from one. */
export function propertyRuleProblems(text: string): readonly { line: number }[] {
	return text.split("\n").flatMap((line, index) => {
		if (!line.trim()) return [];
		const colon = line.indexOf(":");
		const property = line.slice(0, colon).trim();
		const hasValue = line
			.slice(colon + 1)
			.split(",")
			.some((value) => value.trim().length > 0);
		return colon < 0 || !property || !hasValue ? [{ line: index + 1 }] : [];
	});
}

/** The settings text for the rules, the reverse of parsePropertyRules. */
export function formatPropertyRules(rules: PropertyRules): string {
	return Object.entries(rules)
		.map(([property, values]) => `${property}: ${values.join(", ")}`)
		.join("\n");
}
