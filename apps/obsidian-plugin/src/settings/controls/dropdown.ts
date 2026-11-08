import { optionsOf } from "../rows";
import type { RenderControl } from "./index";

/** Draws dropdown labels in their schema order before selecting the saved value. */
export const renderDropdown: RenderControl = (setting, row, tab) => {
	setting.addDropdown((d) => {
		d.addOptions(optionsOf(row.key));
		d.setValue(tab.options()[row.key] as string);
		d.onChange(async (v) => await tab.save({ [row.key]: v }, row.redrawsTab));
	});
};
