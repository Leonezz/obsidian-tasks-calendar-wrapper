import { ItemView, Menu, Notice, normalizePath, Pos, type UserEvent } from "obsidian";
import {
	createStore,
	dayKey,
	normalizeNotePath,
	pickResolveSettings,
	type DateField,
	type DateValue,
	type DayKey,
	type LineTarget,
	type QuickFilter,
	type QueryEnv,
	type Resolved,
	type Store,
	type Task,
	type TaskRowModel,
} from "@tasks-calendar-wrapper/core";
import type { UiHost } from "@tasks-calendar-wrapper/ui";
import isEqual from "underscore/modules/isEqual.js";
import { createResolveEnv } from "../../src/state/resolveenv";
import { initialTimelineState, type TimelineState } from "../../src/state/timeline";
import { UserOption } from "../../src/useroptions";
import { ConfirmModal } from "../../src/confirm-modal";
import { openNoteAt } from "../../src/open-note";
import { sameParseKey } from "../../utils/parsekey";
import { tagSearchUri } from "../../utils/utils";
import { moment } from "../../utils/moment";
import { appendTaskToNote } from "./appendtask";
import { DateModal, type DateAnswer } from "./datemodal";
import { rowMenuItems, showRowMenu } from "./rowmenu";
import { changesInPlace } from "./taskactions";
import { canEditInTasksDialog } from "./tasksplugin";
import { writeFailureText } from "./notices";
import {
	createShiftLedger,
	REFUSAL_NOTICE_MS,
	type ShiftLedger,
	type TaskWriter,
	type WriteResult,
} from "./taskwriter";
import type { PendingWrites } from "./pendingwrites";
import { TagSuggest } from "./tagsuggest";

const defaultObsidianBridgeProps = {
	plugin: {} as ItemView,
	/** The view's state: the bridge renders its options, and the tasks read when the list shown last changed. */
	store: createStore<TimelineState>(initialTimelineState()) as Store<TimelineState>,
};
export type BridgeProps = Readonly<typeof defaultObsidianBridgeProps> & {
	readonly host: UiHost;
	readonly writer: Pick<TaskWriter, "insert" | "write" | "editInTasksDialog" | "refuseIfNotReread">;
	readonly ledger?: ShiftLedger;
	readonly pendingWrites?: PendingWrites;
	readonly onWriteResult?: (target: LineTarget, result: WriteResult) => void;
	/** Receives a quick entry's written path and the promise that resolves when it is indexed. */
	readonly onQuickEntryWritten?: (path: string, indexed: Promise<void>) => void;
	/** Reports the committed reload; zero marks a mount before the first reload. */
	readonly onListCommitted?: (reloadId: number) => void;
	readonly resolveEnv?: ReturnType<typeof createResolveEnv>;
	readonly askDate?: (field: DateField, sourceLine: string) => Promise<DateAnswer>;
};
export interface BridgeState {
	readonly tasks: readonly Task[];
	readonly userOptions: UserOption;
	/** The reload whose tasks this bridge is showing. */
	readonly reloadId?: number;
	/** The quick entry panel's filter, kept until the user clears it or adds a task through the quick entry. */
	readonly quickFilter?: QuickFilter;
}

/**
 * The quick entry panel's filter. The priorities are copied: the panel goes on changing its own list, and the filter
 * is the one the button applied.
 */
export function quickFilterOf(
	from: string | undefined,
	to: string | undefined,
	priorities: readonly string[],
	tags: readonly string[] = [],
): QuickFilter {
	return Object.freeze({
		from,
		to,
		priorities: Object.freeze([...priorities]),
		...(tags.length !== 0 && { tags: Object.freeze([...tags]) }),
	});
}

/** The bridge's state with the tasks of a new list shown, keeping the quick filter. */
export function withNewList(state: BridgeState, tasks: readonly Task[]): BridgeState {
	return { ...state, tasks };
}

export type BridgeUpdate = Partial<BridgeState> | ((state: BridgeState) => Partial<BridgeState>);

export interface BridgeActions {
	onUpdateTasks(): void;
	handleFilterEnable(
		startDate: string | undefined,
		endDate: string | undefined,
		priorities: string[],
		tags?: string[],
	): void;
	handleCreateNewTask(path: string, append: string): Promise<boolean>;
	confirmCreateNote(path: string): Promise<boolean>;
	handleTagClick(tag: string): void;
	handleOpenFile(path: string, position: Pos, evt?: UserEvent): void;
	handleModifyTask(model: TaskRowModel, evt: MouseEvent): Promise<WriteResult | void>;
	handleCompleteTask(model: TaskRowModel, evt: MouseEvent): Promise<WriteResult | void>;
	handleRowMenu(model: TaskRowModel, evt: MouseEvent): void;
	handleDateBadge(model: TaskRowModel, field: DateField): Promise<WriteResult | void>;
	handleSetDate(model: TaskRowModel, field: DateField, day: DayKey | null): Promise<WriteResult | void>;
	getTaskItemHandlers(): TaskItemHandlers;
	suggestTags(input: HTMLInputElement, tags: () => readonly string[], pick: (tag: string) => void): () => void;
	getQuickEntryHandlers(): QuickEntryHandlers;
	queryEnvFor(now: DateValue, tasks: readonly Task[], options: UserOption): { env: QueryEnv; prepared?: Resolved };
}

