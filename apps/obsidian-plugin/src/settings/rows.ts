import { copy, type SettingControl, type SettingIssue } from "@tasks-calendar-wrapper/core";
import { settingGroups, settingsSchema, type SettingGroup, type SettingsSpec } from "../settings-schema";
import type { UserOption } from "../useroptions";

/** The texts a control uses, with optional leaves for its kind. */
interface SettingTexts {
	readonly name: string;
	readonly desc: string;
	readonly placeholder?: string;
	readonly descAfterLink?: string;
	readonly addTooltip?: string;
	readonly options?: Readonly<Record<string, string>>;
}

/** A heading or setting, including hidden rows and the palette nested in its parent. */
export type SettingRow =
	| { readonly kind: "heading"; readonly group: SettingGroup; readonly name: string }
	| {
			readonly kind: "setting";
			readonly key: keyof UserOption;
			readonly control: Exclude<SettingControl, "none">;
			readonly spec: SettingsSpec;
			readonly texts: SettingTexts;
			readonly issue?: SettingIssue;
			readonly shown: boolean;
			readonly redrawsTab: boolean;
			readonly palette?: SettingRowOf<"setting">;
	  };

/** The row of one kind. */
export type SettingRowOf<K extends SettingRow["kind"]> = Extract<SettingRow, { kind: K }>;

/** The schema entry for an option. */
export function specOf(key: keyof UserOption) {
	const spec = settingsSchema.find((spec) => spec.key === key);
	if (!spec) throw new Error(`Missing setting spec: ${key}`);
	return spec;
}

/** The copy entry for an option. */
export function textsOf(key: keyof UserOption) {
	const spec = specOf(key);
	if (spec.copy === undefined) throw new Error(`Missing setting copy: ${key}`);
	return copy.settings[spec.copy];
}

/** Stored dropdown values and their labels, in the schema's order. */
export function optionsOf(key: keyof UserOption): Record<string, string> {
	const spec = specOf(key);
	const texts = textsOf(key);
	if (!spec.options || !("options" in texts)) throw new Error(`Missing setting options: ${key}`);
	const labels: Readonly<Record<string, string>> = texts.options;
	return Object.fromEntries(Object.entries(spec.options).map(([value, label]) => [value, labels[label]]));
}

/** Rows in tab order; only visibility parents are read, leaving every value to its control. */
export function settingRows(
	schema: readonly SettingsSpec[],
	options: Readonly<Record<string, unknown>>,
	issues: readonly SettingIssue[],
): readonly SettingRow[] {
	const rowOf = (spec: SettingsSpec): SettingRowOf<"setting"> => {
		if (spec.control === "none") throw new Error(`Missing setting control: ${spec.key}`);
		if (spec.copy === undefined) throw new Error(`Missing setting copy: ${spec.key}`);
		const issue = issues.find((issue) => issue.key === spec.key);
		const palette = schema.find((child) => child.control === "tagPalette" && child.shownWhen === spec.key);
		return Object.freeze({
			kind: "setting",
			key: spec.key,
			control: spec.control,
			spec: frozenSpec(spec),
			texts: copy.settings[spec.copy],
			issue: issue && Object.freeze({ ...issue }),
			shown: spec.shownWhen === undefined || Boolean(options[spec.shownWhen]),
			redrawsTab: spec.redrawsTab,
			...(palette && { palette: rowOf(palette) }),
		});
	};
	const indexed = schema.map((spec, index) => ({ spec, index }));
	const rows: SettingRow[] = [];
	for (const group of settingGroups) {
		const entries = indexed.filter(({ spec }) => spec.group === group && spec.control !== "none");
		if (entries.length === 0) continue;
		rows.push(Object.freeze({ kind: "heading", group, name: copy.settings.groups[group] }));
		entries.sort((a, b) => (a.spec.order ?? a.index) - (b.spec.order ?? b.index));
		for (const { spec } of entries) {
			if (spec.control !== "tagPalette") rows.push(rowOf(spec));
		}
	}
	return Object.freeze(rows);
}

/** Freeze metadata without changing a caller's schema or the identity of the built-in codecs. */
function frozenSpec(spec: SettingsSpec): SettingsSpec {
	return Object.freeze({
		...spec,
		...(spec.options && { options: Object.freeze({ ...spec.options }) }),
		...(spec.codec && {
			codec: Object.isFrozen(spec.codec) ? spec.codec : Object.freeze({ ...spec.codec }),
		}),
	});
}
