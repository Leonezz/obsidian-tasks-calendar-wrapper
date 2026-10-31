import {
	countsOn,
	equalCounts,
	findRevert,
	lostWrites,
	taskLineCounts,
	type LineCounts,
	type Neighbours,
	type WriteCounts,
} from "@tasks-calendar-wrapper/core";
import { contentIdOf, type ContentId } from "../../utils/contentid";
import { normalized } from "./writerchecks";
import type { WriteRecord } from "./writerholds";

/** Different observations made while a note's own write is still running. */
export const DEFERRED_CHECKS_MAX = 16;
const RETAIN_MS = 60000;
const RECORDS_MAX = 50;

interface Entry {
	readonly record: WriteRecord;
	readonly outcome: WriteCounts["outcome"];
	readonly undoOf?: number;
	readonly neighbours?: Neighbours;
	readonly deletedNeighbours?: Neighbours;
	neighboursVoid: boolean;
}

interface Group {
	readonly members: readonly Entry[];
	readonly expected: readonly LineCounts[];
}

interface DeferredCheck {
	readonly text: string;
	readonly id: ContentId;
	readonly at: number;
}

interface Note {
	groups: readonly Group[];
	inflight: boolean;
	deferred: readonly DeferredCheck[];
}

/** Every reverted group in one check is presented together; release applies to all its members. */
export interface RevertReport {
	readonly records: readonly WriteRecord[];
	readonly lost: readonly WriteRecord[];
}

function keysOf(group: Group): readonly string[] {
	return [...new Set(group.members.flatMap(({ record }) => record.keys))];
}

function inWindow(entry: Entry, at: number): boolean {
	return (
		entry.record.status !== "reported" &&
		(entry.outcome === "written" || entry.outcome === "unknown") &&
		at <= entry.record.windowEnd
	);
}

function sameNeighbours(left: Neighbours, right: Neighbours): boolean {
	return left.above === right.above && left.below === right.below;
}

