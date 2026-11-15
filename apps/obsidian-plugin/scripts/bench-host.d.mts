/** Types for scripts/bench-host.mjs, which the tests import. */

export interface BenchProcess {
	readonly pid: number;
	readonly command: string;
}

export interface HostState {
	readonly loadAverage: number;
	readonly idleSeconds: number;
	readonly power: string;
	readonly lowPower: boolean;
	readonly others: readonly BenchProcess[];
}

export function otherBenchProcesses(ps: string, selfPid: number): BenchProcess[];
export function hidIdleSeconds(ioreg: string): number;
export function powerSource(pmsetBattery: string): string;
export function lowPowerMode(pmset: string): boolean;
export function idleProblems(
	state: HostState,
	limits: { readonly load: number; readonly idleMinutes: number },
): string[];

export interface LoadSample {
	readonly atMs: number;
	readonly loadAverage: number;
}

export interface LoadAdmission {
	readonly limit: number;
	readonly timeoutMs: number;
	readonly pollMs: number;
	readonly startedAtMs: number;
	readonly waitedMs: number;
	readonly sample: LoadSample;
	readonly samples: readonly LoadSample[];
}

export function waitForLoadBelow(options: {
	readonly limit: number;
	readonly timeoutMs: number;
	readonly pollMs: number;
	readonly readLoad: () => number;
	readonly now: () => number;
	readonly pause: (ms: number) => void;
	readonly log?: (message: string) => void;
}): LoadAdmission;
