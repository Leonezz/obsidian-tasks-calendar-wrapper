import { createElement, useRef } from "react";
import { HostContext } from "@tasks-calendar-wrapper/ui";
import { Timeline, type TimelineProps } from "@tasks-calendar-wrapper/ui/src/timeline/Timeline";
import { createResolveEnv } from "../src/state/resolveenv";
import { testHost } from "./stubs/host";

type TimelineElementProps = Omit<TimelineProps, "queryEnv"> & { queryEnv?: TimelineProps["queryEnv"] };

function TimelineWithEnv(props: TimelineElementProps) {
	const ref = useRef<ReturnType<typeof createResolveEnv>>();
	const resolveEnv = (ref.current ??= createResolveEnv());
	return createElement(Timeline, {
		...props,
		queryEnv: props.queryEnv ?? ((now) => ({ ...resolveEnv(now), prepared: undefined })),
	});
}

/** Renders the function timeline with the same props and test host, without exposing an instance. */
export function timelineElement(props: TimelineElementProps) {
	return createElement(HostContext.Provider, { value: testHost }, createElement(TimelineWithEnv, props));
}
