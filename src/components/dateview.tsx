import { moment } from 'obsidian';
import * as React from 'react';
import { getFileTitle } from '../../../dataview-util/dataview';
import { TaskStatus, doneDateSymbol, dueDateSymbol, recurrenceSymbol, scheduledDateSymbol, startDateSymbol } from '../../../utils/tasks';
import { forwardedDateKey } from '../../../utils/taskmapable';
import * as Icons from './asserts/icons';
import { QuickEntryHandlerContext, TaskListContext, TodayFocusEventHandlersContext, UserOptionContext } from './context';
import { TaskItemView } from './taskitemview';

const defaultDateProps = {
    date: moment(),
}

type DateViewProps = Readonly<typeof defaultDateProps>;

export class DateView extends React.Component<DateViewProps> {
    render(): React.ReactNode {
        return (
            <UserOptionContext.Consumer>{({ forward, dateFormat }) => (
                < TaskListContext.Consumer >{({ taskList, entryOnDate }) => {
                    const entryOnDateMoment = moment(entryOnDate);
                    const isEntryDate = this.props.date.format("YYYYMMDD") === entryOnDateMoment.format("YYYYMMDD");
                    const isToday = this.props.date.isSame(moment(), 'date');
                    if (forward && !isToday) {
                        // Tasks pulled onto today are shown there only, so they are not listed twice.
                        taskList = taskList.filter(t => t.status !== TaskStatus.overdue && !t.dates.has(forwardedDateKey))
                    }
                    return (
                        <div>
                            {isEntryDate && <TodayFocus visual={"Focus On Today"} />}
                            {isEntryDate && <Counters />}
                            {isEntryDate && <QuickEntry />}
                            {
                                taskList.length > 0 && <div className={isToday ? "details today" : "details"}
                                    data-year={this.props.date.format("YYYY")}
                                    data-types={[...new Set(taskList.map((t => t.status)))].join(" ")}>
                                    <DateHeader thisDate={this.props.date.format(dateFormat)} />
                                    <div className={isToday ? "details today" : "details"}
                                        data-year={this.props.date.format("YYYY")}
                                        data-types={[...new Set(taskList.map((t => t.status)))].join(" ")}>
                                        <TaskListContext.Provider value={{ taskList: taskList, entryOnDate: entryOnDate }}>
                                            <NormalDateContent date={this.props.date} />
                                        </TaskListContext.Provider>
                                    </div>
                                </div>
                            }
                        </div>
                    )

                }}
                </TaskListContext.Consumer>
            )}
            </UserOptionContext.Consumer >
        )
    }
}

type DateHeaderProps = {
    thisDate: string,
}
class DateHeader extends React.Component<DateHeaderProps> {
    render(): React.ReactNode {
        return (
            <div className='dateLine'>
                <div className='date'>{this.props.thisDate}</div>
                <div className='weekday'></div>
            </div>
        )
    }
}

type NormalDateContentProps = {
    date: moment.Moment,
}

class NormalDateContent extends React.Component<NormalDateContentProps> {

    render(): React.ReactNode {
        return (
            <TaskListContext.Consumer>
                {({ taskList }) => (
                    <div className='content'>
                        {/* Keyed by the task's place in the vault, so a row is never reused for another task, see issue #138. */}
                        {taskList.map(t => <TaskItemView key={`${t.path}:${t.line}`} taskItem={t} />)}
                    </div>
                )}
            </TaskListContext.Consumer>
        )
    }
}


const defaultQuickEntryState = {
    selectedFile: "" as string,
    action: "append" as string,
    filters: [] as string[],
};
type QuickEntryState = typeof defaultQuickEntryState;

