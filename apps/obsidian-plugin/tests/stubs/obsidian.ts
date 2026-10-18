/**
 * Minimal runtime stand-in for the `obsidian` package, which ships type
 * declarations only. Tests alias `obsidian` to this module.
 */
import moment from "moment";

export { moment };

/** As in Obsidian: with resetTimer, every call starts the wait again, so only the last call of a burst runs. */
export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout = 0, resetTimer = false) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const debounced = (...args: T) => {
		if (timer !== undefined) {
			if (!resetTimer) return;
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			cb(...args);
		}, timeout);
	};
	return Object.assign(debounced, { cancel: () => clearTimeout(timer) });
}

/** Obsidian shows a toast. The stub keeps each message, so a test can check what the user was told. */
export class Notice {
	static shown: string[] = [];

	constructor(
		public message: string,
		public duration?: number,
	) {
		Notice.shown.push(message);
	}
}

/** Stands in for the DOM elements a modal is built from. Keeps the text, the children and whether it got the focus. */
export class FakeElement {
	text = "";
	children: (FakeElement | ButtonComponent)[] = [];
	focused = false;

	focus(): void {
		this.focused = true;
	}

	setText(text: string): void {
		this.text = text;
		this.children = [];
	}

	createDiv(): FakeElement {
		const div = new FakeElement();
		this.children = [...this.children, div];
		return div;
	}
}

/** Keeps what a test needs to find a button and press it. */
export class ButtonComponent {
	readonly buttonEl = new FakeElement();
	buttonText = "";
	private clickHandler?: () => unknown;

	constructor(containerEl: FakeElement) {
		containerEl.children = [...containerEl.children, this];
	}

	setButtonText(text: string): this {
		this.buttonText = text;
		return this;
	}

	setCta(): this {
		return this;
	}

	onClick(handler: () => unknown): this {
		this.clickHandler = handler;
		return this;
	}

	/** Not in Obsidian: presses the button. */
	click(): void {
		this.clickHandler?.();
	}
}

/** As in Obsidian, opening calls onOpen, and closing, by a button or by Escape, calls onClose and then the close callback. */
export class Modal {
	readonly titleEl = new FakeElement();
	readonly contentEl = new FakeElement();
	private closeCallback?: () => unknown;
	private isOpen = false;

	constructor(public app: unknown) {}

	open(): void {
		this.isOpen = true;
		void this.onOpen();
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.onClose();
		this.closeCallback?.();
	}

	onOpen(): Promise<void> | void {}

	onClose(): void {}

	setTitle(title: string): this {
		this.titleEl.setText(title);
		return this;
	}

	setContent(content: string): this {
		this.contentEl.setText(content);
		return this;
	}

	setCloseCallback(callback: () => unknown): this {
		this.closeCallback = callback;
		return this;
	}
}

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Writes the markdown as escaped text where Obsidian would render it, so a test reads the row's own text. */
export const MarkdownRenderer = {
	renderMarkdown(markdown: string, el: { firstElementChild: unknown }): Promise<void> {
		el.firstElementChild = { innerHTML: escapeHtml(markdown) };
		return Promise.resolve();
	},
};

/** A view keeps the app of the leaf it is opened in, as Obsidian's views do. Events are not delivered. */
export class ItemView {
	readonly app: unknown;

	constructor(public leaf: { app?: unknown }) {
		this.app = leaf.app;
	}

	registerEvent(): void {}
}

export class TFile {}

export class WorkspaceLeaf {}

/** No test reaches it: the quick entry, which writes notes, is not tested through the bridge. */
export function normalizePath(path: string): string {
	return path;
}
