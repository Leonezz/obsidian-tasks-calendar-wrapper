import { copy } from "@tasks-calendar-wrapper/core";
import type { RenderControl } from "./index";

/** Draws a text area and updates its codec's problems while typing. */
export const renderTextArea: RenderControl = (setting, row, tab) => {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	const showProblems = (text: string) =>
		tab.setMessages({
			warnings: codec.problems?.(text).map(copy.settings.tab.propertyRuleSkipped),
		});
	setting.addTextArea((ta) => {
		if (row.texts.placeholder !== undefined) ta.setPlaceholder(row.texts.placeholder);
		const text = codec.format(tab.options()[row.key]);
		ta.setValue(text);
		showProblems(text);
		ta.onChange(async (v) => {
			showProblems(v);
			await tab.save({ [row.key]: codec.parse(v) }, row.redrawsTab);
		});
	});
};
