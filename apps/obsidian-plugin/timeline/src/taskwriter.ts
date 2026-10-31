import {
	MarkdownView,
	type App,
	type DataAdapter,
	type EditorChange,
	type MetadataCache,
	type Vault,
	type Workspace,
} from "obsidian";
import {
	checkEncoding,
	decodeUtf8Strict,
	deepFreeze,
	lineOfText,
	replaceSpan,
	undoSpanFor,
	type DayKey,
	type DateField,
	type LineTarget,
	type MomentFactory,
	type NewDateStyle,
	type Span,
	type UndoSpan,
} from "@tasks-calendar-wrapper/core";
import { openNoteAt } from "../../src/open-note";
import type { NoticeContext, NoticePresenter, RefuseReason } from "./notices";
import type { SharedTaskIndex } from "./sharedindex";
import type { TasksToggle } from "./tasksplugin";
import { displayText, errorMessage, normalized, prepareEdit, sourceAt, withoutBOM } from "./writerchecks";
import { createWriteTracking, writeSnapshot, type WriteRecord } from "./writerholds";
import { createWriterWatch } from "./writerwatch";
import { redoWrites } from "./writerredo";
import { UNDO_KEEP_MAX } from "./writerconstants";

export * from "./writerconstants";
export { DEFERRED_CHECKS_MAX } from "./revertcheck";

/** Edits whose new lines can be computed without waiting for user input. */
export type TaskEdit =
	| { readonly kind: "toggle" }
	| { readonly kind: "date"; readonly field: DateField; readonly day: DayKey | null }
	| { readonly kind: "replace"; readonly expected: string; readonly lines: readonly string[] }
	| { readonly kind: "undo"; readonly record: UndoRecord };

/** Quick entry shares the queue and hold lifecycle without creating an undo or revert-check record. */
export interface InsertEdit {
	readonly kind: "insert";
	readonly apply: (content: string) => string;
}

/** The exact span and neighbours from the write. The writer keeps shifted copies; callers retain this frozen handle. */
export interface UndoRecord extends UndoSpan {
	readonly id: number;
	readonly path: string;
	readonly line: number;
	readonly above: string | null;
	readonly below: string | null;
	readonly edit: Exclude<TaskEdit, { kind: "undo" }>;
}

/** A write is finished before its metadata is necessarily indexed; callers can wait for either milestone. */
export type WriteResult =
	| {
			readonly kind: "written";
			readonly id: number;
			readonly delta: number;
			readonly indexed: Promise<void>;
			readonly undo?: UndoRecord;
	  }
	| { readonly kind: "unchanged"; readonly alreadyUndone?: true }
	| { readonly kind: "cancelled" }
	| { readonly kind: "refused"; readonly reason: RefuseReason; readonly message: string }
	| { readonly kind: "failed"; readonly unknownOutcome: boolean; readonly error: unknown };

/** Events carry the write identity, so several pending writes of one row do not replace each other. Frozen. */
export interface WriteEvent extends LineTarget {
	readonly id: number;
	readonly kind:
		| "pending"
		| "written"
		| "unchanged"
		| "refused"
		| "failed"
		| "indexed"
		| "slow"
		| "overwritten"
		| "recheck"
		| "released";
	readonly lines: readonly string[];
	/** The lines an Undo replaces, which the store holds once Obsidian re-read the note. */
	readonly written?: readonly string[];
	readonly reason?: RefuseReason;
	readonly unknownOutcome?: boolean;
	/** A quick entry or Undo restoring a deleted line displaced the line at this position too. */
	readonly insertBefore?: true;
	/** Advances only for a token release. A failed save before the hold emits the current sequence. */
	readonly releaseSeq?: number;
}

/** The public Obsidian operations the writer uses; App satisfies this structural surface. */
export interface WriterApp {
	readonly vault: Pick<Vault, "getFileByPath" | "cachedRead" | "process" | "on" | "offref"> & {
		readonly adapter: Pick<DataAdapter, "readBinary">;
	};
	readonly metadataCache: Pick<MetadataCache, "on" | "offref">;
	readonly workspace: Pick<Workspace, "getLeavesOfType">;
}

