import { App, FrontMatterCache, LinkCache, ListItemCache, Notice, Pos, SectionCache, TagCache, TFile } from "obsidian";
import { Link } from "../../dataview-util/markdown";
import { TaskDataModel, TaskRegularExpressions } from "../../utils/tasks";

export class ObsidianTaskAdapter {
    private app: App;
    private tasksList: TaskDataModel[] = [];
    constructor(app: App) {
        this.app = app;

        this.generateTasksList = this.generateTasksList.bind(this);
        this.getTaskList = this.getTaskList.bind(this);
        this.fromItemCache = this.fromItemCache.bind(this);
        this.fromLine = this.fromLine.bind(this);

    }

    getTaskList() {
        return [...this.tasksList];
    }

    pathsFilter(filter: string[]) {
        const isParent = (parent: string, path: string) => {
            if (parent.length > path.length) return false;
            const paths = path.split('/');
            const parents = parent.split('/');
            return parents.every((v, i) => v === paths[i]);
        };
        return (file: TFile) => {
            const fileName = file.path;
            return !filter.some((path) => isParent(path, fileName));
        }
    }

    includePathsFilter(filter: string[]) {
        const isParent = (parent: string, path: string) => {
            if (parent.length > path.length) return false;
            const paths = path.split('/');
            const parents = parent.split('/');
            return parents.every((v, i) => v === paths[i]);
        };
        return (file: TFile) => {
            const fileName = file.path;
            return filter.some((path) => isParent(path, fileName));
        }
    }

    fileIncludeTagsFilter(filter: string[]) {
        return (file: TFile) => {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache?.tags?.map(t => t.tag);
            return filter.some(tag => tags?.includes(tag));
        }
    }

    fileExcludeTagsFilter(filter: string[]) {
        return (file: TFile) => {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache?.tags?.map(t => t.tag);
            return filter.every(tag => !tags?.includes(tag));
        }
    }

    async generateTasksList(includeFilter: string[], pathFilter: string[], includeTags: string[], excludeTags: string[]) {
        this.tasksList.length = 0;
        const files = this.app.vault.getMarkdownFiles()
        let filteredFiles = files;
        if (includeFilter.length !== 0)
            filteredFiles = filteredFiles.filter(this.includePathsFilter(includeFilter));
        if (pathFilter.length !== 0)
            filteredFiles = filteredFiles.filter(this.pathsFilter(pathFilter));
        if (includeTags.length !== 0)
            filteredFiles = filteredFiles.filter(this.fileIncludeTagsFilter(includeTags));
        if (excludeTags.length !== 0)
            filteredFiles = filteredFiles.filter(this.fileExcludeTagsFilter(excludeTags));

        // Every read has to finish before the list is handed over. Without waiting, files that
        // were not in Obsidian's read cache yet were silently left out, see issue #80.
        const reads = await Promise.allSettled(filteredFiles.map(async (file: TFile) => {
            const content = await this.app.vault.cachedRead(file);
            const cache = this.app.metadataCache.getFileCache(file);
            cache?.listItems?.forEach(
                this.fromItemCache(Link.file(file.path), file.path, content, cache.sections, cache.links, cache.frontmatter, cache.tags)
            );
        }));

        const failed = reads.filter((read): read is PromiseRejectedResult => read.status === "rejected");
        if (failed.length > 0) {
            failed.forEach(read => console.error("Tasks Calendar Wrapper: reading a file failed", read.reason));
            new Notice(`Tasks Calendar Wrapper: ${failed.length} file(s) could not be read, their tasks are missing. See the developer console.`, 5000);
        }
    }

