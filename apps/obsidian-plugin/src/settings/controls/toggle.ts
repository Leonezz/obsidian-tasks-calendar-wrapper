import type { RenderControl } from "./index";
import { reportSaveError } from "../save";

/** Draws a toggle with the row's texts and redraw behavior. */
export const renderToggle: RenderControl = (setting, row, tab) => {
	setting.addToggle((tg) => {
		tg.toggleEl.setAttribute("aria-label", row.texts.name);
		tg.setValue(tab.options()[row.key] as boolean);
		tg.onChange(async (v) => await tab.save({ [row.key]: v }, row.redrawsTab).catch(reportSaveError));
	});
};
