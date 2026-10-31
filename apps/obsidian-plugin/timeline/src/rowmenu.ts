import type { Menu as ObsidianMenu } from "obsidian";
import {
	dayKey,
	dayKeyAfter,
	parseTaskLine,
	tasksTaskLineRegex,
	type DateField,
	type DateValue,
	type DayKey,
	type MomentFactory,
} from "@tasks-calendar-wrapper/core";

/** A date action; relative days are read when the item is clicked. */
export type RowMenuAction =
	| { readonly kind: "set"; readonly field: DateField; readonly day: () => DayKey }
	| { readonly kind: "pick" | "remove"; readonly field: DateField };

/** One item in the row's date menu, grouped by field. */
export interface RowMenuItem {
	readonly title: string;
	readonly section: DateField;
	readonly action: RowMenuAction;
}

/** Reads only a line's own date, including Tasks' other list markers, without daily-note defaults. */
export function ownDate(sourceLine: string, field: DateField, moment: MomentFactory): DateValue | undefined {
	const match = tasksTaskLineRegex.exec(sourceLine);
	const line = match ? `- [${match[3]}] ${match[4]}` : sourceLine;
	return parseTaskLine(line, { moment })?.dates[field];
}

/** Builds immutable date items without opening Obsidian UI or sampling today's date. */
export function rowMenuItems(
	sourceLine: string,
	options: { readonly changesInPlace: boolean; readonly moment: MomentFactory & (() => DateValue) },
): readonly RowMenuItem[] {
	if (!options.changesInPlace) return Object.freeze([]);
	const { moment } = options;
	const items: RowMenuItem[] = [
		{ title: "Due today", section: "due", action: { kind: "set", field: "due", day: () => dayKey(moment()) } },
		{
			title: "Due tomorrow",
			section: "due",
			action: { kind: "set", field: "due", day: () => dayKeyAfter(moment(), 1, "day") },
		},
	];
	for (const field of ["due", "scheduled", "start"] as const) {
		items.push({ title: `Pick ${field} date…`, section: field, action: { kind: "pick", field } });
		if (ownDate(sourceLine, field, moment))
			items.push({ title: `Remove ${field} date`, section: field, action: { kind: "remove", field } });
	}
	return Object.freeze(items.map((item) => Object.freeze({ ...item, action: Object.freeze(item.action) })));
}

/** Shows the items through the supplied public Menu API in the event's window. */
export function showRowMenu(
	Menu: typeof ObsidianMenu,
	items: readonly RowMenuItem[],
	evt: MouseEvent,
	run: (action: RowMenuAction) => void | Promise<unknown>,
): void {
	if (items.length === 0) return;
	const menu = new Menu();
	for (const entry of items)
		menu.addItem((item) =>
			item
				.setTitle(entry.title)
				.setSection(entry.section)
				.onClick(() => run(entry.action)),
		);
	menu.showAtMouseEvent(evt);
}
