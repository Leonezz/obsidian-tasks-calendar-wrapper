import { ButtonComponent, Modal, Plugin, Setting, TextComponent } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { textsOf } from "./rows";
import { isSingleTag, SettingsTagSuggest } from "./tags";
import { reportSaveError } from "./save";

type SaveTag = (tag: string) => Promise<string | void>;
type SavePalette = (tag: string, color: string) => Promise<string | void>;

/** A tag editor keeps its input until validation and persistence have both succeeded. */
export class TagColorPaletteModal extends Modal {
	tagText: string;
	color: string;
	valid = false;
	private suggest?: SettingsTagSuggest;
	constructor(
		plugin: Plugin,
		tag = "",
		color = "#000000",
		private readonly save?: SavePalette,
	) {
		super(plugin.app);
		this.tagText = tag;
		this.color = color;
	}
	onOpen(): void {
		this.valid = false;
		this.display();
	}
	onClose(): void {
		this.closeSuggestions();
	}
	closeSuggestions(): void {
		this.suggest?.close();
	}
	display(): void {
		this.contentEl.empty();
		const texts = textsOf("tagColorPalette");
		this.setTitle(texts.name);
		const settingdiv = this.contentEl.createDiv();
		const description = textsOf("tagColorPalette").desc;
		let text: TextComponent;
		let saveButton: ButtonComponent;
		let saving = false;
		const input = new Setting(settingdiv).setName(copy.settings.tab.tagModalName).setDesc(description);
		const showError = (message?: string) => {
			this.valid = false;
			text.inputEl.setAttribute("aria-invalid", String(!!message));
			input.setDesc(message ? errorDescription(description, message) : description);
		};
		const submit = async () => {
			if (saving) return;
			const tag = this.tagText.trim();
			const color = this.color;
			if (!isSingleTag(tag)) return showError(copy.settings.tab.invalidTag({ tag: this.tagText }));
			if (!/^#[\da-f]{6}$/i.test(this.color)) return showError(copy.settings.tab.emptyColor);
			saving = true;
			saveButton.setDisabled(true);
			try {
				const error = await this.save?.(tag, color);
				if (error) return showError(error);
				// An edit made during the save is a new draft and must stay available.
				if (this.tagText.trim() === tag && this.color === color) {
					this.tagText = tag;
					this.valid = true;
					this.close();
				}
			} catch (error) {
				showError(copy.settings.tab.saveFailed);
				reportSaveError(error);
			} finally {
				saving = false;
				saveButton.setDisabled(false);
			}
		};
		input
			.addText((t) => {
				text = t;
				t.setValue(this.tagText).setPlaceholder(copy.settings.tab.tagPlaceholder);
				t.inputEl.setAttribute("aria-label", copy.settings.tab.tagModalName);
				t.onChange((value) => {
					this.tagText = value;
					showError();
				});
				t.inputEl.addEventListener("keydown", (event) => {
					if (
						event.key === "Enter" &&
						!event.isComposing &&
						event.keyCode !== 229 &&
						!event.defaultPrevented
					) {
						event.preventDefault();
						void submit();
					}
				});
				this.suggest = new SettingsTagSuggest(
					this.app,
					t.inputEl,
					() => [],
					(tag) => {
						this.tagText = tag;
						showError();
					},
				);
			})
			.addColorPicker((picker) => {
				picker.setValue(this.color).onChange((value) => {
					this.color = value;
					showError();
				});
			});
		new Setting(this.contentEl.createDiv())
			.addButton((button) => {
				saveButton = button;
				button
					.setButtonText(copy.settings.tab.saveLabel)
					.setTooltip(copy.settings.tab.saveTooltip)
					.setCta()
					.onClick(submit);
			})
			.addButton((button) => {
				button
					.setButtonText(copy.settings.tab.cancelLabel)
					.setTooltip(copy.settings.tab.cancelTooltip)
					.onClick(() => this.close());
			});
	}
}

/** Retained for callers needing a dialog; the settings lists themselves use inline entry. */
export class TagModal extends Modal {
	tagText = "";
	rejected?: string;
	valid = false;
	constructor(
		plugin: Plugin,
		private readonly save?: SaveTag,
	) {
		super(plugin.app);
	}
	onOpen(): void {
		this.valid = false;
		this.display();
	}
	display(): void {
		this.contentEl.empty();
		this.setTitle(copy.settings.tab.addTagLabel);
		let text: TextComponent;
		let saveButton: ButtonComponent;
		let saving = false;
		const input = new Setting(this.contentEl.createDiv())
			.setName(copy.settings.tab.tagModalName)
			.setDesc(copy.settings.tab.tagModalDesc);
		const showError = (message?: string) => {
			this.valid = false;
			text.inputEl.setAttribute("aria-invalid", String(!!message));
			input.setDesc(
				message ? errorDescription(copy.settings.tab.tagModalDesc, message) : copy.settings.tab.tagModalDesc,
			);
		};
		const submit = async () => {
			if (saving) return;
			const tag = this.tagText.trim();
			if (!isSingleTag(tag)) {
				this.rejected = this.tagText;
				showError(copy.settings.tab.invalidTag({ tag: this.tagText }));
				return;
			}
			saving = true;
			saveButton.setDisabled(true);
			try {
				const error = await this.save?.(tag);
				if (error) return showError(error);
				if (this.tagText.trim() === tag) {
					this.tagText = tag;
					this.valid = true;
					this.close();
				}
			} catch (error) {
				showError(copy.settings.tab.saveFailed);
				reportSaveError(error);
			} finally {
				saving = false;
				saveButton.setDisabled(false);
			}
		};
		input.addText((t) => {
			text = t;
			t.setValue(this.tagText)
				.setPlaceholder(copy.settings.tab.tagPlaceholder)
				.onChange((value) => {
					this.tagText = value;
					showError();
				});
			t.inputEl.setAttribute("aria-label", copy.settings.tab.tagModalName);
			t.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
					event.preventDefault();
					void submit();
				}
			});
		});
		new Setting(this.contentEl.createDiv())
			.addButton((button) => {
				saveButton = button;
				button
					.setButtonText(copy.settings.tab.addTagLabel)
					.setTooltip(copy.settings.tab.saveTooltip)
					.setCta()
					.onClick(submit);
			})
			.addButton((button) => {
				button
					.setButtonText(copy.settings.tab.cancelLabel)
					.setTooltip(copy.settings.tab.cancelTooltip)
					.onClick(() => this.close());
			});
	}
}

function errorDescription(description: string, message: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.appendText(description);
		fragment.createEl("p", {
			text: message,
			cls: "tasks-calendar-wrapper-setting-warning",
			attr: { role: "alert" },
		});
	});
}
