import * as React from "react";
import {
	copy,
	createStore,
	expandShortcuts,
	getFileTitle,
	setTaskDate,
	TasksPrioritySymbolToLabel,
	type MomentFactory,
	type NewDateStyle,
	type QuickFilter,
	type Store,
} from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext, useHost } from "../contexts";
import { useStore } from "../hooks/useStore";

export type QuickEntryDraft = {
	readonly text: string;
	readonly filePath: string;
	readonly due: string;
	readonly priority: string;
	readonly pending: boolean;
	readonly error: string;
	readonly savedTo: string;
};

/** The view owns this store, outside the keyed years/days which filters can remount. */
export function createQuickEntryDraft(): Store<QuickEntryDraft> {
	return createStore<QuickEntryDraft>({
		text: "",
		filePath: "",
		due: "",
		priority: "",
		pending: false,
		error: "",
		savedTo: "",
	});
}

type QuickEntryProps = {
	readonly applied?: QuickFilter;
	readonly taskFiles: readonly string[];
	readonly defaultFile?: string;
	readonly draft?: Store<QuickEntryDraft>;
	readonly newDateStyle?: NewDateStyle;
};

const priorityNames = ["Highest", "High", "Medium", "No", "Low", "Lowest"];
const priorityText = (name: string) => (name === "No" ? copy.quickEntry.none : name);

/** Changes one visible priority, retaining comments, field style and a trailing block ID. */
function withPriority(text: string, priority: string, newDateStyle: NewDateStyle): string | undefined {
	if (!priority) return text;
	const visible = text.replace(/%%[\s\S]*?%%/g, (comment) => "\0".repeat(comment.length));
	const emoji = [...visible.matchAll(/[🔺⏫🔼🔽⏬]\uFE0F?/gu)];
	const fields = [...visible.matchAll(/(\[+)\s*priority\s*::[^\]]*\]/gu)];
	if (emoji.length + fields.length > 1 || /\(\s*priority\s*::[^)]*\)/u.test(visible)) return undefined;
	const symbol = Object.entries(TasksPrioritySymbolToLabel).find(([, label]) => label === priority)?.[0];
	if (symbol === undefined) return undefined;
	if (emoji[0]) {
		const at = emoji[0].index!;
		return text.slice(0, at) + symbol + text.slice(at + emoji[0][0].length);
	}
	if (fields[0]) {
		const field = fields[0];
		const at = field.index!;
		let end = at + field[0].length;
		for (let extra = 1; extra < field[1].length && text[end] === "]"; extra++) end++;
		return (
			text.slice(0, at) +
			`${"[".repeat(field[1].length)}priority:: ${priority === "No" ? "none" : priority.toLowerCase()}${"]".repeat(field[1].length)}` +
			text.slice(end)
		);
	}
	if (priority === "No") return text;
	const existingDataview = /\[+[^[\]]+::/u.test(visible);
	const existingEmoji = /📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌|🔁|🏁|🆔|⛔/u.test(visible);
	const dataview = existingDataview || (!existingEmoji && newDateStyle === "dataview");
	const token = dataview ? ` [priority:: ${priority.toLowerCase()}]` : ` ${symbol}`;
	const at = / \^[a-zA-Z0-9-]+\s*$/u.exec(text)?.index ?? text.length;
	return text.slice(0, at) + token + text.slice(at);
}

function taskText(draft: QuickEntryDraft, moment: MomentFactory, newDateStyle: NewDateStyle): string | undefined {
	let text = withPriority(draft.text.trim(), draft.priority, newDateStyle);
	if (text === undefined) return undefined;
	if (draft.due) {
		try {
			const result = setTaskDate(`- [ ] ${text}`, "due", draft.due, { newFieldStyle: newDateStyle, moment });
			if (result.kind === "refused") return undefined;
			if (result.kind === "line") text = result.line.slice(6);
		} catch {
			return undefined;
		}
	}
	return text;
}

