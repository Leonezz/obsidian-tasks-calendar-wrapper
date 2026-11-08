import { copy, pathListCodec } from "@tasks-calendar-wrapper/core";
import type { RenderControl } from "./index";

const PATH_FILTER_WARNING = copy.settings.tab.pathFilterWarning;

/** Draws a text area, with the path warning only for the path-list codec. */
export const renderTextArea: RenderControl = (setting, row, tab) => {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	setting
		.setName(row.texts.name)
		.setDesc(
			row.spec.codec === pathListCodec
				? descriptionWithWarning(row.texts.desc, PATH_FILTER_WARNING)
				: row.texts.desc,
		)
		.addTextArea((ta) => {
			if (row.texts.placeholder !== undefined) ta.setPlaceholder(row.texts.placeholder);
			ta.setValue(codec.format(tab.options()[row.key]));
			ta.onChange(async (v) => await tab.save({ [row.key]: codec.parse(v) }, row.redrawsTab));
		});
};

function descriptionWithWarning(description: string, warning: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.appendText(description);
		fragment.createEl("p", { text: warning, cls: "tasks-calendar-wrapper-setting-warning" });
	});
}
