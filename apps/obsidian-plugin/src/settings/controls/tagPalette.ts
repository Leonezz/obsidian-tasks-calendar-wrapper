import { ExtraButtonComponent, Setting } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { TagColorPaletteModal } from "../modals";
import { reportSaveError } from "../save";
import type { SettingsControlActions } from "../generate";
import type { SettingRowOf } from "../rows";

/** Wrapping palette chips open an editor that saves before it closes. */
export function renderTagPalette(
	tagSettings: Setting,
	row: SettingRowOf<"setting">,
	tab: SettingsControlActions,
): (shown: boolean, refresh?: boolean) => void {
	const key = row.key;
	const container = tagSettings.controlEl.createDiv("tcw-settings-palette");
	let drawn = false;
	let pending = false;
	const buttons: ExtraButtonComponent[] = [];
	const previews: HTMLButtonElement[] = [];
	const canAct = () => tab.isShown() && container.isConnected;
	const setPending = (value: boolean) => {
		pending = value;
		container.setAttribute("aria-busy", String(value));
		for (const button of buttons) button.setDisabled(value);
		for (const preview of previews) preview.disabled = value;
	};
	const remove = async (tag: string) => {
		if (pending || !canAct()) return;
		const current = tab.options()[key] as Record<string, string>;
		if (!Object.prototype.hasOwnProperty.call(current, tag)) return;
		setPending(true);
		try {
			await tab.save({ [key]: withoutTag(current, tag) }, row.redrawsTab);
		} catch (error) {
			reportSaveError(error);
		} finally {
			setPending(false);
		}
	};
	const open = (original?: string) => {
		if (pending || !canAct()) return;
		const palette = tab.options()[key] as Record<string, string>;
		if (original !== undefined && !Object.prototype.hasOwnProperty.call(palette, original)) return;
		let baseline = original;
		let failed: { tag: string; color: string } | undefined;
		const modal = new TagColorPaletteModal(
			tab.plugin,
			original,
			original ? palette[original] : undefined,
			async (tag, color) => {
				if (!canAct()) return copy.settings.tab.saveFailed;
				if (pending) return copy.settings.tab.saving;
				const current = tab.options()[key] as Record<string, string>;
				const ownFailedWrite = failed?.tag === tag && current[tag] === failed.color;
				if (tag !== baseline && Object.prototype.hasOwnProperty.call(current, tag) && !ownFailedWrite)
					return copy.settings.tab.tagExists({ tag });
				// A failed earlier save already reached the live store; replace its provisional key on retry.
				const base = withoutTag(current, baseline);
				if (failed && failed.tag !== baseline && base[failed.tag] === failed.color) delete base[failed.tag];
				setPending(true);
				try {
					await tab.save({ [key]: { ...base, [tag]: color } }, row.redrawsTab);
					baseline = tag;
					failed = undefined;
				} catch (error) {
					failed = { tag, color };
					throw error;
				} finally {
					setPending(false);
				}
			},
		);
		tab.registerCleanup?.(() => modal.closeSuggestions());
		modal.open();
	};
	const addTooltip = row.texts.addTooltip;
	if (addTooltip === undefined) throw new Error(`Missing setting addTooltip: ${key}`);
	tagSettings.addExtraButton((button) => {
		buttons.push(button);
		button
			.setIcon("plus-with-circle")
			.setTooltip(addTooltip)
			.onClick(() => open());
	});
	const addButton = tagSettings.controlEl.children[tagSettings.controlEl.children.length - 1] as HTMLElement;
	const show = (shown: boolean, refresh = false) => {
		if (refresh) {
			// Keep the outer container alive: an open editor may still hold a newer draft.
			container.empty();
			drawn = false;
			buttons.splice(1);
			previews.length = 0;
		}
		container.hidden = !shown;
		addButton.hidden = !shown;
		if (!shown || drawn) return;
		drawn = true;
		Object.entries(tab.options()[key] as Record<string, string>).forEach(([tag, color]) => {
			const chip = new Setting(container);
			chip.settingEl.addClass("tcw-settings-palette-chip");
			const preview = chip.controlEl.createEl("button", {
				cls: "tag tcw-settings-palette-tag",
				text: tag,
				attr: {
					type: "button",
					style: `color: ${color}`,
					"aria-label": copy.settings.tab.editTagColor({ tag }),
				},
			});
			preview.addEventListener("click", () => open(tag));
			previews.push(preview);
			chip.addExtraButton((button) => {
				buttons.push(button);
				button
					.setIcon("cross")
					.setTooltip(copy.settings.tab.removeTag({ tag }))
					.onClick(() => remove(tag));
			}).addExtraButton((button) => {
				buttons.push(button);
				button
					.setIcon("pencil")
					.setTooltip(copy.settings.tab.editTagColor({ tag }))
					.onClick(() => open(tag));
			});
		});
		setPending(pending);
	};
	show(row.shown);
	return show;
}

function withoutTag(palette: Record<string, string>, tag?: string): Record<string, string> {
	return Object.fromEntries(Object.entries(palette).filter(([key]) => key !== tag));
}
