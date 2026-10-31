// For tests only; the guarded calls and this module are dropped from the production build.
type ComponentName = "TaskItemView" | "DateView";

const counts: Record<ComponentName, number> = { TaskItemView: 0, DateView: 0 };
const days: string[] = [];

export function recordRender(component: ComponentName, day?: string): void {
	counts[component]++;
	if (component === "DateView" && day !== undefined) days.push(day);
}

export function rendersOf(component: ComponentName): number {
	return counts[component];
}

export function renderedDays(): readonly string[] {
	return [...days];
}

export function resetRenderCounts(): void {
	counts.TaskItemView = 0;
	counts.DateView = 0;
	days.length = 0;
}
