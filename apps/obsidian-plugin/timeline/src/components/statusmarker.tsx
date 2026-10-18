import * as React from "react";
import * as Icons from "./asserts/icons";

const defaultStripWithIconProps = {
	status: "task",
	marker: " ",
	useBuiltinStyle: true,
	onToggle: () => {},
};

type StripWithIconProps = Readonly<typeof defaultStripWithIconProps>;

/**
 * The checkbox is controlled by the task's marker. With only an initial value, a checkbox that was
 * clicked once kept its state when the row was reused for another task, so an open task could
 * show up ticked, see issue #138. It also has no element id: every row used the same one, so a
 * click on any icon toggled the first checkbox on the page.
 */
export class StripWithIcon extends React.Component<StripWithIconProps> {
	render(): React.ReactNode {
		return (
			<div className="timeline">
				<input
					type="checkbox"
					className={this.props.useBuiltinStyle ? "icon" : ""}
					data-task={this.props.marker}
					checked={this.props.marker !== " "}
					onChange={() => {
						if (!this.props.useBuiltinStyle) this.props.onToggle();
					}}
				></input>
				{this.props.useBuiltinStyle && (
					<label
						className="icon"
						onClick={() => {
							if (this.props.useBuiltinStyle) this.props.onToggle();
						}}
					>
						{Icons.getTaskStatusIcon(this.props.status)}
					</label>
				)}
			</div>
		);
	}
}
