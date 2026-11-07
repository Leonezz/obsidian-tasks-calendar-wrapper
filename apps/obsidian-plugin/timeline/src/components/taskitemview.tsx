import { Platform } from "obsidian";
import * as React from "react";
import { sameRowModel, type BadgeKind, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { Content } from "@tasks-calendar-wrapper/ui/src/row/Content";
import * as Icons from "@tasks-calendar-wrapper/ui/src/icons";
import { RowWriteContext, TaskItemEventHandlersContext } from "./context";
import { clickIsGuarded, type ListChangeClock } from "./clickguard";
import type { PendingWrite } from "../pendingwrites";
import { recordRender } from "./renderprobe";
import { StatusMarker } from "@tasks-calendar-wrapper/ui/src/row/StatusMarker";
import { TagBadge, FileBadge, DateStatusBadge, ModifyBadge } from "@tasks-calendar-wrapper/ui/src/row/Badges";

type TaskItemProps = { readonly model: TaskRowModel };

export class TaskItemView extends React.PureComponent<TaskItemProps> {
	render(): React.ReactNode {
		// Counted for the tests only; the production build drops the call and the probe.
		process.env.NODE_ENV !== "production" && recordRender("TaskItemView");
		return (
			<TaskItemEventHandlersContext.Consumer>
				{(callbacks) => <SubscribedTaskRow model={this.props.model} callbacks={callbacks} />}
			</TaskItemEventHandlersContext.Consumer>
		);
	}
}

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
	overlay?: PendingWrite;
	clock: ListChangeClock;
};

/** The static markup tests render rows without a DOM, where React warns about layout effects. */
const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

function SubscribedTaskRow(props: Pick<TaskRowProps, "model" | "callbacks">) {
	const { pendingWrites, clock } = React.useContext(RowWriteContext);
	const id = `${props.model.path}:${props.model.line}`;
	const subscribe = React.useCallback(
		(listener: () => void) => pendingWrites.subscribe(id, listener),
		[pendingWrites, id],
	);
	const snapshot = React.useCallback(() => pendingWrites.getSnapshot(id), [pendingWrites, id]);
	const overlay = React.useSyncExternalStore(subscribe, snapshot, snapshot);
	const [, forceRender] = React.useReducer((value: number) => value + 1, 0);
	// Subscribe in layout so a row mounted by a transition hears the clear in that commit's layout phase.
	useClientLayoutEffect(() => {
		if (overlay === undefined) return;
		const check = () => {
			if (pendingWrites.getSnapshot(id) !== overlay) forceRender();
		};
		const unsubscribe = pendingWrites.subscribe(id, check);
		check();
		return unsubscribe;
	}, [pendingWrites, id, overlay]);
	return <TaskRow {...props} overlay={overlay} clock={clock} />;
}

/**
 * One row, rendered only from its model. Every save re-renders the timeline with new task objects,
 * so a row is skipped when its model and handlers are unchanged (issue #63).
 */
class TaskRow extends React.Component<TaskRowProps> {
	shouldComponentUpdate(next: TaskRowProps): boolean {
		return (
			!sameRowModel(next.model, this.props.model) ||
			next.callbacks !== this.props.callbacks ||
			next.overlay !== this.props.overlay ||
			next.clock !== this.props.clock
		);
	}

	render(): React.ReactNode {
		const { model, callbacks, overlay, clock } = this.props;
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
						{callbacks.handleRowMenu && Platform.isMobile && (
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
	}
}
