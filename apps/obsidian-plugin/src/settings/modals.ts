import { Modal, Notice, Plugin, Setting } from "obsidian";
import { copy, TaskRegularExpressions } from "@tasks-calendar-wrapper/core";
import { textsOf } from "./rows";

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
		new Setting(settingdiv)
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
						return new Notice(copy.settings.tab.invalidTag({ tag: this.tagText }), 5000);
					}
					if (this.color === "") {
						this.valid = false;
						return new Notice(copy.settings.tab.emptyColor, 5000);
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
						new Notice(copy.settings.tab.invalidTag({ tag: this.tagText }), 5000);
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
