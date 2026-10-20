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

/** What Obsidian's createEl and createDiv take: a class, or the class, the text and the attributes. */
export type FakeElementInfo =
	string | { cls?: string; text?: string; attr?: Record<string, string | number | boolean | null>; href?: string };

/**
 * Stands in for the DOM elements a modal or a settings tab is built from. Keeps the tag, the class, the text, the
 * attributes, the children and whether it got the focus.
 */
export class FakeElement {
	text = "";
	cls: string;
	children: (FakeElement | ButtonComponent)[] = [];
	focused = false;
	readonly attr: Readonly<Record<string, string | number | boolean | null>>;

	constructor(
		readonly tag = "div",
		info: FakeElementInfo = {},
	) {
		const { cls = "", text = "", attr = {}, href } = typeof info === "string" ? { cls: info } : info;
		this.cls = cls;
		this.text = text;
		this.attr = href === undefined ? attr : { ...attr, href };
	}

	get firstChild(): FakeElement | ButtonComponent | null {
		return this.children[0] ?? null;
	}

	focus(): void {
		this.focused = true;
	}

	addClass(cls: string): void {
		this.cls = this.cls ? `${this.cls} ${cls}` : cls;
	}

	setText(text: string): void {
		this.text = text;
		this.children = [];
	}

	empty(): void {
		this.text = "";
		this.children = [];
	}

	appendChild<T extends FakeElement>(child: T): T {
		this.children = [...this.children, child];
		return child;
	}

	appendText(text: string): void {
		this.appendChild(new FakeElement("#text", { text }));
	}

	createEl(tag: string, info?: FakeElementInfo): FakeElement {
		return this.appendChild(new FakeElement(tag, info));
	}

	createDiv(info?: FakeElementInfo): FakeElement {
		return this.createEl("div", info);
	}
}

