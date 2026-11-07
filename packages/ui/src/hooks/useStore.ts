import type { Store } from "@tasks-calendar-wrapper/core";

export function useStore<S, T = S>(store: Store<S>, select?: (state: S) => T, isEqual?: (a: T, b: T) => boolean): T {
	throw new Error("not implemented");
}
