// For tests only; the guarded calls and this module are dropped from the production build.
type ComponentName = "TaskItemView" | "DateView";
type ProviderName = "QuickEntryHandlerContext" | "TodayFocusEventHandlersContext" | "UserOptionContext";

const counts: Record<ComponentName, number> = { TaskItemView: 0, DateView: 0 };
const days: string[] = [];
const providers: Partial<Record<ProviderName, object>> = {};

export function recordProvider(provider: ProviderName, value: object): void {
	providers[provider] = value;
}

export function providerValues(): Readonly<Partial<Record<ProviderName, object>>> {
	return { ...providers };
}

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