class QuickEntry extends React.Component<Record<string, unknown>, QuickEntryState> {
    private textInput;
    private fileSecect;
    private okButton;
    private quickEntryPanel;
    private dateFilter: string[] = new Array<string>(2);
    private priorityFilter: string[] = new Array<string>;
    constructor(none: Record<string, unknown>) {
        super(none);

        this.onQuickEntryFileSelectChange = this.onQuickEntryFileSelectChange.bind(this);
        this.onQuickEntryNewTaskInput = this.onQuickEntryNewTaskInput.bind(this);
        this.onQuickEntryNewTaskKeyUp = this.onQuickEntryNewTaskKeyUp.bind(this);
        this.onQuickEntryPanelBlur = this.onQuickEntryPanelBlur.bind(this);
        this.onQuickEntryPanelFocus = this.onQuickEntryPanelFocus.bind(this);


        this.textInput = React.createRef<HTMLInputElement>();
        this.fileSecect = React.createRef<HTMLSelectElement>();
        this.okButton = React.createRef<HTMLButtonElement>();
        this.quickEntryPanel = React.createRef<HTMLDivElement>();

        this.state = {
            selectedFile: "Inbox.md",
            action: "append",
            filters: [],
        }
    }


    onQuickEntryFileSelectChange() {
        if (!this.fileSecect.current) return;
        this.setState({
            selectedFile: this.fileSecect.current?.value,
        })
        this.textInput.current?.focus();
    }

