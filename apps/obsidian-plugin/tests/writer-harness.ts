import "./setup";
import moment from "moment";
import type { TFile } from "obsidian";
import { dayKey, type LineTarget } from "@tasks-calendar-wrapper/core";
import { MarkdownView } from "./stubs/obsidian";
import { fakeVault, metadataOf } from "./fakevault";
import {
	createTaskWriter,
	type TaskEdit,
	type TaskWriter,
	type WriteEvent,
	type WriteResult,
} from "../timeline/src/taskwriter";
import {
	refusalText,
	writeFailureText,
	mayNotSavedText,
	slowText,
	undoDoneText,
	undoAlreadyText,
	undoExpiredText,
	overwrittenText,
	type NoticeContext,
	type RefuseReason,
} from "../timeline/src/notices";

/** Flushes the small async steps between a fake adapter and its listeners. */
export async function flush(): Promise<void> {
	for (let i = 0; i < 40; i++) await Promise.resolve();
}

/** A promise the test can finish after a save or process reached it. */
export function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

/** A main-window clock; closing a view does not remove its timers. */
export class WriterClock {
	now = 0;
	private serial = 0;
	private timers = new Map<number, { at: number; run: () => void }>();
	setTimeout = (run: () => void, wait: number): number => {
		const id = ++this.serial;
		this.timers.set(id, { at: this.now + wait, run });
		return id;
	};
	clearTimeout = (id: number): void => {
		this.timers.delete(id);
	};
	elapse(ms: number): void {
		this.now += ms;
	}
	async advance(ms: number): Promise<void> {
		const end = this.now + ms;
		await flush();
		for (;;) {
			const next = [...this.timers]
				.filter(([, timer]) => timer.at <= end)
				.sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
			if (!next) break;
			this.now = Math.max(this.now, next[1].at);
			this.timers.delete(next[0]);
			next[1].run();
			await flush();
		}
		this.now = end;
		await flush();
	}
	count(): number {
		return this.timers.size;
	}
}

interface Position {
	line: number;
	ch: number;
}
interface Change {
	from: Position;
	to?: Position;
	text: string;
}
interface Transaction {
	changes?: Change | Change[];
}
interface ViewHost {
	app: { vault: { getFileByPath(path: string): TFile | null } };
	text(path: string): string;
	put(path: string, text: string): void;
}

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const normal = (text: string): string => text.replace(/\r\n/g, "\n");

/** A MarkdownView with a distinct reading-mode editor and Obsidian's saving/saveAgain behavior. */
export class WriterView extends MarkdownView {
	mode: "source" | "preview";
	data: string;
	editorText: string;
	lastSavedData: string;
	saving = false;
	saveAgain = false;
	saves = 0;
	reads: string[] = [];
	transactions: { transaction: Transaction; origin?: string }[] = [];
	beforeSave?: () => Promise<void> | void;
	declare file: TFile | null;

	constructor(
		readonly harness: ViewHost,
		path: string,
		mode: "source" | "preview",
	) {
		super();
		this.file = harness.app.vault.getFileByPath(path);
		this.mode = mode;
		this.data = normal(harness.text(path));
		this.editorText = this.data;
		this.lastSavedData = this.data;
		this.editor = {
			setCursor: () => {},
			getLine: (line: number): string => {
				this.reads.push("getLine");
				return this.editorText.split("\n")[line] ?? "";
			},
			getValue: (): string => {
				this.reads.push("getValue");
				return this.editorText;
			},
			lineCount: (): number => {
				this.reads.push("lineCount");
				return this.editorText.split("\n").length;
			},
			transaction: (transaction: Transaction, origin?: string): void => {
				this.transactions.push({ transaction, origin });
				const changes = transaction.changes
					? Array.isArray(transaction.changes)
						? transaction.changes
						: [transaction.changes]
					: [];
				const offset = (position: Position): number =>
					this.editorText
						.split("\n")
						.slice(0, position.line)
						.reduce((n, line) => n + line.length + 1, 0) + position.ch;
				for (const change of [...changes].reverse()) {
					const start = offset(change.from);
					const end = offset(change.to ?? change.from);
					this.editorText = this.editorText.slice(0, start) + change.text + this.editorText.slice(end);
				}
				this.data = this.editorText;
			},
		};
	}
	getMode(): "source" | "preview" {
		return this.mode;
	}
	getViewData(): string {
		return this.data;
	}
	type(text: string): void {
		this.data = text;
		if (this.mode === "source") this.editorText = text;
	}
	async save(): Promise<void> {
		this.saves++;
		if (this.saving) {
			this.saveAgain = true;
			return;
		}
		if (this.data === this.lastSavedData) return;
		this.saving = true;
		const text = this.data;
		try {
			await this.beforeSave?.();
			if (this.file) this.harness.put(this.file.path, text);
			this.lastSavedData = text;
		} finally {
			this.saving = false;
		}
		if (this.saveAgain) {
			this.saveAgain = false;
			await this.save();
		}
	}
}

