import { MarkdownView } from "obsidian";
import type { TaskWriterDeps, WriteResult } from "./taskwriter";
import type { CheckTrigger, WriteRecord, createWriteTracking } from "./writerholds";
import { createRevertCheck, type RevertReport } from "./revertcheck";
import { normalized } from "./writerchecks";
import { INDEXED_NOTICE_MS } from "./writerconstants";

/** Reads one note at a time, preserving trigger times while its writes are in flight. */
export function createWriterWatch(
	deps: TaskWriterDeps,
	tracking: ReturnType<typeof createWriteTracking>,
	redo: (records: readonly WriteRecord[]) => Promise<void>,
) {
	const rule = createRevertCheck(tracking.drop);
	const queues = new Map<string, Promise<void>>();
	const results = new Map<string, Promise<void>>();
	const latestEditor = new Map<string, WriteRecord>();
	const retry = new Map<string, number>();
	const editorTimers = new Map<WriteRecord, number>();
	let disposed = false;
	let stop!: () => void;
	const stopped = new Promise<undefined>((resolve) => {
		stop = () => resolve(undefined);
	});

	function enqueue(path: string, run: () => void | Promise<void>): Promise<void> {
		const previous = queues.get(path);
		const next = previous ? previous.then(run) : Promise.resolve(run());
		queues.set(path, next);
		void next.then(() => {
			if (queues.get(path) === next) queues.delete(path);
		});
		return next;
	}

	function report(reports: readonly RevertReport[]): void {
		if (disposed || reports.length === 0) return;
		const lost = [...new Set(reports.flatMap((item) => item.lost))].sort((a, b) => a.id - b.id);
		const records = new Set(reports.flatMap((item) => item.records));
		for (const record of records) {
			tracking.indexed(record, false);
			const timer = editorTimers.get(record);
			if (timer !== undefined) deps.clearTimeout(timer);
			editorTimers.delete(record);
		}
		for (const record of lost) tracking.event(record, "overwritten");
		const first = lost[0];
		deps.index.markDirty([first.target.path]);
		tracking.event(first, "recheck");
		let running = false;
		const canRedo = lost.every((record) => record.edit.kind !== "undo" && record.edit.kind !== "replace");
		deps.notices.overwritten(
			first.context,
			lost.length,
			canRedo
				? async () => {
						if (running || disposed) return;
						running = true;
						try {
							await redo(lost);
						} finally {
							running = false;
						}
					}
				: undefined,
		);
		for (const record of lost)
			if (record.edit.kind === "replace") deps.notices.editChangedBack(record.context, record.lines.join("\n"));
	}
	function sources(path: string): MarkdownView[] {
		return deps.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.filter(
				(view): view is MarkdownView =>
					view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source",
			);
	}
	function cancelRetry(path: string): void {
		const timer = retry.get(path);
		if (timer !== undefined) deps.clearTimeout(timer);
		retry.delete(path);
	}
	async function read(path: string, trigger: CheckTrigger): Promise<string | undefined> {
		const open = sources(path);
		const last = latestEditor.get(path);
		if (open.length) {
			const source = open.find((view) => view === last?.source) ?? open[0];
			const text = source.editor.getValue();
			if (open.some((view) => view !== source && normalized(view.editor.getValue()) !== normalized(text))) {
				if (!retry.has(path))
					retry.set(
						path,
						deps.setTimeout(() => {
							retry.delete(path);
							void check(path, "result", deps.now());
						}, 50),
					);
				return undefined;
			}
			return text;
		}
		if (
			last &&
			last.writtenAt !== undefined &&
			!last.editorIndexed &&
			trigger !== "slow" &&
			deps.now() < last.writtenAt + INDEXED_NOTICE_MS
		)
			return undefined;
		const file = deps.app.vault.getFileByPath(path);
		return file ? deps.app.vault.cachedRead(file) : undefined;
	}
	function check(path: string, trigger: CheckTrigger, at: number, changed?: string): Promise<void> {
		if (disposed || rule.retained(path).length === 0) return Promise.resolve();
		const last = latestEditor.get(path);
		if (trigger === "changed" && last && changed !== undefined && rule.expected(last, changed))
			last.editorIndexed = true;
		cancelRetry(path);
		const run = async () => {
			if (disposed) return;
			try {
				const current = await Promise.race([read(path, trigger), stopped]);
				if (!disposed && current !== undefined) report(rule.check(path, current, at));
			} catch {
				// A transient cache read failure is retried by the next metadata event or writer timer.
			}
		};
		return enqueue(path, run);
	}
	return {
		check,
		/** A new write may overlap a read, but must not overtake the previous write's deferred result. */
		ready(path: string): Promise<void> {
			return results.get(path) ?? Promise.resolve();
		},
		begin(record: WriteRecord): void {
			rule.begin(record.target.path);
		},
		finished(record: WriteRecord, result: WriteResult, current?: string): void {
			if (disposed) return;
			if (result.kind === "unchanged") tracking.release(record, false);
			const path = record.target.path;
			const at = record.resultAt;
			const complete = () => {
				if (disposed) return;
				report(
					rule.result(
						record,
						path,
						at,
						result.kind === "unchanged" && Boolean(result.alreadyUndone),
						current,
					),
				);
				if (record.source && result.kind === "written") {
					latestEditor.set(path, record);
					const scheduledAt = at + INDEXED_NOTICE_MS;
					editorTimers.set(
						record,
						deps.setTimeout(
							() => {
								editorTimers.delete(record);
								if (!record.editorIndexed) void check(record.target.path, "slow", scheduledAt);
							},
							Math.max(0, scheduledAt - deps.now()),
						),
					);
				}
				void check(path, "result", deps.now());
			};
			if (!queues.has(path)) {
				complete();
				return;
			}
			const completed = enqueue(path, complete);
			results.set(path, completed);
			void completed.then(() => {
				if (results.get(path) === completed) results.delete(path);
			});
		},
		renamed(from: string, to: string): void {
			rule.rename(from, to);
			const last = latestEditor.get(from);
			if (last) latestEditor.set(to, last);
			latestEditor.delete(from);
			cancelRetry(from);
		},
		deleted(path: string): void {
			rule.remove(path);
			latestEditor.delete(path);
			cancelRetry(path);
		},
		dispose(): void {
			disposed = true;
			stop();
			for (const path of retry.keys()) cancelRetry(path);
			latestEditor.clear();
			for (const timer of editorTimers.values()) deps.clearTimeout(timer);
			editorTimers.clear();
		},
	};
}
