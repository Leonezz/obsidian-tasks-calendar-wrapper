import * as React from "react";
import { copy } from "@tasks-calendar-wrapper/core";
import { ViewActionsContext } from "../contexts";

export function TodayFocus({ visual }: { readonly visual: string }) {
	const actions = React.useContext(ViewActionsContext);
	return (
		<div
			className="todayHeader"
			aria-label={copy.timeline.focusOnTodayAria}
			role="button"
			tabIndex={0}
			onClick={actions.toggleTodayFocus}
			onKeyDown={(evt) => {
				if (evt.key !== "Enter" && evt.key !== " ") return;
				evt.preventDefault();
				actions.toggleTodayFocus();
			}}
		>
			{visual}
		</div>
	);
}
