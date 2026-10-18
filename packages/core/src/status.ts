/** The statuses the timeline gives a task, and the checkbox markers that set one directly. */

export const TaskStatus = {
	due: "due", // to-do type
	scheduled: "scheduled", // to-do type
	start: "start", // to-do type
	done: "done",
	unplanned: "unplanned",
	overdue: "overdue",
	process: "process", // to-do type
	cancelled: "cancelled",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskStatusMarkerMap = {
	">": TaskStatus.overdue,
	"<": TaskStatus.scheduled,
	x: TaskStatus.done,
	"/": TaskStatus.process,
	"-": TaskStatus.cancelled,
};
