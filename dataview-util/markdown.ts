import { LinkCache, Pos, SectionCache } from 'obsidian';
import { getFileTitle, normalizeHeaderForLink } from './dataview';
//////////
// LINK //
//////////

/** The Obsidian 'link', used for uniquely describing a file, header, or block. */
export class Link {
    /** The file path this link points to. */
    public path: string;
    /** The display name associated with the link. */
    public display?: string;
    /** The block ID or header this link points to within a file, if relevant. */
    public subpath?: string;
    /** Is this link an embedded link (!)? */
    public embed: boolean;
    /** The type of this link, which determines what 'subpath' refers to, if anything. */
    public type: "file" | "header" | "block";

    public withListCache(id?: string, _itemText?: string) {
        return new Link({
            path: this.path,
            display: this.display,
            subpath: id,
            embed: this.embed,
            type: "block",
        })
    }

    public static withLinkCache(cache: LinkCache) {
        return Link.file(cache.link, false, cache.displayText);
    }

    public withSectionCache(cache: SectionCache, text: string) {
        switch (cache.type) {
            case "heading":
                return this.withHeader(text);
            case "list":
                return this.withListCache(cache.id, text);
            case "block":
                return new Link({ path: this.path, display: this.display, subpath: cache.id, embed: this.embed, type: "block" })
            default:
                return this.toFile();
        }
    }

    /** Create a link to a specific file. */
    public static file(path: string, embed = false, display?: string) {
        return new Link({
            path,
            embed,
            display,
            subpath: undefined,
            type: "file",
        });
    }

    public static infer(linkpath: string, embed = false, display?: string) {
        if (linkpath.includes("#^")) {
            const split = linkpath.split("#^");
            return Link.block(split[0], split[1], embed, display);
        } else if (linkpath.includes("#")) {
            const split = linkpath.split("#");
            return Link.header(split[0], split[1], embed, display);
        } else return Link.file(linkpath, embed, display);
    }

    /** Create a link to a specific file and header in that file. */
    public static header(path: string, header: string, embed?: boolean, display?: string) {
        // Headers need to be normalized to alpha-numeric & with extra spacing removed.
        return new Link({
            path,
            embed,
            display,
            subpath: normalizeHeaderForLink(header),
            type: "header",
        });
    }

    /** Create a link to a specific file and block in that file. */
    public static block(path: string, blockId: string, embed?: boolean, display?: string) {
        return new Link({
            path,
            embed,
            display,
            subpath: blockId,
            type: "block",
        });
    }

    public static fromObject(object: Record<string, any>) {
        return new Link(object);
    }

    private constructor(fields: Partial<Link>) {
        Object.assign(this, fields);
    }

    /** Checks for link equality (i.e., that the links are pointing to the same exact location). */
    public equals(other: Link): boolean {
        if (other == undefined || other == null) return false;

        return this.path == other.path && this.type == other.type && this.subpath == other.subpath;
    }

    /** Convert this link to it's markdown representation. */
    public toString(): string {
        return this.markdown();
    }

    /** Convert this link to a raw object which is serialization-friendly. */
    public toObject(): Record<string, any> {
        return { path: this.path, type: this.type, subpath: this.subpath, display: this.display, embed: this.embed };
    }

    /** Update this link with a new path. */
    //@ts-ignore; error appeared after updating Obsidian to 0.15.4; it also updated other packages but didn't say which
    public withPath(path: string) {
        return new Link(Object.assign({}, this, { path }));
    }

    /** Return a new link which points to the same location but with a new display value. */
    public withDisplay(display?: string) {
        return new Link(Object.assign({}, this, { display }));
    }

    /** Convert a file link into a link to a specific header. */
    public withHeader(header: string) {
        return Link.header(this.path, header, this.embed, this.display);
    }

    /** Convert any link into a link to its file. */
    public toFile() {
        return Link.file(this.path, this.embed, this.display);
    }

    /** Convert this link into an embedded link. */
    public toEmbed(): Link {
        if (this.embed) {
            return this;
        } else {
            const link = new Link(this);
            link.embed = true;
            return link;
        }
    }

    /** Convert this link into a non-embedded link. */
    public fromEmbed(): Link {
        if (!this.embed) {
            return this;
        } else {
            const link = new Link(this);
            link.embed = false;
            return link;
        }
    }

    /** Convert this link to markdown so it can be rendered. */
    public markdown(): string {
        let result = (this.embed ? "!" : "") + "[[" + this.obsidianLink();

        if (this.display) {
            result += "|" + this.display;
        } else {
            result += "|" + getFileTitle(this.path);
            if (this.type == "header" || this.type == "block") result += " > " + this.subpath;
        }

        result += "]]";
        return result;
    }

    /** Convert the inner part of the link to something that Obsidian can open / understand. */
    public obsidianLink(): string {
        const escaped = this.path.replace("|", "\\|");
        if (this.type == "header") return escaped + "#" + this.subpath?.replace("|", "\\|");
        if (this.type == "block") return escaped + "#^" + this.subpath?.replace("|", "\\|");
        else return escaped;
    }

    /** The stripped name of the file this link points to. */
    public fileName(): string {
        return getFileTitle(this.path).replace(".md", "");
    }
}


