/** Mobile screenshot contracts; behavior is implemented after the red tests. */
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
	throw new Error("not implemented");
}

export function collectTouchTargets({ container, targets }) {
	throw new Error("not implemented");
}

export function touchTargetProblems(stateName, measurements, minimum = 44) {
	throw new Error("not implemented");
}

export function formatTouchTargetReport(problems, minimum = 44) {
	throw new Error("not implemented");
}
