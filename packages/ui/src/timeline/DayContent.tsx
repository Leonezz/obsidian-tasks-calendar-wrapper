import type { ResolvedTask, TaskRowModel } from "@tasks-calendar-wrapper/core";
import { TaskItem } from "../row/TaskItem";

type DayContentProps = {
	readonly tasks: readonly ResolvedTask[];
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

export function DayContent({ tasks, modelFor }: DayContentProps) {
	return (
		<div className="content">
			{/* Keyed by the task's place in the vault, so a row is never reused for another task, see issue #138. */}
			{tasks.map((resolved) => (
				<TaskItem key={resolved.task.id} model={modelFor(resolved)} />
			))}
		</div>
	);
}
