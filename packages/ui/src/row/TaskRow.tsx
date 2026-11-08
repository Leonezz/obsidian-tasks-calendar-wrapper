import * as React from "react";
import { copy, sameRowModel, type BadgeKind, type TaskRowModel, type TaskStatus } from "@tasks-calendar-wrapper/core";
import { Content } from "./Content";
import * as Icons from "../icons";
import {
	RowDayKeyContext,
	RowWriteContext,
	TaskItemEventHandlersContext,
	rowInstanceKey,
	useHost,
	type RowOverlay,
} from "../contexts";
import { clickIsGuarded, type ListChangeClock } from "../clickguard";
import { StatusMarker } from "./StatusMarker";
import { TagBadge, FileBadge, DateStatusBadge, ModifyBadge } from "./Badges";

const badgeIcons: Record<BadgeKind, JSX.Element> = {
	created: Icons.taskIcon,
	start: Icons.startIcon,
	scheduled: Icons.scheduledIcon,
	due: Icons.dueIcon,
	done: Icons.doneIcon,
	repeat: Icons.repeatIcon,
	priority: Icons.priorityIcon,
};

const badgeClasses: Record<BadgeKind, string> = {
	created: "relative",
	start: "relative",
	scheduled: "relative",
	due: "relative",
	done: "relative",
	repeat: "repeat",
	priority: "priority",
};

const statusAria: Record<TaskStatus, string> = {
	due: copy.row.statusAria.due,
	scheduled: copy.row.statusAria.scheduled,
	start: copy.row.statusAria.start,
	done: copy.row.statusAria.done,
	unplanned: copy.row.statusAria.unplanned,
	overdue: copy.row.statusAria.overdue,
	process: copy.row.statusAria.process,
	cancelled: copy.row.statusAria.cancelled,
};

type TaskRowProps = {
	model: TaskRowModel;
	callbacks: React.ContextType<typeof TaskItemEventHandlersContext>;
	overlay?: RowOverlay;
	clock: ListChangeClock;
};

// The comparator is the negation of the old shouldComponentUpdate.
export const sameRowModelProps = (prev: TaskRowProps, next: TaskRowProps): boolean =>
	sameRowModel(prev.model, next.model) &&
	prev.callbacks === next.callbacks &&
	prev.overlay === next.overlay &&
	prev.clock === next.clock;

/**
 * One row, rendered only from its model. Every save re-renders the timeline with new task objects,
 * so a row is skipped when its model and handlers are unchanged (issue #63).
 */
