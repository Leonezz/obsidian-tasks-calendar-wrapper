import { copy } from "@tasks-calendar-wrapper/core";
import { moment } from "../../../utils/moment";
import type { RenderControl } from "./index";

/** Draws a moment-format box with a preview that follows the input before saving. */
export const renderMomentFormat: RenderControl = (setting, row, tab) => {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	const showPreview = (value: string) =>
		tab.setMessages({
			preview: copy.settings.tab.momentPreview({ sample: moment().format(value) }),
		});
	setting.addMomentFormat((m) => {
		if (row.texts.placeholder !== undefined) m.setPlaceholder(row.texts.placeholder);
		const value = codec.format(tab.options()[row.key]);
		m.setValue(value);
		showPreview(value);
		m.onChange(async (v) => {
			showPreview(v);
			await tab.save({ [row.key]: codec.parse(v) }, row.redrawsTab);
		});
	});
};
