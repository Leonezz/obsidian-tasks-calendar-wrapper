/**
 * What the A/B mode of scripts/bench.mjs and scripts/bench-nightly.mjs read about the Mac before they measure: other
 * scripts driving the same Obsidian, how long ago someone used the Mac, and what it runs on. Plain parsing of the output
 * of `ps`, `ioreg` and `pmset`, so tests/benchnightly.test.ts can test it.
 */

/** The scripts that drive the running Obsidian; one's work would land in another's measurements. */
const DRIVES_OBSIDIAN = /\bnode\b.*\bscripts\/(bench|screenshots)\.mjs\b/;

/**
 * The processes in the output of `ps -A -o pid=,ppid=,command=` that run a benchmark or the screenshots, other than
 * `selfPid` and the processes that started it, such as the shell of `pnpm bench`.
 */
export function otherBenchProcesses(ps, selfPid) {
	const processes = ps
		.split("\n")
		.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
		.filter((match) => match !== null)
		.map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
	const parents = new Map(processes.map((process) => [process.pid, process.ppid]));
	const own = new Set();
	for (let pid = selfPid; pid && !own.has(pid); pid = parents.get(pid)) own.add(pid);
	return processes
		.filter((process) => !own.has(process.pid) && DRIVES_OBSIDIAN.test(process.command))
		.map(({ pid, command }) => ({ pid, command }));
}

/** Seconds since the last keyboard, mouse or trackpad input, from `ioreg -c IOHIDSystem`. */
export function hidIdleSeconds(ioreg) {
	const match = ioreg.match(/"HIDIdleTime" = (\d+)/);
	if (!match) throw new Error("the output of `ioreg -c IOHIDSystem` has no HIDIdleTime");
	return Number(match[1]) / 1e9;
}

/** What the Mac draws power from, "AC Power" or "Battery Power", from `pmset -g batt`. */
export function powerSource(pmsetBattery) {
	const match = pmsetBattery.match(/Now drawing from '([^']+)'/);
	if (!match)
		throw new Error(`could not read the power source from \`pmset -g batt\`: ${pmsetBattery.slice(0, 200)}`);
	return match[1];
}

/** Whether Low Power Mode is on, from `pmset -g`; Macs without it do not list it. */
export function lowPowerMode(pmset) {
	return pmset.match(/^\s*lowpowermode\s+(\d+)/m)?.[1] === "1";
}

/**
 * Why the Mac is not idle enough to measure on, or nothing: it has to be plugged in, as a laptop on battery slows down
 * to save it, not in Low Power Mode, under the load average limit, untouched for `idleMinutes`, and running no other
 * benchmark.
 */
export function idleProblems(state, limits) {
	const problems = [];
	if (state.power !== "AC Power") problems.push(`it runs on ${state.power}, not AC Power`);
	if (state.lowPower) problems.push("Low Power Mode is on");
	if (state.loadAverage > limits.load)
		problems.push(`the 1-minute load average is ${Math.round(state.loadAverage * 10) / 10}, above ${limits.load}`);
	if (state.idleSeconds < limits.idleMinutes * 60)
		problems.push(
			`it was used ${Math.round(state.idleSeconds)} s ago, less than ${limits.idleMinutes} minutes ago`,
		);
	for (const other of state.others) problems.push(`another benchmark is running: ${other.pid} ${other.command}`);
	return problems;
}
