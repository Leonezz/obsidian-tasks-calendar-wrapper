import { Setting } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { TagColorPaletteModal } from "../modals";
import type { RenderControl } from "./index";

/** Draws the palette before its parent toggle, keeping an empty nested row when it is off. */
export const renderTagPalette: RenderControl = (tagSettings, row, tab) => {
	const key = row.key;
	tagSettings.controlEl.empty();
	tagSettings.controlEl.appendChild(createDiv());
	let tagBadgeSetting = new Setting(tagSettings.controlEl.firstChild as HTMLElement);
	if (row.shown) {
		Object.entries(tab.options()[key] as Record<string, string>).forEach(([tag, color], index) => {
			if (index !== 0 && !(index & 0x01))
				tagBadgeSetting = new Setting(tagSettings.controlEl.firstChild as HTMLElement);
			tagBadgeSetting.controlEl.appendChild(
				createDiv({ cls: "tag", text: tag, attr: { style: `color: ${color}` } }),
			);
			tagBadgeSetting
				.addExtraButton(async (btn) => {
					btn.setIcon("cross")
						.setTooltip(copy.settings.tab.deleteTooltip)
						.onClick(async () => {
							await tab.save(
								{ [key]: withoutTag(tab.options()[key] as Record<string, string>, tag) },
								row.redrawsTab,
							);
						});
				})
				.addExtraButton(async (btn) => {
					btn.setIcon("pencil")
						.setTooltip(copy.settings.tab.editTooltip)
						.onClick(async () => {
							const modal = new TagColorPaletteModal(tab.plugin, tag, color);
							modal.onClose = () => {
								if (!modal.valid) return;
								tab.saveInBackground(
									{
										[key]: {
											...withoutTag(tab.options()[key] as Record<string, string>, tag),
											[modal.tagText]: modal.color,
										},
									},
									row.redrawsTab,
								);
							};
							modal.open();
						});
				});
		});

		const addTooltip = row.texts.addTooltip;
		if (addTooltip === undefined) throw new Error(`Missing setting addTooltip: ${key}`);
		tagSettings.addExtraButton(async (btn) => {
			btn.setIcon("plus-with-circle")
				.setTooltip(addTooltip)
				.onClick(async () => {
					const modal = new TagColorPaletteModal(tab.plugin);
					modal.onClose = () => {
						if (!modal.valid) return;
						tab.saveInBackground(
							{
								[key]: {
									...(tab.options()[key] as Record<string, string>),
									[modal.tagText]: modal.color,
								},
							},
							row.redrawsTab,
						);
					};
					modal.open();
				});
		});
	}
};

function withoutTag(palette: Record<string, string>, tag: string): Record<string, string> {
	return Object.fromEntries(Object.entries(palette).filter(([key]) => key !== tag));
}