/** Keeps what a test needs to find a button and press it. */
export class ButtonComponent {
	readonly buttonEl = new FakeElement("button");
	buttonText = "";
	icon = "";
	tooltip = "";
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

	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}

	setTooltip(tooltip: string): this {
		this.tooltip = tooltip;
		return this;
	}

	onClick(handler: () => unknown): this {
		this.clickHandler = handler;
		return this;
	}

	/** Not in Obsidian: presses the button. Returns what the handler returns. */
	click(): unknown {
		return this.clickHandler?.();
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

/** Not in Obsidian: the element of a setting row. It keeps its Setting, so a test reads the rows in the order they show. */
export class SettingItemElement extends FakeElement {
	constructor(readonly setting: Setting) {
		super("div", "setting-item");
	}
}

/** Not in Obsidian: the element of a control. It keeps its component, so a test reads a row's controls in order. */
export class ControlElement extends FakeElement {
	constructor(readonly component: SettingControl | ExtraButtonComponent) {
		super(component.type);
	}
}

/** A control of a setting row, as Obsidian's value components: keeps the value, the placeholder and the change handler. */
export class SettingControl {
	readonly el: ControlElement;
	placeholder?: string;
	protected changeHandler?: (value: unknown) => unknown;

	constructor(
		containerEl: FakeElement,
		readonly type: string,
		public value: unknown,
	) {
		this.el = containerEl.appendChild(new ControlElement(this));
	}

	setValue(value: unknown): this {
		this.value = value;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.placeholder = placeholder;
		return this;
	}

	onChange(handler: (value: never) => unknown): this {
		this.changeHandler = handler as (value: unknown) => unknown;
		return this;
	}

	/** Not in Obsidian: what typing, picking or switching does. Returns what the handler returns. */
	change(value: unknown): unknown {
		this.value = value;
		return this.changeHandler?.(value);
	}
}

/** As Obsidian's ToggleComponent: setting another value calls the change handler. */
export class ToggleComponent extends SettingControl {
	constructor(containerEl: FakeElement) {
		super(containerEl, "toggle", false);
	}

	setValue(value: unknown): this {
		if (this.value === value) return this;
		this.value = value;
		this.changeHandler?.(value);
		return this;
	}
}

/** As Obsidian's text inputs: a value that is not a string is ignored, and the input stays as it was. */
export class TextComponent extends SettingControl {
	constructor(containerEl: FakeElement, type = "text") {
		super(containerEl, type, "");
	}

	setValue(value: unknown): this {
		if (typeof value === "string") this.value = value;
		return this;
	}
}

export class TextAreaComponent extends TextComponent {
	constructor(containerEl: FakeElement) {
		super(containerEl, "textarea");
	}
}

export class MomentFormatComponent extends TextComponent {
	constructor(containerEl: FakeElement) {
		super(containerEl, "moment-format");
	}
}

/** As a select element: a value none of the options has selects nothing, and the dropdown shows "". */
export class DropdownComponent extends SettingControl {
	options: Readonly<Record<string, string>> = {};

	constructor(containerEl: FakeElement) {
		super(containerEl, "dropdown", "");
	}

	addOption(value: string, display: string): this {
		this.options = { ...this.options, [value]: display };
		return this;
	}

	addOptions(options: Record<string, string>): this {
		this.options = { ...this.options, ...options };
		return this;
	}

	setValue(value: unknown): this {
		this.value = Object.prototype.hasOwnProperty.call(this.options, String(value)) ? String(value) : "";
		return this;
	}
}

export class ColorComponent extends SettingControl {
	constructor(containerEl: FakeElement) {
		super(containerEl, "color", "#000000");
	}
}

/** Keeps the icon, the tooltip and what pressing it does. */
export class ExtraButtonComponent {
	readonly type = "extra-button";
	readonly el: ControlElement;
	icon = "lucide-settings";
	tooltip = "";
	private clickHandler?: () => unknown;

	constructor(containerEl: FakeElement) {
		this.el = containerEl.appendChild(new ControlElement(this));
	}

	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}

	setTooltip(tooltip: string): this {
		this.tooltip = tooltip;
		return this;
	}

	onClick(handler: () => unknown): this {
		this.clickHandler = handler;
		return this;
	}

	/** Not in Obsidian: presses the button. Returns what the handler returns. */
	click(): unknown {
		return this.clickHandler?.();
	}
}

type SettingComponent = SettingControl | ExtraButtonComponent | ButtonComponent;

/**
 * As Obsidian's Setting: a row in the container, with a name, a description and its controls in controlEl. Each add
 * method makes the control, hands it to the callback and drops what the callback returns, as Obsidian does.
 */
export class Setting {
	readonly settingEl: SettingItemElement;
	readonly controlEl: FakeElement;
	components: readonly SettingComponent[] = [];
	name: string | FakeElement = "";
	desc: string | FakeElement = "";
	heading = false;

	constructor(containerEl: FakeElement) {
		this.settingEl = containerEl.appendChild(new SettingItemElement(this));
		this.controlEl = this.settingEl.createDiv("setting-item-control");
	}

	setName(name: string | FakeElement): this {
		this.name = name;
		return this;
	}

	setDesc(desc: string | FakeElement): this {
		this.desc = desc;
		return this;
	}

	setHeading(): this {
		this.heading = true;
		return this;
	}

	addToggle(cb: (toggle: ToggleComponent) => unknown): this {
		return this.add(new ToggleComponent(this.controlEl), cb);
	}

	addText(cb: (text: TextComponent) => unknown): this {
		return this.add(new TextComponent(this.controlEl), cb);
	}

	addTextArea(cb: (textArea: TextAreaComponent) => unknown): this {
		return this.add(new TextAreaComponent(this.controlEl), cb);
	}

	addMomentFormat(cb: (format: MomentFormatComponent) => unknown): this {
		return this.add(new MomentFormatComponent(this.controlEl), cb);
	}

	addDropdown(cb: (dropdown: DropdownComponent) => unknown): this {
		return this.add(new DropdownComponent(this.controlEl), cb);
	}

