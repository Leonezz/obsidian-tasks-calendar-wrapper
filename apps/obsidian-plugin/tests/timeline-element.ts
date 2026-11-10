import { createElement, useRef } from "react";
import { HostContext, Timeline, type TimelineProps } from "@tasks-calendar-wrapper/ui";
import { createResolveEnv } from "../src/state/resolveenv";
import { createViewState, onLoadViewState, type ViewStateHandle } from "../src/state/viewstate";
import { testHost } from "./stubs/host";

type TimelineElementProps = Omit<TimelineProps, "queryEnv" | "viewState" | "viewActions"> &
	Partial<Pick<TimelineProps, "queryEnv" | "viewState" | "viewActions">>;

function TimelineWithEnv(props: TimelineElementProps) {
	const ref = useRef<ReturnType<typeof createResolveEnv>>();
	const resolveEnv = (ref.current ??= createResolveEnv());
	const stateRef = useRef<ViewStateHandle>();
	const viewState = (stateRef.current ??= createViewState(onLoadViewState(props.userOptions)));
	return createElement(Timeline, {
		...props,
		viewState: props.viewState ?? viewState.store,
		viewActions: props.viewActions ?? viewState.actions,
		queryEnv: props.queryEnv ?? ((now) => ({ ...resolveEnv(now), prepared: undefined })),
	});
}

/** Renders the function timeline with the same props and test host, without exposing an instance. */
export function timelineElement(props: TimelineElementProps) {
	return createElement(HostContext.Provider, { value: testHost }, createElement(TimelineWithEnv, props));
}
