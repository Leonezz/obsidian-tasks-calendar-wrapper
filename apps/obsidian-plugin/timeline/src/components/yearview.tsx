import { yearOfDay } from '@tasks-calendar-wrapper/core';
import { moment } from '../../../utils/moment';
import * as React from 'react';
import { groupTasksByDate, inDisplayOrder } from '../taskdates';
import { TaskListContext } from './context';
import { DateView } from './dateview';

const defaultYearViewProps = {
    year: 2023 as number,
    newestFirst: false as boolean,
};
type YearViewProps = Readonly<typeof defaultYearViewProps>;
export class YearView extends React.Component<YearViewProps> {
    render(): React.ReactNode {
        return (
            <TaskListContext.Consumer>{({ taskList, entryOnDate }) => {
                const tasksOfThisYear = taskList;
                const tasksByDate = groupTasksByDate(tasksOfThisYear);
                const daysOfThisYear: Set<string> = new Set(tasksByDate.keys());
                if (this.props.year === yearOfDay(entryOnDate) && !daysOfThisYear.has(entryOnDate))
                    daysOfThisYear.add(entryOnDate);
                const days = inDisplayOrder([...daysOfThisYear].filter(d => yearOfDay(d) === this.props.year), this.props.newestFirst);
                return (
                    <div>
                        {tasksOfThisYear.length > 0 &&
                            <YearHeader year={this.props.year} dataTypes={[...new Set(tasksOfThisYear.map(t => t.status))]} />}
                        {days.map((d) => {
                            const tasksOfThisDate = tasksByDate.get(d) ?? [];
                            // Keyed by the day, so a day added above does not make React rebuild every day below it.
                            return (
                                <TaskListContext.Provider value={{ taskList: tasksOfThisDate, entryOnDate: entryOnDate }} key={d}>
                                    <DateView date={moment(d)} />
                                </TaskListContext.Provider>
                            )
                        })}
                    </div>)
            }}
            </TaskListContext.Consumer>
        );
    }
}

const defaultYearHeaderProps = {
    year: 2023 as number,
    dataTypes: [] as string[],
}
type YearHeaderProps = Readonly<typeof defaultYearHeaderProps>;
class YearHeader extends React.Component<YearHeaderProps> {
    render(): React.ReactNode {
        const yearMoment = moment().year(this.props.year);
        return (
            <div className={"year" + (yearMoment.isSame(moment(), 'year') ? " current" : "")}
                data-types={this.props.dataTypes.join(" ")}>
                {yearMoment.format("YYYY")}
            </div>
        );
    }
}