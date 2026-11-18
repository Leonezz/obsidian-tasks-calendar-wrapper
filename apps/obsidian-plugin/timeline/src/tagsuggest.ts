import { AbstractInputSuggest, type App } from "obsidian";

/** The whitespace-delimited tag around the caret, including any untyped suffix. */
function activeTag(text: string, caret: number) {
	let from = Math.max(0, Math.min(caret, text.length));
	let to = from;
	while (from > 0 && !/\s/u.test(text[from - 1])) from--;
	while (to < text.length && !/\s/u.test(text[to])) to++;
	return { from, to, prefix: text.slice(from, caret) };
}

/** Suggests the tag at the caret without replacing the other tags in the filter. */
export class TagSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly field: HTMLInputElement,
		private readonly listTags: () => readonly string[],
		private readonly onPick: (text: string) => void,
	) {
		super(app, field);
	}

	protected getSuggestions(query: string): string[] {
		const { prefix } = activeTag(query, this.field.selectionStart ?? query.length);
		const wanted = prefix.replace(/^#+/, "").toLowerCase();
		return this.listTags().filter((tag) => tag.toLowerCase().includes(wanted));
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText(tag);
	}

	selectSuggestion(tag: string, evt?: MouseEvent | KeyboardEvent): void {
		if (evt instanceof KeyboardEvent && (evt.isComposing || evt.keyCode === 229)) return;
		const text = this.field.value;
		const { from, to } = activeTag(text, this.field.selectionStart ?? text.length);
		const suffix = text.slice(to);
		// Leave existing separators alone; a final tag gets one so another can be typed immediately.
		const next = text.slice(0, from) + tag + (suffix || " ");
		const caret = suffix.trim() === "" ? next.length : from + tag.length;
		this.setValue(next);
		this.close();
		this.field.focus();
		this.field.setSelectionRange(caret, caret);
		this.onPick(next);
	}
}
