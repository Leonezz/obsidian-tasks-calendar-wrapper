export declare const TASKS_PARITY_VAULT: "tasks-parity";
export declare const GENERATED_FOLDER: "Parity";
export declare const ENCODING_NOTES: readonly string[];
export declare const GENERATED_KINDS: readonly string[];
export declare const RECURRENCE_RULES: readonly { readonly id: string; readonly rule: string }[];

export interface TasksParityCase {
	path: string;
	line: number;
	sourceLine: string;
	kind: string;
	recurring: boolean;
	lineEnding: "lf" | "crlf" | "mixed";
}

export declare function goldenVaultNotes(): Map<string, Buffer>;
export declare function generatedNotes(): Map<string, Buffer>;
export declare function tasksParityNotes(): Map<string, Buffer>;
export declare function tasksParityCases(): TasksParityCase[];
