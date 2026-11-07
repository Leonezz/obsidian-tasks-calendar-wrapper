import * as React from "react";
import {
	HostContext,
	QuickEntryHandlerContext,
	TaskItemEventHandlersContext,
	Timeline,
	recordProvider,
	useStore,
} from "@tasks-calendar-wrapper/ui";
import type { TimelineState } from "../../src/state/timeline";
import {
	createBridgeActions,
	listChanged,
	listUpdate,
	type BridgeActions,
	type BridgeProps,
	type BridgeState,
	type BridgeUpdate,
} from "./bridgeactions";

const selectOptions = (state: TimelineState) => state.options;
type ListState = Omit<BridgeState, "userOptions">;
export type MountedBridgeHandle = BridgeActions & { readonly state: BridgeState };

export function ObsidianBridge(
	props: BridgeProps & { readonly handleRef?: React.MutableRefObject<MountedBridgeHandle | null> },
) {
	const userOptions = useStore(props.store, selectOptions);
	const seen = React.useRef<TimelineState>();
	const [state, dispatch] = React.useReducer(
		(state: ListState, update: BridgeUpdate): ListState => {
			const partial = typeof update === "function" ? update({ ...state, userOptions }) : update;
			const { tasks, reloadId, quickFilter } = { ...state, ...partial };
			return { tasks, reloadId, quickFilter };
		},
		props.store,
		(store): ListState => {
			const snapshot = store.getSnapshot();
			seen.current = snapshot;
			return { tasks: snapshot.tasks, reloadId: snapshot.reloadId };
		},
	);
	const renderedState = React.useRef<BridgeState>({ ...state, userOptions });
	renderedState.current = { ...state, userOptions };
	const [actions] = React.useState(() => createBridgeActions(props, () => renderedState.current, dispatch));
	const committed = React.useRef<{ reloadId?: number }>();

	/**
	 * After the view's state changed. New options and a changed list render again. A writer recheck also hands over
	 * the latest source lines when the visible list stays equal. Ordinary reloads keep the previous tasks until the
	 * list changes or quick entry brings them along. Reloads and option changes keep the quick filter.
	 */
	React.useLayoutEffect(() => {
		const onStateChanged = () => {
			const next = props.store.getSnapshot();
			const before = seen.current!;
			seen.current = next;
			if (listChanged(before, next)) React.startTransition(() => dispatch(listUpdate(props.store)));
		};
		const unsubscribe = props.store.subscribe(onStateChanged);
		// A change between reading the state and subscribing would not be heard of otherwise.
		onStateChanged();
		return unsubscribe;
	}, [props.store]);

	React.useLayoutEffect(() => {
		const id = state.reloadId;
		const previous = committed.current;
		committed.current = { reloadId: id };
		if (!previous) props.onListCommitted?.(id ?? 0);
		else if (id !== undefined && id !== previous.reloadId) props.onListCommitted?.(id);
	}, [state.reloadId]);

	React.useLayoutEffect(() => {
		const handleRef = props.handleRef;
		if (!handleRef) return;
		handleRef.current = {
			get state() {
				return renderedState.current;
			},
			...actions,
		};
		return () => {
			handleRef.current = null;
		};
	}, [actions, props.handleRef]);

	return bridgeTree(props, renderedState.current, actions);
}

export function bridgeTree(props: BridgeProps, state: BridgeState, actions: BridgeActions): React.ReactNode {
	const { tasks, userOptions } = state;
	const quickEntryHandlers = actions.getQuickEntryHandlers();
	process.env.NODE_ENV !== "production" && recordProvider("QuickEntryHandlerContext", quickEntryHandlers);
	return (
		<HostContext.Provider value={props.host}>
			<QuickEntryHandlerContext.Provider value={quickEntryHandlers}>
				<TaskItemEventHandlersContext.Provider value={actions.getTaskItemHandlers()}>
					<Timeline
						userOptions={userOptions}
						tasks={tasks}
						pendingWrites={props.pendingWrites}
						quickFilter={state.quickFilter}
						queryEnv={(now) => actions.queryEnvFor(now, tasks, userOptions)}
					/>
				</TaskItemEventHandlersContext.Provider>
			</QuickEntryHandlerContext.Provider>
		</HostContext.Provider>
	);
}