    onQuickEntryNewTaskKeyUp(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key !== "Enter") return;
        this.okButton.current?.click();
    }

    onQuickEntryNewTaskInput() {
        const input = this.textInput.current;
        if (!input) return;
        const newTask = input.value;
        // Icons
        if (newTask.includes("due ")) { input.value = newTask.replace("due", dueDateSymbol) }
        if (newTask.includes("start ")) { input.value = newTask.replace("start", startDateSymbol) }
        if (newTask.includes("scheduled ")) { input.value = newTask.replace("scheduled", scheduledDateSymbol) }
        if (newTask.includes("done ")) { input.value = newTask.replace("done", doneDateSymbol) }
        if (newTask.includes("repeat ")) { input.value = newTask.replace("repeat", recurrenceSymbol) }
        if (newTask.includes("recurring ")) { input.value = newTask.replace("recurring", recurrenceSymbol) }

        // Dates
        if (newTask.includes("today ")) { input.value = newTask.replace("today", moment().format("YYYY-MM-DD")) }
        if (newTask.includes("tomorrow ")) { input.value = newTask.replace("tomorrow", moment().add(1, "days").format("YYYY-MM-DD")) }
        if (newTask.includes("yesterday ")) { input.value = newTask.replace("yesterday", moment().subtract(1, "days").format("YYYY-MM-DD")) }

        // In X days/weeks/month/years
        const futureDate = newTask.match(/(in)\W(\d{1,3})\W(days|day|weeks|week|month|years|year) /);
        if (futureDate && futureDate.length > 3) {
            const value: number = parseInt(futureDate[2]);
            const unit = futureDate[3] as moment.unitOfTime.Base;
            const date = moment().add(value, unit).format("YYYY-MM-DD[ ]")
            input.value = newTask.replace(futureDate[0], date);
        }

        // Next Weekday
        const weekday = newTask.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday) /);
        if (weekday) {
            const weekdays = ["", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
            const dayINeed = weekdays.indexOf(weekday[1]);
            if (moment().isoWeekday() < dayINeed) {
                input.value = newTask.replace(weekday[1], moment().isoWeekday(dayINeed).format("YYYY-MM-DD"));
            } else {
                input.value = newTask.replace(weekday[1], moment().add(1, 'weeks').isoWeekday(dayINeed).format("YYYY-MM-DD"));
            }
        }

        input.focus();
    }

    onQuickEntryPanelFocus() {
        this.quickEntryPanel.current?.addClass("focus");
    }

    onQuickEntryPanelBlur() {
        this.quickEntryPanel.current?.removeClass("focus");
    }

    render(): React.ReactNode {
        const filterNames = ['+', "date", "priority"]
        return (
            <div className='quickEntryPanel' ref={this.quickEntryPanel}>
                <div className='left'>
                    <div className='actionSelect'>
                        <select name='Action' className='actionName' value={this.state.action} onChange={(event) => {
                            this.setState({ action: event.target.value })
                            if (this.textInput.current)
                                this.textInput.current.value = ""
                        }}>
                            <option value={"append"} key={1}>New Task</option>
                            <option value={"filter"} key={2}>Filter</option>
                        </select>
                        {this.state.action === "append"
                            ?
                            <UserOptionContext.Consumer>{({ taskFiles }) =>
                                <select name='File name' className='fileSelect' ref={this.fileSecect} aria-label='Select a note to add a new task to'
                                    onChange={this.onQuickEntryFileSelectChange} defaultValue={taskFiles[0]} >
                                    {
                                        [...taskFiles].map(
                                            (f, i) => {
                                                const secondParentFolder =
                                                    !(f.split("/")[f.split("/").length - 3]) ? "" : "… / ";
                                                const parentFolder =
                                                    !(f.split("/")[f.split("/").length - 2]) ? "" :
                                                        (secondParentFolder + "📂 " + f.split("/")[f.split("/").length - 2] + " / ");
                                                const filePath = parentFolder + "📄 " + getFileTitle(f);
                                                return (
                                                    <option style={{ whiteSpace: "nowrap" }} value={f} title={f} key={i} >
                                                        {filePath}
                                                    </option>);
                                            }
                                        )
                                    }
                                </select>
                            }
                            </UserOptionContext.Consumer>
                            :
                            <MultiSelect key={0} name='Filter Type'
                                className='filterSelector'
                                options={filterNames}
                                fallbackValueIndex={0}
                                selectChangeHandler={res => { this.setState({ filters: res }) }}
                                visual={['➕', '📆 date', '⏫ priority']} />

                        }
                    </div>

                    <div className='left'>
                        {this.state.action === "append" ?
                            <input className='newTask' type='text' placeholder='Enter your tasks here' ref={this.textInput}
                                onInput={this.onQuickEntryNewTaskInput} onKeyUp={this.onQuickEntryNewTaskKeyUp}
                                onFocus={this.onQuickEntryPanelFocus} onBlur={this.onQuickEntryPanelBlur} />
                            :
                            <div className='left'>
                                {this.state.filters.map((f, i) => {
                                    if (f === 'date') {
                                        return <div key={i} className='dateFilter'>
                                            <a key={0}>From: </a><input key={1} type='date' onChange={e => this.dateFilter[0] = e.target.value} />
                                            <a key={2}>  To: </a><input key={3} type='date' onChange={e => this.dateFilter[1] = e.target.value} />
                                        </div>
                                    } else if (f === 'priority') {
                                        return <div key={i} className='actionSelect'>
                                            <a>Priorities: </a><MultiSelect key={1} name='priorityFilter' className=''
                                                options={['+', '1', '2', '3', '4']} visual={['➕', 'High', 'Medium', 'None', 'Low']}
                                                fallbackValueIndex={0} selectChangeHandler={(res) => { this.priorityFilter = res; }} />
                                        </div>
                                    } return <div key={i} />
                                })
                                }
                            </div>
                        }
                    </div>
                </div>

                <div className='right'>
                    <QuickEntryHandlerContext.Consumer>{callback => (
                        <button className='ok' ref={this.okButton} aria-label='Append new task to selected note'
                            onClick={() => {
                                if (this.state.action === 'append') {
                                    // there is an issue with this.state.selectedFile:
                                    // the value is not setted when initialize.
                                    // using this.fileSecect.current?.value for emergency.
                                    const filePath = this.fileSecect.current?.value; // this.state.selectedFile;
                                    const newTask = this.textInput.current?.value;
                                    if (!newTask || !filePath) return;
                                    if (newTask.length > 1) {
                                        callback.handleCreateNewTask(filePath, newTask);
                                        if (this.textInput.current) {
                                            this.textInput.current.value = "";
                                        }
                                    } else {
                                        this.textInput.current?.focus();
                                    }
                                } else {
                                    callback.handleFilterEnable(this.dateFilter[0], this.dateFilter[1], this.priorityFilter);
                                }
                            }}>
                            {Icons.buttonIcon}
                        </button>)}
                    </QuickEntryHandlerContext.Consumer>
                </div>
            </div >
        );
    }
}

