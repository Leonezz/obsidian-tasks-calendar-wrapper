/** The clock object stays with a timeline, so rows read the last committed list change without a context update. */
export interface ListChangeClock {
	lastListChangeAt: number;
}

/** A popout's event timestamp belongs to that window's clock, not the main window's. */
export function clickTime(evt: MouseEvent): number {
	return performance.now() - ((evt.view ?? window).performance.now() - evt.timeStamp);
}

export function clickIsGuarded(evt: MouseEvent, clock: ListChangeClock): boolean {
	const clickAt = clickTime(evt);
	return clickAt < clock.lastListChangeAt || clickAt - clock.lastListChangeAt < 300;
}
