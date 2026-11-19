import { ButtonComponent, Setting, TextComponent } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { isSingleTag, SettingsTagSuggest } from "../tags";
import { reportSaveError } from "../save";
import type { RenderControl } from "./index";

/** Inline tag entry and wrapping chips; saving never replaces the focused input. */
export const renderTagList: RenderControl = (setting, row, tab) => {
	const key = row.key;
	const container = setting.controlEl.createDiv("tcw-settings-tags");
	let text: TextComponent;
	let addButton: ButtonComponent;
	let pending = false;
	let composing = false;
	let failedAdds: readonly string[] = [];
	const current = () => tab.options()[key] as string[];
	const remove = async (tag: string) => {
		if (pending || !tab.isShown() || !container.isConnected) return;
		pending = true;
		try {
			await tab.save({ [key]: current().filter((value) => value !== tag) }, row.redrawsTab);
			drawTags();
			text.inputEl.focus();
		} catch (error) {
			reportSaveError(error);
		} finally {
			pending = false;
		}
	};
	const drawTags = () => {
		container.empty();
		current().forEach((tag) => {
			const chip = new Setting(container);
			chip.settingEl.addClass("tcw-settings-tag-chip");
			chip.controlEl.createEl("span", { cls: "tag", text: tag });
			chip.addExtraButton((button) => {
				button
					.setIcon("cross")
					.setTooltip(copy.settings.tab.removeTag({ tag }))
					.onClick(() => remove(tag));
			});
		});
	};
	const add = async () => {
		if (pending || composing || !tab.isShown() || !container.isConnected) return;
		const submitted = text.inputEl.value;
		const tags = [
			...new Set(
				submitted
					.split(/[,\r\n]+/)
					.map((tag) => tag.trim())
					.filter(Boolean),
			),
		];
		const invalid = tags.find((tag) => !isSingleTag(tag));
		if (invalid !== undefined || tags.length === 0) {
			text.inputEl.setAttribute("aria-invalid", "true");
			tab.setMessages({ warnings: [copy.settings.tab.invalidTag({ tag: invalid ?? submitted })] });
			return;
		}
		const additions = tags.filter((tag) => !current().includes(tag));
		const retrying =
			failedAdds.length > 0 && failedAdds.every((tag) => tags.includes(tag) && current().includes(tag));
		if (additions.length === 0 && !retrying) {
			tab.setMessages({ warnings: [copy.settings.tab.tagExists({ tag: tags[0] })] });
			return;
		}
		pending = true;
		addButton.setDisabled(true);
		try {
			await tab.save({ [key]: [...current(), ...additions] }, row.redrawsTab);
			failedAdds = [];
			drawTags();
			tab.setMessages({});
			if (text.inputEl.value === submitted) text.setValue("");
			text.inputEl.focus();
		} catch (error) {
			failedAdds = [...new Set([...failedAdds, ...additions])];
			reportSaveError(error);
		} finally {
			pending = false;
			addButton.setDisabled(false);
		}
	};
	tab.registerRefresh?.(drawTags);
	drawTags();
	setting.addText((control) => {
		text = control;
		control.setPlaceholder(copy.settings.tab.tagPlaceholder).onChange(() => {
			control.inputEl.setAttribute("aria-invalid", "false");
			tab.setMessages({});
		});
		control.inputEl.addClass("tcw-settings-tag-input");
		control.inputEl.setAttribute("aria-label", row.texts.name);
		control.inputEl.addEventListener("compositionstart", () => {
			composing = true;
		});
		control.inputEl.addEventListener("compositionend", () => {
			composing = false;
		});
		control.inputEl.addEventListener("keydown", (event) => {
			if (composing || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
			if (event.key === "Enter") {
				event.preventDefault();
				void add();
			} else if (event.key === "Backspace" && control.inputEl.value === "" && current().length > 0) {
				event.preventDefault();
				void remove(current()[current().length - 1]);
			}
		});
		control.inputEl.addEventListener("paste", (event) => {
			const pasted = event.clipboardData?.getData("text/plain");
			if (!pasted || !/[,\r\n]/.test(pasted)) return;
			event.preventDefault();
			const from = control.inputEl.selectionStart ?? control.inputEl.value.length;
			const to = control.inputEl.selectionEnd ?? from;
			// Single-line native inputs strip newlines before `input` fires; retain each pasted tag.
			const next =
				control.inputEl.value.slice(0, from) +
				pasted.replace(/[\r\n]+/g, ",") +
				control.inputEl.value.slice(to);
			control.setValue(next);
			void add();
		});
		const suggest = new SettingsTagSuggest(tab.plugin.app, control.inputEl, current, () => {
			void add();
		});
		tab.registerCleanup?.(() => suggest.close());
	});
	setting.addButton((button) => {
		addButton = button;
		button.setButtonText(copy.settings.tab.addTagLabel).setTooltip(copy.settings.tab.addTagTooltip).onClick(add);
	});
};
