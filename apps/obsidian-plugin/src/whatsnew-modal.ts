import { App, ButtonComponent, Modal } from "obsidian";
import { REPOSITORY_URL, ReleaseNote, SupportLink } from "../utils/whatsnew";

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

        contentEl.createEl("p", {
            text: "If you find this plugin useful, a star on GitHub or your support for its development helps a lot.",
            cls: "tasks-calendar-wrapper-support-text",
        });

        const links = contentEl.createDiv({ cls: "tasks-calendar-wrapper-support-links" });
        new ButtonComponent(links)
            .setButtonText("⭐ Star on GitHub")
            .onClick(() => window.open(REPOSITORY_URL));
        for (const link of this.links) {
            new ButtonComponent(links)
                .setButtonText(link.label)
                .onClick(() => window.open(link.url));
        }

        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(buttons)
            .setButtonText("Thanks!")
            .setCta()
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