type TaskItemHandlers = Pick<BridgeActions, "handleOpenFile" | "handleCompleteTask" | "handleTagClick"> & {
	[Key in "handleModifyTask" | "handleRowMenu" | "handleDateBadge"]: BridgeActions[Key] | undefined;
};
type QuickEntryHandlers = Pick<BridgeActions, "handleCreateNewTask" | "handleFilterEnable" | "suggestTags"> &
	Pick<BridgeState, "quickFilter">;

export function listChanged(before: TimelineState, next: TimelineState): boolean {
	return next.shown !== before.shown || next.taskRevision !== before.taskRevision;
}

export function listUpdate(store: Store<TimelineState>): BridgeUpdate {
	// The tasks are read when React applies the change, as the old view's model was, so a reload that ends before
	// then with the same list shown brings its tasks along.
	return (state) => {
		const snap = store.getSnapshot();
		return { ...withNewList(state, snap.tasks), reloadId: snap.reloadId };
	};
}

export function createBridgeActions(
	props: BridgeProps,
	getState: () => BridgeState,
	setState: (update: BridgeUpdate) => void,
): BridgeActions {
	const app = props.plugin.app;
	const ledger = props.ledger ?? createShiftLedger();
	const resolveEnv = props.resolveEnv ?? createResolveEnv();
	let taskItemHandlers: TaskItemHandlers | undefined;
	let quickEntryHandlers: QuickEntryHandlers | undefined;
	const actions: BridgeActions = {
		/** Shows the tasks read last, without the quick filter, as adding a task through the quick entry always did. */
		onUpdateTasks() {
			setState(() => {
				const snap = props.store.getSnapshot();
				return { tasks: snap.tasks, reloadId: snap.reloadId, quickFilter: undefined };
			});
		},

		/** The quick entry panel's filter, which core applies, see QuickFilter. */
		handleFilterEnable(
			startDate: string | undefined,
			endDate: string | undefined,
			priorities: string[],
			tags: string[] = [],
		) {
			const quickFilter =
				!startDate && !endDate && priorities.length === 0 && tags.length === 0
					? undefined
					: quickFilterOf(startDate, endDate, priorities, tags);
			setState((state) => ({
				quickFilter: isEqual(state.quickFilter, quickFilter) ? state.quickFilter : quickFilter,
			}));
		},

		async handleCreateNewTask(path: string, append: string): Promise<boolean> {
			const notePath = normalizePath(normalizeNotePath(path));
			try {
				const added = await appendTaskToNote(
					app.vault,
					{
						insert: async (path, edit) => {
							const result = await props.writer.insert(path, edit);
							props.onWriteResult?.({ path, line: 0, sourceLine: "" }, result);
							if (result.kind === "written") props.onQuickEntryWritten?.(path, result.indexed);
							return result;
						},
					},
					notePath,
					getState().userOptions.sectionForNewTasks,
					"- [ ] " + append,
					actions.confirmCreateNote,
				);
				if (added) actions.onUpdateTasks();
				return added;
			} catch (reason) {
				console.error("Tasks Calendar Wrapper: adding a task failed", reason);
				new Notice(writeFailureText({ path: notePath, line: 0, text: append }, reason), REFUSAL_NOTICE_MS);
				return false;
			}
		},

		confirmCreateNote(path: string): Promise<boolean> {
			return new ConfirmModal(app, {
				title: "Create note",
				message: "No such file: " + path + ". Would you like to create it?",
				confirmText: "Create",
			}).ask();
		},

		/** Searches for the tag through the documented obsidian://search URI, not the private API of the search plugin. */
		handleTagClick(tag: string) {
			window.open(tagSearchUri(app.vault.getName(), tag));
		},

		handleOpenFile(path: string, position: Pos, evt?: UserEvent) {
			openNoteAt(app, path, position.start.line, evt).catch((reason) => {
				console.error("Tasks Calendar Wrapper: opening a note failed", reason);
				new Notice(
					"Could not open " + path + ": " + (reason instanceof Error ? reason.message : String(reason)),
					5000,
				);
			});
		},

		async handleModifyTask(model: TaskRowModel, evt: MouseEvent): Promise<WriteResult | void> {
			const { path, position } = model;
			if (!changesInPlace(getState().userOptions)) {
				actions.handleOpenFile(path, position, evt);
				return;
			}
			let target: LineTarget = model;
			const result = await props.writer.editInTasksDialog(
				() => (target = { path, line: ledger.shift(path, model.line), sourceLine: model.sourceLine }),
			);
			props.onWriteResult?.(target, result);
			return result;
		},

		/** Reads the row's target again when its turn in the note's write queue starts. */
		async handleCompleteTask(model: TaskRowModel, evt: MouseEvent): Promise<WriteResult | void> {
			if (!changesInPlace(getState().userOptions)) {
				actions.handleOpenFile(model.path, model.position, evt);
				return;
			}
			const { path } = model;
			let target: LineTarget = model;
			const result = await props.writer.write(
				() => (target = { path, line: ledger.shift(path, model.line), sourceLine: model.sourceLine }),
				{ kind: "toggle" },
			);
			props.onWriteResult?.(target, result);
			return result;
		},

		/** Opens a menu for the captured row; each item uses the writer's current target checks. */
		handleRowMenu(model: TaskRowModel, evt: MouseEvent): void {
			const items = rowMenuItems(model.sourceLine, {
				changesInPlace: changesInPlace(getState().userOptions),
				moment,
			});
			showRowMenu(Menu, items, evt, (action) => {
				if (action.kind === "pick") return actions.handleDateBadge(model, action.field);
				return actions.handleSetDate(model, action.field, action.kind === "set" ? action.day() : null);
			});
		},

		/** Picks a date for a menu item or badge, refusing stale rows before opening the modal. */
		async handleDateBadge(model: TaskRowModel, field: DateField): Promise<WriteResult | void> {
			if (!changesInPlace(getState().userOptions)) return;
			const { path } = model;
			const target = { path, line: ledger.shift(path, model.line), sourceLine: model.sourceLine };
			const refused = props.writer.refuseIfNotReread(target, "date");
			if (refused) {
				props.onWriteResult?.(target, refused);
				return refused;
			}
			const answer = await (props.askDate
				? props.askDate(field, model.sourceLine)
				: new DateModal(app, field, model.sourceLine).ask());
			if (answer) return actions.handleSetDate(model, field, answer.kind === "day" ? answer.day : null);
		},

		/** Reads the date edit's target again when its turn in the note's write queue starts. */
		async handleSetDate(model: TaskRowModel, field: DateField, day: DayKey | null): Promise<WriteResult | void> {
			if (!changesInPlace(getState().userOptions)) return;
			const { path } = model;
			let target: LineTarget = model;
			const result = await props.writer.write(
				() => (target = { path, line: ledger.shift(path, model.line), sourceLine: model.sourceLine }),
				{ kind: "date", field, day },
			);
			props.onWriteResult?.(target, result);
			return result;
		},

		/**
		 * The same object on every render while the handlers stay the same, so task rows that did not
		 * change can skip rendering (issue #63). Modifying a task needs the Tasks plugin.
		 */
		getTaskItemHandlers(): TaskItemHandlers {
			const handleModifyTask = canEditInTasksDialog(app).kind !== "none" ? actions.handleModifyTask : undefined;
			const handleRowMenu = changesInPlace(getState().userOptions) ? actions.handleRowMenu : undefined;
			const handleDateBadge = changesInPlace(getState().userOptions) ? actions.handleDateBadge : undefined;
			if (
				!taskItemHandlers ||
				taskItemHandlers.handleModifyTask !== handleModifyTask ||
				taskItemHandlers.handleRowMenu !== handleRowMenu ||
				taskItemHandlers.handleDateBadge !== handleDateBadge
			) {
				taskItemHandlers = {
					handleOpenFile: actions.handleOpenFile,
					handleCompleteTask: actions.handleCompleteTask,
					handleTagClick: actions.handleTagClick,
					handleModifyTask,
					handleRowMenu,
					handleDateBadge,
				};
			}
			return taskItemHandlers;
		},

		suggestTags: (input: HTMLInputElement, tags: () => readonly string[], pick: (tag: string) => void) => {
			const suggest = new TagSuggest(app, input, tags, pick);
			return () => suggest.close();
		},

		getQuickEntryHandlers(): QuickEntryHandlers {
			if (!quickEntryHandlers || quickEntryHandlers.quickFilter !== getState().quickFilter) {
				quickEntryHandlers = {
					handleCreateNewTask: actions.handleCreateNewTask,
					handleFilterEnable: actions.handleFilterEnable,
					quickFilter: getState().quickFilter,
					suggestTags: actions.suggestTags,
				};
			}
			return quickEntryHandlers;
		},

		/** Checked on every timeline render, including its own counter clicks after midnight or a parse change. */
		queryEnvFor(now: DateValue, tasks: readonly Task[], options: UserOption) {
			const { env, parseKey } = resolveEnv(now);
			const snapshot = props.store.getSnapshot();
			const { resolved } = snapshot;
			const prepared =
				resolved &&
				snapshot.tasks === tasks &&
				isEqual(resolved.under.settings, pickResolveSettings(options)) &&
				resolved.under.day === dayKey(now) &&
				sameParseKey(resolved.under.parseKey, parseKey)
					? resolved.shown
					: undefined;
			return { env, prepared };
		},
	};
	return actions;
}
