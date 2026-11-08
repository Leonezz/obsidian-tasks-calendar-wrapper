import type { RenderControl } from "./index";

/** Draws a toggle with the row's texts and redraw behavior. */
export const renderToggle: RenderControl = (setting, row, tab) => {
	setting
		.setName(row.texts.name)
		.setDesc(row.texts.desc)
		.addToggle((tg) => {
			tg.setValue(tab.options()[row.key] as boolean);
			tg.onChange(async (v) => await tab.save({ [row.key]: v }, row.redrawsTab));
		});
};