type WriterDeps = Parameters<typeof createTaskWriter>[0];

/** Byte storage plus independent adapter/cache/metadata delivery, with spies at every write boundary. */
export function writerHarness(notes: Record<string, string | Uint8Array> = { "a.md": "- [ ] A" }) {
	const bytes = new Map(
		Object.entries(notes).map(([path, text]) => [path, typeof text === "string" ? encode(text) : text.slice()]),
	);
	const base = fakeVault(
		Object.fromEntries([...bytes].map(([path, value]) => [path, decode(value).replace(/^\uFEFF/, "")])),
	);
	const cache = new Map([...bytes].map(([path, value]) => [path, decode(value)]));
	const clock = new WriterClock();
	const views: WriterView[] = [];
	const leaves: { view: unknown }[] = [];
	const pending: { path: string; text: string }[] = [];
	const readCalls: string[] = [];
	const binaryCalls: string[] = [];
	const processCalls: string[] = [];
	const writes: string[] = [];
	const notices: string[] = [];
	const refusals: { reason: RefuseReason; context: NoticeContext }[] = [];
	const reverts: { context: NoticeContext; count: number; redo?: () => Promise<void> }[] = [];
	const recoveries: { context: NoticeContext; editedLine: string }[] = [];
	const events: WriteEvent[] = [];
	const dirty: string[] = [];
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const opened: { path: string; line: number }[] = [];
	const releases: { path: string; markDirty: boolean }[] = [];
	const holds = new Map<string, number>();
	let peak = 0;
	let delivery: "delayed" | "dropped" | "delivered" = "delayed";
	let beforeProcess: (() => Promise<void> | void) | undefined;
	let beforeBinary: (() => Promise<void> | void) | undefined;
	let afterBinary: (() => void) | undefined;
	const app = {
		...base.app,
		vault: Object.assign(base.app.vault, {
			getFileByPath(path: string): TFile | null {
				return base.app.vault.getAbstractFileByPath(path) as TFile | null;
			},
			async cachedRead(file: TFile): Promise<string> {
				readCalls.push(file.path);
				return cache.get(file.path) ?? "";
			},
			adapter: {
				async readBinary(path: string): Promise<ArrayBuffer> {
					binaryCalls.push(path);
					await beforeBinary?.();
					const value = bytes.get(path)?.slice() ?? new Uint8Array();
					afterBinary?.();
					return value.buffer as ArrayBuffer;
				},
			},
			async process(file: TFile, fn: (content: string) => string): Promise<string> {
				processCalls.push(file.path);
				await beforeProcess?.();
				const before = decode(bytes.get(file.path) ?? new Uint8Array());
				const after = fn(before);
				cache.set(file.path, after);
				if (after !== before) put(file.path, after);
				return after;
			},
		}),
		workspace: Object.assign(base.app.workspace, { getLeavesOfType: (_type: string) => leaves }),
	};
	function changed(path = "a.md", text = decode(bytes.get(path) ?? new Uint8Array())): void {
		const file = app.vault.getFileByPath(path);
		if (!file) return;
		base.writeSilently(path, text.replace(/^\uFEFF/, ""));
		app.metadataCache.trigger("changed", file, text, metadataOf(text.replace(/^\uFEFF/, "")));
	}
	function put(path: string, text: string): void {
		bytes.set(path, encode(text));
		cache.set(path, text);
		writes.push(path);
		base.write(path, text.replace(/^\uFEFF/, ""), { indexed: false });
		clock.setTimeout(() => {
			for (const view of views) if (view.file?.path === path && !view.saving) view.data = normal(text);
		}, 0);
		if (delivery === "delayed") pending.push({ path, text });
		if (delivery === "delivered") clock.setTimeout(() => changed(path, text), 0);
	}
	const index = {
		hold(path: string) {
			holds.set(path, (holds.get(path) ?? 0) + 1);
			peak = Math.max(peak, holds.get(path) ?? 0);
			let released = false;
			return {
				release(options?: { markDirty?: boolean }): void {
					if (released) return;
					released = true;
					holds.set(path, (holds.get(path) ?? 1) - 1);
					releases.push({ path, markDirty: options?.markDirty !== false });
					if (options?.markDirty !== false) dirty.push(path);
				},
			};
		},
		markDirty(paths: readonly string[]): void {
			dirty.push(...paths);
		},
	};
	const deps: WriterDeps = {
		app: app as never,
		index,
		tasks: () => ({ kind: "none" }),
		moment,
		locale: () => moment.locale(),
		notices: {
			refuse(reason, context) {
				refusals.push({ reason, context });
				const text = refusalText(reason, context);
				notices.push(text);
				return text;
			},
			failed(context, error) {
				notices.push(writeFailureText(context, error));
			},
			mayNotSaved(context, kind) {
				notices.push(mayNotSavedText(context, kind));
			},
			slow(context) {
				notices.push(slowText(context));
			},
			editNotSaved() {},
			editChangedBack(context, editedLine) {
				recoveries.push({ context, editedLine });
			},
			overwritten(context, count, redo) {
				reverts.push({ context, count, redo });
				notices.push(overwrittenText(context, count));
			},
			undoDone(context, dialogEdit) {
				notices.push(undoDoneText(context, dialogEdit));
			},
			undoAlready(context) {
				notices.push(undoAlreadyText(context));
			},
			undoExpired(context) {
				const text = undoExpiredText(context);
				notices.push(text);
				return text;
			},
		},
		today: () => dayKey(moment("2026-10-31", "YYYY-MM-DD")),
		now: () => clock.now,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		newDateStyle: () => "emoji",
		logger: { warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) },
		openNote: (path, line) => {
			opened.push({ path, line });
		},
	};
	let writer: ReturnType<typeof createTaskWriter>;
	function target(
		line = 0,
		path = "a.md",
		sourceLine = normal(decode(bytes.get(path) ?? new Uint8Array())).split("\n")[line],
	): LineTarget {
		return { path, line, sourceLine };
	}
	const harness = {
		app,
		base,
		bytes,
		cache,
		clock,
		views,
		leaves,
		pending,
		readCalls,
		binaryCalls,
		processCalls,
		writes,
		notices,
		refusals,
		reverts,
		recoveries,
		events,
		dirty,
		warnings,
		errors,
		opened,
		releases,
		holds,
		index,
		deps,
		changed,
		put,
		peak: () => peak,
		text: (path = "a.md") => decode(bytes.get(path) ?? new Uint8Array()),
		setDelivery(value: typeof delivery) {
			delivery = value;
		},
		onProcess(fn?: typeof beforeProcess) {
			beforeProcess = fn;
		},
		onBinary(fn?: typeof beforeBinary, after?: typeof afterBinary) {
			beforeBinary = fn;
			afterBinary = after;
		},
		view(path = "a.md", mode: "source" | "preview" = "preview"): WriterView {
			const view = new WriterView(harness, path, mode);
			views.push(view);
			leaves.push({ view });
			return view;
		},
		target,
		create(overrides: Partial<WriterDeps> = {}): TaskWriter {
			writer = createTaskWriter({ ...deps, ...overrides });
			writer.onWrite((event) => events.push(event));
			return writer;
		},
		write(at = target(), edit: TaskEdit = { kind: "toggle" }): Promise<WriteResult> {
			return writer.write(() => at, edit);
		},
		async deliver(): Promise<void> {
			for (const item of pending.splice(0)) changed(item.path, item.text);
			await flush();
		},
		remove(path = "a.md") {
			base.remove(path);
			bytes.delete(path);
			cache.delete(path);
		},
		rename(from: string, to: string) {
			const value = bytes.get(from);
			const text = cache.get(from);
			base.rename(from, to);
			bytes.delete(from);
			cache.delete(from);
			if (value) bytes.set(to, value);
			if (text !== undefined) cache.set(to, text);
		},
	};
	return harness;
}

/** The test harness's inferred surface, including the bytes and its MarkdownViews. */
export type WriterHarness = ReturnType<typeof writerHarness>;
