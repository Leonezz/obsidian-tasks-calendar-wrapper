import { AbstractInputSuggest, getAllTags, type App } from "obsidian";
import { TaskRegularExpressions } from "@tasks-calendar-wrapper/core";

// The task parser's tag syntax, without its stateful `g` flag. The complete input must be one tag.
const tagPattern = new RegExp(TaskRegularExpressions.hashTags.source, "u");

export function isSingleTag(tag: string): boolean {
	return tag.length > 1 && tag.startsWith("#") && !/\s/u.test(tag) && tag.match(tagPattern)?.[0] === tag;
}

/** Tags indexed by Obsidian, including frontmatter, read when the suggestions are requested. */
export class SettingsTagSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly excluded: () => readonly string[],
		private readonly choose: (tag: string) => void,
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const selected = new Set(this.excluded());
		const tags = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache) for (const tag of getAllTags(cache) ?? []) if (isSingleTag(tag)) tags.add(tag);
		}
		const needle = query.trim().toLocaleLowerCase();
		return [...tags]
			.filter((tag) => !selected.has(tag) && tag.toLocaleLowerCase().includes(needle))
			.sort((a, b) => a.localeCompare(b))
			.slice(0, 30);
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText(tag);
	}

	selectSuggestion(tag: string, event?: MouseEvent | KeyboardEvent): void {
		if (event && "isComposing" in event && (event.isComposing || event.keyCode === 229)) return;
		event?.preventDefault();
		this.setValue(tag);
		this.close();
		this.choose(tag);
		this.input.focus();
	}
}
