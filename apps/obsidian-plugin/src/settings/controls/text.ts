import type { RenderControl } from "./index";

/** Draws a text box using the row's codec. */
export const renderText: RenderControl = (setting, row, tab) => {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	setting
		.setName(row.texts.name)
		.setDesc(row.texts.desc)
		.addText((t) => {
			if (row.texts.placeholder !== undefined) t.setPlaceholder(row.texts.placeholder);
			t.setValue(codec.format(tab.options()[row.key]));
			t.onChange(async (v) => await tab.save({ [row.key]: codec.parse(v) }, row.redrawsTab));
		});
};
