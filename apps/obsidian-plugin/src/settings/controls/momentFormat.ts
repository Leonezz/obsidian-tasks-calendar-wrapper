import { copy } from "@tasks-calendar-wrapper/core";
import type { RenderControl } from "./index";

const MOMENT_FORMAT_DOCS_URL = "https://momentjs.com/docs/#/displaying/format/";

/** Draws a moment-format box and its documentation link. */
export const renderMomentFormat: RenderControl = (setting, row, tab) => {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	if (row.texts.descAfterLink === undefined) throw new Error(`Missing setting descAfterLink: ${row.key}`);
	setting
		.setName(row.texts.name)
		.setDesc(descriptionWithMomentDocsLink(row.texts.desc, row.texts.descAfterLink))
		.addMomentFormat((m) => {
			if (row.texts.placeholder !== undefined) m.setPlaceholder(row.texts.placeholder);
			m.setValue(codec.format(tab.options()[row.key]));
			m.onChange(async (v) => await tab.save({ [row.key]: codec.parse(v) }, row.redrawsTab));
		});
};

function descriptionWithMomentDocsLink(before: string, after: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.appendText(before);
		fragment.createEl("a", { text: copy.settings.tab.momentDocsLink, href: MOMENT_FORMAT_DOCS_URL });
		fragment.appendText(after);
	});
}