/** All clocks, effects and settings come from the plugin; timers must belong to its main window. */
export interface TaskWriterDeps {
	readonly app: WriterApp;
	readonly index: Pick<SharedTaskIndex, "hold" | "markDirty">;
	readonly tasks: () => TasksToggle;
	readonly notices: Pick<
		NoticePresenter,
		| "refuse"
		| "failed"
		| "mayNotSaved"
		| "slow"
		| "editNotSaved"
		| "editChangedBack"
		| "overwritten"
		| "undoDone"
		| "undoAlready"
		| "undoExpired"
	>;
	readonly moment: MomentFactory & { locale(): string };
	/** Obsidian's language for explaining unreadable local digits; defaults to its moment locale. */
	readonly locale?: () => string;
	readonly today: () => DayKey;
	readonly now: () => number;
	readonly setTimeout: (run: () => void, delay: number) => number;
	readonly clearTimeout: (timer: number) => void;
	readonly newDateStyle: () => NewDateStyle;
	readonly logger: Pick<Console, "error" | "warn">;
	/** Tests can observe opening a note; the plugin uses openNoteAt by default. */
	readonly openNote?: (path: string, line: number) => void | Promise<unknown>;
}

/** One writer per plugin, with independent queues for its notes and counting index holds. */
export interface TaskWriter {
	/** Samples the path to choose a queue, then reads the target again when its turn starts. The path must stay fixed. */
	write(target: () => LineTarget, edit: TaskEdit): Promise<WriteResult>;
	/** Existing-note quick entry; its callback runs only after the encoding check, inside Vault.process. */
	insert(path: string, edit: (content: string) => string): Promise<WriteResult>;
	/** The owning view calls this when its undo notice disappears, including after a hover. */
	forgetUndo(record: UndoRecord): void;
	/** Lets views hide a notice when its record is forgotten, evicted, or disposed. */
	onUndoGone(listener: (record: UndoRecord) => void): () => void;
	/** Subscribes without owning view state; unsubscribe when the view closes. */
	onWrite(listener: (event: WriteEvent) => void): () => void;
	/** The latest actual token release; a reload captures this before asking the index for tasks. */
	releaseSeq(): number;
	/** Plugin unload abandons outstanding operations, releases holds and cancels its timers. */
	dispose(): void;
}

/** A view's own line shifts, kept until a reload beginning after their releases has rendered. */
export interface ShiftLedger {
	/** Records a successful write in the coordinates at the time of that write. */
	record(path: string, line: number, delta: number, releaseSeq: number, insertBefore?: boolean): void;
	/** Records a write before its own release sequence is known. */
	recordWrite(id: number, path: string, line: number, delta: number, insertBefore?: boolean): void;
	/** Attaches the sequence from this write's released event. */
	releaseWrite(id: number, seq: number): void;
	/** An overwritten write no longer displaces the rows. */
	clearWrite(id: number): void;
	/** Drops only shifts included in a completed reload. */
	clearThrough(seq: number, pinned?: ReadonlySet<string>): void;
	/** Applies retained writes in order to the view's original line. */
	shift(path: string, line: number): number;
}

/** Keeps shifts local to the view that made them, rather than shifting another view's already-fresh rows. */
export function createShiftLedger(): ShiftLedger {
	let shifts: readonly {
		id?: number;
		path: string;
		line: number;
		delta: number;
		seq: number;
		insertBefore: boolean;
	}[] = [];
	return Object.freeze({
		record(path: string, line: number, delta: number, releaseSeq: number, insertBefore = false): void {
			shifts = [...shifts, Object.freeze({ path, line, delta, seq: releaseSeq, insertBefore })];
		},
		recordWrite(id: number, path: string, line: number, delta: number, insertBefore = false): void {
			shifts = [...shifts, Object.freeze({ id, path, line, delta, seq: Infinity, insertBefore })];
		},
		releaseWrite(id: number, seq: number): void {
			shifts = shifts.map((shift) => (shift.id === id ? Object.freeze({ ...shift, seq }) : shift));
		},
		clearWrite(id: number): void {
			shifts = shifts.filter((shift) => shift.id !== id);
		},
		clearThrough(seq: number, pinned?: ReadonlySet<string>): void {
			shifts = shifts.filter((shift) => shift.seq > seq || pinned?.has(shift.path));
		},
		shift(path: string, line: number): number {
			return shifts.reduce(
				(at, shift) =>
					shift.path === path && (shift.line < at || (shift.insertBefore && shift.line === at))
						? at + shift.delta
						: at,
				line,
			);
		},
	});
}

