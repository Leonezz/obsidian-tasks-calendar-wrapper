import type { ResolvedTask, TaskRowModel } from "@tasks-calendar-wrapper/core";
import { RowDayKeyContext } from "../contexts";
import { TaskItem } from "../row/TaskItem";
import { WindowGap, type WindowDayPlan } from "./Windowed";

type DayContentProps = {
	readonly dayKey: string;
	readonly tasks: readonly ResolvedTask[];
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
	readonly window?: WindowDayPlan;
};

export function DayContent({ dayKey, tasks, modelFor, window }: DayContentProps) {
	return (
		<RowDayKeyContext.Provider value={dayKey}>
			<div className="content" role="list">
				{/* Keyed by the task's place in the vault, so a row is never reused for another task, see issue #138. */}
				{window
					? window.parts.map((part) =>
							part.kind === "gap" ? (
								<WindowGap key={`gap:${part.start}:${part.end}`} height={part.height} />
							) : (
								<TaskItem key={tasks[part.index].task.id} model={modelFor(tasks[part.index])} />
							),
						)
					: tasks.map((resolved) => <TaskItem key={resolved.task.id} model={modelFor(resolved)} />)}
			</div>
		</RowDayKeyContext.Provider>
	);
}