/** All extracted markdown file metadata obtained from a file. */
export class PageMetadata {
    /** The path this file exists at. */
    public path: string;
    /** Obsidian-provided date this page was created. */
    public ctime: string;
    /** Obsidian-provided date this page was modified. */
    public mtime: string;
    /** Obsidian-provided size of this page in bytes. */
    public size: number;
    /** The day associated with this page, if relevant. */
    public day?: string;
    /** The first H1/H2 header in the file. May not exist. */
    public title?: string;
    /** All of the fields contained in this markdown file - both frontmatter AND in-file links. */
    public fields: Map<string, string>;
    /** All of the exact tags (prefixed with '#') in this file overall. */
    public tags: Set<string>;
    /** All of the aliases defined for this file. */
    public aliases: Set<string>;
    /** All OUTGOING links (including embeds, header + block links) in this file. */
    public links: Link[];
    /** All list items contained within this page. Filter for tasks to get just tasks. */
    public lists: ListItem[];
    /** The raw frontmatter for this document. */
    public frontmatter: Record<string, string>;

    public constructor(path: string, init?: Partial<PageMetadata>) {
        this.path = path;
        this.fields = new Map<string, string>();
        this.frontmatter = {};
        this.tags = new Set<string>();
        this.aliases = new Set<string>();
        this.links = [];

        Object.assign(this, init);

        this.lists = (this.lists || []).map(l => new ListItem(l));
    }


    /** The name (based on path) of this file. */
    public name(): string {
        return getFileTitle(this.path);
    }
}

/** A list item inside of a list. */
export class ListItem {
    /** The symbol ('*', '-', '1.') used to define this list item. */
    symbol: string;
    /** A link which points to this task, or to the closest block that this task is contained in. */
    link: Link;
    /** A link to the section that contains this list element; could be a file if this is not in a section. */
    section: Link;
    /** The text of this list item. This may be multiple lines of markdown. */
    text: string;
    /** The line that this list item starts on in the file. */
    line: number;
    /** The number of lines that define this list item. */
    lineCount: number;
    /** The line number for the first list item in the list this item belongs to. */
    list: number;
    /** Any links contained within this list item. */
    links: Link[];
    /** The tags contained within this list item. */
    tags: Set<string>;
    /** The raw Obsidian-provided position for where this task is. */
    position: Pos;
    /** The line number of the parent list item, if present; if this is undefined, this is a root item. */
    parent?: number;
    /** The line numbers of children of this list item. */
    children: number[];
    /** The block ID for this item, if one is present. */
    blockId?: string;
    /** Any fields defined in this list item. For tasks, this includes fields underneath the task. */
    fields: Map<string, string>;

    task?: {
        /** The text in between the brackets of the '[ ]' task indicator ('[X]' would yield 'X', for example.) */
        status: string;
        /** Whether or not this task has been checked in any way (it's status is not empty/space). */
        checked: boolean;
        /** Whether or not this task was completed; derived from 'status' by checking if the field 'X' or 'x'. */
        completed: boolean;
        /** Whether or not this task and all of it's subtasks are completed. */
        fullyCompleted: boolean;
    };

    public constructor(init?: Partial<ListItem>) {
        Object.assign(this, init);

        this.fields = this.fields || new Map();
        this.tags = this.tags || new Set();
        this.children = this.children || [];
        this.links = this.links || [];
    }

    public id(): string {
        return `${this.file().path}-${this.line}`;
    }

    public file(): Link {
        return this.link.toFile();
    }

    public markdown(): string {
        if (this.task) return `${this.symbol} [${this.task.completed ? "x" : " "}] ${this.text}`;
        else return `${this.symbol} ${this.text}`;
    }
}

/** A serialized list item as seen by users; this is not a task. */
export interface SListEntry extends SListItemBase {
    task: false;
}
/** A serialized list item. */
export type SListItem = SListEntry | STask;

/** A serialized task. */
export interface STask extends SListItemBase {
    task: true;
    /** The status of this task, the text between the brackets ('[ ]'). Will be a space if the task is currently unchecked. */
    status: string;
    /** Indicates whether the task has any value other than empty space. */
    checked: boolean;
    /** Indicates whether the task explicitly has been marked "completed" ('x' or 'X'). */
    completed: boolean;
    /** Indicates whether the task and ALL subtasks have been completed. */
    fullyCompleted: boolean;

    /** If present, then the time that this task was created. */
    created?: moment.Moment;
    /** If present, then the time that this task was due. */
    due?: moment.Moment;
    /** If present, then the time that this task was completed. */
    completion?: moment.Moment;
    /** If present, then the day that this task can be started. */
    start?: moment.Moment;
    /** If present, then the day that work on this task is scheduled. */
    scheduled?: moment.Moment;
}

/** Shared data between list items. */
export interface SListItemBase {
    /** The symbo used to start this list item, like '1.' or '1)' or '*'. */
    symbol: string;
    /** A link to the closest thing to this list item (a block, a section, or a file). */
    link: Link;
    /** The section that contains this list item. */
    section: Link;
    /** The path of the file that contains this item. */
    path: string;

    /** The line this item starts on. */
    line: number;
    /** The number of lines this item spans. */
    lineCount: number;
    /** The internal Obsidian tracker of the exact position of this line. */
    position: Pos;
    /** The line number of the list that this item is part of. */
    list: number;
    /** If present, the block ID for this item. */
    blockId?: string;
    /** The line number of the parent item to this list, if relevant. */
    parent?: number;
    /** The children elements of this list item. */
    children: SListItem[];
    /** Links contained inside this list item. */
    outlinks: Link[];

    /** The raw text of this item. */
    text: string;
    /**
     * If present, overrides 'text' when rendered in task views. You should not mutate 'text' since it is used to
     * validate a list item when editing it.
     */
    visual?: string;
    /** Whether this item has any metadata annotations on it. */
    annotated?: boolean;

    /** Any tags present in this task. */
    tags: string[];

    /** @deprecated use 'children' instead. */
    subtasks: SListItem[];
    /** @deprecated use 'task' instead. */
    real: boolean;
    /** @deprecated use 'section' instead. */
    header: Link;

    /** Additional fields added by annotations. */
    //[key: string]: any;
}
