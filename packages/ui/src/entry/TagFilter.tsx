import * as React from "react";
import { copy, createStore, type QuickFilter } from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext } from "../contexts";
import { useStore } from "../hooks/useStore";

/** The static markup tests render rows without a DOM, where React warns about layout effects. */
const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

/** Tags keep their spelling and nesting; the query matches them ignoring case. */
function tagsOf(text: string): string[] {
	const tags = new Map<string, string>();
	for (const token of text.split(/\s+/u)) {
		const tag = token.replace(/^#+/, "");
		if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), "#" + tag);
	}
	return [...tags.values()];
}

type SubmittedFilter = {
	readonly from?: string;
	readonly to?: string;
	readonly priorities: readonly string[];
	readonly tags: readonly string[];
};

export type TagFilterDraft = {
	readonly text: string;
	readonly applied?: QuickFilter;
	readonly submitted?: SubmittedFilter;
	readonly selection?: { readonly start: number; readonly end: number };
};

/** The view keeps the editor's continuation outside the keyed years and days. */
export function createTagFilterDraft() {
	return createStore<TagFilterDraft>({ text: "" });
}

function matchesSubmission(applied: QuickFilter | undefined, submitted: SubmittedFilter): boolean {
	const same = (left: readonly string[], right: readonly string[]) =>
		left.length === right.length && left.every((value, index) => value === right[index]);
	return (
		applied?.from === submitted.from &&
		applied?.to === submitted.to &&
		same(applied?.priorities ?? [], submitted.priorities) &&
		same(applied?.tags ?? [], submitted.tags)
	);
}

type TagFilterProps = {
	readonly applied?: QuickFilter;
	readonly tags: readonly string[];
	readonly draft?: ReturnType<typeof createTagFilterDraft>;
};

/**
 * Shows tasks with any typed tag, suggesting the tags on the tasks. A suggestion or Enter applies them, and emptying
 * the box clears it. It is shown whether the quick entry panel is or not, and keeps the panel's dates and priorities.
 */
export function TagFilter({ applied, tags, draft: suppliedDraft }: TagFilterProps) {
	const callback = React.useContext(QuickEntryHandlerContext);
	const input = React.useRef<HTMLInputElement>(null);
	const composing = React.useRef(false);
	const fallback = React.useRef<ReturnType<typeof createTagFilterDraft>>();
	if (!fallback.current) fallback.current = createTagFilterDraft();
	const store = suppliedDraft ?? fallback.current;
	const draft = useStore(store);
	const ownUpdate = draft.submitted && matchesSubmission(applied, draft.submitted);
	/** External filter identities replace a draft; our own application retains its spaces and caret. */
	const effectiveText = draft.applied === applied || ownUpdate ? draft.text : (applied?.tags?.join(" ") ?? "");
	const latest = React.useRef({ tags, applied, callback });
	useClientLayoutEffect(() => {
		latest.current = { tags, applied, callback };
		const current = store.getSnapshot();
		const ownUpdate = current.submitted && matchesSubmission(applied, current.submitted);
		if (ownUpdate && current.selection && input.current) {
			input.current.focus();
			input.current.setSelectionRange(current.selection.start, current.selection.end);
		}
		if (current.applied !== applied || ownUpdate)
			store.setState({
				text: current.applied === applied || ownUpdate ? current.text : (applied?.tags?.join(" ") ?? ""),
				applied,
			});
	});
	useClientLayoutEffect(() => {
		if (!input.current) return;
		let listening = true;
		const stop = callback.suggestTags?.(
			input.current,
			() => latest.current.tags,
			(text) => {
				if (!listening || composing.current) return;
				const field = input.current;
				apply(text, {
					start: field?.value === text ? (field.selectionStart ?? text.length) : text.length,
					end: field?.value === text ? (field.selectionEnd ?? text.length) : text.length,
				});
			},
		);
		return () => {
			listening = false;
			stop?.();
		};
	}, []);

	function apply(text: string, selection?: TagFilterDraft["selection"]): void {
		const { applied, callback } = latest.current;
		const field = input.current;
		const caret =
			selection ??
			(field && field.ownerDocument.activeElement === field
				? { start: field.selectionStart ?? text.length, end: field.selectionEnd ?? text.length }
				: undefined);
		const priorities = [...(applied?.priorities ?? [])];
		const tags = tagsOf(text);
		store.setState({
			text,
			applied,
			submitted: { from: applied?.from, to: applied?.to, priorities, tags },
			selection: caret,
		});
		callback.handleFilterEnable(applied?.from, applied?.to, priorities, tags);
	}

	return (
		<div className="tagFilterBar">
			<input
				ref={input}
				type="search"
				placeholder={copy.quickEntry.tagPlaceholder}
				aria-label={copy.quickEntry.tagAria}
				value={effectiveText}
				onCompositionStart={() => {
					composing.current = true;
				}}
				onCompositionEnd={() => {
					composing.current = false;
				}}
				onChange={(e) => {
					const text = e.target.value;
					store.setState({ text, applied });
					if (text.trim() === "") apply(text);
				}}
				onKeyDown={(e) => {
					if (
						e.key === "Enter" &&
						!e.defaultPrevented &&
						!e.nativeEvent.isComposing &&
						!composing.current &&
						e.keyCode !== 229
					) {
						e.preventDefault();
						apply(e.currentTarget.value);
					}
				}}
			/>
		</div>
	);
}