const multiSelectProps = {
    name: "" as string,
    className: "" as string,
    options: [] as string[],
    visual: [] as string[],
    selectChangeHandler: {} as (options: string[]) => void,
    fallbackValueIndex: 0 as number,
}
type MultiSelectProps = typeof multiSelectProps;
const multiSelectStates = {
    results: [] as string[],
}
type MultiSelectStates = Readonly<typeof multiSelectStates>;
class MultiSelect extends React.Component<MultiSelectProps, MultiSelectStates> {
    private selectElem;
    constructor(props: MultiSelectProps) {
        super(props);
        this.selectElem = React.createRef<HTMLSelectElement>();
        this.state = {
            results: []
        };
    }
    render(): React.ReactNode {
        return (
            <div className='left MultiSelect'>
                <select name={this.props.name} className={this.props.className} ref={this.selectElem}
                    onClick={() => {
                        if (this.selectElem.current !== null)
                            this.selectElem.current.selectedIndex = this.props.fallbackValueIndex;
                    }}
                    onChange={(e) => {
                        const idx = e.target.selectedIndex;
                        if (idx === this.props.fallbackValueIndex) return;
                        const value = this.props.options[idx];
                        const results = this.state.results;
                        if (results.includes(value)) results.remove(value);
                        else results.push(value);
                        this.setState({ results: results });
                        this.props.selectChangeHandler(results);
                    }}>
                    {this.props.options
                        //.filter((_, i) => i !== this.props.fallbackValueIndex)
                        .map((n, i) =>
                            <option value={n} key={i}>
                                {this.props.visual[i] + (this.state.results.includes(n) ? "🎯" : " ")}
                            </option>
                        )}
                </select>
                {this.state.results.map(f => <a>{this.props.visual[this.props.options.indexOf(f)] + "🎯"}</a>)}
            </div>
        )
    }
}

const defaultTodayFocusProps = {
    visual: "Today" as string,
};
type TodayFocusProps = Readonly<typeof defaultTodayFocusProps>;
class TodayFocus extends React.Component<TodayFocusProps> {
    render(): React.ReactNode {
        return (
            <TodayFocusEventHandlersContext.Consumer>{callback => (
                <div className='todayHeader' aria-label='Focus today' onClick={callback.handleTodayFocusClick}>
                    {this.props.visual}
                </div>)}
            </TodayFocusEventHandlersContext.Consumer>
        );
    }
}

const defaultCountersProps = {
}

type CountersProps = Readonly<typeof defaultCountersProps>;

class Counters extends React.Component<CountersProps> {
    render(): React.ReactNode {
        return (
            <UserOptionContext.Consumer>{options => (
                < div className='counters' >
                    {options.counters.map((c, i) =>
                        <CounterItem onClick={c.onClick} cnt={c.cnt} id={c.id} label={c.label} ariaLabel={c.ariaLabel} key={i} />
                    )}
                </div>
            )}
            </UserOptionContext.Consumer>
        );
    }
}

const defaultCounterProps = {
    onClick: () => { },
    cnt: 0,
    id: "",
    label: "",
    ariaLabel: ""
}

export type CounterProps = Readonly<typeof defaultCounterProps>;

class CounterItem extends React.Component<CounterProps> {
    render(): React.ReactNode {
        return (<div className='counter' id={this.props.id} aria-label={this.props.ariaLabel} onClick={this.props.onClick}>
            <div className='count'>{this.props.cnt}</div>
            <div className='label'>{this.props.label}</div>
        </div>
        );
    }
}