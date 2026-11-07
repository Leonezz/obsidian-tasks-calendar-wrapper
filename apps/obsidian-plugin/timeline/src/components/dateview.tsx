import * as React from "react";
import { type DayGroup, type QuickFilter, type ResolvedTask, type TaskRowModel } from "@tasks-calendar-wrapper/core";
import { Counters, type CounterProps } from "@tasks-calendar-wrapper/ui/src/entry/Counters";
import { QuickEntry } from "@tasks-calendar-wrapper/ui/src/entry/QuickEntry";
import { TodayFocus } from "@tasks-calendar-wrapper/ui/src/entry/TodayFocus";
import { DayHeader } from "@tasks-calendar-wrapper/ui/src/timeline/DayHeader";
import { QuickEntryHandlerContext } from "./context";
import { recordRender } from "@tasks-calendar-wrapper/ui/src/renderprobe";
import { TaskItem } from "@tasks-calendar-wrapper/ui/src/row/TaskItem";

// The date line's height (20.8 px plus its 10 px margins), rounded up.
const DATE_LINE_ESTIMATE = "41px";

export type EntryProps = {
	readonly counters: readonly CounterProps[];
	readonly taskFiles: readonly string[];
	/** The tags on the tasks, suggested by the tag filter. */
	readonly tags: readonly string[];
};

type DateViewProps = {
	readonly day: DayGroup;
	/** The day's year in the locale's digits. */
	readonly yearLabel: string;
	readonly entry?: EntryProps;
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

/**
 * A day of the timeline, as core arranged it: the entry panel when the entry sits on it, then its heading and its
 * rows when it lists any. The statuses it lists before the counter filter go on its data-types, as before.
 * Days other than the entry day skip their rows' style, layout and paint while off screen.
 */
export class DateView extends React.Component<DateViewProps> {
	shouldComponentUpdate(next: DateViewProps): boolean {
		const { day } = this.props;
		return (
			next.yearLabel !== this.props.yearLabel ||
			next.modelFor !== this.props.modelFor ||
			next.entry !== this.props.entry ||
			next.day.key !== day.key ||
			next.day.label !== day.label ||
			next.day.isToday !== day.isToday ||
			next.day.isEntry !== day.isEntry ||
			next.day.dated !== day.dated ||
			next.day.statuses.length !== day.statuses.length ||
			next.day.statuses.some((status, index) => status !== day.statuses[index]) ||
			next.day.tasks.length !== day.tasks.length ||
			next.day.tasks.some((task, index) => task !== day.tasks[index])
		);
	}

	render(): React.ReactNode {
		// Counted for the tests only; the production build drops the call and the probe.
		process.env.NODE_ENV !== "production" && recordRender("DateView", this.props.day.key);
		const { day, yearLabel, entry, modelFor } = this.props;
		const className = day.isToday ? "details today" : "details";
		const types = day.statuses.join(" ");
		return (
			<div>
				{entry && <TodayFocus visual={"Focus On Today"} />}
				{entry && <Counters counters={entry.counters} />}
				{entry && (
					<QuickEntryHandlerContext.Consumer>
						{({ quickFilter }) => (
							<>
								<TagFilter applied={quickFilter} tags={entry.tags} />
								<QuickEntry applied={quickFilter} taskFiles={entry.taskFiles} />
							</>
						)}
					</QuickEntryHandlerContext.Consumer>
				)}
				{day.tasks.length > 0 && (
					<div
						className={className + (entry === undefined ? " tcw-day" : "")}
						data-year={yearLabel}
						data-types={types}
						style={
							entry === undefined
								? ({
										"--tcw-day-estimate": `calc(${day.tasks.length} * var(--tcw-day-row-estimate) + ${DATE_LINE_ESTIMATE})`,
									} as React.CSSProperties)
								: undefined
						}
					>
						<DayHeader thisDate={day.label} />
						<div className={className} data-year={yearLabel} data-types={types}>
							<NormalDateContent tasks={day.tasks} modelFor={modelFor} />
						</div>
					</div>
				)}
			</div>
		);
	}
}

type NormalDateContentProps = {
	readonly tasks: readonly ResolvedTask[];
	readonly modelFor: (task: ResolvedTask) => TaskRowModel;
};

class NormalDateContent extends React.Component<NormalDateContentProps> {
	render(): React.ReactNode {
		return (
			<div className="content">
				{/* Keyed by the task's place in the vault, so a row is never reused for another task, see issue #138. */}
				{this.props.tasks.map((resolved) => (
					<TaskItem key={resolved.task.id} model={this.props.modelFor(resolved)} />
				))}
			</div>
		);
	}
}

/** The tag typed in the tag filter, with its "#"; none for an empty filter. */
function tagsOf(text: string): string[] {
	const tag = text.trim().replace(/^#+/, "");
	return tag === "" ? [] : ["#" + tag];
}

type TagFilterProps = { readonly applied?: QuickFilter; readonly tags: readonly string[] };
type TagFilterState = { readonly text: string; readonly applied?: QuickFilter };

/**
 * Shows only tasks with the typed tag, suggesting the tags on the tasks. A suggestion or Enter applies it, and emptying
 * the box clears it. It is shown whether the quick entry panel is or not, and keeps the panel's dates and priorities.
 */
class TagFilter extends React.Component<TagFilterProps, TagFilterState> {
	static contextType = QuickEntryHandlerContext;
	declare context: React.ContextType<typeof QuickEntryHandlerContext>;
	private readonly input = React.createRef<HTMLInputElement>();
	private stopSuggesting?: () => void;
	state: TagFilterState = { text: this.props.applied?.tags?.join(" ") ?? "", applied: this.props.applied };

	/** A filter applied or cleared elsewhere, such as by adding a task, shows its own tag. */
	static getDerivedStateFromProps(props: TagFilterProps, state: TagFilterState): TagFilterState | null {
		if (props.applied === state.applied) return null;
		return { text: props.applied?.tags?.join(" ") ?? "", applied: props.applied };
	}

	componentDidMount(): void {
		if (this.input.current)
			this.stopSuggesting = this.context.suggestTags?.(
				this.input.current,
				() => this.props.tags,
				(tag) => {
					this.setState({ text: tag });
					this.apply(tag);
				},
			);
	}

	componentWillUnmount(): void {
		this.stopSuggesting?.();
	}

	private apply(text: string): void {
		const { applied } = this.props;
		this.context.handleFilterEnable(applied?.from, applied?.to, [...(applied?.priorities ?? [])], tagsOf(text));
	}

	render(): React.ReactNode {
		return (
			<div className="tagFilterBar">
				<input
					ref={this.input}
					type="search"
					placeholder="🏷️ Filter by tag: #home"
					aria-label="Show only tasks with this tag"
					value={this.state.text}
					onChange={(e) => {
						const text = e.target.value;
						this.setState({ text });
						if (text.trim() === "") this.apply("");
					}}
					onKeyUp={(e) => {
						if (e.key === "Enter") this.apply(this.state.text);
					}}
				/>
			</div>
		);
	}
}
