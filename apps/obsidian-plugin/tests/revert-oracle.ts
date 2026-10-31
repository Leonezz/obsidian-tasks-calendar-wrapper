/** The truth keeps identities and every observed state; it never reads the checker's records or options. */
export interface ModelLine {
	readonly id: number;
	readonly text: string;
}

export interface ModelWrite {
	readonly id: number;
	readonly identities: ReadonlySet<number>;
	readonly before: number;
	readonly after: number;
	readonly undoOf?: number;
	readonly resultAt: number;
	readonly signature: string;
	readonly keys: readonly string[];
	readonly neighbours?: readonly [string | null, string | null];
	releasedAt?: number;
	windowEnd: number;
	active: boolean;
	readonly unknown?: true;
	readonly expected?: readonly string[];
}

type Source = "initial" | "own" | "user" | "foreign" | "ctrlz";
interface History {
	readonly lines: readonly ModelLine[];
	readonly source: Source;
}
export interface VerdictGroup {
	readonly identities: ReadonlySet<number>;
	readonly writes: readonly ModelWrite[];
	readonly undecidable: boolean;
	readonly moved: boolean;
	readonly match?: number;
	readonly first?: number;
	readonly run?: number;
}

const intersects = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => [...a].some((id) => b.has(id));
const same = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((text, i) => text === b[i]);

export class RevertOracle {
	readonly history: History[] = [];
	readonly writes: ModelWrite[] = [];
	readonly edits: { position: number; identities: ReadonlySet<number> }[] = [];
	private readonly carried = new Map<string, Set<number>>();
	last: VerdictGroup[] = [];

	constructor(initial: readonly ModelLine[]) {
		this.observe(initial, "initial");
	}
	get position(): number {
		return this.history.length - 1;
	}
	observe(lines: readonly ModelLine[], source: Source, changed: readonly number[] = []): void {
		this.history.push({ lines: lines.map((line) => ({ ...line })), source });
		for (const line of lines) {
			const identities = this.carried.get(line.text) ?? new Set<number>();
			identities.add(line.id);
			this.carried.set(line.text, identities);
		}
		if (source === "user" && changed.length)
			this.edits.push({ position: this.position, identities: new Set(changed) });
	}
	state(position: number, identities: ReadonlySet<number>): string[] {
		return this.history[position].lines
			.filter((line) => identities.has(line.id))
			.map((line) => line.text)
			.sort();
	}
	groups(): { identities: ReadonlySet<number>; writes: ModelWrite[] }[] {
		let groups: { identities: ReadonlySet<number>; writes: ModelWrite[] }[] = [];
		for (const write of this.writes) {
			const hit = groups.filter((group) => intersects(group.identities, write.identities));
			groups = [
				...groups.filter((group) => !hit.includes(group)),
				{
					identities: new Set([...write.identities, ...hit.flatMap((group) => [...group.identities])]),
					writes: [...hit.flatMap((group) => group.writes), write].sort((a, b) => a.id - b.id),
				},
			];
		}
		return groups;
	}
	private undecidable(identities: ReadonlySet<number>): boolean {
		return [...this.carried.values()].some((ids) => ids.size > 1 && intersects(ids, identities));
	}
	private remaining(
		candidates: readonly ModelWrite[],
		identities: ReadonlySet<number>,
		undone?: number,
	): ModelWrite[] {
		// This order is the truth's fixed policy, including the deliberate difference from rule 5f.
		const drop = new Set(undone === undefined ? [] : [undone]);
		const ids = new Set(candidates.map((write) => write.id));
		for (const write of candidates) {
			if (write.undoOf !== undefined && ids.has(write.undoOf) && !drop.has(write.undoOf) && !drop.has(write.id)) {
				drop.add(write.id);
				drop.add(write.undoOf);
			}
		}
		const chain = candidates.filter((write) => !drop.has(write.id));
		const lost: ModelWrite[] = [];
		for (let i = 0; i < chain.length;) {
			const start = this.state(chain[i].before, identities);
			let end = chain.length - 1;
			while (end >= i && !same(start, this.state(chain[end].after, identities))) end--;
			if (end < i) lost.push(chain[i++]);
			else i = end + 1;
		}
		return lost;
	}
	evaluate(now: number, undone?: number, mark = true): number[] {
		const lost: ModelWrite[] = [];
		this.last = this.groups().map(({ identities, writes }) => {
			const current = this.state(this.position, identities);
			const common = { identities, writes, undecidable: this.undecidable(identities) };
			if (same(current, this.state(writes[writes.length - 1].after, identities)))
				return { ...common, moved: false };
			let previous = this.position;
			while (previous >= 0 && same(current, this.state(previous, identities))) previous--;
			const run = previous + 1;
			if (previous < 0 || this.history[run].source === "user") return { ...common, moved: true, run };
			const matches = Array.from({ length: previous }, (_, i) => i).filter((i) =>
				same(current, this.state(i, identities)),
			);
			const match = matches.at(-1);
			if (match === undefined) return { ...common, moved: true, run };
			const remaining = this.remaining(
				writes.filter((write) => write.before >= match),
				identities,
				undone,
			).filter((write) => write.active);
			if (remaining.some((write) => write.windowEnd >= now)) lost.push(...remaining);
			return { ...common, moved: true, run, match, first: matches[0] };
		});
		if (mark) for (const write of lost) write.active = false;
		return lost.map((write) => write.id).sort((a, b) => a - b);
	}
}

