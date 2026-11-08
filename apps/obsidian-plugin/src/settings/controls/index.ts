import type { Setting } from "obsidian";
import type { SettingControl } from "@tasks-calendar-wrapper/core";
import type { SettingsControlActions } from "../generate";
import type { SettingRowOf } from "../rows";
import { renderToggle } from "./toggle";
import { renderDropdown } from "./dropdown";
import { renderText } from "./text";
import { renderTextArea } from "./textArea";
import { renderMomentFormat } from "./momentFormat";
import { renderTagList } from "./tagList";
import { renderTagPalette } from "./tagPalette";

/** Draws a row's control into its Setting, reading values when the control needs them. */
export type RenderControl = (setting: Setting, row: SettingRowOf<"setting">, tab: SettingsControlActions) => void;

/** One renderer for every control the schema can name. */
export const renderers: { readonly [C in Exclude<SettingControl, "none">]: RenderControl } = {
	toggle: renderToggle,
	dropdown: renderDropdown,
	text: renderText,
	textArea: renderTextArea,
	momentFormat: renderMomentFormat,
	tagList: renderTagList,
	tagPalette: renderTagPalette,
};
