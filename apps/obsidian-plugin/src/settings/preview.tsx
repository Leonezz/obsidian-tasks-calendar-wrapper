import * as React from "react";
import { createRoot } from "react-dom/client";
import { Component } from "obsidian";
import { copy, dayKey, parseNote, resolveTasks, taskRowModel } from "@tasks-calendar-wrapper/core";
import {
	DayContent,
	DayHeader,
	HostContext,
	RowWriteContext,
	TaskItemEventHandlersContext,
	YearHeader,
	timelineDisplayClasses,
	type UiHost,
} from "@tasks-calendar-wrapper/ui";
import type TasksCalendarWrapper from "../main";
import { createUiHost } from "../uihost";
import { defaultUserOptions, type UserOption } from "../useroptions";
import { isSingleTag } from "./tags";

const noAction = () => {};
const callbacks: React.ContextType<typeof TaskItemEventHandlersContext> = {
	handleOpenFile: noAction,
	handleCompleteTask: noAction,
	handleTagClick: noAction,
	handleModifyTask: noAction,
	handleRowMenu: undefined,
	handleDateBadge: undefined,
};

/** A synthetic note goes through the same parser, resolver and row model as vault tasks. */
export function settingsPreviewSample(options: UserOption, host: UiHost) {
	const now = host.now();
	const key = dayKey(now);
	const palette = options.tagColorPalette && !Array.isArray(options.tagColorPalette) ? options.tagColorPalette : {};
	const tag = Object.keys(palette).find(isSingleTag) ?? copy.settings.tab.previewTag;
	const heading = `## ${copy.settings.tab.previewSection}`;
	const line = `- [ ] ${copy.settings.tab.previewTask} ${tag} ⏫ 🔁 ${copy.settings.tab.previewRecurrence.toLowerCase()} 📅 ${key}`;
	const point = (line: number, col: number, offset: number) => ({ line, col, offset });
	const parsed = parseNote(
		{
			path: `${copy.settings.tab.previewNote}.md`,
			content: `${heading}\n${line}`,
			metadata: {
				sections: [
					{
						type: "heading",
						position: { start: point(0, 0, 0), end: point(0, heading.length, heading.length) },
					},
				],
				listItems: [
					{
						task: " ",
						parent: -1,
						position: {
							start: point(1, 0, heading.length + 1),
							end: point(1, line.length, heading.length + 1 + line.length),
						},
					},
				],
			},
		},
		host.moment,
	);
	const env = { now, moment: host.moment, warn: (message: string, error: unknown) => console.warn(message, error) };
	const resolved = resolveTasks(parsed.tasks, { convert24HourTimePrefix: options.convert24HourTimePrefix }, env)
		.shown[0];
	const dateFormat = typeof options.dateFormat === "string" ? options.dateFormat : defaultUserOptions.dateFormat;
	const model = taskRowModel(
		resolved,
		{
			dateFormat,
			hideTags: Array.isArray(options.hideTags) ? options.hideTags : [],
			tagPalette: palette,
			useBuiltinStyle: options.useBuiltinStyle,
		},
		env,
	);
	return { now, key, dateFormat, resolved, model };
}

/** Uses the production DayContent -> TaskItem -> TaskRow tree, with no connection to vault actions. */
export function SettingsPreview({ options, host }: { readonly options: UserOption; readonly host: UiHost }) {
	const sample = settingsPreviewSample(options, host);
	const prefix = React.useId();
	const rowWrites = React.useMemo<React.ContextType<typeof RowWriteContext>>(
		() => ({
			pendingWrites: { getSnapshot: () => undefined, subscribe: () => noAction },
			clock: { lastListChangeAt: -Infinity },
			prefix: `tcw-settings-preview-${prefix}-`,
			focusRow: noAction,
			moveFocus: noAction,
		}),
		[prefix],
	);
	const preventAction = (event: React.SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	return (
		<>
			<div
				className="tcw-settings-preview-surface"
				role="group"
				aria-label={copy.settings.tab.previewReadOnly}
				aria-disabled="true"
				onClickCapture={preventAction}
				onAuxClickCapture={preventAction}
				onContextMenuCapture={preventAction}
				onKeyDownCapture={(event) => {
					if (["Enter", " ", "F10", "ContextMenu"].includes(event.key)) preventAction(event);
				}}
			>
				<HostContext.Provider value={host}>
					<RowWriteContext.Provider value={rowWrites}>
						<TaskItemEventHandlersContext.Provider value={callbacks}>
							<div className={`taskido ${timelineDisplayClasses(options)}`}>
								<span>
									<YearHeader
										year={{
											year: sample.now.year(),
											label: sample.now.format("YYYY"),
											isCurrent: true,
											showHeader: true,
											statuses: [sample.resolved.status],
											days: [],
										}}
									/>
									<div className="details today">
										<DayHeader thisDate={sample.now.format(sample.dateFormat)} />
										<div
											className="details today"
											data-year={sample.now.year()}
											data-types={sample.resolved.status}
										>
											<DayContent
												dayKey={sample.key}
												tasks={[sample.resolved]}
												modelFor={() => sample.model}
											/>
										</div>
									</div>
								</span>
							</div>
						</TaskItemEventHandlersContext.Provider>
					</RowWriteContext.Provider>
				</HostContext.Provider>
			</div>
			<small>{copy.settings.tab.previewHint}</small>
		</>
	);
}

/** One React root and Markdown owner per settings display, disposed with that display. */
export function mountSettingsPreview(container: HTMLElement, plugin: TasksCalendarWrapper) {
	const owner = plugin.addChild(new Component());
	const host = createUiHost({
		owner: () => owner,
		createElement: () => container.ownerDocument.createElement("a"),
		capacity: 16,
	});
	const root = createRoot(container);
	let disposed = false;
	return {
		update(options: UserOption): void {
			if (!disposed) root.render(<SettingsPreview options={options} host={host} />);
		},
		destroy(): void {
			if (disposed) return;
			disposed = true;
			root.unmount();
			host.clearMarkdownCache();
			plugin.removeChild(owner);
		},
	};
}
