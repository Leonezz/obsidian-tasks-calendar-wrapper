import {
	parseTaskLine,
	recurrenceMarkers,
	resolveTasks,
	type QueryEnv,
	type ResolveSettings,
	type Task,
	type TaskStatus,
} from "@tasks-calendar-wrapper/core";
import type { WriteEvent } from "./taskwriter";

/** Display only. Every write keeps its own release sequence, even when another write of the row follows it. */
export interface PendingWrite {
	readonly id: number;
	readonly path: string;
	readonly dimmed: boolean;
	readonly marker?: string;
	readonly status?: TaskStatus;
	readonly releaseSeq?: number;
}

export interface PendingWrites {
	apply(event: WriteEvent, tasks: readonly Task[], settings: ResolveSettings, env: QueryEnv): void;
	getSnapshot(id: string): PendingWrite | undefined;
	subscribe(id: string, listener: () => void): () => void;
	clearThrough(seq: number, pinned?: ReadonlySet<string>): void;
}

/** Resolve through core with the view's daily-note format; hidden completed rows still need their predicted icon. */
function prediction(
	event: WriteEvent,
	settings: ResolveSettings,
	env: QueryEnv,
): Pick<PendingWrite, "marker" | "status"> {
	const parsed = event.lines.map((line) => parseTaskLine(line, { moment: env.moment, path: event.path }));
	const resolved = parsed.map((task) =>
		task ? resolveTasks([task], { dailyNoteFormat: settings.dailyNoteFormat }, env).shown[0] : undefined,
	);
	const source = parseTaskLine(event.sourceLine, { moment: env.moment, path: event.path });
	const done = resolved.find((task) => task?.status === "done");
	const restoring = event.lines.length === 1 && event.lines[0] === event.sourceLine;
	const completingRecurrence = recurrenceMarkers(event.sourceLine) > 0 && !source?.completed && !restoring;
	const next = resolved.length > 1 || completingRecurrence ? done : resolved[0];
	return next ? { marker: next.task.statusMarker, status: next.status } : {};
}

/** One store per view. Only listeners for an affected task id are notified; provider values never change. */
export function createPendingWrites(): PendingWrites {
	const rows = new Map<string, readonly PendingWrite[]>();
	const listeners = new Map<string, Set<() => void>>();
	function set(id: string, entries: readonly PendingWrite[]): void {
		const before = rows.get(id)?.at(-1);
		if (entries.length) rows.set(id, entries);
		else rows.delete(id);
		if (before !== entries.at(-1)) for (const listener of listeners.get(id) ?? []) listener();
	}
	return Object.freeze({
		getSnapshot: (id: string) => rows.get(id)?.at(-1),
		subscribe(id: string, listener: () => void): () => void {
			let subscribed = listeners.get(id);
			if (!subscribed) listeners.set(id, (subscribed = new Set()));
			subscribed.add(listener);
			return () => {
				subscribed.delete(listener);
				if (subscribed.size === 0) listeners.delete(id);
			};
		},
		apply(event: WriteEvent, tasks: readonly Task[], settings: ResolveSettings, env: QueryEnv): void {
			if (event.kind === "pending" && !event.insertBefore) {
				const matches = tasks.filter(
					(task) => task.path === event.path && task.sourceLine === event.sourceLine,
				);
				const task = matches.length === 1 ? matches[0] : matches.find((task) => task.line === event.line);
				if (task)
					set(task.id, [
						...(rows.get(task.id) ?? []),
						Object.freeze({
							id: event.id,
							path: event.path,
							dimmed: true,
							...prediction(event, settings, env),
						}),
					]);
				return;
			}
			for (const [id, entries] of rows) {
				if (!entries.some((entry) => entry.id === event.id)) continue;
				if (["refused", "failed", "unchanged", "overwritten"].includes(event.kind))
					set(
						id,
						entries.filter((entry) => entry.id !== event.id),
					);
				else if (event.kind === "released" || event.kind === "slow")
					set(
						id,
						entries.map((entry) =>
							entry.id !== event.id
								? entry
								: Object.freeze({
										...entry,
										...(event.kind === "slow"
											? { dimmed: false }
											: { releaseSeq: event.releaseSeq }),
									}),
						),
					);
			}
		},
		clearThrough(seq: number, pinned: ReadonlySet<string> = new Set()): void {
			for (const [id, entries] of rows)
				set(
					id,
					entries.filter(
						(entry) => entry.releaseSeq === undefined || entry.releaseSeq > seq || pinned.has(entry.path),
					),
				);
		},
	});
}
