export function DayHeader({ thisDate }: { readonly thisDate: string }) {
	return (
		<div className="dateLine">
			<div className="date">{thisDate}</div>
			<div className="weekday"></div>
		</div>
	);
}
