export interface CalendarSettings {
    viewPath: string,
    view: string,
    firstDayOfWeek: string,
    options: string,
    dailyNoteFolder: string | null,
    dailyNoteFormat: string | null,
    startPosition: string | null,
    globalTaskFilter: string | null,
    css: string | null,
    pages: string
};

export interface TimelineSettings {
    viewPath: string,
    options: string,
    dailyNoteFolder: string | null,
    dailyNoteFormat: string | null,
    section: string | null,
    sort: string | null,
    forward: string,
    select: string | null,
    inbox: string | null,
    taskFiles: string,
    globalTaskFilter: string | null,
    pages: string
};

export function serializeSettingToDVJS(setting: CalendarSettings | TimelineSettings) {
    if(!setting.viewPath)return "";
    var ans = `dv.view("${setting.viewPath}", {`;

    let key: keyof(typeof setting);
    for(key in setting){
        if(key == "viewPath")continue;
        if(setting[key] == null)continue;
        ans += `${key}: "${setting[key]}",`
    }
    ans = ans.trimEnd() + "})";
    return ans;
}
