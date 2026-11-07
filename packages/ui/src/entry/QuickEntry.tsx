import * as React from "react";
import { copy, expandShortcuts, getFileTitle, type QuickFilter } from "@tasks-calendar-wrapper/core";
import * as Icons from "../icons";
import { QuickEntryHandlerContext, useHost } from "../contexts";
import { MultiSelect } from "./MultiSelect";

type QuickEntryProps = {
	readonly applied?: QuickFilter;
	readonly taskFiles: readonly string[];
};
type QuickEntryState = {
	gen: number;
	draft: { from: string; to: string; priorities: readonly string[] };
};

function draftOf(applied?: QuickFilter): QuickEntryState["draft"] {
	return { from: applied?.from ?? "", to: applied?.to ?? "", priorities: [...(applied?.priorities ?? [])] };
}

export function QuickEntry({ applied, taskFiles }: QuickEntryProps) {
	const host = useHost();
	const callback = React.useContext(QuickEntryHandlerContext);
	const textInput = React.useRef<HTMLInputElement>(null);
	const fileSelect = React.useRef<HTMLSelectElement>(null);
	const okButton = React.useRef<HTMLButtonElement>(null);
	const appendPending = React.useRef(false);
	const [action, setAction] = React.useState(() => (applied ? "filter" : "append"));
	const [filters, setFilters] = React.useState(() => [
		...(applied?.from || applied?.to ? ["date"] : []),
		...(applied?.priorities.length ? ["priority"] : []),
	]);
	/** A newly applied filter replaces the draft; a reload keeps the filter's identity and the edits in progress. */
	const [draftState, setDraftState] = React.useState(() => ({ gen: 0, draft: draftOf(applied) }));
	const committed = React.useRef({ applied, gen: 0 });
	const gen = applied === committed.current.applied ? committed.current.gen : committed.current.gen + 1;
	const draft = draftState.gen === gen ? draftState.draft : draftOf(applied);
	React.useLayoutEffect(() => {
		committed.current = { applied, gen };
	});
	const [focused, setFocused] = React.useState(false);

	function onQuickEntryFileSelectChange() {
		if (!fileSelect.current) return;
		textInput.current?.focus();
	}

	function onQuickEntryNewTaskKeyUp(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key !== "Enter") return;
		okButton.current?.click();
	}

	function onQuickEntryNewTaskInput() {
		const input = textInput.current;
		if (!input) return;
		const expanded = expandShortcuts(input.value, host.now());
		// The input is left alone when there was nothing to replace.
		if (expanded !== input.value) input.value = expanded;
		input.focus();
	}

	function onQuickEntryPanelFocus() {
		setFocused(true);
	}

	function onQuickEntryPanelBlur() {
		setFocused(false);
	}

	const filterNames = ["+", "date", "priority"];
	return (
		<div className={focused ? "quickEntryPanel focus" : "quickEntryPanel"}>
			<div className="left">
				<div className="actionSelect">
					<select
						name="Action"
						className="actionName"
						value={action}
						onChange={(event) => {
							setAction(event.target.value);
							if (textInput.current) textInput.current.value = "";
						}}
					>
						<option value={"append"} key={1}>
							{copy.quickEntry.newTask}
						</option>
						<option value={"filter"} key={2}>
							{copy.quickEntry.filter}
						</option>
					</select>
					{action === "append" ? (
						<select
							name="File name"
							className="fileSelect"
							ref={fileSelect}
							aria-label={copy.quickEntry.selectNoteAria}
							onChange={onQuickEntryFileSelectChange}
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
							selected={filters}
							fallbackValueIndex={0}
							selectChangeHandler={(res) => {
								setFilters(res);
							}}
							visual={copy.quickEntry.filterVisual}
						/>
					)}
				</div>

				<div className="left">
					{action === "append" ? (
						<input
							className="newTask"
							type="text"
							placeholder={copy.quickEntry.placeholder}
							ref={textInput}
							onInput={onQuickEntryNewTaskInput}
							onKeyUp={onQuickEntryNewTaskKeyUp}
							onFocus={onQuickEntryPanelFocus}
							onBlur={onQuickEntryPanelBlur}
						/>
					) : (
						<div className="left">
							{filters.map((f, i) => {
								if (f === "date") {
									return (
										<div key={i} className="dateFilter">
											<a key={0}>{copy.quickEntry.from}</a>
											<input
												key={1}
												type="date"
												value={draft.from}
												onChange={(e) => {
													const from = e.target.value;
													setDraftState((s) => ({
														gen,
														draft: {
															...(s.gen === gen ? s.draft : draftOf(applied)),
															from,
														},
													}));
												}}
											/>
											<a key={2}>{copy.quickEntry.to}</a>
											<input
												key={3}
												type="date"
												value={draft.to}
												onChange={(e) => {
													const to = e.target.value;
													setDraftState((s) => ({
														gen,
														draft: { ...(s.gen === gen ? s.draft : draftOf(applied)), to },
													}));
												}}
											/>
										</div>
									);
								} else if (f === "priority") {
									return (
										<div key={i} className="actionSelect">
											<a>{copy.quickEntry.priorities}</a>
											<MultiSelect
												key={1}
												name="priorityFilter"
												className=""
												options={["+", "1", "2", "3", "4"]}
												selected={draft.priorities}
												visual={copy.quickEntry.priorityVisual}
												fallbackValueIndex={0}
												selectChangeHandler={(res) => {
													setDraftState((s) => ({
														gen,
														draft: {
															...(s.gen === gen ? s.draft : draftOf(applied)),
															priorities: res,
														},
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
				<button
					className="ok"
					ref={okButton}
					aria-label={copy.quickEntry.appendTaskAria}
					onClick={() => {
						if (action === "append") {
							if (appendPending.current) return;
							// Read the selected note from the DOM, including its initial default value.
							const filePath = fileSelect.current?.value;
							const newTask = textInput.current?.value;
							if (!newTask || !filePath) return;
							if (newTask.length > 1) {
								appendPending.current = true;
								void callback.handleCreateNewTask(filePath, newTask).then(
									(added) => {
										appendPending.current = false;
										if (added && textInput.current) textInput.current.value = "";
									},
									(error: unknown) => {
										appendPending.current = false;
										throw error;
									},
								);
							} else {
								textInput.current?.focus();
							}
						} else {
							callback.handleFilterEnable(
								draft.from,
								draft.to,
								[...draft.priorities],
								[...(applied?.tags ?? [])],
							);
						}
					}}
				>
					{Icons.buttonIcon}
				</button>
			</div>
		</div>
	);
}
