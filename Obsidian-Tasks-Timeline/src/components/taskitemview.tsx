import { MarkdownRenderer } from "obsidian";
import * as React from "react";
import { getFileTitle } from "../../../dataview-util/dataview";
import { TasksTimelineView } from "../../../src/views";
import { TaskDataModel } from "../../../utils/tasks";
import { BadgeKind, TaskRowModel, taskRowModel } from "../taskrow";
import * as Icons from './asserts/icons';
import { TaskItemEventHandlersContext, UserOptionContext } from "./context";
import { StripWithIcon } from "./statusmarker";

const defaultTaskItemProps = {
    taskItem: {} as TaskDataModel
}

type TaskItemProps = Readonly<typeof defaultTaskItemProps>;
export class TaskItemView extends React.Component<TaskItemProps> {
    render(): React.ReactNode {
        return (
            <TaskItemEventHandlersContext.Consumer>{
                callbacks => (
                    <UserOptionContext.Consumer>{
                        ({ dateFormat, hideTags, tagPalette, useBuiltinStyle }) => {
                            const model = taskRowModel(this.props.taskItem, { dateFormat, hideTags, tagPalette, useBuiltinStyle });
                            return <TaskRow model={model} modelKey={JSON.stringify(model)} callbacks={callbacks} />;
                        }}
                    </UserOptionContext.Consumer>
                )}
            </TaskItemEventHandlersContext.Consumer>
        )
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
    model: TaskRowModel,
    modelKey: string,
    callbacks: React.ContextType<typeof TaskItemEventHandlersContext>,
};

/**
 * One row, rendered only from its model. Every save re-renders the timeline with new task objects,
 * so a row is skipped when its model and handlers are unchanged (issue #63).
 */
class TaskRow extends React.Component<TaskRowProps> {
    shouldComponentUpdate(next: TaskRowProps): boolean {
        return next.modelKey !== this.props.modelKey || next.callbacks !== this.props.callbacks;
    }

    render(): React.ReactNode {
        const { model, callbacks } = this.props;
        const openTaskFile = () => {
            callbacks.handleOpenFile(model.path, model.position);
        };
        const onToggleTask = () => {
            callbacks.handleCompleteTask(model.path, model.position);
        };
        const onModifyTask = () => {
            callbacks.handleModifyTask(model.path, model.position);
        };
        return (
            <div data-line={model.line} data-task={model.statusMarker} data-col={model.col} data-link={model.link} data-dailynote={model.isDailyNote}
                className={`task ${model.status}`}
                style={{ "--task-color": model.color || "var(--text-muted)" } as React.CSSProperties} aria-label={model.fileTitle}>
                <StripWithIcon onToggle={onToggleTask} useBuiltinStyle={model.useBuiltinStyle}
                    marker={model.statusMarker} status={model.status} />
                <div className='lines' onClick={openTaskFile}>
                    <div className="content">
                        <Content display={model.display} fileName={model.path} />
                    </div>
                    <div className='line info'>
                        {callbacks.handleModifyTask &&
                            <ModifyBadge onClick={onModifyTask}></ModifyBadge>}
                        {model.badges.map(badge =>
                            <DateStatusBadge key={badge.kind} className={badgeClasses[badge.kind]} ariaLabel={badge.ariaLabel}
                                label={badge.label} icon={badgeIcons[badge.kind]} />)}
                        <FileBadge filePath={model.path} subPath={model.subPath} />
                        {model.tags.map((t, i) =>
                            <TagBadge tag={t.tag} color={t.color} onClick={callbacks.handleTagClick} key={i} />)}
                    </div>
                </div>
            </div>
        )
    }
}

const defaultContentProps = {
    display: "",
    fileName: "",
}
type ContentProps = Readonly<typeof defaultContentProps>
/**
 * Rendering markdown is the most expensive part of a row, so it only runs again when the text or the file changes.
 * Every reload creates new task objects, so without this every row was rendered again after each save (issue #63).
 */
class Content extends React.PureComponent<ContentProps> {
    render(): React.ReactNode {
        const cont = createEl("a")
        MarkdownRenderer.renderMarkdown(this.props.display, cont, this.props.fileName, TasksTimelineView.view!);
        return <a dangerouslySetInnerHTML={{ __html: cont.firstElementChild!.innerHTML }} />
    }
}


type TagBadgeProps = {
    tag: string,
    color: string | undefined,
    onClick: (tag: string) => void,
};

class TagBadge extends React.Component<TagBadgeProps> {

    render(): React.ReactNode {
        const tag = this.props.tag;
        const tagText = tag.replace("#", "");
        const color = this.props.color;
        let style: Record<string, unknown>;
        if (color) {
            style = {
                '--tag-color': color,
                '--tag-background': `${color}1a`,
                'zIndex': 9999,
            };
        } else {
            style = {
                '--tag-color': 'var(--text-muted)',
                'zIndex': 9999,
            };
        }
        return (
            <a href={tag} className={'tag'} target='_blank' rel='noopener' style={style} aria-label={tag}
                onClick={(e) => {
                    e.stopPropagation();
                    this.props.onClick(tag);
                }}>
                <div className='icon'>{Icons.tagIcon}</div>
                <div className='label'>{tagText}</div>
            </a>);
    }
}

const defaultFileBadgeProps = {
    filePath: "",
    subPath: "",
}

type FileBadgeProps = Readonly<typeof defaultFileBadgeProps>;
class FileBadge extends React.Component<FileBadgeProps> {
    render(): React.ReactNode {
        const filePath = this.props.filePath;
        const fileName = getFileTitle(filePath);
        const subPath = this.props.subPath;
        return (
            <a className='file' aria-label={filePath}>
                <div className='icon'>{Icons.fileIcon}</div>
                <div className='label'>{fileName}</div>
                <span className='header'>{subPath != "" ? "  >  " + subPath : subPath}</span>
            </a>)
    }
}

const defaultBadgeProps = {
    className: "",
    ariaLabel: "",
    label: "",
    icon: Icons.taskIcon,
    //onClick: () => { },
}

type BadgeProps = Readonly<typeof defaultBadgeProps>;

class DateStatusBadge extends React.Component<BadgeProps> {

    render(): React.ReactNode {
        const type = this.props.className;
        const aria_label = this.props.ariaLabel;
        const label = this.props.label;
        const icon = this.props.icon;
        return (
            <a className={type} aria-label={aria_label} /*onClick={this.props.onClick}*/>
                <div className='icon'>{icon}</div>
                <div className='label'>{label}</div>
            </a>
        );
    }
}

const defaultModifyBadgeProps = {
    onClick: () => { }
};
type ModifyBadgeProps = Readonly<typeof defaultModifyBadgeProps>;
class ModifyBadge extends React.Component<ModifyBadgeProps> {
    render(): React.ReactNode {
        return (
            <a className='modify' aria-label="Modify Task" onClick={this.props.onClick}>✏️</a>
        )
    }
}