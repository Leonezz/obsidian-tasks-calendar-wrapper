import * as React from "react";

export type MultiSelectProps = {
	name: string;
	ariaLabel?: string;
	className: string;
	options: string[];
	selected: readonly string[];
	visual: readonly string[];
	selectChangeHandler: (options: string[]) => void;
	fallbackValueIndex: number;
};

export function MultiSelect(props: MultiSelectProps) {
	const selectElem = React.useRef<HTMLSelectElement>(null);
	return (
		<div className="left MultiSelect">
			<select
				name={props.name}
				aria-label={props.ariaLabel}
				className={props.className}
				ref={selectElem}
				onClick={() => {
					if (selectElem.current !== null) selectElem.current.selectedIndex = props.fallbackValueIndex;
				}}
				onChange={(e) => {
					const idx = e.target.selectedIndex;
					if (idx === props.fallbackValueIndex) return;
					const value = props.options[idx];
					const selected = props.selected;
					const results = selected.includes(value)
						? selected.filter((result) => result !== value)
						: [...selected, value];
					props.selectChangeHandler(results);
				}}
			>
				{props.options
					//.filter((_, i) => i !== props.fallbackValueIndex)
					.map((n, i) => (
						<option value={n} key={i}>
							{props.visual[i] + (props.selected.includes(n) ? "🎯" : " ")}
						</option>
					))}
			</select>
			{props.selected.map((f) => (
				<a key={f}>{props.visual[props.options.indexOf(f)] + "🎯"}</a>
			))}
		</div>
	);
}
