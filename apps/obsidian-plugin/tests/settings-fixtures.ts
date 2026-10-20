/**
 * What the settings tests share: the data.json shapes in fixtures/settings, rebuilt from the plugin's history; the
 * plugin started on one of them as Obsidian starts it; the rows a settings tab shows; and snapshots of what these tests
 * see, written with `UPDATE_GOLDEN=1 pnpm test` as the golden snapshots are.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import TasksCalendarWrapper from "../src/main";
import type { TasksCalendarSettingTab } from "../src/settings";
import { fakeVault } from "./fakevault";
import { FIXTURES } from "./golden-vault";
import {
	ButtonComponent,
	ControlElement,
	DropdownComponent,
	ExtraButtonComponent,
	FakeElement,
	type AddedCommand,
	type Setting,
	SettingItemElement,
} from "./stubs/obsidian";

/**
 * The data.json shapes, each as the version that wrote such a file wrote it: JSON.stringify(options, undefined, 2) by
 * Obsidian, or with tabs by scripts/fixture-app.mjs. Every version wrote all of its options at once.
 */
export const SETTINGS_FIXTURES: Readonly<Record<string, string>> = {
	"0.0.4-array-palette.json":
		"0.0.4's options, where the tag colour palette was a list; 0.0.4 never saved them, the build after it did",
	"0.0.5-useinfo.json":
		"0.0.5: the task item switches in useInfo, and the tag filters in useTagFilter, taskTagFilters and fileTagFilters",
	"0.1.2-freetext-sort.json": "0.0.9 to 0.1.2: the sort typed as a lambda, here the text box's own example",
	"0.2.9-dropdown-sort.json": "0.1.3 to 0.3.3: the sort picked from a list of lambdas",
	"0.3.1-hide-literal-todo.json":
		'0.1.12 to 0.3.3: a "[ ]" typed into the statuses to hide, which those versions saved as it was typed',
	"0.3.7-full.json": "0.3.7's options, as every 0.3.7 user has them after its first start",
	"quiet.json": "the options scripts/fixture-app.mjs installs for the benchmark and the screenshots",
	"null.json": "null, which is also what Obsidian hands a plugin without a data.json",
};

export const FIXTURE_NAMES = Object.keys(SETTINGS_FIXTURES);

const settingsDir = () => {
	if (!FIXTURES) assert.fail("GOLDEN_FIXTURES is not set. Run the tests with `pnpm test`, which sets it.");
	return path.join(FIXTURES, "settings");
};

/** The text of a fixture, as Obsidian reads data.json. */
export const readFixture = (name: string) => readFileSync(path.join(settingsDir(), name), "utf8");

/** The plugin's manifest; the version is pinned, as which release notes show depends on it. */
export const MANIFEST = {
	id: "tasks-calendar-wrapper",
	name: "Tasks Calendar Wrapper",
	version: "0.3.7",
	dir: ".obsidian/plugins/tasks-calendar-wrapper",
} as const;

/** The plugin with what the stub keeps for it, which Obsidian's typings do not declare. */
export type StartedPlugin = TasksCalendarWrapper & {
	dataJson: string | null;
	settingTab: TasksCalendarSettingTab | null;
	commands: readonly AddedCommand[];
	load(): Promise<void>;
	unload(): void;
};

/**
 * Starts the plugin as Obsidian does, with this data.json text, or none for null: it is loaded while Obsidian is still
 * starting, unless the layout is already ready, as when the plugin is turned on later.
 */
export async function startPlugin(dataJson: string | null, { layoutReady = false } = {}) {
	const vault = fakeVault({ "Inbox.md": "- [ ] call the plumber 📅 2026-01-20" }, { layoutReady });
	const plugin = new TasksCalendarWrapper(vault.app as never, MANIFEST as never) as unknown as StartedPlugin;
	plugin.dataJson = dataJson;
	await plugin.load();
	return { vault, plugin };
}

/** A control of a settings row, as the tab shows it. */
export type Control =
	| { type: string; value: unknown; placeholder?: string; options?: string[] }
	| { type: "extra-button" | "button"; icon: string; tooltip: string }
	| { type: "tag"; text: string; style?: unknown }
	| { type: "rows"; rows: Row[] };

