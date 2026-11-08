import { Setting } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { TagModal } from "../modals";
import { reportSaveError } from "../save";
import type { RenderControl } from "./index";

/** Draws three tags per row, deleting and adding against the options saved now. */
export const renderTagList: RenderControl = (setting, row, tab) => {
	const key = row.key;
	const tagsSetting = setting;
	const container = tagsSetting.controlEl.createDiv();
	let tagsSettingControlEl = new Setting(container);
	const tags = tab.options()[key] as string[];
	tags.forEach((t, i) => {
		if (i !== 0 && i % 3 === 0) tagsSettingControlEl = new Setting(container);
		tagsSettingControlEl.controlEl.appendChild(createDiv({ cls: "tag", text: t }));
		tagsSettingControlEl.addExtraButton((eb) => {
			eb.setIcon("cross")
				.setTooltip(copy.settings.tab.deleteTooltip)
				.onClick(async () => {
					await tab.save(
						{ [key]: (tab.options()[key] as string[]).filter((tag) => tag !== t) },
						row.redrawsTab,
					);
				});
		});
	});

	const onadd = async (t: string) => {
		const current = tab.options()[key] as string[];
		if (current.includes(t)) {
			tab.setMessages({ warnings: [copy.settings.tab.tagExists({ tag: t })] });
		} else {
			await tab.save({ [key]: [...current, t] }, row.redrawsTab);
		}
	};
	tagsSetting.addExtraButton((eb) => {
		eb.setIcon("plus-with-circle").setTooltip(copy.settings.tab.addTagTooltip);
		eb.onClick(() => {
			tab.setMessages({});
			const modal = new TagModal(tab.plugin);
			modal.onClose = () => {
				if (!modal.valid) {
					if (modal.rejected !== undefined)
						tab.setMessages({ warnings: [copy.settings.tab.invalidTag({ tag: modal.rejected })] });
					return;
				}
				onadd(modal.tagText).catch(reportSaveError);
			};
			modal.open();
		});
	});
};
