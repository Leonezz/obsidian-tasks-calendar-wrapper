import { createStore, type QuickFilter, type Store } from "@tasks-calendar-wrapper/core";
import type { ViewActions, ViewState } from "@tasks-calendar-wrapper/ui";
import isEqual from "underscore/modules/isEqual.js";
import type { UserOption } from "../useroptions";

/** The two controls kept when a timeline moves or closes within a plugin session. */
export interface SavedViewState {
	readonly counter: string;
	readonly todayFocus: boolean;
}

/** Changes to one view, including its unsaved quick filter and session restore. */
export interface ViewStateActions extends ViewActions {
	setQuickFilter(filter: QuickFilter | undefined): void;
	clearQuickFilter(): void;
	restore(saved: SavedViewState): void;
}

/** A view's snapshots and its constant actions. */
export interface ViewStateHandle {
	readonly store: Store<ViewState>;
	readonly actions: ViewStateActions;
}

/** One view's controls; actions replace snapshots only when their values change. */
export function createViewState(initial: SavedViewState): ViewStateHandle {
	const store = createStore<ViewState>({ counter: initial.counter, todayFocus: initial.todayFocus });
	const actions = Object.freeze<ViewStateActions>({
		toggleCounter(id) {
			store.setState((state) => ({
				...state,
				counter: state.counter !== `${id}Filter` ? `${id}Filter` : "",
			}));
		},
		toggleTodayFocus() {
			store.setState((state) => ({ ...state, todayFocus: !state.todayFocus }));
		},
		setQuickFilter(filter) {
			store.setState((state) => (isEqual(state.quickFilter, filter) ? state : { ...state, quickFilter: filter }));
		},
		clearQuickFilter() {
			store.setState((state) => (state.quickFilter === undefined ? state : { ...state, quickFilter: undefined }));
		},
		restore(saved) {
			store.setState((state) =>
				state.counter === saved.counter && state.todayFocus === saved.todayFocus
					? state
					: { ...state, counter: saved.counter, todayFocus: saved.todayFocus },
			);
		},
	});
	return { store, actions };
}

/** On Load values are used as written, including a raw counter string. */
export function onLoadViewState(options: Pick<UserOption, "defaultFilters" | "defaultTodayFocus">): SavedViewState {
	return { counter: options.defaultFilters, todayFocus: options.defaultTodayFocus };
}

/** The last closed timeline, held only for this plugin instance. */
export interface ViewSession {
	readonly id: string;
	lastClosed(): SavedViewState | undefined;
	recordClosed(state: SavedViewState): void;
}

function newSessionId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** A fresh plugin session; tests may supply its id. */
export function createViewSession(id = newSessionId()): ViewSession {
	let closed: SavedViewState | undefined;
	return {
		id,
		lastClosed: () => closed,
		recordClosed(state) {
			closed = Object.freeze({ counter: state.counter, todayFocus: state.todayFocus });
		},
	};
}

/** The leaf's saved state never contains the quick filter. */
export function savedViewState(state: ViewState, session: ViewSession) {
	return { v: 1, session: session.id, counter: state.counter, todayFocus: state.todayFocus };
}

/** Only a valid state from this plugin session can replace a view's controls. */
export function restoredViewState(raw: unknown, session: ViewSession): SavedViewState | undefined {
	if (raw === null || typeof raw !== "object") return undefined;
	const state = raw as Record<string, unknown>;
	if (
		state.v !== 1 ||
		state.session !== session.id ||
		typeof state.counter !== "string" ||
		typeof state.todayFocus !== "boolean"
	)
		return undefined;
	return { counter: state.counter, todayFocus: state.todayFocus };
}
