export interface CalendarSettings {
    viewPath: String,
    view: String,
    firstDayOfWeek: String,
    options: String,
    dailyNoteFolder: String | null,
    dailyNoteFormat: String | null,
    startPosition: String | null,
    globalTaskFilter: String | null,
    css: String | null,
    pages: String
};

export interface TimelineSettings {
    viewPath: String,
    options: String,
    dailyNoteFolder: String | null,
    dailyNoteFormat: String | null,
    section: String | null,
    sort: String | null,
    forward: String | null,
    select: String | null,
    inbox: String | null,
    taskFiles: String,
    globalTaskFilter: String | null,
    pages: String
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