export function QuickEntry({ taskFiles, defaultFile, draft: suppliedDraft, newDateStyle = "emoji" }: QuickEntryProps) {
	const host = useHost();
	const callback = React.useContext(QuickEntryHandlerContext);
	const fallback = React.useRef<Store<QuickEntryDraft>>();
	if (!fallback.current) fallback.current = createQuickEntryDraft();
	const store = suppliedDraft ?? fallback.current;
	const draft = useStore(store);
	const textInput = React.useRef<HTMLInputElement>(null);
	const composing = React.useRef(false);
	const [focused, setFocused] = React.useState(false);
	const filePath = taskFiles.includes(draft.filePath)
		? draft.filePath
		: defaultFile && taskFiles.includes(defaultFile)
			? defaultFile
			: (taskFiles[0] ?? "");

	function change(next: Partial<QuickEntryDraft>): void {
		store.setState((current) => ({ ...current, ...next, error: "", savedTo: "" }));
	}
	function changeDue(due: string): void {
		if (store.getSnapshot().due !== due) change({ due });
	}

	async function submit(): Promise<void> {
		const submitted = store.getSnapshot();
		if (submitted.pending || composing.current || !submitted.text.trim() || !filePath) return;
		const content = taskText(submitted, host.moment, newDateStyle);
		if (content === undefined) {
			store.setState((current) => ({ ...current, error: copy.quickEntry.metadataConflict, savedTo: "" }));
			return;
		}
		change({ pending: true });
		try {
			const added = await callback.handleCreateNewTask(filePath, content);
			store.setState((current) => {
				const unchanged =
					current.text === submitted.text &&
					current.filePath === submitted.filePath &&
					current.due === submitted.due &&
					current.priority === submitted.priority;
				return {
					...current,
					pending: false,
					text: added && unchanged ? "" : current.text,
					due: added && unchanged && current.due === submitted.due ? "" : current.due,
					priority: added && unchanged && current.priority === submitted.priority ? "" : current.priority,
					savedTo: added ? getFileTitle(filePath) : "",
				};
			});
		} catch {
			store.setState((current) => ({ ...current, pending: false, error: copy.quickEntry.createFailed }));
		}
	}

	return (
		<div className={focused ? "quickEntryPanel focus" : "quickEntryPanel"}>
			<div className="entryMain">
				<span className="entryPlus" aria-hidden="true">
					{copy.quickEntry.addGlyph}
				</span>
				<input
					className="newTask"
					type="text"
					placeholder={copy.quickEntry.placeholder}
					aria-label={copy.quickEntry.newTask}
					ref={textInput}
					value={draft.text}
					onCompositionStart={() => {
						composing.current = true;
					}}
					onCompositionEnd={() => {
						composing.current = false;
					}}
					onInput={(event) => {
						const input = event.currentTarget;
						const text = composing.current ? input.value : expandShortcuts(input.value, host.now());
						change({ text });
					}}
					onKeyDown={(event) => {
						if (
							event.key !== "Enter" ||
							event.nativeEvent.isComposing ||
							composing.current ||
							event.keyCode === 229
						)
							return;
						event.preventDefault();
						void submit();
					}}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
				/>
				<button
					className="ok"
					type="button"
					aria-label={copy.quickEntry.appendTaskAria}
					disabled={draft.pending || !filePath}
					onClick={() => void submit()}
				>
					{copy.quickEntry.add}
				</button>
			</div>
			<div className="entryMeta">
				<label>
					{copy.quickEntry.saveTo}
					<select
						className="fileSelect"
						aria-label={copy.quickEntry.selectNoteAria}
						value={filePath}
						onChange={(event) => {
							change({ filePath: event.target.value });
							textInput.current?.focus();
						}}
					>
						{taskFiles.map((file) => (
							<option value={file} key={file}>
								{file.replace(/\.md$/i, "")}
							</option>
						))}
					</select>
				</label>
				<label>
					{copy.quickEntry.due}
					<input
						className="taskDue"
						type="date"
						aria-label={copy.quickEntry.dueAria}
						value={draft.due}
						onInput={(event) => changeDue(event.currentTarget.value)}
						onChange={(event) => changeDue(event.currentTarget.value)}
					/>
				</label>
				<label>
					<span className="tcw-sr-only">{copy.quickEntry.priority}</span>
					<select
						className="taskPriority"
						aria-label={copy.quickEntry.taskPriorityAria}
						value={draft.priority}
						onChange={(event) => change({ priority: event.target.value })}
					>
						<option value="">{copy.quickEntry.priority}</option>
						{priorityNames.map((priority) => (
							<option value={priority} key={priority}>
								{priorityText(priority)}
							</option>
						))}
					</select>
				</label>
			</div>
			{draft.error && (
				<div className="entryError" role="alert">
					{draft.error}
				</div>
			)}
			{draft.savedTo && (
				<div className="entryStatus" role="status">
					{copy.quickEntry.addedTo({ note: draft.savedTo })}
				</div>
			)}
		</div>
	);
}
