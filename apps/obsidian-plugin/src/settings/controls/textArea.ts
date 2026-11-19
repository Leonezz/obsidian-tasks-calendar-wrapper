import { copy } from "@tasks-calendar-wrapper/core";
import type { RenderControl } from "./index";
import { renderPathList } from "./pathPicker";
import { reportSaveError } from "../save";

/** Draws a text area and updates its codec's problems while typing. */
export const renderTextArea: RenderControl = (setting, row, tab) => {
	if (row.key === "includePaths" || row.key === "excludePaths" || row.key === "taskFiles") {
		renderPathList(setting, row, tab);
		return;
	}
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
		ta.inputEl.setAttribute("aria-label", row.texts.name);
		showProblems(text);
		ta.onChange(async (v) => {
			showProblems(v);
			await tab.save({ [row.key]: codec.parse(v) }, row.redrawsTab).catch(reportSaveError);
		});
	});
};
