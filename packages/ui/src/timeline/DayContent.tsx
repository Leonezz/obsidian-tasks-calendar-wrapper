import type { ResolvedTask, TaskRowModel } from "@tasks-calendar-wrapper/core";
import { RowDayKeyContext } from "../contexts";
import { TaskItem } from "../row/TaskItem";

type DayContentProps = {
	readonly dayKey: string;
	readonly tasks: readonly ResolvedTask[];
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

export function DayContent({ dayKey, tasks, modelFor }: DayContentProps) {
	return (
		<RowDayKeyContext.Provider value={dayKey}>
			<div className="content" role="list">
				{/* Keyed by the task's place in the vault, so a row is never reused for another task, see issue #138. */}
				{tasks.map((resolved) => (
					<TaskItem key={resolved.task.id} model={modelFor(resolved)} />
				))}
			</div>
		</RowDayKeyContext.Provider>
	);
}