    /**
     * This function takes all known list items as input and passes them to fromLine.
     * @param link A Link object points to the file where the list item belongs. It can also be constructed from the file path,
     * the only reason this is an augment is to avoid constructing one same Link for every item.
     * @param filePath The path of the file where the list item belongs.
     * @param fileContent The file content for extracting the raw texts for list items. The reason this is an augment is to avoiding
     * reading one same file for every item.
     * @param sections The section cache from Obsidian.
     * @param links The link cache from Obsidian.
     * @param fontmatter The fontmatter cache from Obsidian.
     * @param tags The tag cache from Obsidian.
     * @returns This funcion directly modify this.taskList. 
     */
    private fromItemCache(link: Link, filePath: string, fileContent: string,
        sections?: SectionCache[], links?: LinkCache[], fontmatter?: FrontMatterCache, tagsCache?: TagCache[]) {
        return (item: ListItemCache) => {
            if (!(item.task)) return null;
            const itemPos = item.position;

            const findParent = () => {
                if (!sections) return null;
                if (item.parent > 0) {
                    for (const s of sections) {
                        if (s.position.start.line === item.parent) return s;
                    }
                } else {
                    let p = -1;
                    let parentHeader = null;
                    for (const s of sections) {
                        if (s.type === "heading" && s.position.start.line > p && s.position.start.line < item.position.start.line) {
                            parentHeader = s;
                            p = parentHeader.position.start.line;
                        }
                    }
                    return parentHeader;
                }
                return null;
            };

            const findOutLinks = (line: number) => {
                if (!links) return null;
                return links.filter(s => s.position.start.line === line);
            };

            const findTags = (line: number): string[] | null => {
                if (!tagsCache) return null;
                return tagsCache.filter(t => t.position.start.line === line).map(s => s.tag);
            };

            const sliceFileContent = (pos: Pos) => {
                return fileContent.slice(pos.start.offset, pos.end.offset);
            };

            const itemText = sliceFileContent(itemPos);
            const parentItem = findParent();
            const outLinks = findOutLinks(itemPos.start.line);
            const parentLink = (parentItem) ?
                link.withSectionCache(parentItem, sliceFileContent(parentItem?.position)) : link;
            const outLinkLinks = (outLinks) ?
                outLinks.map(v => Link.withLinkCache(v)) : [];

            const tags = findTags(itemPos.start.line);

            const taskItem = this.fromLine(itemText, filePath, parentLink, itemPos, outLinkLinks, fontmatter, tags || []);
            if (taskItem) {
                this.tasksList.push(taskItem);
            }
        }
    }
    /**
     * This function parse the raw text of a list item and judge if it is a task item.
     * If it is a task item, it extract only basic information to construct a TaskDataModel.
     * All other information should be in the TaskDataModel.text field.
     * @param line The raw text of the list item, including the list markers
     * @param filePath The file path where the list item is from.
     * @param parent A Link object points to the parent section of the list item.
     * @param position A Pos object from Obsidian.
     * @param outLinks Links from Obsidian.
     * //@param children 
     * //@param annotated 
     * @param frontMatter The yaml data in the header of the file where the list item belongs.
     * @param tags Tag list contained in the list item.
     * @returns A TaskDataModel with basic information if the list item is a Task, null if it is not.
     */
    private fromLine(
        line: string,
        filePath: string,
        parent: Link,
        position: Pos,
        outLinks: Link[],
        //children: TaskDataModel[],
        //annotated: boolean,
        frontMatter: Record<string, string> | undefined,
        tags: string[],
    ): TaskDataModel | null {
        // Check the line to see if it is a markdown task.
        const regexMatch = line.match(TaskRegularExpressions.taskRegex);
        if (regexMatch === null) {
            return null;
        }

        // match[4] includes the whole body of the task after the brackets.
        const body = regexMatch[4].trim();

        let description = body;
        //const indentation = regexMatch[1]; // before - [ ]
        const listMarker = regexMatch[2]; // - for - [ ]

        // Get the status of the task.
        const statusString = regexMatch[3]; // x for - [x]
        //const status = statusString;// StatusRegistry.getInstance().bySymbolOrCreate(statusString);

        // Match for block link and remove if found. Always expected to be
        // at the end of the line.
        const blockLinkMatch = description.match(TaskRegularExpressions.blockLinkRegex);
        const blockLink = blockLinkMatch !== null ? blockLinkMatch[0] : '';

        if (blockLink !== '') {
            description = description.replace(TaskRegularExpressions.blockLinkRegex, '').trim();
        }

        if (frontMatter) {
            if (frontMatter["tag"] && typeof (frontMatter["tag"]) === "string") {
                // add # as prefix if there is not such prefix
                // But it seems unnecessary to judge cuz in obsidian # prefix is not allowed for the frontmatter tags
                const frontmatterTagPrefix = frontMatter["tag"].startsWith("#") ? "" : "#";
                tags.push(frontmatterTagPrefix + frontMatter["tag"]);
            }
            if (frontMatter["tags"] && typeof (frontMatter["tags"]) === typeof (new Array<string>())) {
                // add # as prefix if there is not such prefix
                (frontMatter["tags"] as unknown as Array<string>).forEach(t => tags.push(t.startsWith("#") ? "" : "#" + t));
            }
        }

        tags = [...new Set(tags)];

        const taskItem: TaskDataModel = {
            symbol: listMarker,
            link: parent,
            section: parent,
            text: line,
            visual: description.trim(),
            tags: tags,
            line: position.start.line,
            lineCount: position.end.line - position.start.line + 1,
            list: position.start.line,
            outlinks: outLinks,
            path: filePath,
            children: [],
            task: true,
            annotated: false,
            position: position,
            subtasks: [],
            real: true,
            header: parent,
            status: statusString,
            statusMarker: statusString,
            checked: description.replace(' ', '').length !== 0,
            completed: statusString === 'x',
            fullyCompleted: statusString !== ' ',
            dailyNote: false,
            order: 0,
            priority: "",
            //happens: new Map<string, string>(),
            recurrence: "",
            fontMatter: frontMatter || {},
            isTasksTask: false,
            due: undefined,
            scheduled: undefined,
            start: undefined,
            completion: undefined,
            dates: new Map(),
        };
        return taskItem;
    }
}
