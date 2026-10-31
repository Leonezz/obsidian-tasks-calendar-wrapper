import { MarkdownView } from "obsidian";
import { taskLineCounts, type LineCounts, type LineTarget, type Neighbours } from "@tasks-calendar-wrapper/core";
import { contentIdOf, type ContentId } from "../../utils/contentid";
import type { NoticeContext } from "./notices";
import type { HoldToken } from "./taskindex";
import type { InsertEdit, TaskEdit, TaskWriterDeps, WriteEvent, WriteResult } from "./taskwriter";
import { normalized } from "./writerchecks";
import {
	AMBIGUITY_WINDOW_MS,
	FS_TIMEOUT_BLOCK_MS,
	HOLD_CAP_MS,
	INDEXED_NOTICE_MS,
	OVERWRITE_AFTER_RELEASE_MS,
	OVERWRITE_WATCH_MS,
	RECHECK_MS,
	SLOW_NOTICE_MS,
} from "./writerconstants";

/** A full-note snapshot without keeping the note's text alive for the later revert checker. */
export interface WriteSnapshot {
	readonly id: ContentId;
	readonly counts: LineCounts;
}

/** One write's lifecycle, shared by the write paths and the metadata release rules. */
export interface WriteRecord {
	readonly id: number;
	target: LineTarget;
	context: NoticeContext;
	readonly edit: TaskEdit | InsertEdit;
	readonly lines: readonly string[];
	readonly keys: readonly string[];
	status: "pending" | "written" | "unknown" | "unchanged" | "already-undone" | "reported" | "refused" | "failed";
	before?: WriteSnapshot;
	deletedNeighbours?: Neighbours;
	undoNeighbours?: Neighbours;
	source?: MarkdownView;
	editorIndexed?: boolean;
	after?: WriteSnapshot;
	delta: number;
	insertBefore?: true;
	resultAt: number;
	writtenAt?: number;
	releasedAt?: number;
	windowEnd: number;
	token?: HoldToken;
	released: boolean;
	applied?: true;
	/** Stop an unapplied write after its note moves or disappears, and any write when the plugin unloads. */
	invalidated: boolean;
	indexed: boolean;
	slow: boolean;
	rechecked: boolean;
	readonly indexedPromise: Promise<void>;
	readonly resolveIndexed: () => void;
	capTimer?: number;
	slowTimer?: number;
	windowTimer?: number;
}

/** Normalizes before hashing, so metadata and a source editor can describe the same note. */
export function writeSnapshot(text: string): WriteSnapshot {
	return Object.freeze({ id: contentIdOf(normalized(text)), counts: taskLineCounts(text) });
}

export type CheckTrigger = "changed" | "indexed" | "slow" | "window" | "result";

/** Keeps metadata release and revert checks ordered around the same per-write records. */
export interface TrackingHooks {
	check(path: string, trigger: CheckTrigger, at: number, text?: string): Promise<void>;
	finished(record: WriteRecord, result: WriteResult, current?: string): void;
	renamed(from: string, to: string): void;
	deleted(path: string): void;
}

