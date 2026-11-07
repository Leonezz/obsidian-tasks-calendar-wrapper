import * as React from "react";
import type { TaskRowModel } from "@tasks-calendar-wrapper/core";
import { RowWriteContext, TaskItemEventHandlersContext } from "../contexts";
import { recordRender } from "../renderprobe";
import { TaskRow } from "./TaskRow";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** The static markup tests render rows without a DOM, where React warns about layout effects. */
const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

export const TaskItem = React.memo(function TaskItem({ model }: { readonly model: TaskRowModel }) {
	const callbacks = React.useContext(TaskItemEventHandlersContext);
	const { pendingWrites, clock } = React.useContext(RowWriteContext);
	const id = `${model.path}:${model.line}`;
	const subscribe = React.useCallback(
		(listener: () => void) => pendingWrites.subscribe(id, listener),
		[pendingWrites, id],
	);
	const snapshot = React.useCallback(() => pendingWrites.getSnapshot(id), [pendingWrites, id]);
	const overlay = React.useSyncExternalStore(subscribe, snapshot, snapshot);
	const [, forceRender] = React.useReducer((value: number) => value + 1, 0);
	// Subscribe in layout so a row mounted by a transition hears the clear in that commit's layout phase.
	useClientLayoutEffect(() => {
		if (overlay === undefined) return;
		const check = () => {
			if (pendingWrites.getSnapshot(id) !== overlay) forceRender();
		};
		const unsubscribe = pendingWrites.subscribe(id, check);
		check();
		return unsubscribe;
	}, [pendingWrites, id, overlay]);
	const committedModel = React.useRef<TaskRowModel | null>(null);
	// Counted for the tests only; the production build drops the call and the probe.
	process.env.NODE_ENV !== "production" && committedModel.current !== model && recordRender("TaskItemView");
	useClientLayoutEffect(() => {
		committedModel.current = model;
	}, [model]);
	return <TaskRow model={model} callbacks={callbacks} overlay={overlay} clock={clock} />;
});
