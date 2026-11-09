/** Mobile screenshot states, rendered touch targets and their measurement report. */
export const TOUCH_TARGETS = [
	{ name: "strip checkbox", selector: ".task .timeline label.icon", required: true },
	{ name: "row menu", selector: ".task a.menu", required: true },
	{ name: "modify", selector: ".task a.modify", required: false },
	{ name: "counter", selector: ".counter", required: true },
	{ name: "Focus on today", selector: ".todayHeader", required: true },
	{
		name: "badge",
		selector: ".task .info > :is(.tag, .relative, .repeat, .priority, .file)",
		required: false,
	},
	{ name: "quick entry select", selector: ".quickEntryPanel select", required: true },
	{ name: "quick entry input", selector: ".quickEntryPanel input", required: true },
	{ name: "quick entry button", selector: ".quickEntryPanel button", required: true },
	{ name: "tag filter", selector: ".tagFilterBar input", required: false },
];

export const MOBILE_WIDTH = 390;
export const MOBILE_STATES = [
	"mobile-light-today-all-days-no-counter",
	"mobile-light-today-today-focus-no-counter",
	"mobile-light-today-all-days-todo-filter",
	"mobile-light-today-all-days-overdue-filter",
	"mobile-light-today-all-days-unplanned-filter",
	"mobile-light-top-all-days-no-counter",
	"mobile-light-bottom-all-days-no-counter",
];

export function mobilePlan(only = "") {
	return [
		["today", false, "none"],
		["today", true, "none"],
		["today", false, "todo"],
		["today", false, "overdue"],
		["today", false, "unplanned"],
		["top", false, "none"],
		["bottom", false, "none"],
	]
		.map(([position, todayFocus, counter], index) => ({
			name: MOBILE_STATES[index],
			theme: "light",
			position,
			todayFocus,
			counter,
			behavior: counter === "none" ? null : "Filter",
		}))
		.filter(({ name }) => name.includes(only));
}

export function collectTouchTargets({ container, targets }) {
	const root = document.querySelector(container)?.querySelector(".taskido");
	if (!root) return [];
	return targets.flatMap(({ name, selector }) =>
		[...root.querySelectorAll(selector)].flatMap((element, index) => {
			if (!element.checkVisibility({ checkVisibilityCSS: true })) return [];
			const { left, top, width, height } = element.getBoundingClientRect();
			const hit = document.elementFromPoint(left + width / 2, top + height / 2);
			return [{ target: name, index: index + 1, width, height, hit: element.contains(hit) }];
		}),
	);
}

export function touchTargetProblems(stateName, measurements, minimum = 44) {
	const problems = [];
	const measured = new Set();
	for (const { target, index, width, height, hit } of measurements) {
		measured.add(target);
		const measurement = { state: stateName, target, index, width, height };
		if (width < minimum || height < minimum) problems.push({ ...measurement, reason: "size" });
		if (!hit) problems.push({ ...measurement, reason: "covered" });
	}
	for (const { name, required } of TOUCH_TARGETS)
		if (required && !measured.has(name)) problems.push({ state: stateName, target: name, reason: "missing" });
	return problems;
}

export function formatTouchTargetReport(problems, minimum = 44) {
	const lines = problems.map(({ state, target, index, width, height, reason }) => {
		if (reason === "missing") return `${state}: ${target} has no rendered element (required)`;
		const label = `${state}: ${target} #${index}`;
		return reason === "size"
			? `${label} is ${width}×${height} px, below ${minimum}`
			: `${label} is covered by another element at its centre`;
	});
	lines.push(`Mobile touch targets: ${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
	return { lines, exitCode: problems.length ? 1 : 0 };
}