/** A settings row: its name and description as text, whether it is a heading, and its controls in order. */
export interface Row {
	name: string;
	desc: string;
	heading?: true;
	controls: Control[];
}

/** An element as HTML-like text: a description reads as its text, with its link or warning in it. */
export function markup(node: string | FakeElement | ButtonComponent): string {
	if (typeof node === "string") return node;
	if (node instanceof ButtonComponent) return "";
	if (node.tag === "#text") return node.text;
	const inner = node.text + node.children.map(markup).join("");
	if (node.tag === "#document-fragment") return inner;
	const attrs = Object.entries(node.attr).map(([key, value]) => ` ${key}="${String(value)}"`);
	const cls = node.cls ? ` class="${node.cls}"` : "";
	return `<${node.tag}${attrs.join("")}${cls}>${inner}</${node.tag}>`;
}

/** The settings rows in an element, in the order they show. */
export function rowsOf(container: FakeElement): Row[] {
	return container.children.flatMap((child) => (child instanceof SettingItemElement ? [rowOf(child.setting)] : []));
}

function rowOf(setting: Setting): Row {
	return {
		name: markup(setting.name),
		desc: markup(setting.desc),
		...(setting.heading ? { heading: true as const } : {}),
		controls: setting.controlEl.children.map(controlOf),
	};
}

function controlOf(child: FakeElement | ButtonComponent): Control {
	if (child instanceof ButtonComponent) return { type: "button", icon: child.icon, tooltip: child.tooltip };
	if (child instanceof ControlElement) {
		const control = child.component;
		if (control instanceof ExtraButtonComponent)
			return { type: control.type, icon: control.icon, tooltip: control.tooltip };
		return {
			type: control.type,
			value: control.value,
			...(control.placeholder === undefined ? {} : { placeholder: control.placeholder }),
			...(control instanceof DropdownComponent ? { options: Object.keys(control.options) } : {}),
		};
	}
	if (child.cls === "tag")
		return {
			type: "tag",
			text: child.text,
			...(child.attr.style === undefined ? {} : { style: child.attr.style }),
		};
	return { type: "rows", rows: rowsOf(child) };
}

const UPDATE = process.env.UPDATE_GOLDEN === "1";

/**
 * Snapshots in a folder of fixtures/settings, compared byte for byte; `expected` names every file the folder holds.
 * `UPDATE_GOLDEN=1 pnpm test` writes them; review the diff. checkFolder finds files the tests no longer write and
 * files missing from the folder, whichever tests ran.
 */
export function snapshotsIn(folder: string, expected: readonly string[]) {
	const dir = () => path.join(settingsDir(), folder);
	return {
		match(name: string, text: string): void {
			assert.ok(expected.includes(name), `${name} is not one of the files fixtures/settings/${folder} holds`);
			const file = path.join(dir(), name);
			if (UPDATE) {
				mkdirSync(dir(), { recursive: true });
				writeFileSync(file, text);
				return;
			}
			if (!existsSync(file)) assert.fail(`${file} is missing. Create it with \`UPDATE_GOLDEN=1 pnpm test\`.`);
			assert.equal(
				text,
				readFileSync(file, "utf8"),
				`the result differs from fixtures/settings/${folder}/${name}. If the change is intended, run \`UPDATE_GOLDEN=1 pnpm test\` and review the diff.`,
			);
		},
		checkFolder(): void {
			const onDisk = existsSync(dir()) ? readdirSync(dir()) : [];
			const stale = onDisk.filter((name) => !expected.includes(name));
			assert.deepEqual(
				stale,
				[],
				`the tests no longer write these files in fixtures/settings/${folder}; remove them`,
			);
			const missing = expected.filter((name) => !onDisk.includes(name));
			assert.deepEqual(
				missing,
				[],
				`fixtures/settings/${folder} lacks these files; run \`UPDATE_GOLDEN=1 pnpm test\``,
			);
		},
	};
}
