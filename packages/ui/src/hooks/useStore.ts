import { useMemo, useSyncExternalStore } from "react";
import type { Store } from "@tasks-calendar-wrapper/core";

/** Settings and view state apply as urgent updates, with the current selection on the server. Callers pass stable select and isEqual functions. */
export function useStore<S, T = S>(
	store: Store<S>,
	select?: (state: S) => T,
	isEqual: (a: T, b: T) => boolean = Object.is,
): T {
	const getSelection = useMemo(() => {
		let cached: { snapshot: S; selection: T } | undefined;
		return () => {
			const snapshot = store.getSnapshot();
			if (cached && Object.is(cached.snapshot, snapshot)) return cached.selection;
			const next = select ? select(snapshot) : (snapshot as unknown as T);
			const selection = cached && isEqual(cached.selection, next) ? cached.selection : next;
			cached = { snapshot, selection };
			return selection;
		};
	}, [store, select, isEqual]);
	return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}
