

export const {pages, inbox, select, taskOrder, taskFiles, globalTaskFilter, dailyNoteFolder, dailyNoteFormat, done, sort, css, forward, dateFormat, options, section} = input;

if (!pages && pages!="") { dv.span('> [!ERROR] Missing pages parameter\n> \n> Please set the pages parameter like\n> \n> `pages: ""`'); return false };
if (dailyNoteFormat) { if (dailyNoteFormat.match(/[|\\YMDWwd.,-: \[\]]/g).length != dailyNoteFormat.length) { dv.span('> [!ERROR] The `dailyNoteFormat` contains invalid characters'); return false }};

// Get, Set, Eval Pages
if (pages=="") { var tasks = dv.pages().file.tasks } else { if (pages.startsWith("dv.pages")) { var tasks = eval(pages) } else { var tasks = dv.pages(pages).file.tasks } };
if (!taskFiles) { taskFiles = [...new Set(dv.pages().file.map(f=>f.tasks.filter(t=>!t.completed)).path)].sort(); } else { taskFiles = [...new Set(dv.pagePaths(taskFiles))].sort() };
if (!options) {options = ""};
if (!dailyNoteFolder) {dailyNoteFolder = ""} else {dailyNoteFolder = dailyNoteFolder+"/"};
if (!dailyNoteFormat) {dailyNoteFormat = "YYYY-MM-DD"};
if (!taskOrder) {taskOrder = ["overdue", "due", "scheduled", "start", "process", "unplanned","done","cancelled"]};
if (!sort) {sort = "t=>t.order"};
if (!dateFormat) {dateFormat = "ddd, MMM D"};
if (!select) {select = "dailyNote"};

export const rootNode = dv.el("div", "", {cls: "taskido "+options, attr: {id: "taskido"+tid}});
if (css) { var style = document.createElement("style"); style.innerHTML = css; rootNode.querySelector("span").append(style) };