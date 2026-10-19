/**
 * Stands in for `react-dom/client`, which the tests alias to this module. The view mounts the bridge with createRoot,
 * which needs a DOM the tests do not have; other tests render the bridge through its state (views.test.ts) and the
 * timeline with react-dom/server (timeline.test.ts). A root here keeps what it was given.
 */
import type { ReactNode } from "react";

export interface Root {
	readonly container: unknown;
	readonly rendered: readonly ReactNode[];
	readonly unmounted: boolean;
	render(children: ReactNode): void;
	unmount(): void;
}

/** Every root created, in order. */
export const roots: Root[] = [];

export function createRoot(container: unknown): Root {
	let rendered: readonly ReactNode[] = [];
	let unmounted = false;
	const root: Root = {
		container,
		get rendered() {
			return rendered;
		},
		get unmounted() {
			return unmounted;
		},
		render(children) {
			if (unmounted) throw new Error("Cannot update an unmounted root.");
			rendered = [...rendered, children];
		},
		unmount() {
			unmounted = true;
		},
	};
	roots.push(root);
	return root;
}