export const disagreementClasses = [
	"retention",
	"unknown",
	"outside-edit",
	"bang-neighbours",
	"identical",
	"other",
] as const;
export type DisagreementClass = (typeof disagreementClasses)[number];

/** Measurement predicates only. They do not change the truth or the writer's result. */
export function classify(
	oracle: RevertOracle,
	reported: readonly number[],
	expected: readonly number[],
	pruned: ReadonlySet<number>,
	current: readonly ModelLine[],
): DisagreementClass[] {
	const ids = new Set([...reported, ...expected]);
	const involved = oracle.last.filter(
		(group) => group.match !== undefined || group.writes.some((write) => ids.has(write.id)),
	);
	const writes = involved.flatMap((group) => group.writes);
	const classes: DisagreementClass[] = [];
	if (
		involved.some((group) => {
			const kept = group.writes.filter((write) => !pruned.has(write.id));
			return (
				group.match !== undefined &&
				group.writes.some((write) => pruned.has(write.id)) &&
				(kept.length === 0 || group.match < Math.min(...kept.map((write) => write.before)))
			);
		})
	)
		classes.push("retention");
	if (writes.some((write) => write.unknown)) classes.push("unknown");
	if (
		involved.some((group) => {
			const named = group.writes.filter((write) => ids.has(write.id));
			const start =
				group.first ??
				group.match ??
				(named.length ? Math.min(...named.map((write) => write.before)) : undefined);
			return (
				start !== undefined &&
				oracle.edits.some(
					(edit) =>
						start <= edit.position &&
						edit.position < (group.run ?? oracle.position + 1) &&
						intersects(edit.identities, group.identities),
				)
			);
		})
	)
		classes.push("outside-edit");
	if (
		writes.some((write) => {
			const neighbours = write.neighbours;
			if (!neighbours || pruned.has(write.id)) return false;
			const lines = current.length === 1 && current[0].text === "" ? [] : current;
			return !Array.from({ length: lines.length + 1 }, (_, i) => i).some(
				(i) => (lines[i - 1]?.text ?? null) === neighbours[0] && (lines[i]?.text ?? null) === neighbours[1],
			);
		})
	)
		classes.push("bang-neighbours");
	if (involved.some((group) => group.undecidable)) classes.push("identical");
	return classes.length ? classes : ["other"];
}
