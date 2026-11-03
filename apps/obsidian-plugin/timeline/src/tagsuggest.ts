import { AbstractInputSuggest, type App } from "obsidian";

/** Suggests the timeline's task tags under the tag filter, matching the typed text anywhere in the tag. */
export class TagSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly field: HTMLInputElement,
		private readonly listTags: () => readonly string[],
		private readonly onPick: (tag: string) => void,
	) {
		super(app, field);
	}

	protected getSuggestions(query: string): string[] {
		const wanted = query.trim().replace(/^#+/, "").toLowerCase();
		return this.listTags().filter((tag) => tag.toLowerCase().includes(wanted));
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText(tag);
	}

	selectSuggestion(tag: string): void {
		this.setValue(tag);
		this.onPick(tag);
		this.close();
		this.field.blur();
	}
}