export const TaskRow = React.memo(function TaskRow(props: TaskRowProps) {
	const host = useHost();
	const rowWrites = React.useContext(RowWriteContext);
	const dayKey = React.useContext(RowDayKeyContext);
	const { model, callbacks, overlay, clock } = props;
	const id = `${model.path}:${model.line}`;
	const instanceId = rowInstanceKey(dayKey, id);
	const contentId = `${rowWrites.prefix}${instanceId}-text`;
	const summaryId = `${rowWrites.prefix}${instanceId}-summary`;
	const openTaskFile = (evt: React.MouseEvent | React.KeyboardEvent) => {
		callbacks.handleOpenFile(model.path, model.position, evt.nativeEvent);
	};
	const onToggleTask = (evt: React.MouseEvent | React.KeyboardEvent) => {
		evt.stopPropagation();
		if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
		callbacks.handleCompleteTask(model, evt.nativeEvent);
	};
	const onModifyTask = (evt: React.MouseEvent | React.KeyboardEvent) => {
		evt.stopPropagation();
		if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
		callbacks.handleModifyTask?.(model, evt.nativeEvent);
	};
	const onRowMenu = (evt: React.MouseEvent | React.KeyboardEvent, nativeEvent: MouseEvent) => {
		evt.stopPropagation();
		if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
		callbacks.handleRowMenu?.(model, nativeEvent);
	};
	const onContextMenu = (evt: React.MouseEvent) => {
		evt.preventDefault();
		onRowMenu(evt, evt.nativeEvent);
	};
	const openKeyboardMenu = (evt: React.KeyboardEvent<HTMLElement>) => {
		if (!callbacks.handleRowMenu) return;
		const row = evt.currentTarget.closest<HTMLElement>(".task")!;
		const view = row.ownerDocument.defaultView!;
		const rect = row.getBoundingClientRect();
		onRowMenu(evt, new view.MouseEvent("contextmenu", { view, clientX: rect.left, clientY: rect.bottom }));
	};
	const onKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
		if (evt.target === evt.currentTarget) {
			if (["ArrowDown", "ArrowUp", "Home", "End"].includes(evt.key)) {
				evt.preventDefault();
				rowWrites.moveFocus(instanceId, evt.key);
			} else if (evt.key === " ") {
				evt.preventDefault();
				// Holding Space repeats the keydown; only the first press toggles.
				if (!evt.repeat) onToggleTask(evt);
			} else if (evt.key === "Enter") {
				evt.preventDefault();
				openTaskFile(evt);
			} else if (evt.key === "F10" && evt.shiftKey) {
				// The ContextMenu key also fires a native contextmenu event, which onContextMenu handles.
				evt.preventDefault();
				openKeyboardMenu(evt);
			}
		}
	};
	return (
		<div
			{...(callbacks.handleRowMenu ? { onContextMenu } : {})}
			data-line={model.line}
			data-task={model.statusMarker}
			data-col={model.col}
			data-link={model.link}
			data-dailynote={model.isDailyNote}
			className={`task ${model.status}`}
			style={{ "--task-color": model.color || "var(--text-muted)" } as React.CSSProperties}
			role="listitem"
			tabIndex={-1}
			aria-labelledby={`${contentId} ${summaryId}`}
			onFocus={() => rowWrites.focusRow(instanceId)}
			onKeyDown={onKeyDown}
			aria-busy={overlay?.dimmed ? true : undefined}
			aria-disabled={overlay?.dimmed ? true : undefined}
		>
			<StatusMarker
				onToggle={onToggleTask}
				useBuiltinStyle={model.useBuiltinStyle}
				marker={model.statusMarker}
				status={model.status}
				predicted={overlay}
			/>
			<div className="lines" onClick={openTaskFile}>
				<div className="content" id={contentId}>
					<Content display={model.display} fileName={model.path} />
				</div>
				<div className="line info">
					{callbacks.handleModifyTask && <ModifyBadge onClick={onModifyTask}></ModifyBadge>}
					{callbacks.handleRowMenu && host.isMobile && (
						<a
							className="menu"
							aria-label={copy.row.menuAria}
							role="button"
							tabIndex={-1}
							onClick={(evt) => onRowMenu(evt, evt.nativeEvent)}
							onKeyDown={(evt) => {
								if (evt.key === "Enter" || evt.key === " ") {
									evt.preventDefault();
									openKeyboardMenu(evt);
								}
							}}
						>
							{copy.row.menuGlyph}
						</a>
					)}
					{model.badges.map(({ kind, ariaLabel, label }) => (
						<DateStatusBadge
							key={kind}
							className={badgeClasses[kind]}
							ariaLabel={ariaLabel}
							label={label}
							icon={badgeIcons[kind]}
							onClick={
								callbacks.handleDateBadge &&
								(kind === "due" || kind === "scheduled" || kind === "start")
									? (evt) => {
											evt.stopPropagation();
											if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
											callbacks.handleDateBadge?.(model, kind);
										}
									: undefined
							}
						/>
					))}
					<FileBadge filePath={model.path} subPath={model.subPath} />
					{model.tags.map((t, i) => (
						<TagBadge tag={t.tag} color={t.color} onClick={callbacks.handleTagClick} key={i} />
					))}
				</div>
			</div>
			<span className="tcw-sr-only" id={summaryId}>
				{copy.row.summary({
					status: statusAria[model.status],
					dates: model.badges
						.filter(({ kind }) => ["created", "start", "scheduled", "due", "done"].includes(kind))
						.map(({ ariaLabel }) => ariaLabel),
					note: model.fileTitle,
				})}
			</span>
		</div>
	);
}, sameRowModelProps);