	addColorPicker(cb: (color: ColorComponent) => unknown): this {
		return this.add(new ColorComponent(this.controlEl), cb);
	}

	addExtraButton(cb: (button: ExtraButtonComponent) => unknown): this {
		return this.add(new ExtraButtonComponent(this.controlEl), cb);
	}

	addButton(cb: (button: ButtonComponent) => unknown): this {
		return this.add(new ButtonComponent(this.controlEl), cb);
	}

	private add<C extends SettingComponent>(component: C, cb: (component: C) => unknown): this {
		this.components = [...this.components, component];
		cb(component);
		return this;
	}
}

/** As Obsidian's PluginSettingTab: the tab draws itself into containerEl when Obsidian calls display(). */
export class PluginSettingTab {
	readonly containerEl = new FakeElement("div", "vertical-tab-content");

	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}

	display(): void {}

	hide(): void {}
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
	protected loaded = false;
	private cleanups: (() => unknown)[] = [];

	load(): void | Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		void this.onload();
	}

	onload(): void | Promise<void> {}

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

/** What Obsidian reads of a plugin's manifest. */
export interface PluginManifest {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly dir?: string;
}

/** What a plugin's registerView needs of the app: Obsidian's view registry, which tests/fakevault.ts provides. */
interface ViewRegistry {
	registerView(type: string, creator: (leaf: never) => unknown): void;
	unregisterView(type: string): void;
}

/** A command as addCommand records it, with the id and the name Obsidian gives it. */
export interface AddedCommand {
	readonly id: string;
	readonly name: string;
	readonly callback?: () => unknown;
}

/**
 * As Obsidian's Plugin (1.14.4). data.json is kept here as text, in `dataJson`, null when there is no file:
 * - loadData parses it on every call, as Obsidian's readJson does: no file gives null, text that is not JSON gives
 *   undefined after console.error;
 * - saveData writes JSON.stringify(data, undefined, 2) and never fails, as Obsidian swallows write errors;
 * - registerView registers with the app's view registry, addCommand prefixes the id and the name with the plugin's,
 *   addSettingTab keeps the tab, and unloading undoes each, last first;
 * - load runs onload once and waits for it.
 */
export class Plugin extends Component {
	/** Not in Obsidian: the text of data.json, or null when there is none. */
	dataJson: string | null = null;
	/** Not in Obsidian: the commands added, as Obsidian names them. */
	commands: readonly AddedCommand[] = [];
	settingTab: PluginSettingTab | null = null;

	constructor(
		public app: unknown,
		public manifest: PluginManifest,
	) {
		super();
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		await this.onload();
	}

	async loadData(): Promise<unknown> {
		if (this.dataJson === null) return null;
		try {
			return JSON.parse(this.dataJson);
		} catch (error) {
			console.error("failed to read JSON", `${this.manifest.dir}/data.json`, error);
			return undefined;
		}
	}

	async saveData(data: unknown): Promise<void> {
		this.dataJson = JSON.stringify(data, undefined, 2);
	}

	registerView(type: string, creator: (leaf: never) => unknown): void {
		const registry = (this.app as { viewRegistry?: ViewRegistry }).viewRegistry;
		if (!registry) throw new Error("the app has no viewRegistry; make it with fakeVault in tests/fakevault.ts");
		registry.registerView(type, creator);
		this.register(() => registry.unregisterView(type));
	}

	addCommand(command: { id: string; name: string; callback?: () => unknown }): AddedCommand {
		const added: AddedCommand = {
			...command,
			id: `${this.manifest.id}:${command.id}`,
			name: `${this.manifest.name}: ${command.name}`,
		};
		this.commands = [...this.commands, added];
		this.register(() => {
			this.commands = this.commands.filter((other) => other !== added);
		});
		return added;
	}

	addSettingTab(tab: PluginSettingTab): void {
		this.settingTab = tab;
		this.register(() => {
			this.settingTab = null;
		});
	}
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
