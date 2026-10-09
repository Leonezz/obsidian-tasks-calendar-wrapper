import { App, ButtonComponent, Modal } from "obsidian";
import { ReleaseNote, SupportLink } from "../utils/whatsnew";

/** Lists what changed in the versions since the user last looked, with links to support the plugin. */
export class WhatsNewModal extends Modal {
    constructor(app: App, private readonly notes: ReleaseNote[], private readonly links: SupportLink[]) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText("What's new in Tasks Calendar Wrapper");
        contentEl.addClass("tasks-calendar-wrapper-whats-new");

        for (const note of this.notes) {
            contentEl.createEl("h4", { text: `Version ${note.version}` });
            const list = contentEl.createEl("ul");
            note.items.forEach(item => list.createEl("li", { text: item }));
        }

        if (this.links.length > 0) {
            contentEl.createEl("p", {
                text: "If you find this plugin useful, please consider supporting its development.",
                cls: "tasks-calendar-wrapper-support-text",
            });
        }

        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        for (const link of this.links) {
            new ButtonComponent(buttons)
                .setButtonText(link.label)
                .onClick(() => window.open(link.url));
        }
        new ButtonComponent(buttons)
            .setButtonText("Thanks!")
            .setCta()
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
