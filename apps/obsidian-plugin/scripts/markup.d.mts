export function serializeMarkup(element: Element): string;
export function deserializeMarkup(serialized: string, document: Document): Element;
export function normalizeContent(element: Element): Element;
export function compareMarkup(expected: Element, actual: Element): { expected: string; actual: string; diff: string };
export const obsidianMarkupStates: readonly string[];
export function parseVisibleState(name: string): {
	position: "top" | "today" | "bottom";
	todayFocus: boolean;
	counter?: "todo" | "overdue" | "unplanned";
	behavior?: "Filter" | "Focus";
};
