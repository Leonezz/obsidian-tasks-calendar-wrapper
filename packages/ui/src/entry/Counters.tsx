export type CounterProps = {
	readonly onClick: () => void;
	readonly cnt: number;
	readonly id: string;
	readonly label: string;
	readonly ariaLabel: string;
};

export function Counters({ counters }: { readonly counters: readonly CounterProps[] }) {
	return (
		<div className="counters">
			{counters.map((c, i) => (
				<CounterItem
					onClick={c.onClick}
					cnt={c.cnt}
					id={c.id}
					label={c.label}
					ariaLabel={c.ariaLabel}
					key={i}
				/>
			))}
		</div>
	);
}

export function CounterItem(props: CounterProps) {
	return (
		<div className="counter" id={props.id} aria-label={props.ariaLabel} onClick={props.onClick}>
			<div className="count">{props.cnt}</div>
			<div className="label">{props.label}</div>
		</div>
	);
}
