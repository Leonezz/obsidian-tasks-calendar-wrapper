import { ItemView, WorkspaceLeaf } from "obsidian";
import { ObsidianBridge } from 'Obsidian-Tasks-Timeline/src/obsidianbridge';
import { createRoot, Root } from 'react-dom/client';
import { defaultUserOptions, UserOption } from "./settings";

export const CALENDAR_VIEW = "tasks_calendar_view";
export const TIMELINE_VIEW = "tasks_timeline_view";

export abstract class BaseTasksView extends ItemView {
    protected root: Root;
    protected userOption: UserOption;
    constructor(leaf: WorkspaceLeaf, opt: UserOption) {
        super(leaf);
        this.userOption = Object.assign({}, defaultUserOptions, opt);
    }


}

export class TasksTimelineView extends BaseTasksView {
    constructor(leaf: WorkspaceLeaf, opt: UserOption) {
        super(leaf, opt);
    }

    async onOpen(): Promise<void> {

        const { containerEl } = this;
        const container = containerEl.children[1];

        container.empty();
        this.root = createRoot(container);
        this.root.render(
            <ObsidianBridge plugin={this} opt={this.userOption} />
        )
    }

    getViewType(): string {
        return TIMELINE_VIEW;
    }

    getDisplayText(): string {
        return "Tasks Timeline";
    }

    getIcon(): string {
        return "calendar-clock";
    }

    async onClose(): Promise<void> {

    }
}