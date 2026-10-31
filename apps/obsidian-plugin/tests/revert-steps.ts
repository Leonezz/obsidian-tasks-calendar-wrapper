import type { DayKey } from "@tasks-calendar-wrapper/core";
import type { TaskEdit, TaskWriter, UndoRecord, WriteEvent } from "../timeline/src/taskwriter";
import type { WriterHarness, WriterView } from "./writer-harness";
import type { RevertOracle, DisagreementClass, ModelLine, ModelWrite } from "./revert-oracle";

export interface RevertStep {
	readonly kind:
		| "toggle"
		| "due"
		| "remove-due"
		| "set-back"
		| "undo"
		| "redo"
		| "replace"
		| "insert-plain"
		| "delete-plain"
		| "move"
		| "edit-task"
		| "insert-task"
		| "delete-task"
		| "stale"
		| "revert-line"
		| "ctrlz"
		| "view"
		| "time"
		| "changed"
		| "delivery"
		| "quick-entry"
		| "rename"
		| "save-again"
		| "timeout"
		| "concurrent"
		| "custom";
	readonly note?: number;
	readonly at?: number;
	readonly value?: number;
	readonly mode?: "source" | "preview" | "closed";
	readonly text?: string;
	readonly ms?: number;
	readonly deliver?: boolean;
	readonly save?: boolean;
	readonly label?: string;
	readonly custom?: (context: ModelStepContext) => Promise<void>;
}

export interface ModelRunOptions {
	readonly duplicated?: boolean;
	readonly toggle?: (source: string, today: DayKey) => string;
	readonly initial?: readonly string[];
	readonly count?: (key: string) => void;
}
export interface ModelFailure {
	readonly step: number;
	readonly actual: readonly number[];
	readonly expected: readonly number[];
	readonly classes: readonly DisagreementClass[];
	readonly message: string;
}

export interface NoteModel {
	path: string;
	lines: readonly ModelLine[];
	readonly oracle: RevertOracle;
	readonly snapshots: (readonly ModelLine[])[];
	readonly undo: Map<number, { record: UndoRecord; original: ModelLine }>;
	readonly ownStack: { view: WriterView; before: readonly ModelLine[]; after: string }[];
	readonly retained: Set<number>;
	readonly pruned: Set<number>;
	pending: boolean;
	revision: number;
	beforeForeign?: readonly ModelLine[];
	redoTarget?: {
		readonly revision: number;
		readonly ownStateBeforeRevert: boolean;
		readonly lastOwnIds: readonly number[];
		readonly actions: number;
		readonly day: string;
		readonly identities: ReadonlySet<number>;
		readonly texts: readonly string[];
		readonly redo: () => Promise<void>;
	};
	latestEditor?: ModelWrite;
	editorReady?: boolean;
}

export interface ModelStepContext {
	readonly h: WriterHarness;
	readonly writer: TaskWriter;
	readonly note: NoteModel;
	readonly notes: readonly NoteModel[];
	readonly own: (note: NoteModel, step: RevertStep) => Promise<void>;
	readonly changed: (note: NoteModel) => Promise<void>;
	readonly advance: (ms: number) => Promise<void>;
	readonly external: (
		note: NoteModel,
		next: readonly ModelLine[],
		source: "user" | "foreign" | "ctrlz",
		deliver: boolean,
		changedIds?: readonly number[],
	) => Promise<void>;
	readonly observe: (
		note: NoteModel,
		next: readonly ModelLine[],
		source: "own" | "user" | "foreign" | "ctrlz",
		changedIds?: readonly number[],
	) => void;
	readonly ownResult: (
		note: NoteModel,
		event: WriteEvent,
		before: readonly ModelLine[],
		beforePosition: number,
		edit: TaskEdit,
		original: ModelLine,
		validate?: boolean,
	) => void;
	readonly check: (
		trigger: string,
		undone?: number,
		expectedOverride?: Map<NoteModel, number[]>,
		checked?: ReadonlySet<NoteModel>,
	) => void;
	readonly syncViews: (note: NoteModel) => void;
	readonly currentText: (note: NoteModel) => string;
	readonly line: (text: string) => ModelLine;
	readonly setToday: (day: DayKey) => void;
	readonly count: (key: string) => void;
}

/** A stable generator: seeds replay without depending on the clock, test order or a random global. */
export function generateReverts(seed: number, steps: number): RevertStep[] {
	let state = (seed ^ 0x9e3779b9) >>> 0;
	const random = (n: number): number => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return Math.floor((state / 0x100000000) * n);
	};
	const kinds: RevertStep["kind"][] = [
		"toggle",
		"toggle",
		"toggle",
		"due",
		"due",
		"remove-due",
		"set-back",
		"undo",
		"redo",
		"insert-plain",
		"delete-plain",
		"move",
		"edit-task",
		"insert-task",
		"delete-task",
		"stale",
		"stale",
		"revert-line",
		"ctrlz",
		"view",
		"time",
		"time",
		"time",
		"changed",
		"delivery",
		"quick-entry",
		"rename",
		"save-again",
		"timeout",
		"concurrent",
	];
	return Array.from({ length: steps }, () => ({
		kind: kinds[random(kinds.length)],
		note: random(2),
		at: random(31),
		value: random(31),
		mode: (["source", "preview", "closed"] as const)[random(3)],
		ms: random(4001),
		deliver: random(4) !== 0,
	}));
}
