// Types for the offline tests and the later capture script.
export declare const TASKS_PARITY_MARKER = ".tasks-parity-vault";
export declare const TASKS_PLUGIN_ID = "obsidian-tasks-plugin";
export declare const TASKS_VERSION = "8.6.0";
export type TasksFile = { url: string; sha256: string };
export declare const TASKS_FILES: Record<string, TasksFile>;
export type TasksParityVaultOptions = {
	tasksAssets?: string;
	fetch?: typeof globalThis.fetch;
	readAsset?: (file: string) => Uint8Array | Promise<Uint8Array>;
	tasksFiles?: Record<string, TasksFile>;
	buildPaths?: { mainJs: string; stylesCss: string };
};
export type TasksParityVaultResult = {
	dir: string;
	notes: number;
	written: number;
	tasksWritten: number;
	tasksKept: number;
	pluginWritten: number;
	pluginKept: number;
	otherWritten: number;
	totalWritten: number;
};
export declare function writeTasksParityVault(
	target: string,
	options?: TasksParityVaultOptions,
): Promise<TasksParityVaultResult>;
