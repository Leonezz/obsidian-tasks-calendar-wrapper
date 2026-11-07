import * as React from "react";
import { sameRowModel, type BadgeKind, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { Content } from "./Content";
import * as Icons from "../icons";
import { TaskItemEventHandlersContext, useHost, type RowOverlay } from "../contexts";
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
	const { model, callbacks, overlay, clock } = props;
	const openTaskFile = (evt: React.MouseEvent<HTMLDivElement>) => {
		callbacks.handleOpenFile(model.path, model.position, evt.nativeEvent);
	};
	const onToggleTask = (evt: React.MouseEvent) => {
		evt.stopPropagation();
		if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
		callbacks.handleCompleteTask(model, evt.nativeEvent);
	};
	const onModifyTask = (evt: React.MouseEvent) => {
		evt.stopPropagation();
		if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
		callbacks.handleModifyTask?.(model, evt.nativeEvent);
	};
	const onRowMenu = (evt: React.MouseEvent) => {
		evt.stopPropagation();
		if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) return;
		callbacks.handleRowMenu?.(model, evt.nativeEvent);
	};
	const onContextMenu = (evt: React.MouseEvent) => {
		evt.preventDefault();
		onRowMenu(evt);
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
			aria-label={model.fileTitle}
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
				<div className="content">
					<Content display={model.display} fileName={model.path} />
				</div>
				<div className="line info">
					{callbacks.handleModifyTask && <ModifyBadge onClick={onModifyTask}></ModifyBadge>}
					{callbacks.handleRowMenu && host.isMobile && (
						<a className="menu" aria-label="Task menu" onClick={onRowMenu}>
							⋯
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
		</div>
	);
}, sameRowModelProps);
