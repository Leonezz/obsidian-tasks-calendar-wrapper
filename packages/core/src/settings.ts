import { formatPropertyRules, parsePropertyRules, type PropertyRules } from "./properties";

/**
 * The generic part of a settings schema: what a setting's value is, how the settings tab shows it, and how its text
 * box reads and writes it. It knows no plugin's options; the plugin lists them, one SettingSpec each.
 */

/** The type of a setting's value in data.json. */
export type SettingType = "boolean" | "string" | "stringList" | "stringMap" | "stringListMap";

/** The control the settings tab shows for a setting, or none for one the plugin manages itself. */
export type SettingControl =
	"toggle" | "dropdown" | "text" | "textArea" | "momentFormat" | "tagList" | "tagPalette" | "none";

/**
 * When the plugin reads a setting, which is when a change takes effect: with every push to the timelines, when a
 * timeline opens, once when the plugin loads, or never.
 */
export type ReadWhen = "push" | "viewOpen" | "pluginLoad" | "never";

/** Reads the text typed into a setting's box as its value, and writes the value as the text to show. */
export interface TextCodec<T> {
	parse(text: string): T;
	format(value: T): string;
}

export interface SettingSpec<K extends string = string, G extends string = string> {
	readonly key: K;
	readonly type: SettingType;
	readonly control: SettingControl;
	/** How the box of a text, text area or moment format control reads and writes the value. */
	readonly codec?: TextCodec<unknown>;
	/** The heading the setting shows under; none for a setting without a control. */
	readonly group?: G;
	/** The setting shows only while this one is on. */
	readonly shownWhen?: K;
	/** Changing the setting draws the tab again: it shows or hides other settings, or its own tags change. */
	readonly redrawsTab: boolean;
	readonly readWhen: ReadWhen;
}

const splitTrimmed = (text: string) => text.split(",").map((item) => item.trim());

/** Comma-separated paths: each trimmed, empty ones dropped. */
export const pathListCodec: TextCodec<string[]> = Object.freeze({
	parse: (text: string) => splitTrimmed(text).filter((path) => path.length > 0),
	format: (paths: readonly string[]) => paths.join(","),
});

/** Comma-separated files: each trimmed, empty ones kept, so an empty box is one empty file. */
export const fileListCodec: TextCodec<string[]> = Object.freeze({
	parse: splitTrimmed,
	format: (files: readonly string[]) => files.join(","),
});

/** Comma-separated status markers: each trimmed, and "[ ]" read as the space of a task to do. */
export const statusListCodec: TextCodec<string[]> = Object.freeze({
	parse: (text: string) => splitTrimmed(text).map((marker) => (marker === "[ ]" ? " " : marker)),
	format: (markers: readonly string[]) => markers.join(","),
});

/** Text without the spaces around it. */
export const trimmedTextCodec: TextCodec<string> = Object.freeze({
	parse: (text: string) => text.trim(),
	format: (text: string) => text,
});

/** Text as typed. */
export const plainTextCodec: TextCodec<string> = Object.freeze({
	parse: (text: string) => text,
	format: (text: string) => text,
});

/** Property rules, one property a line with its values after a colon, see parsePropertyRules. */
export const propertyRulesCodec: TextCodec<PropertyRules> = Object.freeze({
	parse: parsePropertyRules,
	format: formatPropertyRules,
});

/** A setting whose value is not of the type its spec gives, and what was found instead. */
export interface SettingIssue {
	readonly key: string;
	readonly expected: SettingType;
	readonly found: string;
}

/**
 * The settings whose values are not of the types the schema gives, in the schema's order. Only the types are checked,
 * and nothing is changed; keys the schema does not list are not looked at.
 */
export function settingIssues(
	values: Readonly<Record<string, unknown>>,
	schema: readonly SettingSpec[],
): readonly SettingIssue[] {
	const issues: SettingIssue[] = [];
	for (const { key, type } of schema) {
		const found = mismatchOf(values[key], type);
		if (found !== undefined) issues.push(Object.freeze({ key, expected: type, found }));
	}
	return Object.freeze(issues);
}

/** What the value is, when it is not of the type; undefined when it is. */
function mismatchOf(value: unknown, type: SettingType): string | undefined {
	switch (type) {
		case "boolean":
		case "string":
			return typeof value === type ? undefined : kindOf(value);
		case "stringList":
			return Array.isArray(value) ? badItemIn("array", value, isString) : kindOf(value);
		case "stringMap":
			return isPlainObject(value) ? badItemIn("object", Object.values(value), isString) : kindOf(value);
		case "stringListMap":
			return isPlainObject(value)
				? badItemIn("object", Object.values(value), isStringList, listOrKind)
				: kindOf(value);
	}
}

const isString = (item: unknown) => typeof item === "string";

const isStringList = (item: unknown) => Array.isArray(item) && item.every(isString);

/** The first item that does not fit, as "array with a number"; undefined when they all fit. */
function badItemIn(
	container: string,
	items: readonly unknown[],
	fits: (item: unknown) => boolean,
	describe: (item: unknown) => string = (item) => withArticle(kindOf(item)),
): string | undefined {
	const at = items.findIndex((item) => !fits(item));
	return at < 0 ? undefined : `${container} with ${describe(items[at])}`;
}

/** A list that should hold only text, by what is wrong in it, as "an array with a number"; else its kind. */
function listOrKind(item: unknown): string {
	return Array.isArray(item) ? `an ${badItemIn("array", item, isString)}` : withArticle(kindOf(item));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The kind of a value as data.json holds it: null and arrays apart from other objects. */
function kindOf(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function withArticle(kind: string): string {
	if (kind === "null" || kind === "undefined") return kind;
	return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}
