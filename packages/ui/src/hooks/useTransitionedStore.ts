import type { Store } from "@tasks-calendar-wrapper/core";

export function useTransitionedStore<S, T>(store: Store<S>, select: (state: S) => T): T {
	throw new Error("not implemented");
}
