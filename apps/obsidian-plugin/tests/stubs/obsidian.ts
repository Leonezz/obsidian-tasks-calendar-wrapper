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

/** What `on` returns, to hand to `offref`. */
export interface EventRef {
	readonly e: Events;
	readonly name: string;
	readonly fn: (...data: unknown[]) => unknown;
	readonly ctx?: unknown;
}

/** The timer of the module's start, which a test's mocked clock does not replace. */
const realSetTimeout = setTimeout;

/**
 * As Obsidian's Events (1.14.4): a trigger calls the handlers there were when it started, in the order they were added,
 * and a handler that throws does not stop the others; its error is thrown again from a timer. Here that is a real
 * timer, so a test that mocks the clock still fails on it.
 */
export class Events {
	private handlers: Record<string, EventRef[]> = {};

	on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
		const ref: EventRef = { e: this, name, fn: callback as EventRef["fn"], ctx };
		this.handlers = { ...this.handlers, [name]: [...(this.handlers[name] ?? []), ref] };
		return ref;
	}

	off(name: string, callback: (...data: never[]) => unknown): void {
		this.keep(name, (ref) => ref.fn !== callback);
	}

	offref(ref: EventRef): void {
		this.keep(ref.name, (other) => other !== ref);
	}

	trigger(name: string, ...data: unknown[]): void {
		for (const ref of this.handlers[name] ?? []) this.tryTrigger(ref, data);
	}

	tryTrigger(ref: EventRef, data: unknown[]): void {
		try {
			ref.fn.apply(ref.ctx, data);
		} catch (error) {
			realSetTimeout(() => {
				throw error;
			}, 0);
		}
	}

	private keep(name: string, wanted: (ref: EventRef) => boolean): void {
		const { [name]: refs = [], ...others } = this.handlers;
		const kept = refs.filter(wanted);
		this.handlers = kept.length > 0 ? { ...others, [name]: kept } : others;
	}
}

/**
 * As Obsidian's Component: what is registered while it is loaded is undone, last first, when it unloads, and then
 * onunload runs. registerEvent registers taking the handler off again.
 */
export class Component {
	private loaded = false;
	private cleanups: (() => unknown)[] = [];

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		this.onload();
	}

	onload(): void {}

	unload(): void {
		if (!this.loaded) return;
		this.loaded = false;
		const cleanups = this.cleanups;
		this.cleanups = [];
		for (const cleanup of [...cleanups].reverse()) cleanup();
		this.onunload();
	}

	onunload(): void {}

	register(cleanup: () => unknown): void {
		this.cleanups = [...this.cleanups, cleanup];
	}

	registerEvent(ref: EventRef): void {
		this.register(() => ref.e.offref(ref));
	}
}

/** Obsidian's `empty()` on the elements of a view. */
class ViewElement {
	empty(): void {}
}

/**
 * A view keeps the app of the leaf it is opened in, as Obsidian's views do. As in Obsidian, opening it loads it and then
 * runs onOpen, and closing it unloads it, which takes off the handlers it registered, and then runs onClose. Obsidian's
 * typings do not declare open and close; tests reach them through tests/fakevault.ts.
 */
export class ItemView extends Component {
	readonly app: unknown;
	/** The view's header and its content, as Obsidian builds them. */
	readonly containerEl = { children: [new ViewElement(), new ViewElement()] };

	constructor(public leaf: { app?: unknown }) {
		super();
		this.app = leaf.app;
	}

	async open(): Promise<void> {
		this.load();
		await this.onOpen();
	}

	async close(): Promise<void> {
		this.unload();
		await this.onClose();
	}

	async onOpen(): Promise<void> {}

	async onClose(): Promise<void> {}
}

/** A file or folder of the vault. As in Obsidian, renaming one changes the path of the same object. */
export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;

	/** Not in Obsidian's typings: what Obsidian does when the vault renames a file. */
	setPath(path: string): void {
		this.path = path;
		this.name = path.slice(path.lastIndexOf("/") + 1);
	}
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";

	/** As in Obsidian, the extension is what follows the last dot, in lower case, unless the name starts or ends with it. */
	setPath(path: string): void {
		super.setPath(path);
		const dot = this.name.lastIndexOf(".");
		const hasExtension = dot > 0 && dot < this.name.length - 1;
		this.basename = hasExtension ? this.name.slice(0, dot) : this.name;
		this.extension = hasExtension ? this.name.slice(dot + 1).toLowerCase() : "";
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class WorkspaceLeaf {}

/** No test reaches it: the quick entry, which writes notes, is not tested through the bridge. */
export function normalizePath(path: string): string {
	return path;
}