const origin = "tasks-calendar-wrapper";
const timeoutMessage = "File system operation timed out.";

class Refusal extends Error {
	constructor(
		readonly reason: RefuseReason,
		readonly inside = false,
	) {
		super(reason);
	}
}
class EditorSaveFailure extends Error {
	constructor(
		readonly cause: unknown,
		readonly unknownOutcome: boolean,
	) {
		super(errorMessage(cause));
	}
}

/** Makes a line-scoped transaction, including the newline when deleting a non-final line. */
function editorChange(
	before: string,
	line: number,
	expected: readonly string[],
	lines: readonly string[],
	eol = "\n",
	below?: string | null,
): EditorChange {
	const first = lineOfText(before, line) ?? "";
	// A deleted first line may have exposed a U+FEFF owned by the following line, as in replaceSpan.
	const exposed = expected.length === 0 && below === first;
	const bom = line === 0 && first.startsWith("\uFEFF") && !exposed ? 1 : 0;
	if (expected.length === 0) return { from: { line, ch: bom }, to: { line, ch: bom }, text: lines.join(eol) + eol };
	if (lines.length === 0 && lineOfText(before, line + expected.length) !== null) {
		return { from: { line, ch: bom }, to: { line: line + expected.length, ch: 0 }, text: "" };
	}
	const end = line + expected.length - 1;
	return {
		from: { line, ch: bom },
		to: { line: end, ch: (lineOfText(before, end) ?? "").length },
		text: lines.join("\n"),
	};
}

