import * as React from "react";
import { copy } from "@tasks-calendar-wrapper/core";
import { TodayFocusEventHandlersContext } from "../contexts";

export function TodayFocus({ visual }: { readonly visual: string }) {
	const callback = React.useContext(TodayFocusEventHandlersContext);
	return (
		<div
			className="todayHeader"
			aria-label={copy.timeline.focusOnTodayAria}
			role="button"
			tabIndex={0}
			onClick={callback.handleTodayFocusClick}
			onKeyDown={(evt) => {
				if (evt.key !== "Enter" && evt.key !== " ") return;
				evt.preventDefault();
				callback.handleTodayFocusClick();
			}}
		>
			{visual}
		</div>
	);
}
