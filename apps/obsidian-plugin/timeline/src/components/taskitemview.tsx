import { MarkdownRenderer } from "obsidian";
import * as React from "react";
import { getFileTitle, sameRowModel, type BadgeKind, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { TasksTimelineView } from "../../../src/views";
import * as Icons from "./asserts/icons";
import { RowWriteContext, TaskItemEventHandlersContext } from "./context";
import { clickIsGuarded, type ListChangeClock } from "./clickguard";
import type { PendingWrite } from "../pendingwrites";
import { recordRender } from "./renderprobe";
import { StripWithIcon } from "./statusmarker";

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

function SubscribedTaskRow(props: Pick<TaskRowProps, "model" | "callbacks">) {
	const { pendingWrites, clock } = React.useContext(RowWriteContext);
	const id = `${props.model.path}:${props.model.line}`;
	const subscribe = React.useCallback(
		(listener: () => void) => pendingWrites.subscribe(id, listener),
		[pendingWrites, id],
	);
	const snapshot = React.useCallback(() => pendingWrites.getSnapshot(id), [pendingWrites, id]);
	const overlay = React.useSyncExternalStore(subscribe, snapshot, snapshot);
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
			if (overlay?.dimmed || clickIsGuarded(evt.nativeEvent, clock)) {
				evt.stopPropagation();
				return;
			}
			callbacks.handleModifyTask?.(model, evt.nativeEvent);
		};
		return (
			<div
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
				<StripWithIcon
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
						{model.badges.map((badge) => (
							<DateStatusBadge
								key={badge.kind}
								className={badgeClasses[badge.kind]}
								ariaLabel={badge.ariaLabel}
								label={badge.label}
								icon={badgeIcons[badge.kind]}
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

const defaultContentProps = {
	display: "",
	fileName: "",
};
type ContentProps = Readonly<typeof defaultContentProps>;
/**
 * Rendering markdown is the most expensive part of a row, so it only runs again when the text or the file changes.
 * Every reload creates new task objects, so without this every row was rendered again after each save (issue #63).
 */
class Content extends React.PureComponent<ContentProps> {
	render(): React.ReactNode {
		const cont = createEl("a");
		MarkdownRenderer.renderMarkdown(this.props.display, cont, this.props.fileName, TasksTimelineView.view!);
		return <a dangerouslySetInnerHTML={{ __html: cont.firstElementChild!.innerHTML }} />;
	}
}

type TagBadgeProps = {
	tag: string;
	color: string | undefined;
	onClick: (tag: string) => void;
};

class TagBadge extends React.Component<TagBadgeProps> {
	render(): React.ReactNode {
		const tag = this.props.tag;
		const tagText = tag.replace("#", "");
		const color = this.props.color;
		let style: Record<string, unknown>;
		if (color) {
			style = {
				"--tag-color": color,
				"--tag-background": `${color}1a`,
				zIndex: 9999,
			};
		} else {
			style = {
				"--tag-color": "var(--text-muted)",
				zIndex: 9999,
			};
		}
		return (
			<a
				href={tag}
				className={"tag"}
				target="_blank"
				rel="noopener"
				style={style}
				aria-label={tag}
				onClick={(e) => {
					e.stopPropagation();
					this.props.onClick(tag);
				}}
			>
				<div className="icon">{Icons.tagIcon}</div>
				<div className="label">{tagText}</div>
			</a>
		);
	}
}

const defaultFileBadgeProps = {
	filePath: "",
	subPath: "",
};

type FileBadgeProps = Readonly<typeof defaultFileBadgeProps>;
class FileBadge extends React.Component<FileBadgeProps> {
	render(): React.ReactNode {
		const filePath = this.props.filePath;
		const fileName = getFileTitle(filePath);
		const subPath = this.props.subPath;
		return (
			<a className="file" aria-label={filePath}>
				<div className="icon">{Icons.fileIcon}</div>
				<div className="label">{fileName}</div>
				<span className="header">{subPath != "" ? "  >  " + subPath : subPath}</span>
			</a>
		);
	}
}

const defaultBadgeProps = {
	className: "",
	ariaLabel: "",
	label: "",
	icon: Icons.taskIcon,
	//onClick: () => { },
};

type BadgeProps = Readonly<typeof defaultBadgeProps>;

class DateStatusBadge extends React.Component<BadgeProps> {
	render(): React.ReactNode {
		const type = this.props.className;
		const aria_label = this.props.ariaLabel;
		const label = this.props.label;
		const icon = this.props.icon;
		return (
			<a className={type} aria-label={aria_label} /*onClick={this.props.onClick}*/>
				<div className="icon">{icon}</div>
				<div className="label">{label}</div>
			</a>
		);
	}
}

const defaultModifyBadgeProps = {
	onClick: (evt: React.MouseEvent) => {},
};
type ModifyBadgeProps = Readonly<typeof defaultModifyBadgeProps>;
class ModifyBadge extends React.Component<ModifyBadgeProps> {
	render(): React.ReactNode {
		return (
			<a className="modify" aria-label="Modify Task" onClick={this.props.onClick}>
				✏️
			</a>
		);
	}
}
