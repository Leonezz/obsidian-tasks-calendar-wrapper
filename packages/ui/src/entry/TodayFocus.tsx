import * as React from "react";
import { TodayFocusEventHandlersContext } from "../contexts";

export function TodayFocus({ visual }: { readonly visual: string }) {
	const callback = React.useContext(TodayFocusEventHandlersContext);
	return (
		<div className="todayHeader" aria-label="Focus today" onClick={callback.handleTodayFocusClick}>
			{visual}
		</div>
	);
}
