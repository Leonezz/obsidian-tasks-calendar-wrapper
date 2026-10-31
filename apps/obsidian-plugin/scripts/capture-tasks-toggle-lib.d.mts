import type { TasksParityCase } from "./tasks-parity-notes.mjs";
export { TASKS_PARITY_VAULT } from "./tasks-parity-notes.mjs";

export interface NoteDiff {
	readonly prefix: number;
	readonly suffix: number;
	readonly text: string;
}

export interface ProbeSignature {
	readonly emojiDone: boolean;
	readonly dataviewDone: boolean;
	readonly completedIndex: number;
	readonly newCreated: boolean;
	readonly newScheduled: boolean;
	readonly taggedDone: boolean;
	readonly questionStatus: string;
}

export interface StatusSetting {
	readonly symbol: string;
	readonly name: string;
	readonly nextStatusSymbol: string;
	readonly availableAsCommand: boolean;
	readonly type: "TODO" | "DONE" | "IN_PROGRESS" | "ON_HOLD" | "CANCELLED" | "NON_TASK";
}

export interface CaptureSettings {
	readonly taskFormat?: "dataview";
	readonly recurrenceOnNextLine?: boolean;
	readonly removeScheduledDateOnRecurrence?: boolean;
	readonly setDoneDate?: boolean;
	readonly setCancelledDate?: boolean;
	readonly setCreatedDate?: boolean;
	readonly globalFilter?: string;
	readonly removeGlobalFilter?: boolean;
	readonly statusSettings?: {
		readonly coreStatuses: readonly StatusSetting[];
		readonly customStatuses: readonly StatusSetting[];
	};
}

export declare const PROBE_LINES: readonly string[];
export declare const SETTINGS_GROUPS: readonly {
	readonly name: string;
	readonly settings: CaptureSettings;
	readonly signature: ProbeSignature;
}[];
export declare function probeSignature(outputs: readonly string[]): ProbeSignature;
export declare function captureCases(): TasksParityCase[];
export declare function diffNote(before: string, after: string): NoteDiff;
export declare function applyNoteDiff(before: string, diff: NoteDiff): string;
export declare function stableStringify(value: unknown): string;
