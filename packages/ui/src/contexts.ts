import * as React from "react";
import type { UiHost } from "./host";

export const HostContext = React.createContext<UiHost | null>(null);
HostContext.displayName = "HostContext";

/** The app supplies the timeline's host; rendering outside its provider is a wiring error. */
export function useHost(): UiHost {
	const host = React.useContext(HostContext);
	if (host === null) throw new Error("useHost needs a HostContext provider around the timeline");
	return host;
}

export const TodayFocusEventHandlersContext = React.createContext({
	handleTodayFocusClick: () => {},
});
