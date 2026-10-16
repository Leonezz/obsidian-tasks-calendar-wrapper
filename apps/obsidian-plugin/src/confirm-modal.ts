import { App, ButtonComponent, Modal } from "obsidian";

export interface ConfirmOptions {
    title: string;
    message: string;
    /** The label of the button that answers yes. */
    confirmText: string;
}

/**
 * Asks the user a yes or no question in an Obsidian dialog, in place of the browser's confirm().
 * Only the confirm button answers yes. Cancel, Escape, the close button and a click outside all answer no.
 */
export class ConfirmModal extends Modal {
    private confirmed = false;
    private confirmButton?: ButtonComponent;
    private readonly answer: Promise<boolean>;

    constructor(app: App, private readonly options: ConfirmOptions) {
        super(app);
        this.answer = new Promise(resolve => this.setCloseCallback(() => resolve(this.confirmed)));
    }

    /** Opens the dialog. Resolves once it closes, to whether the user confirmed. */
    ask(): Promise<boolean> {
        this.open();
        // Opening focuses the first button, Cancel. The confirm button takes it, so Enter answers yes as with confirm().
        this.confirmButton?.buttonEl.focus();
        return this.answer;
    }

    onOpen(): void {
        this.setTitle(this.options.title).setContent(this.options.message);
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(buttons)
            .setButtonText("Cancel")
            .onClick(() => this.close());
        this.confirmButton = new ButtonComponent(buttons)
            .setButtonText(this.options.confirmText)
            .setCta()
            .onClick(() => {
                this.confirmed = true;
                this.close();
            });
    }
}
