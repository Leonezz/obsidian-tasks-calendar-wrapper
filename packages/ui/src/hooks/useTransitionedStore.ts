import { startTransition, useLayoutEffect, useRef, useState } from "react";
import type { Store } from "@tasks-calendar-wrapper/core";

/**
 * The task list (tasks, shown, taskRevision, reloadId) arrives in a transition so it does not block urgent updates.
 * React 18 always applies useSyncExternalStore changes synchronously; startTransition cannot defer them.
 * useDeferredValue first renders urgently with the old value, but onListCommitted needs the exact list in the
 * commit's layout phase. Callers pass a stable select for one field or a store-held object; equality is Object.is.
 */
export function useTransitionedStore<S, T>(store: Store<S>, select: (state: S) => T): T {
	const seen = useRef<S>();
	const [state, setState] = useState(() => {
		seen.current = store.getSnapshot();
		return select(seen.current);
	});
	useLayoutEffect(() => {
		const onChange = () => {
			const snapshot = store.getSnapshot();
			if (snapshot === seen.current) return;
			seen.current = snapshot;
			startTransition(() =>
				setState((prev) => {
					const next = select(store.getSnapshot());
					return Object.is(prev, next) ? prev : next;
				}),
			);
		};
		const unsubscribe = store.subscribe(onChange);
		// Close the gap between the initial read and subscribing, as the class bridge does on mount.
		onChange();
		return unsubscribe;
	}, [store, select]);
	return state;
}