/** Owns counting holds and the main-window timers; no view reloads or revert decisions live here. */
export function createWriteTracking(deps: TaskWriterDeps, emit: (event: WriteEvent) => void, hooks: TrackingHooks) {
	let records: WriteRecord[] = [];
	let serial = 0;
	let sequence = 0;
	let disposed = false;
	const timers = new Set<number>();
	const versions = new Map<string, number>();
	const blocked = new Map<string, number>();
	const slowUntil = new Map<string, number>();
	const changes = new Map<string, string[]>();

	function later(run: () => void, delay: number): number {
		const timer = deps.setTimeout(
			() => {
				timers.delete(timer);
				if (!disposed) run();
			},
			Math.max(0, delay),
		);
		timers.add(timer);
		return timer;
	}
	function cancel(timer?: number): void {
		if (timer === undefined) return;
		deps.clearTimeout(timer);
		timers.delete(timer);
	}
	function event(record: WriteRecord, kind: WriteEvent["kind"], extra: Partial<WriteEvent> = {}): void {
		emit(
			Object.freeze({
				...record.target,
				id: record.id,
				lines: record.lines,
				kind,
				...(record.edit.kind === "undo" && record.edit.record.span.expected.length > 0
					? { written: record.edit.record.span.expected }
					: {}),
				...(record.insertBefore ? { insertBefore: true as const } : {}),
				...extra,
			}),
		);
	}
	function of(path: string): WriteRecord[] {
		return records.filter((record) => record.target.path === path);
	}
	function held(path: string): boolean {
		return of(path).some((record) => record.token && !record.released);
	}
	function pending(path: string): boolean {
		return of(path).some((record) => record.status === "pending");
	}
	function recheck(record: WriteRecord): void {
		if (record.rechecked || held(record.target.path)) return;
		record.rechecked = true;
		event(record, "recheck");
	}
	function windowTimer(record: WriteRecord): void {
		cancel(record.windowTimer);
		if (record.status !== "written" && record.status !== "unknown") {
			if (record.status !== "pending") record.windowEnd = record.resultAt;
			return;
		}
		if (record.releasedAt === undefined) return;
		record.windowEnd = Math.max(
			(record.writtenAt ?? record.resultAt) + OVERWRITE_WATCH_MS,
			record.releasedAt + OVERWRITE_AFTER_RELEASE_MS,
		);
		if (disposed) return;
		const scheduledAt = record.windowEnd;
		record.windowTimer = later(() => {
			void hooks.check(record.target.path, "window", scheduledAt);
			const writes = of(record.target.path).filter(
				(item) => item.status === "written" || item.status === "unknown",
			);
			if (writes[writes.length - 1] !== record || record.indexed || record.rechecked || held(record.target.path))
				return;
			deps.logger.warn("Tasks Calendar Wrapper: metadata did not index the last write", record.target.path);
			recheck(record);
		}, record.windowEnd - deps.now());
	}
	function release(record: WriteRecord, markDirty = true): void {
		if (record.released) return;
		record.released = true;
		record.releasedAt = deps.now();
		cancel(record.capTimer);
		cancel(record.slowTimer);
		record.slow = false;
		if (record.token) {
			record.token.release({ markDirty });
			sequence++;
		}
		// Before check 6 there is no token. The event still ends a pending overlay, without advancing the sequence.
		event(record, "released", { releaseSeq: sequence });
		windowTimer(record);
		if (record.status === "refused" || record.status === "failed")
			records = records.filter((item) => item !== record);
	}
	function indexed(record: WriteRecord, markDirty = true): void {
		if (record.indexed) return;
		record.indexed = true;
		record.slow = false;
		cancel(record.slowTimer);
		release(record, markDirty);
		record.resolveIndexed();
		event(record, "indexed");
		void hooks.check(record.target.path, "indexed", deps.now());
	}
	function touch(path: string): void {
		versions.set(path, (versions.get(path) ?? 0) + 1);
	}
	function defer(path: string, text: string): void {
		changes.set(path, [...(changes.get(path) ?? []), text]);
	}

	async function changed(path: string, text: string, checking?: Promise<void>): Promise<void> {
		if (disposed) return;
		if (pending(path)) {
			defer(path, text);
			return;
		}
		const version = versions.get(path) ?? 0;
		const currentRecords = of(path);
		const writes = currentRecords.filter(
			(record) => record.status === "written" || record.status === "unknown" || record.status === "reported",
		);
		const lastRecord = currentRecords[currentRecords.length - 1]?.id;
		const id = contentIdOf(normalized(text));
		const matches = writes.filter((record) => record.after?.id === id);
		const latest = matches[matches.length - 1];
		if (latest) {
			for (const record of writes) if (record.id <= latest.id) indexed(record);
			return;
		}
		if (writes.some((record) => record.before?.id === id)) {
			const file = deps.app.vault.getFileByPath(path);
			const source = deps.app.workspace
				.getLeavesOfType("markdown")
				.map((leaf) => leaf.view)
				.find(
					(view): view is MarkdownView =>
						view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source",
				);
			const editorMatches = source && contentIdOf(normalized(source.editor.getValue())) === id;
			if (!editorMatches) {
				if (!file) return;
				let current: string;
				try {
					current = await deps.app.vault.cachedRead(file);
				} catch {
					return;
				}
				if (disposed || (versions.get(path) ?? 0) !== version) return;
				if (pending(path)) {
					defer(path, text);
					return;
				}
				const latestRecords = of(path);
				if (latestRecords[latestRecords.length - 1]?.id !== lastRecord) {
					void changed(path, text);
					return;
				}
				if (contentIdOf(normalized(current)) !== id) return;
			}
		}
		await checking;
		if (disposed || (versions.get(path) ?? 0) !== version) return;
		for (const record of writes) release(record);
	}

	const metadata = deps.app.metadataCache;
	const vault = deps.app.vault;
	const changedRef = metadata.on("changed", (file, text) => {
		touch(file.path);
		const checking = hooks.check(file.path, "changed", deps.now(), text);
		void changed(file.path, text, checking);
	});
	const deletedRef = metadata.on("deleted", (file) => {
		touch(file.path);
		changes.delete(file.path);
		hooks.deleted(file.path);
		for (const record of of(file.path)) {
			if (record.status === "pending" && !record.applied) record.invalidated = true;
			release(record);
		}
	});
	const renameRef = vault.on("rename", (file, oldPath) => {
		touch(oldPath);
		touch(file.path);
		changes.delete(oldPath);
		for (const record of of(oldPath)) {
			if (record.status === "pending" && !record.applied) record.invalidated = true;
			release(record);
			if (!record.invalidated) {
				record.target = Object.freeze({ ...record.target, path: file.path });
				record.context = { ...record.context, path: file.path };
			}
		}
		hooks.renamed(oldPath, file.path);
		deps.index.markDirty([oldPath, file.path]);
	});
	const modifyRef = vault.on("modify", (file) => {
		cancel(blocked.get(file.path));
		blocked.delete(file.path);
	});

	return {
		begin(
			target: LineTarget,
			edit: TaskEdit | InsertEdit,
			lines: readonly string[],
			context: NoticeContext,
		): WriteRecord {
			let resolveIndexed!: () => void;
			const indexedPromise = new Promise<void>((resolve) => {
				resolveIndexed = resolve;
			});
			const record: WriteRecord = {
				id: ++serial,
				target,
				edit,
				lines,
				context,
				keys: Object.freeze(
					edit.kind === "insert"
						? []
						: [
								...new Set(
									edit.kind === "undo"
										? [...edit.record.span.expected, ...lines]
										: [target.sourceLine, ...lines],
								),
							],
				),
				status: "pending",
				delta: 0,
				resultAt: deps.now(),
				windowEnd: Infinity,
				released: false,
				invalidated: disposed,
				indexed: false,
				slow: false,
				rechecked: false,
				indexedPromise,
				resolveIndexed,
			};
			records.push(record);
			return record;
		},
		acquire(record: WriteRecord): boolean {
			if (disposed || record.invalidated || record.released) return false;
			if (record.token) return true;
			record.token = deps.index.hold(record.target.path);
			record.capTimer = later(() => {
				release(record);
				deps.logger.warn(
					"Tasks Calendar Wrapper: releasing an unindexed write after 120 s",
					record.target.path,
				);
				recheck(record);
			}, HOLD_CAP_MS);
			return true;
		},
		event,
		release,
		indexed,
		drop(dropped: readonly WriteRecord[]): void {
			const gone = new Set(dropped);
			records = records.filter((record) => !gone.has(record) || !record.released);
		},
		finish(record: WriteRecord, result: WriteResult, current?: string): void {
			record.resultAt = deps.now();
			record.status =
				result.kind === "failed" && result.unknownOutcome
					? "unknown"
					: result.kind === "cancelled"
						? "refused"
						: result.kind === "unchanged" && result.alreadyUndone
							? "already-undone"
							: result.kind;
			if (result.kind === "written") {
				record.writtenAt = deps.now();
				record.delta = result.delta;
				const scheduledAt = record.resultAt + INDEXED_NOTICE_MS;
				if (!record.released && !disposed)
					record.slowTimer = later(() => {
						void hooks.check(record.target.path, "slow", scheduledAt).then(() => {
							if (record.indexed || record.released) return;
							record.slow = true;
							const path = record.target.path;
							if ((slowUntil.get(path) ?? -Infinity) <= deps.now()) {
								deps.notices.slow(record.context);
								slowUntil.set(path, deps.now() + SLOW_NOTICE_MS);
							}
							event(record, "slow");
						});
					}, INDEXED_NOTICE_MS);
			}
			windowTimer(record);
			if (record.released && (record.status === "refused" || record.status === "failed"))
				records = records.filter((item) => item !== record);
			event(
				record,
				result.kind === "cancelled" ? "refused" : result.kind,
				result.kind === "failed"
					? { unknownOutcome: result.unknownOutcome }
					: result.kind === "refused"
						? { reason: result.reason }
						: {},
			);
			hooks.finished(record, result, current);
			const queued = changes.get(record.target.path) ?? [];
			changes.delete(record.target.path);
			for (const text of queued) void changed(record.target.path, text);
		},
		lineChanged(record: WriteRecord): void {
			const path = record.target.path;
			const version = versions.get(path) ?? 0;
			later(() => {
				if ((versions.get(path) ?? 0) === version) recheck(record);
			}, RECHECK_MS);
		},
		distance(path: string): number {
			return of(path)
				.filter(
					(record) => record.writtenAt !== undefined && deps.now() - record.writtenAt < AMBIGUITY_WINDOW_MS,
				)
				.reduce((sum, record) => sum + Math.abs(record.delta), 0);
		},
		notReread(target: LineTarget): boolean {
			return of(target.path).some(
				(record) =>
					record.slow &&
					!record.indexed &&
					!record.released &&
					record.target.line === target.line &&
					record.target.sourceLine === target.sourceLine,
			);
		},
		blocked(path: string): boolean {
			return blocked.has(path);
		},
		block(path: string): void {
			cancel(blocked.get(path));
			blocked.set(
				path,
				later(() => blocked.delete(path), FS_TIMEOUT_BLOCK_MS),
			);
		},
		releaseSeq(): number {
			return sequence;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			metadata.offref(changedRef);
			metadata.offref(deletedRef);
			vault.offref(renameRef);
			vault.offref(modifyRef);
			for (const record of records) {
				if (record.status === "pending") record.invalidated = true;
				release(record);
			}
			for (const timer of timers) deps.clearTimeout(timer);
			timers.clear();
			changes.clear();
			blocked.clear();
		},
	};
}
