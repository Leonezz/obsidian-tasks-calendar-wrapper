import { moment } from 'obsidian';
import * as React from 'react';
import { groupTasksByDate } from '../taskdates';
import { TaskListContext } from './context';
import { DateView } from './dateview';

const defaultYearViewProps = {
    year: 2023 as number,
};
type YearViewProps = Readonly<typeof defaultYearViewProps>;
export class YearView extends React.Component<YearViewProps> {
    render(): React.ReactNode {
        return (
            <TaskListContext.Consumer>{({ taskList, entryOnDate }) => {
                const tasksOfThisYear = taskList;
                const tasksByDate = groupTasksByDate(tasksOfThisYear);
                const daysOfThisYear: Set<string> = new Set(tasksByDate.keys());
                if (this.props.year === moment(entryOnDate).year() && !daysOfThisYear.has(entryOnDate))
                    daysOfThisYear.add(entryOnDate);
                return (
                    <div>
                        {tasksOfThisYear.length > 0 &&
                            <YearHeader year={this.props.year} dataTypes={[...new Set(tasksOfThisYear.map(t => t.status))]} />}
                        {[...daysOfThisYear]
                            .filter(d => moment(d).year() === this.props.year)
                            .sort()
                            .map((d) => {
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