// For tests only; the guarded calls and this module are dropped from the production build.
import type { ReactNode } from "react";
import type { TimelineProps } from "./timeline/Timeline";
import type { ListChangeClock } from "./clickguard";

type ComponentName = "TaskItemView" | "DateView";
type ProviderName = "QuickEntryHandlerContext" | "ViewActions";

const counts: Record<ComponentName, number> = { TaskItemView: 0, DateView: 0 };
const days: string[] = [];
const providers: Partial<Record<ProviderName, object>> = {};

/** Tests can wrap the rendered timeline and inspect its commit clock. */
export type TimelineRenderHook = (props: TimelineProps, rendered: ReactNode, clock: ListChangeClock) => ReactNode;

let timelineRenderHook: TimelineRenderHook | undefined;

export function onTimelineRender(hook: TimelineRenderHook): () => void {
	if (timelineRenderHook) throw new Error("A timeline render hook is already installed");
	timelineRenderHook = hook;
	return () => {
		timelineRenderHook = undefined;
	};
}

export function timelineRendered(props: TimelineProps, rendered: ReactNode, clock: ListChangeClock): ReactNode {
	return timelineRenderHook ? timelineRenderHook(props, rendered, clock) : rendered;
}

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
