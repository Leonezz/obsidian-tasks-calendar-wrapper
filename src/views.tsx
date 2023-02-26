import { ItemView, WorkspaceLeaf } from "obsidian";
import { ObsidianBridge } from 'Obsidian-Tasks-Timeline/src/obsidianbridge';
import { TimelineSettings } from "Obsidian-Tasks-Timeline/src/utils/options";
import { createRoot, Root } from 'react-dom/client';

export const CALENDAR_VIEW = "tasks_calendar_view";
export const TIMELINE_VIEW = "tasks_timeline_view";

export abstract class BaseTasksView extends ItemView {
    protected options: TimelineSettings;
    protected root: Root;
    //private component: View;
    constructor(leaf: WorkspaceLeaf, setting: TimelineSettings | null) {
        super(leaf);
    }


}

export class TasksTimelineView extends BaseTasksView {
    constructor(leaf: WorkspaceLeaf, options: TimelineSettings | null) {
        super(leaf, options);
        this.options = Object.assign({}, {}, new TimelineSettings());
        if (this.options.dailyNoteFormat?.match(/[|\\YMDWwd.,-: \[\]]/g)?.length !== this.options.dailyNoteFormat?.length) {
            // Error handler here
            return;
        }

    }

    async onOpen(): Promise<void> {

        const { containerEl } = this;
        const container = containerEl.children[1];

        container.empty();
        this.root = createRoot(container);
        this.root.render(
            <ObsidianBridge plugin={this} />
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