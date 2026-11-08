import { Modal, Plugin, Setting } from "obsidian";
import { copy, TaskRegularExpressions } from "@tasks-calendar-wrapper/core";
import { textsOf } from "./rows";
import { reportNotice } from "../../timeline/src/notices";
import { ERROR_NOTICE_MS } from "../../timeline/src/writerconstants";

export class TagColorPaletteModal extends Modal {
	tagText: string;
	color: string;
	valid: boolean;
	constructor(plugin: Plugin, tag?: string, color?: string) {
		super(plugin.app);
		this.tagText = tag || "";
		this.color = color || "";
		this.valid = false;
	}
	onOpen(): void {
		this.display();
	}
	display() {
		const { contentEl } = this;
		contentEl.empty();
		const settingdiv = contentEl.createDiv();
		const input = new Setting(settingdiv)
			.setName(textsOf("tagColorPalette").name)
			.setDesc(textsOf("tagColorPalette").desc)
			.addText((t) => {
				t.setValue(this.tagText);
				t.onChange((v) => (this.tagText = v));
			})
			.addColorPicker((cp) => {
				cp.setValue(this.color);
				cp.onChange((v) => (this.color = v));
			});
		const footer = contentEl.createDiv();
		new Setting(footer)
			.addButton((btn) => {
				btn.setIcon("checkmark");
				btn.setTooltip(copy.settings.tab.saveTooltip);
				btn.onClick(() => {
					if (!this.tagText.match(TaskRegularExpressions.hashTags)) {
						this.valid = false;
						input.setDesc(
							createFragment((fragment) => {
								fragment.appendText(textsOf("tagColorPalette").desc);
								fragment.createEl("p", {
									text: copy.settings.tab.invalidTag({ tag: this.tagText }),
									cls: "tasks-calendar-wrapper-setting-warning",
								});
							}),
						);
						return;
					}
					if (this.color === "") {
						this.valid = false;
						return reportNotice(copy.settings.tab.emptyColor, ERROR_NOTICE_MS);
					}
					this.valid = true;
					this.close();
				});
				return btn;
			})
			.addButton((btn) => {
				btn.setIcon("cross");
				btn.setTooltip(copy.settings.tab.cancelTooltip);
				btn.onClick(() => {
					this.valid = false;
					this.close();
				});
				return btn;
			});
	}
}

export class TagModal extends Modal {
	tagText: string;
	rejected?: string;
	valid: boolean;
	constructor(plugin: Plugin) {
		super(plugin.app);
		this.tagText = "";
		this.valid = false;
	}
	onOpen(): void {
		this.display();
	}
	display() {
		const { contentEl } = this;
		contentEl.empty();
		const settingdiv = contentEl.createDiv();
		new Setting(settingdiv)
			.setName(copy.settings.tab.tagModalName)
			.setDesc(copy.settings.tab.tagModalDesc)
			.addText((t) => {
				t.setValue(this.tagText);
				t.onChange((v) => {
					this.tagText = v;
				});
				return t;
			});
		const footer = contentEl.createDiv();
		new Setting(footer)
			.addButton((btn) => {
				btn.setIcon("checkmark");
				btn.setTooltip(copy.settings.tab.saveTooltip);
				btn.onClick(() => {
					if (!this.tagText.match(TaskRegularExpressions.hashTags)) {
						this.valid = false;
						this.rejected = this.tagText;
					} else {
						this.valid = true;
					}
					this.close();
				});
				return btn;
			})
			.addButton((btn) => {
				btn.setIcon("cross");
				btn.setTooltip(copy.settings.tab.cancelTooltip);
				btn.onClick(() => {
					this.valid = false;
					this.close();
				});
				return btn;
			});
	}
}
