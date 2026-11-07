import type * as React from "react";
import * as Icons from "../icons";

export type StatusMarkerProps = {
	readonly status: string;
	readonly marker: string;
	readonly useBuiltinStyle: boolean;
	readonly onToggle: (evt: React.MouseEvent) => void;
	readonly predicted?: { readonly marker?: string; readonly status?: string };
};

/**
 * The checkbox is controlled by the task's marker. With only an initial value, a checkbox that was
 * clicked once kept its state when the row was reused for another task, so an open task could
 * show up ticked, see issue #138. It also has no element id: every row used the same one, so a
 * click on any icon toggled the first checkbox on the page.
 */
export function StatusMarker(props: StatusMarkerProps) {
	const marker = props.predicted?.marker ?? props.marker;
	const status = props.predicted?.status ?? props.status;
	return (
		<div className="timeline">
			<input
				type="checkbox"
				className={props.useBuiltinStyle ? "icon" : ""}
				data-task={marker}
				checked={marker !== " "}
				onChange={() => {}}
				onClick={(evt) => {
					evt.stopPropagation();
					if (!props.useBuiltinStyle) props.onToggle(evt);
				}}
			></input>
			{props.useBuiltinStyle && (
				<label
					className="icon"
					onClick={(evt) => {
						if (props.useBuiltinStyle) props.onToggle(evt);
					}}
				>
					{Icons.getTaskStatusIcon(status)}
				</label>
			)}
		</div>
	);
}