/** Coordinates preflight, saving, encoding and both write paths without running a UI command. */
export function createTaskWriter(deps: TaskWriterDeps): TaskWriter {
	let disposed = false;
	const listeners = new Set<(event: WriteEvent) => void>();
	const queues = new Map<string, Promise<unknown>>();
	const aborts = new Set<() => void>();
	const undos = new Map<UndoRecord, UndoRecord>();
	// Clicking Undo accepts the record before Obsidian removes its notice. Queued requests still follow own shifts.
	const undoRequests = new Set<{ record: UndoRecord }>();
	const undoListeners = new Set<(record: UndoRecord) => void>();
	const tracking = createWriteTracking(
		deps,
		(event) => {
			for (const listener of listeners) listener(event);
		},
		{
			check: (...args) => watch.check(...args),
			finished: (...args) => watch.finished(...args),
			renamed: (from, to) => watch.renamed(from, to),
			deleted: (path) => watch.deleted(path),
		},
	);
	const watch = createWriterWatch(deps, tracking, (records) => redoWrites(deps, records, enqueue));

	function forgetUndo(record: UndoRecord): void {
		if (!undos.delete(record)) return;
		for (const listener of undoListeners) listener(record);
	}
	function keepUndo(record: UndoRecord): void {
		undos.set(record, record);
		if (undos.size > UNDO_KEEP_MAX) forgetUndo(undos.keys().next().value!);
	}
	function shiftUndos(path: string, line: number, delta: number, insertBefore = false): void {
		if (delta === 0) return;
		function shiftedRecord(record: UndoRecord): UndoRecord {
			if (record.path !== path || record.line < line || (record.line === line && !insertBefore)) return record;
			const shifted = record.line + delta;
			return deepFreeze({ ...record, line: shifted, span: { ...record.span, line: shifted } });
		}
		for (const [handle, record] of undos) undos.set(handle, shiftedRecord(record));
		for (const request of undoRequests) request.record = shiftedRecord(request.record);
	}

	function views(path: string): MarkdownView[] {
		return deps.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.filter((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === path);
	}
	function refused(
		record: WriteRecord,
		reason: RefuseReason,
		inside = false,
		details: Partial<NoticeContext> = {},
	): WriteResult {
		const context = { ...record.context, ...details };
		if (reason === "line-changed" || reason === "undo-changed") {
			if (!record.token) deps.index.markDirty([record.target.path]);
			if (reason === "line-changed") tracking.lineChanged(record);
		}
		const result: WriteResult = Object.freeze({
			kind: "refused",
			reason,
			message: deps.notices.refuse(reason, context),
		});
		tracking.finish(record, result);
		tracking.release(record, reason === "undo-changed" || (reason !== "not-utf8" && !inside));
		if (reason === "undo-changed") tracking.event(record, "recheck");
		if (record.edit.kind === "replace") deps.notices.editNotSaved(context, record.lines.join("\n"));
		return result;
	}
	function failed(record: WriteRecord, error: unknown, unknown: false | "timeout" | "editor"): WriteResult {
		if (unknown) {
			tracking.block(record.target.path);
			deps.notices.mayNotSaved(record.context, unknown);
		} else {
			deps.logger.error("Tasks Calendar Wrapper: could not write", record.target.path, error);
			deps.notices.failed(record.context, error);
		}
		const result: WriteResult = Object.freeze({ kind: "failed", unknownOutcome: Boolean(unknown), error });
		tracking.finish(record, result);
		tracking.release(record);
		if (record.edit.kind === "replace") deps.notices.editNotSaved(record.context, record.lines.join("\n"));
		return result;
	}

	async function run(target: LineTarget, edit: TaskEdit | InsertEdit, undoing?: UndoRecord): Promise<WriteResult> {
		if (edit.kind === "undo") {
			const undo = undoing ?? edit.record;
			target = { path: undo.path, line: undo.line, sourceLine: undo.original };
		}
		const sourceLine =
			target.line === 0
				? withoutBOM(edit.kind === "replace" ? edit.expected : target.sourceLine)
				: edit.kind === "replace"
					? edit.expected
					: target.sourceLine;
		target = Object.freeze({ ...target, sourceLine });
		const context: NoticeContext = {
			path: target.path,
			line: target.line,
			text: displayText(sourceLine, deps),
			action: edit.kind === "insert" ? undefined : edit.kind,
		};
		const early = (reason: RefuseReason) =>
			refused(
				tracking.begin(target, edit, Object.freeze(edit.kind === "replace" ? [...edit.lines] : []), context),
				reason,
			);
		if (edit.kind === "undo" && !undoing) {
			const record = tracking.begin(target, edit, [], context);
			const result: WriteResult = Object.freeze({
				kind: "refused",
				reason: "undo-changed",
				message: deps.notices.undoExpired(context),
			});
			tracking.finish(record, result);
			tracking.release(record, false);
			return result;
		}
		if (tracking.blocked(target.path)) return early("queue-blocked");
		if (edit.kind !== "undo" && edit.kind !== "insert" && tracking.notReread(target)) return early("not-reread");
		const file = deps.app.vault.getFileByPath(target.path);
		if (!file) return early("moved-or-deleted");
		const note = file;
		const distance = tracking.distance(target.path);
		if (edit.kind !== "undo" && edit.kind !== "insert" && distance > 0) {
			const content = await deps.app.vault.cachedRead(file);
			for (let line = Math.max(0, target.line - distance); line <= target.line + distance; line++) {
				if (line !== target.line && sourceAt(content, line) === sourceLine) return early("ambiguous");
			}
		}
		const prepared =
			edit.kind === "undo" || edit.kind === "insert"
				? { kind: "lines" as const, lines: Object.freeze(undoing ? [undoing.original] : []), unchanged: false }
				: prepareEdit(sourceLine, target.path, edit, deps);
		const lines =
			prepared.kind === "lines" ? prepared.lines : Object.freeze(edit.kind === "replace" ? [...edit.lines] : []);
		const record = tracking.begin(target, edit, lines, context);
		const span: Span = undoing?.span ?? { line: target.line, expected: [sourceLine] };
		const changedReason = undoing ? "undo-changed" : "line-changed";
		function replace(before: string) {
			return replaceSpan(before, span, lines);
		}
		function alreadyUndone(before: string): boolean {
			return (
				undoing !== undefined &&
				replace(before).kind === "mismatch" &&
				replaceSpan(
					before,
					{
						line: undoing.line,
						expected: [undoing.original],
						above: undoing.above,
						below: undoing.below,
					},
					[undoing.original],
				).kind === "replaced"
			);
		}
		if (prepared.kind === "refused") {
			if (prepared.reason === "tasks-too-old") {
				try {
					if (deps.openNote) await deps.openNote(target.path, target.line);
					else await openNoteAt(deps.app as App, target.path, target.line);
				} catch (error) {
					return failed(record, error, false);
				}
			}
			return refused(record, prepared.reason, false, prepared.details);
		}
		watch.begin(record);
		tracking.event(record, "pending");
		let resultText: string | undefined;
		let abandoned = false;
		let timer: number | undefined;
		let abort!: () => void;
		const deadline = new Promise<never>((_, reject) => {
			abort = () => {
				abandoned = true;
				reject(new Error(disposed ? "The plugin unloaded." : timeoutMessage));
			};
			timer = deps.setTimeout(abort, 60000);
			aborts.add(abort);
		});
		function active(): void {
			if (abandoned || disposed) throw new Error("The write was abandoned.");
			if (record.invalidated) throw new Refusal("moved-or-deleted");
		}
		async function bytes(): Promise<string> {
			const raw = await deps.app.vault.adapter.readBinary(target.path);
			active();
			const decoded = decodeUtf8Strict(new Uint8Array(raw));
			if (decoded === null) throw new Refusal("not-utf8");
			return decoded;
		}
		async function write(): Promise<WriteResult> {
			let disk = await deps.app.vault.cachedRead(note);
			active();
			record.before = writeSnapshot(disk);
			if (edit.kind !== "insert") {
				if (undoing && undoing.span.above !== undefined && undoing.span.below !== undefined)
					record.undoNeighbours = { above: undoing.above, below: undoing.below };
				if (lines.length === 0)
					record.deletedNeighbours = {
						above: sourceAt(disk, target.line - 1),
						below: sourceAt(disk, target.line + 1),
					};
				const predicted = replace(disk);
				if (predicted.kind === "replaced") record.after = writeSnapshot(predicted.content);
			}
			const open = edit.kind === "insert" ? [] : views(target.path);
			let verified: string | null = null;
			for (const view of open) {
				const text = view.getViewData();
				if (text.includes("\uFFFD")) verified = await bytes();
				active();
				if (normalized(text) !== normalized(disk)) {
					await view.save();
					active();
					disk = await deps.app.vault.cachedRead(note);
					active();
					verified = null;
				}
			}
			const restored = undoing !== undefined && alreadyUndone(disk);
			for (const view of open) {
				const text = view.getViewData();
				if (restored ? !alreadyUndone(text) : replace(text).kind === "mismatch")
					throw new Refusal(changedReason);
			}
			const source = open.find((view) => view.getMode() === "source");
			record.source = source;
			if (restored || (prepared.kind === "lines" && prepared.unchanged)) {
				if (source) {
					const line = source.editor.getLine(target.line);
					if ((target.line === 0 ? withoutBOM(line) : line) !== sourceLine) throw new Refusal(changedReason);
					if (restored && !alreadyUndone(source.editor.getValue())) throw new Refusal(changedReason);
				}
				if (sourceAt(disk, target.line) !== sourceLine) throw new Refusal(changedReason);
				resultText = source ? source.editor.getValue() : disk;
				record.before = record.after = writeSnapshot(resultText);
				return Object.freeze(restored ? { kind: "unchanged", alreadyUndone: true } : { kind: "unchanged" });
			}
			active();
			if (!tracking.acquire(record)) throw new Refusal("moved-or-deleted");
			let undo: UndoRecord | undefined;
			let unchanged = false;
			function replacement(before: string): string {
				if (edit.kind === "insert") {
					const after = edit.apply(before);
					const oldLines = before.split("\n");
					const newLines = after.split("\n");
					const first = oldLines.findIndex((line, i) => line !== newLines[i]);
					const line = first < 0 ? oldLines.length : first;
					record.target = Object.freeze({ ...target, line, sourceLine: sourceAt(before, line) ?? "" });
					record.context = { ...context, line };
					record.before = writeSnapshot(before);
					record.after = writeSnapshot(after);
					record.delta = newLines.length - oldLines.length;
					if (
						record.delta > 0 &&
						oldLines.slice(line).join("\n") === newLines.slice(line + record.delta).join("\n")
					)
						record.insertBefore = true;
					unchanged = before === after;
					return after;
				}
				const result = replace(before);
				if (result.kind === "mismatch") {
					if (!alreadyUndone(before)) throw new Refusal(changedReason, !source);
					resultText = before;
					record.before = record.after = writeSnapshot(before);
					unchanged = true;
					return before;
				}
				record.before = writeSnapshot(before);
				record.after = writeSnapshot(result.content);
				record.delta = result.delta;
				if (span.expected.length === 0 && lines.length > 0) record.insertBefore = true;
				if (undoing && undoing.span.above !== undefined && undoing.span.below !== undefined)
					record.undoNeighbours = { above: undoing.above, below: undoing.below };
				if (lines.length === 0)
					record.deletedNeighbours = {
						above: sourceAt(before, target.line - 1),
						below: sourceAt(before, target.line + 1),
					};
				if (edit.kind !== "undo") {
					const saved = undoSpanFor(before, target.line, lines);
					undo = deepFreeze({
						...saved,
						id: record.id,
						path: target.path,
						line: target.line,
						edit,
						above: saved.span.above !== undefined ? saved.span.above : sourceAt(before, target.line - 1),
						below: saved.span.below !== undefined ? saved.span.below : sourceAt(before, target.line + 1),
					});
				}
				return result.content;
			}
			if (source) {
				if (source.editor.getValue().includes("\uFFFD") && verified === null) verified = await bytes();
				active();
				// No await between these checks and the transaction: typing cannot interleave with the replacement.
				if (!undoing) {
					const line = source.editor.getLine(target.line);
					if ((target.line === 0 ? withoutBOM(line) : line) !== sourceLine) throw new Refusal("line-changed");
				}
				const before = source.editor.getValue();
				if (checkEncoding(before, verified).kind !== "ok") throw new Refusal(changedReason);
				replacement(before);
				if (unchanged) return Object.freeze({ kind: "unchanged", alreadyUndone: true });
				source.editor.transaction(
					{ changes: [editorChange(before, span.line, span.expected, lines, span.eol, span.below)] },
					origin,
				);
				record.applied = true;
				try {
					await source.save();
				} catch (error) {
					if (abandoned || errorMessage(error) === timeoutMessage) throw error;
					const current = source.editor.getValue();
					const rollback: Span = undoing ? { line: span.line, expected: lines } : undo!.span;
					const originals = undoing ? span.expected : [undo!.original];
					const reverse = replaceSpan(current, rollback, originals);
					if (reverse.kind === "mismatch") throw new EditorSaveFailure(error, true);
					source.editor.transaction(
						{
							changes: [
								editorChange(
									current,
									rollback.line,
									rollback.expected,
									originals,
									rollback.eol,
									rollback.below,
								),
							],
						},
						origin,
					);
					throw new EditorSaveFailure(error, false);
				}
				active();
			} else {
				for (let attempt = 0; attempt < 2; attempt++) {
					let needBytes = false;
					let refusal: Refusal | undefined;
					await deps.app.vault.process(note, (content) => {
						if (abandoned || disposed || record.invalidated) return content;
						record.before = writeSnapshot(content);
						const encoding = checkEncoding(content, verified);
						if (encoding.kind === "verify-bytes") {
							needBytes = true;
							return content;
						}
						if (encoding.kind === "changed") {
							refusal = new Refusal(changedReason, true);
							return content;
						}
						try {
							const after = replacement(content);
							if (after !== content) record.applied = true;
							return after;
						} catch (error) {
							if (!(error instanceof Refusal)) throw error;
							refusal = error;
							return content;
						}
					});
					active();
					if (refusal) throw refusal;
					if (!needBytes) break;
					verified = await bytes();
				}
			}
			if (unchanged)
				return Object.freeze(undoing ? { kind: "unchanged", alreadyUndone: true } : { kind: "unchanged" });
			shiftUndos(record.target.path, record.target.line, record.delta, record.insertBefore);
			if (undo) {
				undo = deepFreeze({ ...undo, path: record.target.path });
				keepUndo(undo);
			}
			return Object.freeze({
				kind: "written",
				id: record.id,
				delta: record.delta,
				indexed: record.indexedPromise,
				...(undo ? { undo } : {}),
			});
		}
		try {
			const result = await Promise.race([write(), deadline]);
			tracking.finish(record, result, resultText);
			if (result.kind === "unchanged") tracking.release(record, false);
			if (undoing) {
				if (result.kind === "written") deps.notices.undoDone(context, undoing.edit.kind === "replace");
				else if (result.kind === "unchanged" && result.alreadyUndone) deps.notices.undoAlready(context);
			}
			return result;
		} catch (error) {
			abandoned = true;
			if (error instanceof Refusal) return refused(record, error.reason, error.inside);
			if (error instanceof EditorSaveFailure)
				return failed(record, error.cause, error.unknownOutcome ? "editor" : false);
			return failed(record, error, errorMessage(error) === timeoutMessage ? "timeout" : false);
		} finally {
			if (timer !== undefined) deps.clearTimeout(timer);
			aborts.delete(abort);
		}
	}

	function enqueue(target: () => LineTarget, edit: TaskEdit | InsertEdit): Promise<WriteResult> {
		if (disposed)
			return Promise.resolve(
				Object.freeze({ kind: "failed", unknownOutcome: false, error: new Error("The plugin unloaded.") }),
			);
		const path = target().path;
		const request: TaskEdit | InsertEdit =
			edit.kind === "replace"
				? Object.freeze({ ...edit, lines: Object.freeze([...edit.lines]) })
				: Object.freeze({ ...edit });
		const undo = edit.kind === "undo" ? undos.get(edit.record) : undefined;
		const undoRequest = undo ? { record: undo } : undefined;
		if (undoRequest) undoRequests.add(undoRequest);
		const previous = queues.get(path) ?? Promise.resolve();
		const next = previous.then(async () => {
			await watch.ready(path);
			const latest = target();
			if (latest.path !== path) throw new Error("A queued task target changed notes.");
			if (disposed)
				return Object.freeze({
					kind: "failed" as const,
					unknownOutcome: false,
					error: new Error("The plugin unloaded."),
				});
			try {
				return await run(latest, request, undoRequest?.record);
			} catch (error) {
				const lines = Object.freeze(request.kind === "replace" ? [...request.lines] : []);
				const record = tracking.begin(latest, request, lines, {
					path,
					line: latest.line,
					text: latest.sourceLine,
					action: request.kind === "insert" ? undefined : request.kind,
				});
				return failed(record, error, errorMessage(error) === timeoutMessage ? "timeout" : false);
			}
		});
		const settled = () => {
			if (undoRequest) undoRequests.delete(undoRequest);
		};
		const tail = next.then(settled, settled);
		queues.set(path, tail);
		void tail.then(() => {
			if (queues.get(path) === tail) queues.delete(path);
		});
		return next;
	}

	return Object.freeze({
		write(target: () => LineTarget, edit: TaskEdit): Promise<WriteResult> {
			return enqueue(
				edit.kind === "undo"
					? () => ({ path: edit.record.path, line: edit.record.line, sourceLine: edit.record.original })
					: target,
				edit,
			);
		},
		insert(path: string, apply: (content: string) => string): Promise<WriteResult> {
			return enqueue(() => ({ path, line: 0, sourceLine: "" }), { kind: "insert", apply });
		},
		forgetUndo,
		onUndoGone(listener: (record: UndoRecord) => void): () => void {
			undoListeners.add(listener);
			return () => {
				undoListeners.delete(listener);
			};
		},
		onWrite(listener: (event: WriteEvent) => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		releaseSeq: tracking.releaseSeq,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const abort of aborts) abort();
			watch.dispose();
			tracking.dispose();
			for (const record of undos.keys()) forgetUndo(record);
			undoListeners.clear();
		},
	});
}
