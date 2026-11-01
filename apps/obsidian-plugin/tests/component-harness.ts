import type { TestContext } from "node:test";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { TimelineView } from "../timeline/src/components/timelineview";
import { StripWithIcon } from "../timeline/src/components/statusmarker";

/** Step 10 will take these props from createBridgeActions instead of the bridge constructor. */
export type BridgeProps = ConstructorParameters<typeof ObsidianBridge>[0];

/** Step 10 will keep this state/action/render contract over createBridgeActions and the bridge's pure tree. */
export type BridgeHandle = Pick<
	ObsidianBridge,
	| "state"
	| "props"
	| "setState"
	| "handleCreateNewTask"
	| "handleCompleteTask"
	| "handleFilterEnable"
	| "handleRowMenu"
	| "handleSetDate"
	| "handleDateBadge"
	| "handleModifyTask"
	| "handleOpenFile"
	| "handleTagClick"
	| "onUpdateTasks"
	| "getTaskItemHandlers"
	| "render"
> & {
	mount(): void;
	unmount(): void;
};

type BridgeState = BridgeHandle["state"];
type Update = Partial<BridgeState> | ((state: BridgeState, props: BridgeProps) => Partial<BridgeState> | null) | null;
type DeferredBridge = BridgeHandle & {
	flush(): void;
	renderPending(): void;
	commit(): void;
	flushLatest(): Update | undefined;
};
type BridgeOptions = { mode?: "sync" | "deferred"; mount?: boolean };

// The handle is the instance: internal setState calls and replaced handlers still go through the same object
// the tests spy on. Its narrower type hides lifecycle names while preserving writable state and handler identity.
function handleOf(bridge: ObsidianBridge): BridgeHandle {
	return Object.assign(bridge, {
		mount: () => bridge.componentDidMount(),
		unmount: () => bridge.componentWillUnmount(),
	});
}

/** Step 10 will drive createBridgeActions with these same synchronous or deferred state/commit semantics. */
export function bridgeActions(props: BridgeProps, options: BridgeOptions & { mode: "deferred" }): DeferredBridge;
export function bridgeActions(props: BridgeProps, options?: BridgeOptions): BridgeHandle;
export function bridgeActions(props: BridgeProps, { mode = "sync", mount = true }: BridgeOptions = {}): BridgeHandle {
	const instance = new ObsidianBridge(props);
	const bridge = handleOf(instance);
	const apply = (update: Update) => {
		bridge.state = {
			...bridge.state,
			...(typeof update === "function" ? update(bridge.state, bridge.props) : update),
		};
	};
	if (mode === "sync") {
		bridge.setState = (update) => {
			const before = bridge.state;
			apply(update);
			instance.componentDidUpdate(bridge.props, before);
		};
		if (mount) bridge.mount();
		return bridge;
	}

	let queued: Update[] = [];
	let commits: BridgeState[] = [];
	bridge.setState = (update) => {
		queued = [...queued, update];
	};
	const render = (update: Update) => {
		commits.push(bridge.state);
		apply(update);
	};
	const commit = () => {
		const before = commits;
		commits = [];
		for (const state of before) instance.componentDidUpdate(bridge.props, state);
	};
	const renderPending = () => {
		const updates = queued;
		queued = [];
		for (const update of updates) render(update);
	};
	const flush = () => {
		const updates = queued;
		queued = [];
		for (const update of updates) {
			render(update);
			commit();
		}
	};
	const flushLatest = () => {
		const update = queued.pop();
		if (update) {
			render(update);
			commit();
		}
		return update;
	};
	const deferred = Object.assign(bridge, { flush, renderPending, commit, flushLatest });
	if (mount) {
		bridge.mount();
		flush();
	}
	return deferred;
}

/** Step 10 will expose the function bridge's actions/state here, keeping the ref-like handle and bridgeState(). */
export function mountBridge(props: BridgeProps) {
	const bridge: { current: BridgeHandle | null } = { current: null };
	const element = createElement(ObsidianBridge, {
		...props,
		ref: (instance: ObsidianBridge | null) => {
			bridge.current = instance ? handleOf(instance) : null;
		},
	});
	return { element, bridge, bridgeState: () => bridge.current!.state };
}

/** Step 9 will render the function timeline with the same props, without exposing an instance. */
export function timelineElement(props: ComponentProps<typeof TimelineView>) {
	return createElement(TimelineView, props);
}

/** Step 9 will use a renderprobe hook for this wrapper and the timeline's commit clock. */
export function onTimelineRender(
	t: TestContext,
	wrap: (props: ComponentProps<typeof TimelineView>, rendered: ReactNode) => ReactNode,
) {
	const mounted: { timeline?: TimelineView } = {};
	const render = TimelineView.prototype.render;
	t.mock.method(TimelineView.prototype, "render", function (this: TimelineView) {
		mounted.timeline = this;
		return wrap(this.props, render.call(this));
	});
	return {
		clock: () =>
			(mounted.timeline as unknown as { rowWrites: { clock: { lastListChangeAt: number } } }).rowWrites.clock,
	};
}

/** Step 4 will observe the function strip's renders instead of wrapping its class prototype. */
export function onStripRender(t: TestContext, spy: () => void) {
	const render = StripWithIcon.prototype.render;
	t.mock.method(StripWithIcon.prototype, "render", function (this: StripWithIcon) {
		spy();
		return render.call(this);
	});
}
