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
