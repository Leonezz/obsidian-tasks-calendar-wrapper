import { moment } from "../../../utils/moment";
import * as React from "react";
import {
	expandShortcuts,
	getFileTitle,
	type DayGroup,
	type QuickFilter,
	type ResolvedTask,
	type TaskRowModel,
} from "@tasks-calendar-wrapper/core";
import * as Icons from "./asserts/icons";
import { QuickEntryHandlerContext, TodayFocusEventHandlersContext } from "./context";
import { recordRender } from "./renderprobe";
import { TaskItemView } from "./taskitemview";

export type EntryProps = {
	readonly counters: readonly CounterProps[];
	readonly taskFiles: readonly string[];
};

type DateViewProps = {
	readonly day: DayGroup;
	/** The day's year in the locale's digits. */
	readonly yearLabel: string;
	readonly entry?: EntryProps;
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

/**
 * A day of the timeline, as core arranged it: the entry panel when the entry sits on it, then its heading and its
 * rows when it lists any. The statuses it lists before the counter filter go on its data-types, as before.
 */
export class DateView extends React.Component<DateViewProps> {
	shouldComponentUpdate(next: DateViewProps): boolean {
		const { day } = this.props;
		return (
			next.yearLabel !== this.props.yearLabel ||
			next.modelFor !== this.props.modelFor ||
			next.entry !== this.props.entry ||
			next.day.key !== day.key ||
			next.day.label !== day.label ||
			next.day.isToday !== day.isToday ||
			next.day.isEntry !== day.isEntry ||
			next.day.dated !== day.dated ||
			next.day.statuses.length !== day.statuses.length ||
			next.day.statuses.some((status, index) => status !== day.statuses[index]) ||
			next.day.tasks.length !== day.tasks.length ||
			next.day.tasks.some((task, index) => task !== day.tasks[index])
		);
	}

	render(): React.ReactNode {
		// Counted for the tests only; the production build drops the call and the probe.
		process.env.NODE_ENV !== "production" && recordRender("DateView", this.props.day.key);
		const { day, yearLabel, entry, modelFor } = this.props;
		const className = day.isToday ? "details today" : "details";
		const types = day.statuses.join(" ");
		return (
			<div>
				{entry && <TodayFocus visual={"Focus On Today"} />}
				{entry && <Counters counters={entry.counters} />}
				{entry && (
					<QuickEntryHandlerContext.Consumer>
						{({ quickFilter }) => <QuickEntry applied={quickFilter} taskFiles={entry.taskFiles} />}
					</QuickEntryHandlerContext.Consumer>
				)}
				{day.tasks.length > 0 && (
					<div className={className} data-year={yearLabel} data-types={types}>
						<DateHeader thisDate={day.label} />
						<div className={className} data-year={yearLabel} data-types={types}>
							<NormalDateContent tasks={day.tasks} modelFor={modelFor} />
						</div>
					</div>
				)}
			</div>
		);
	}
}

type DateHeaderProps = {
	thisDate: string;
};
class DateHeader extends React.Component<DateHeaderProps> {
	render(): React.ReactNode {
		return (
			<div className="dateLine">
				<div className="date">{this.props.thisDate}</div>
				<div className="weekday"></div>
			</div>
		);
	}
}

type NormalDateContentProps = {
	readonly tasks: readonly ResolvedTask[];
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

class NormalDateContent extends React.Component<NormalDateContentProps> {
	render(): React.ReactNode {
		return (
			<div className="content">
				{/* Keyed by the task's place in the vault, so a row is never reused for another task, see issue #138. */}
				{this.props.tasks.map((resolved) => (
					<TaskItemView key={resolved.task.id} model={this.props.modelFor(resolved)} />
				))}
			</div>
		);
	}
}

type QuickEntryProps = {
	readonly applied?: QuickFilter;
	readonly taskFiles: readonly string[];
};
const defaultQuickEntryState = {
	selectedFile: "" as string,
	action: "append" as string,
	filters: [] as string[],
	draft: { from: "", to: "", priorities: [] as readonly string[] },
	applied: undefined as QuickFilter | undefined,
};
type QuickEntryState = typeof defaultQuickEntryState;

function draftOf(applied?: QuickFilter): QuickEntryState["draft"] {
	return { from: applied?.from ?? "", to: applied?.to ?? "", priorities: [...(applied?.priorities ?? [])] };
}

class QuickEntry extends React.Component<QuickEntryProps, QuickEntryState> {
	private textInput;
	private fileSecect;
	private okButton;
	private quickEntryPanel;
	private appendPending = false;
	constructor(props: QuickEntryProps) {
		super(props);

		this.onQuickEntryFileSelectChange = this.onQuickEntryFileSelectChange.bind(this);
		this.onQuickEntryNewTaskInput = this.onQuickEntryNewTaskInput.bind(this);
		this.onQuickEntryNewTaskKeyUp = this.onQuickEntryNewTaskKeyUp.bind(this);
		this.onQuickEntryPanelBlur = this.onQuickEntryPanelBlur.bind(this);
		this.onQuickEntryPanelFocus = this.onQuickEntryPanelFocus.bind(this);

		this.textInput = React.createRef<HTMLInputElement>();
		this.fileSecect = React.createRef<HTMLSelectElement>();
		this.okButton = React.createRef<HTMLButtonElement>();
		this.quickEntryPanel = React.createRef<HTMLDivElement>();

		this.state = {
			selectedFile: "Inbox.md",
			action: props.applied ? "filter" : "append",
			filters: [
				...(props.applied?.from || props.applied?.to ? ["date"] : []),
				...(props.applied?.priorities.length ? ["priority"] : []),
			],
			draft: draftOf(props.applied),
			applied: props.applied,
		};
	}

	/** A newly applied filter replaces the draft; a reload keeps the filter's identity and the edits in progress. */
	static getDerivedStateFromProps(
		props: QuickEntryProps,
		state: QuickEntryState,
	): Pick<QuickEntryState, "draft" | "applied"> | null {
		if (props.applied === state.applied) return null;
		return { draft: draftOf(props.applied), applied: props.applied };
	}

	onQuickEntryFileSelectChange() {
		if (!this.fileSecect.current) return;
		this.setState({
			selectedFile: this.fileSecect.current?.value,
		});
		this.textInput.current?.focus();
	}

	onQuickEntryNewTaskKeyUp(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key !== "Enter") return;
		this.okButton.current?.click();
	}

	onQuickEntryNewTaskInput() {
		const input = this.textInput.current;
		if (!input) return;
		const expanded = expandShortcuts(input.value, moment());
		// The input is left alone when there was nothing to replace.
		if (expanded !== input.value) input.value = expanded;
		input.focus();
	}

	onQuickEntryPanelFocus() {
		this.quickEntryPanel.current?.addClass("focus");
	}

	onQuickEntryPanelBlur() {
		this.quickEntryPanel.current?.removeClass("focus");
	}

	render(): React.ReactNode {
		const filterNames = ["+", "date", "priority"];
		const { taskFiles } = this.props;
		return (
			<div className="quickEntryPanel" ref={this.quickEntryPanel}>
				<div className="left">
					<div className="actionSelect">
						<select
							name="Action"
							className="actionName"
							value={this.state.action}
							onChange={(event) => {
								this.setState({ action: event.target.value });
								if (this.textInput.current) this.textInput.current.value = "";
							}}
						>
							<option value={"append"} key={1}>
								New Task
							</option>
							<option value={"filter"} key={2}>
								Filter
							</option>
						</select>
						{this.state.action === "append" ? (
							<select
								name="File name"
								className="fileSelect"
								ref={this.fileSecect}
								aria-label="Select a note to add a new task to"
								onChange={this.onQuickEntryFileSelectChange}
								defaultValue={taskFiles[0]}
							>
								{[...taskFiles].map((f, i) => {
									const secondParentFolder = !f.split("/")[f.split("/").length - 3] ? "" : "… / ";
									const parentFolder = !f.split("/")[f.split("/").length - 2]
										? ""
										: secondParentFolder + "📂 " + f.split("/")[f.split("/").length - 2] + " / ";
									const filePath = parentFolder + "📄 " + getFileTitle(f);
									return (
										<option style={{ whiteSpace: "nowrap" }} value={f} title={f} key={i}>
											{filePath}
										</option>
									);
								})}
							</select>
						) : (
							<MultiSelect
								key={0}
								name="Filter Type"
								className="filterSelector"
								options={filterNames}
								selected={this.state.filters}
								fallbackValueIndex={0}
								selectChangeHandler={(res) => {
									this.setState({ filters: res });
								}}
								visual={["➕", "📆 date", "⏫ priority"]}
							/>
						)}
					</div>

					<div className="left">
						{this.state.action === "append" ? (
							<input
								className="newTask"
								type="text"
								placeholder="Enter your tasks here"
								ref={this.textInput}
								onInput={this.onQuickEntryNewTaskInput}
								onKeyUp={this.onQuickEntryNewTaskKeyUp}
								onFocus={this.onQuickEntryPanelFocus}
								onBlur={this.onQuickEntryPanelBlur}
							/>
						) : (
							<div className="left">
								{this.state.filters.map((f, i) => {
									if (f === "date") {
										return (
											<div key={i} className="dateFilter">
												<a key={0}>From: </a>
												<input
													key={1}
													type="date"
													value={this.state.draft.from}
													onChange={(e) => {
														const from = e.target.value;
														this.setState((state) => ({ draft: { ...state.draft, from } }));
													}}
												/>
												<a key={2}>{"  To: "}</a>
												<input
													key={3}
													type="date"
													value={this.state.draft.to}
													onChange={(e) => {
														const to = e.target.value;
														this.setState((state) => ({ draft: { ...state.draft, to } }));
													}}
												/>
											</div>
										);
									} else if (f === "priority") {
										return (
											<div key={i} className="actionSelect">
												<a>Priorities: </a>
												<MultiSelect
													key={1}
													name="priorityFilter"
													className=""
													options={["+", "1", "2", "3", "4"]}
													selected={this.state.draft.priorities}
													visual={["➕", "High", "Medium", "None", "Low"]}
													fallbackValueIndex={0}
													selectChangeHandler={(res) => {
														this.setState((state) => ({
															draft: { ...state.draft, priorities: res },
														}));
													}}
												/>
											</div>
										);
									}
									return <div key={i} />;
								})}
							</div>
						)}
					</div>
				</div>

				<div className="right">
					<QuickEntryHandlerContext.Consumer>
						{(callback) => (
							<button
								className="ok"
								ref={this.okButton}
								aria-label="Append new task to selected note"
								onClick={() => {
									if (this.state.action === "append") {
										if (this.appendPending) return;
										// there is an issue with this.state.selectedFile:
										// the value is not setted when initialize.
										// using this.fileSecect.current?.value for emergency.
										const filePath = this.fileSecect.current?.value; // this.state.selectedFile;
										const newTask = this.textInput.current?.value;
										if (!newTask || !filePath) return;
										if (newTask.length > 1) {
											this.appendPending = true;
											void callback.handleCreateNewTask(filePath, newTask).then(
												(added) => {
													this.appendPending = false;
													if (added && this.textInput.current)
														this.textInput.current.value = "";
												},
												(error: unknown) => {
													this.appendPending = false;
													throw error;
												},
											);
										} else {
											this.textInput.current?.focus();
										}
									} else {
										callback.handleFilterEnable(this.state.draft.from, this.state.draft.to, [
											...this.state.draft.priorities,
										]);
									}
								}}
							>
								{Icons.buttonIcon}
							</button>
						)}
					</QuickEntryHandlerContext.Consumer>
				</div>
			</div>
		);
	}
}

const multiSelectProps = {
	name: "" as string,
	className: "" as string,
	options: [] as string[],
	selected: [] as readonly string[],
	visual: [] as string[],
	selectChangeHandler: {} as (options: string[]) => void,
	fallbackValueIndex: 0 as number,
};
type MultiSelectProps = typeof multiSelectProps;
class MultiSelect extends React.Component<MultiSelectProps> {
	private selectElem;
	constructor(props: MultiSelectProps) {
		super(props);
		this.selectElem = React.createRef<HTMLSelectElement>();
	}
	render(): React.ReactNode {
		return (
			<div className="left MultiSelect">
				<select
					name={this.props.name}
					className={this.props.className}
					ref={this.selectElem}
					onClick={() => {
						if (this.selectElem.current !== null)
							this.selectElem.current.selectedIndex = this.props.fallbackValueIndex;
					}}
					onChange={(e) => {
						const idx = e.target.selectedIndex;
						if (idx === this.props.fallbackValueIndex) return;
						const value = this.props.options[idx];
						const selected = this.props.selected;
						const results = selected.includes(value)
							? selected.filter((result) => result !== value)
							: [...selected, value];
						this.props.selectChangeHandler(results);
					}}
				>
					{this.props.options
						//.filter((_, i) => i !== this.props.fallbackValueIndex)
						.map((n, i) => (
							<option value={n} key={i}>
								{this.props.visual[i] + (this.props.selected.includes(n) ? "🎯" : " ")}
							</option>
						))}
				</select>
				{this.props.selected.map((f) => (
					<a key={f}>{this.props.visual[this.props.options.indexOf(f)] + "🎯"}</a>
				))}
			</div>
		);
	}
}

const defaultTodayFocusProps = {
	visual: "Today" as string,
};
type TodayFocusProps = Readonly<typeof defaultTodayFocusProps>;
class TodayFocus extends React.Component<TodayFocusProps> {
	render(): React.ReactNode {
		return (
			<TodayFocusEventHandlersContext.Consumer>
				{(callback) => (
					<div className="todayHeader" aria-label="Focus today" onClick={callback.handleTodayFocusClick}>
						{this.props.visual}
					</div>
				)}
			</TodayFocusEventHandlersContext.Consumer>
		);
	}
}

type CountersProps = { readonly counters: readonly CounterProps[] };

class Counters extends React.Component<CountersProps> {
	render(): React.ReactNode {
		return (
			<div className="counters">
				{this.props.counters.map((c, i) => (
					<CounterItem
						onClick={c.onClick}
						cnt={c.cnt}
						id={c.id}
						label={c.label}
						ariaLabel={c.ariaLabel}
						key={i}
					/>
				))}
			</div>
		);
	}
}

const defaultCounterProps = {
	onClick: () => {},
	cnt: 0,
	id: "",
	label: "",
	ariaLabel: "",
};

export type CounterProps = Readonly<typeof defaultCounterProps>;

class CounterItem extends React.Component<CounterProps> {
	render(): React.ReactNode {
		return (
			<div className="counter" id={this.props.id} aria-label={this.props.ariaLabel} onClick={this.props.onClick}>
				<div className="count">{this.props.cnt}</div>
				<div className="label">{this.props.label}</div>
			</div>
		);
	}
}
