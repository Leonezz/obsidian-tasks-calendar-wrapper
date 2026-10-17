import { moment } from '../../../utils/moment';
import * as React from 'react';
import { UserOption } from '../../../src/settings';
import * as TaskMapable from '../../../utils/taskmapable';
import { TaskDataModel, TaskStatus } from '../../../utils/tasks';
import { counterClass, dayKey, quickEntryTargets } from '@tasks-calendar-wrapper/core';
import { timelineSpan } from '../taskdates';
import { TaskListContext, TodayFocusEventHandlersContext, UserOptionContext } from './context';
import { YearView } from './yearview';


const defaultTimelineProps = {
    userOptions: {} as UserOption,
    taskList: [] as TaskDataModel[]
}
const defaultTimelineStates = {
    filter: "" as string,
    todayFocus: false as boolean,
}
type TimelineProps = Readonly<typeof defaultTimelineProps>;
type TimelineStates = typeof defaultTimelineStates;
export class TimelineView extends React.Component<TimelineProps, TimelineStates> {
    //private calendar: Map<string, Set<number>> = new Map();
    constructor(props: TimelineProps) {
        super(props);

        this.handleCounterFilterClick = this.handleCounterFilterClick.bind(this);
        this.handleTodayFocus = this.handleTodayFocus.bind(this);

        this.state = {
            filter: this.props.userOptions.defaultFilters,
            todayFocus: this.props.userOptions.defaultTodayFocus,
        }
    }

    handleCounterFilterClick(filterName: string) {
        if (this.state.filter !== filterName) {
            this.setState({
                filter: filterName,
            })
        } else {
            this.setState({
                filter: ""
            })
        }
    }

    handleTodayFocus() {
        this.setState({
            todayFocus: !this.state.todayFocus,
        })
    }

    render(): React.ReactNode {
        const taskList = this.props.taskList;
        const newestFirst = this.props.userOptions.newestFirst;
        const { years, entryDay } = timelineSpan(taskList, dayKey(moment()), this.props.userOptions.entryPosition, newestFirst);

        const overdueCount: number = taskList.filter(t => t.status === TaskStatus.overdue).length;
        const unplannedCount: number = taskList.filter(t => t.status === TaskStatus.unplanned).length;
        const completedCount: number = taskList.filter(t => t.status === TaskStatus.done).length;
        const cancelledCount: number = taskList.filter(t => t.status === TaskStatus.cancelled).length;
        // .due, .scheduled, .process, .start
        const todoCount: number = taskList.length - unplannedCount - completedCount - cancelledCount - overdueCount;

        const styles = new Array<string>;
        if (!this.props.userOptions.useCounters) styles.push("noCounters");
        if (!this.props.userOptions.useQuickEntry) styles.push("noQuickEntry");
        if (!this.props.userOptions.useYearHeader) styles.push("noYear");
        if (!this.props.userOptions.useFileBadge &&
            !this.props.userOptions.usePriority &&
            !this.props.userOptions.useRecurrence &&
            !this.props.userOptions.useRelative &&
            !this.props.userOptions.useSection &&
            !this.props.userOptions.useTags) styles.push("noInfo");
        else {
            if (!this.props.userOptions.useFileBadge) styles.push("noFile");
            if (!this.props.userOptions.usePriority) styles.push("noPriority");
            if (!this.props.userOptions.useRecurrence) styles.push("noRepeat");
            if (!this.props.userOptions.useRelative) styles.push("noRelative");
            if (!this.props.userOptions.useSection) styles.push("noHeader");
            if (!this.props.userOptions.useTags) styles.push("noTag");
            if (!this.props.userOptions.useModifyBadge) styles.push("noModify");
        }

        const baseStyles = [...new Set(styles)].join(" ");
        const counterFilter = counterClass(this.state.filter, this.props.userOptions.counterBehavior);
        const todayFocus = this.state.todayFocus ? "todayFocus" : "";
        return (
            <div className={`taskido ${baseStyles} ${counterFilter} ${todayFocus}`}
                id={`taskido${(new Date()).getTime()}`
                }>
                <TodayFocusEventHandlersContext.Provider value={{ handleTodayFocusClick: this.handleTodayFocus }}>
                    <UserOptionContext.Provider value={{
                        hideTags: this.props.userOptions.hideTags,
                        tagPalette: this.props.userOptions.tagColorPalette,
                        dateFormat: this.props.userOptions.dateFormat,
                        taskFiles: quickEntryTargets(this.props.userOptions, moment()),
                        select: this.props.userOptions.inbox,
                        forward: this.props.userOptions.forward,
                        useBuiltinStyle: this.props.userOptions.useBuiltinStyle,
                        counters: [
                            {
                                onClick: () => { this.handleCounterFilterClick('todoFilter') },
                                cnt: todoCount,
                                label: "Todo",
                                id: "todo",
                                ariaLabel: "Todo Tasks"
                            }, {
                                onClick: () => { this.handleCounterFilterClick('overdueFilter') },
                                cnt: overdueCount,
                                id: "overdue",
                                label: "Overdue",
                                ariaLabel: "Overdue Tasks"
                            }, {
                                onClick: () => { this.handleCounterFilterClick('unplannedFilter') },
                                cnt: unplannedCount,
                                id: "unplanned",
                                label: "Unplanned",
                                ariaLabel: "Unplanned Tasks"
                            }
                        ]
                    }}>
                        <span>
                            {years.map((y, i) => (
                                <TaskListContext.Provider value={
                                    {
                                        taskList: taskList.filter(TaskMapable.filterYear(moment().year(y))),
                                        entryOnDate: entryDay,
                                    }
                                } key={i}>
                                    <YearView year={y} newestFirst={newestFirst} key={y} />
                                </TaskListContext.Provider>
                            ))}
                        </span>
                    </UserOptionContext.Provider>
                </TodayFocusEventHandlersContext.Provider>
            </div >)
    }
}