/** Keeps only count tables for writes. Live observations retain text briefly for neighbour checks. */
export function createRevertCheck(onDrop: (records: readonly WriteRecord[]) => void = () => {}) {
	const notes = new Map<string, Note>();

	function note(path: string): Note {
		let state = notes.get(path);
		if (!state) {
			state = { groups: [], inflight: false, deferred: [] };
			notes.set(path, state);
		}
		return state;
	}
	function prune(path: string, at: number): void {
		const state = notes.get(path);
		if (!state || state.inflight) return;
		const old = state.groups.flatMap((group) => group.members);
		let keep = state.groups.filter((group) => {
			const newest = group.members[group.members.length - 1].record;
			return (
				at - newest.resultAt < RETAIN_MS ||
				group.members.some((entry) => !entry.record.released || inWindow(entry, at))
			);
		});
		while (keep.reduce((total, group) => total + group.members.length, 0) > RECORDS_MAX) {
			if (keep.length === 1) {
				keep = [{ ...keep[0], members: keep[0].members.slice(-RECORDS_MAX) }];
				break;
			}
			const oldest = keep.reduce((left, right) =>
				left.members[left.members.length - 1].record.id < right.members[right.members.length - 1].record.id
					? left
					: right,
			);
			keep = keep.filter((group) => group !== oldest);
		}
		state.groups = keep;
		const kept = new Set(keep.flatMap((group) => group.members));
		const dropped = old.filter((entry) => !kept.has(entry)).map((entry) => entry.record);
		if (dropped.length > 0) onDrop(dropped);
	}
	function add(record: WriteRecord, path: string, at: number, alreadyUndone: boolean): void {
		if (record.edit.kind === "insert" || !record.before || !record.after) return;
		const status = record.status;
		if (status !== "written" && status !== "unknown" && status !== "unchanged" && status !== "already-undone")
			return;
		prune(path, at);
		const state = note(path);
		const outcome = alreadyUndone ? "already-undone" : status;
		const noop = outcome === "unchanged" || outcome === "already-undone";
		const entry: Entry = {
			record,
			outcome,
			undoOf: record.edit.kind === "undo" ? record.edit.record.id : undefined,
			neighbours: noop ? undefined : record.undoNeighbours,
			deletedNeighbours: noop ? undefined : record.deletedNeighbours,
			neighboursVoid: false,
		};
		if (noop) {
			record.status = outcome;
			record.released = true;
			record.windowEnd = record.resultAt;
		}
		if (entry.deletedNeighbours) {
			for (const group of state.groups) {
				for (const previous of group.members) {
					if (previous.neighbours && sameNeighbours(previous.neighbours, entry.deletedNeighbours))
						previous.neighboursVoid = true;
				}
			}
		}
		const inter = state.groups.filter((group) => keysOf(group).some((key) => record.keys.includes(key)));
		const members = [...inter.flatMap((group) => group.members), entry].sort((a, b) => a.record.id - b.record.id);
		const expected =
			outcome === "unknown"
				? [...inter.flatMap((group) => group.expected), record.before.counts, record.after.counts]
				: [record.after.counts];
		state.groups = [...state.groups.filter((group) => !inter.includes(group)), { members, expected }];
		prune(path, at);
	}
	function check(
		path: string,
		current: string,
		at: number,
		options: { readonly undone?: number; readonly also?: readonly LineCounts[] } = {},
	): readonly RevertReport[] {
		const state = notes.get(path);
		if (!state) return [];
		if (state.inflight) {
			const id = contentIdOf(normalized(current));
			if (state.deferred.length < DEFERRED_CHECKS_MAX && !state.deferred.some((item) => item.id === id))
				state.deferred = [...state.deferred, { text: current, id, at }];
			return [];
		}
		prune(path, at);
		const reports: RevertReport[] = [];
		for (const group of state.groups) {
			const keys = keysOf(group);
			const snapshots: LineCounts[] = [];
			const adjacency = new Map<number, Neighbours>();
			const writes: WriteCounts[] = [];
			for (const entry of group.members) {
				const record = entry.record;
				const j = snapshots.length;
				snapshots.push(record.before!.counts, record.after!.counts);
				if (entry.neighbours) adjacency.set(j, entry.neighbours);
				if (entry.deletedNeighbours) adjacency.set(j + 1, entry.deletedNeighbours);
				writes.push({
					id: record.id,
					before: record.before!.counts,
					after: record.after!.counts,
					undoOf: entry.undoOf,
					outcome: entry.outcome,
					reported: record.status === "reported",
				});
			}
			const expected = [...group.expected, ...(options.also ?? [])];
			let j = findRevert(current, expected, snapshots, keys, adjacency);
			// A later deletion makes that Undo's P ineligible forever, but leaves every earlier snapshot available.
			while (j !== null && j % 2 === 0 && group.members[j / 2].neighboursVoid)
				j = findRevert(current, expected, snapshots.slice(0, j), keys, adjacency);
			if (j === null) continue;
			const lostIds = new Set(
				lostWrites(writes, j, keys)
					.filter((write) => write.id !== options.undone)
					.map((write) => write.id),
			);
			const lost = group.members.filter((entry) => lostIds.has(entry.record.id));
			if (!lost.some((entry) => inWindow(entry, at))) continue;
			reports.push({
				records: group.members.map((entry) => entry.record),
				lost: lost.map((entry) => entry.record),
			});
		}
		for (const report of reports) for (const record of report.lost) record.status = "reported";
		return reports;
	}

	return {
		begin(path: string): void {
			note(path).inflight = true;
		},
		check,
		/** Completes 5a and 5f before changing expected. The caller checks current text again after this returns. */
		result(
			record: WriteRecord | undefined,
			path: string,
			at: number,
			alreadyUndone = false,
			current?: string,
		): readonly RevertReport[] {
			const state = note(path);
			state.inflight = false;
			const deferred = state.deferred;
			state.deferred = [];
			const also =
				record?.after && (record.status === "written" || record.status === "unknown")
					? [record.after.counts]
					: [];
			const reports = deferred.flatMap((item) => check(path, item.text, item.at, { also }));
			if (record) {
				if ((record.status === "unchanged" || record.status === "already-undone") && current !== undefined) {
					const undone = alreadyUndone && record.edit.kind === "undo" ? record.edit.record.id : undefined;
					reports.push(...check(path, current, at, { undone }));
				}
				add(record, path, at, alreadyUndone);
			} else prune(path, at);
			return reports;
		},
		prune,
		retained(path: string): readonly WriteRecord[] {
			return (notes.get(path)?.groups ?? []).flatMap((group) => group.members.map((entry) => entry.record));
		},
		expected(record: WriteRecord, current: string): boolean {
			const group = notes
				.get(record.target.path)
				?.groups.find((item) => item.members.some((entry) => entry.record === record));
			if (!group) return false;
			const keys = keysOf(group);
			const counts = countsOn(taskLineCounts(current), keys);
			return group.expected.some((table) => equalCounts(countsOn(table, keys), counts));
		},
		rename(oldPath: string, path: string): void {
			const state = notes.get(oldPath);
			if (!state) return;
			notes.delete(oldPath);
			notes.set(path, state);
		},
		remove(path: string): void {
			notes.delete(path);
		},
	};
}
