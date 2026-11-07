import * as React from "react";
import type { UiHost } from "./host";

export const HostContext = React.createContext<UiHost | null>(null);
HostContext.displayName = "HostContext";

export function useHost(): UiHost {
	throw new Error("not implemented");
}
