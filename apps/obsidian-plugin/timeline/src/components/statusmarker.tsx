import * as React from "react";
import * as Icons from "./asserts/icons";
import type { PendingWrite } from "../pendingwrites";

const defaultStripWithIconProps = {
	status: "task",
	marker: " ",
	useBuiltinStyle: true,
	onToggle: (evt: React.MouseEvent) => {},
};

type StripWithIconProps = Readonly<typeof defaultStripWithIconProps> & { readonly predicted?: PendingWrite };

/**
 * The checkbox is controlled by the task's marker. With only an initial value, a checkbox that was
 * clicked once kept its state when the row was reused for another task, so an open task could
 * show up ticked, see issue #138. It also has no element id: every row used the same one, so a
 * click on any icon toggled the first checkbox on the page.
 */
export class StripWithIcon extends React.Component<StripWithIconProps> {
	render(): React.ReactNode {
		const marker = this.props.predicted?.marker ?? this.props.marker;
		const status = this.props.predicted?.status ?? this.props.status;
		return (
			<div className="timeline">
				<input
					type="checkbox"
					className={this.props.useBuiltinStyle ? "icon" : ""}
					data-task={marker}
					checked={marker !== " "}
					onChange={() => {}}
					onClick={(evt) => {
						evt.stopPropagation();
						if (!this.props.useBuiltinStyle) this.props.onToggle(evt);
					}}
				></input>
				{this.props.useBuiltinStyle && (
					<label
						className="icon"
						onClick={(evt) => {
							if (this.props.useBuiltinStyle) this.props.onToggle(evt);
						}}
					>
						{Icons.getTaskStatusIcon(status)}
					</label>
				)}
			</div>
		);
	}
}
