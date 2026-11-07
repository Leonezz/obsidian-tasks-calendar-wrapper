import * as React from "react";
import type { QuickFilter } from "@tasks-calendar-wrapper/core";
import { QuickEntryHandlerContext } from "../contexts";

/** The static markup tests render rows without a DOM, where React warns about layout effects. */
const useClientLayoutEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

/** The tag typed in the tag filter, with its "#"; none for an empty filter. */
function tagsOf(text: string): string[] {
	const tag = text.trim().replace(/^#+/, "");
	return tag === "" ? [] : ["#" + tag];
}

type TagFilterProps = { readonly applied?: QuickFilter; readonly tags: readonly string[] };

/**
 * Shows only tasks with the typed tag, suggesting the tags on the tasks. A suggestion or Enter applies it, and emptying
 * the box clears it. It is shown whether the quick entry panel is or not, and keeps the panel's dates and priorities.
 */
export function TagFilter({ applied, tags }: TagFilterProps) {
	const callback = React.useContext(QuickEntryHandlerContext);
	const input = React.useRef<HTMLInputElement>(null);
	/** A filter applied or cleared elsewhere, such as by adding a task, shows its own tag. */
	const [state, setState] = React.useState(() => ({ gen: 0, text: applied?.tags?.join(" ") ?? "" }));
	const committed = React.useRef({ applied, gen: 0 });
	const gen = applied === committed.current.applied ? committed.current.gen : committed.current.gen + 1;
	const effectiveText = state.gen === gen ? state.text : (applied?.tags?.join(" ") ?? "");
	const latest = React.useRef({ tags, applied, callback });
	useClientLayoutEffect(() => {
		committed.current = { applied, gen };
		latest.current = { tags, applied, callback };
	});
	useClientLayoutEffect(() => {
		if (!input.current) return;
		const stop = callback.suggestTags?.(
			input.current,
			() => latest.current.tags,
			(tag) => {
				setState({ gen: committed.current.gen, text: tag });
				apply(tag);
			},
		);
		return () => stop?.();
	}, []);

	function apply(text: string): void {
		const { applied, callback } = latest.current;
		callback.handleFilterEnable(applied?.from, applied?.to, [...(applied?.priorities ?? [])], tagsOf(text));
	}

	return (
		<div className="tagFilterBar">
			<input
				ref={input}
				type="search"
				placeholder="🏷️ Filter by tag: #home"
				aria-label="Show only tasks with this tag"
				value={effectiveText}
				onChange={(e) => {
					const text = e.target.value;
					setState({ gen, text });
					if (text.trim() === "") apply("");
				}}
				onKeyUp={(e) => {
					if (e.key === "Enter") apply(effectiveText);
				}}
			/>
		</div>
	);
}
