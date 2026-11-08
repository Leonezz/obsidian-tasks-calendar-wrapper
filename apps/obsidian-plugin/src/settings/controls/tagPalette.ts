import { Setting } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { TagColorPaletteModal } from "../modals";
import type { SettingsControlActions } from "../generate";
import type { SettingRowOf } from "../rows";

/** Keeps the palette's container and add button in place, drawing tags on first show. */
export function renderTagPalette(
	tagSettings: Setting,
	row: SettingRowOf<"setting">,
	tab: SettingsControlActions,
): (shown: boolean) => void {
	const key = row.key;
	const container = tagSettings.controlEl.createDiv();
	let drawn = false;
	const addTooltip = row.texts.addTooltip;
	if (addTooltip === undefined) throw new Error(`Missing setting addTooltip: ${key}`);
	tagSettings.addExtraButton((btn) => {
		btn.setIcon("plus-with-circle")
			.setTooltip(addTooltip)
			.onClick(() => {
				const modal = new TagColorPaletteModal(tab.plugin);
				modal.onClose = () => {
					if (!modal.valid) return;
					tab.saveInBackground(
						{ [key]: { ...(tab.options()[key] as Record<string, string>), [modal.tagText]: modal.color } },
						row.redrawsTab,
					);
				};
				modal.open();
			});
	});
	const addButton = tagSettings.controlEl.children[tagSettings.controlEl.children.length - 1] as HTMLElement;
	const show = (shown: boolean) => {
		container.hidden = !shown;
		addButton.hidden = !shown;
		if (!shown || drawn) return;
		drawn = true;
		let tagBadgeSetting = new Setting(container);
		Object.entries(tab.options()[key] as Record<string, string>).forEach(([tag, color], index) => {
			if (index !== 0 && !(index & 0x01)) tagBadgeSetting = new Setting(container);
			tagBadgeSetting.controlEl.appendChild(
				createDiv({ cls: "tag", text: tag, attr: { style: `color: ${color}` } }),
			);
			tagBadgeSetting
				.addExtraButton((btn) => {
					btn.setIcon("cross")
						.setTooltip(copy.settings.tab.deleteTooltip)
						.onClick(async () => {
							await tab.save(
								{ [key]: withoutTag(tab.options()[key] as Record<string, string>, tag) },
								row.redrawsTab,
							);
						});
				})
				.addExtraButton((btn) => {
					btn.setIcon("pencil")
						.setTooltip(copy.settings.tab.editTooltip)
						.onClick(() => {
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
	};
	show(row.shown);
	return show;
}

function withoutTag(palette: Record<string, string>, tag: string): Record<string, string> {
	return Object.fromEntries(Object.entries(palette).filter(([key]) => key !== tag));
}
