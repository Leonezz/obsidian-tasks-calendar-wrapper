import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Events, type App } from "obsidian";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import type { Store } from "@tasks-calendar-wrapper/core";
import { TasksTimelineView } from "../src/views";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import type { TimelineState } from "../src/state/timeline";
import { createTaskIndex, type ParseNote } from "../timeline/src/taskindex";
import type { TaskWriter, WriteEvent } from "../timeline/src/taskwriter";
import { moment } from "../utils/moment";
import { parseKeyOf } from "../utils/parsekey";
import { ObsidianBridge } from "../timeline/src/obsidianbridge";
import { TimelineView } from "../timeline/src/components/timelineview";
import { StripWithIcon } from "../timeline/src/components/statusmarker";
import { providerValues, rendersOf, resetRenderCounts } from "../timeline/src/components/renderprobe";
import { goldenApp, loadVault } from "./golden-vault";
import { unusedNotices, unusedWriter } from "./view-harness";

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

type MountViewOptions = {
	app?: unknown;
	options?: UserOption;
	parse?: ParseNote;
	mode?: "view" | "bridge";
};

/** Supplies the event ports absent from read-only golden apps, without replacing ports a supplied app already has. */
function withEvents<T extends object>(value: T): T & Events {
	const events = new Events();
	return Object.assign(value, {
		...("on" in value ? {} : { on: events.on.bind(events) }),
		...("offref" in value ? {} : { offref: events.offref.bind(events) }),
	}) as T & Events;
}

/** Real view/index/root, with a bridge-only path for the mount-props parity check. */
export async function mountView(
	t: TestContext,
	{ app: supplied, options, parse, mode = "view" }: MountViewOptions = {},
) {
	const app = (supplied ?? goldenApp(loadVault())) as App;
	if (!("plugins" in app)) Object.assign(app, { plugins: { plugins: {} } });
	withEvents(app.vault);
	withEvents(app.metadataCache);
	app.workspace ??= {} as App["workspace"];
	withEvents(app.workspace);
	app.workspace.getLeavesOfType ??= () => [];
	const index = createTaskIndex({ app, moment, parseKey: () => parseKeyOf(moment), parse });
	let listener: ((event: WriteEvent) => void) | undefined;
	let releaseSeq = 0;
	const writer: TaskWriter = {
		...unusedWriter,
		onWrite: (callback) => {
			listener = callback;
			return () => {
				listener = undefined;
			};
		},
		releaseSeq: () => releaseSeq,
	};
	const view = new TasksTimelineView({ app } as never, index, writer, unusedNotices);
	const internals = view as unknown as {
		store: Store<TimelineState>;
		resolveEnv: BridgeProps["resolveEnv"];
	};
	const container = document.body.appendChild(document.createElement("div"));
	Object.assign(container, { empty: () => container.replaceChildren() });
	(view.containerEl as unknown as { children: HTMLElement[] }).children[1] = container;
	const bridgeProps: BridgeProps = {
		plugin: view,
		store: internals.store,
		resolveEnv: internals.resolveEnv,
		writer: view.viewWriter,
		ledger: view.ledger,
		pendingWrites: view.pendingWrites,
		onWriteResult: view.onWriteResult,
		onQuickEntryWritten: view.reloadWhenIndexed,
		onListCommitted: view.onListCommitted,
	};
	let bridgeRoot: ReturnType<typeof createRoot> | undefined;
	let closed = false;
	const unmount = async () => {
		if (closed) return;
		closed = true;
		try {
			await act(async () => {
				bridgeRoot?.unmount();
				view.unload();
				await view.onClose();
			});
		} finally {
			container.remove();
		}
	};
	t.after(unmount);
	await view.onUpdateOptions(
		options ?? { ...structuredClone(defaultUserOptions), defaultFilters: "", defaultTodayFocus: false },
	);
	await act(async () => {
		view.load();
		if (mode === "view") await view.onOpen();
		else {
			bridgeRoot = createRoot(container);
			bridgeRoot.render(mountBridge(bridgeProps).element);
		}
	});
	return {
		view,
		container,
		bridgeProps,
		store: internals.store,
		root: () => {
			const root = container.querySelector<HTMLElement>(".taskido");
			assert.ok(root, "the real timeline mounted its .taskido root");
			return root;
		},
		options: () => internals.store.getSnapshot().options,
		pushOptions: async (next: UserOption) => {
			await act(() => view.onUpdateOptions(next));
		},
		reload: async () => {
			await act(() => view.onReloadTasks());
		},
		edited: (path: string) => index.markDirty([path]),
		feed: async (event: WriteEvent) => {
			releaseSeq = Math.max(releaseSeq, event.releaseSeq ?? 0);
			await act(() => listener?.(event));
		},
		unmount,
	};
}

const classNames = [
	"ObsidianBridge",
	"TimelineView",
	"YearView",
	"YearHeader",
	"DateHeader",
	"NormalDateContent",
	"QuickEntry",
	"MultiSelect",
	"TodayFocus",
	"Counters",
	"CounterItem",
	"TaskRow",
	"StripWithIcon",
	"Content",
	"TagBadge",
	"FileBadge",
	"DateStatusBadge",
	"ModifyBadge",
] as const;
const providerNames = ["QuickEntryHandlerContext", "TodayFocusEventHandlersContext", "UserOptionContext"] as const;

/** Counts private classes as JSX creates their elements, before React calls the prototype render method. */
export function countRenders(t: TestContext) {
	const counts = Object.fromEntries(classNames.map((name) => [name, 0]));
	const observed = new Set<string>();
	let before: ReturnType<typeof providerValues> = {};
	const observe = (type: unknown) => {
		if (typeof type !== "function" || !classNames.includes(type.name as (typeof classNames)[number])) return;
		if (observed.has(type.name)) return;
		const prototype = type.prototype as { render(): ReactNode };
		assert.equal(typeof prototype.render, "function", `${type.name} is a class component`);
		observed.add(type.name);
		const render = prototype.render;
		t.mock.method(prototype, "render", function (this: typeof prototype) {
			counts[type.name]++;
			return render.call(this);
		});
	};
	// These can be made with createElement instead of JSX; hidden classes are discovered through jsx/jsxs below.
	for (const type of [ObsidianBridge, TimelineView, StripWithIcon]) observe(type);
	const runtime = jsxRuntime as unknown as Record<"jsx" | "jsxs", (type: unknown, ...args: unknown[]) => unknown>;
	for (const key of ["jsx", "jsxs"] as const) {
		const create = runtime[key];
		t.mock.method(runtime, key, (type: unknown, ...args: unknown[]) => {
			observe(type);
			return create(type, ...args);
		});
	}
	resetRenderCounts();
	return {
		reset: () => {
			before = providerValues();
			for (const name of classNames) counts[name] = 0;
			resetRenderCounts();
		},
		snapshot: () => {
			const providers = providerValues();
			for (const name of providerNames) assert.ok(providers[name], `${name} was recorded`);
			return {
				renders: { ...counts, TaskItemView: rendersOf("TaskItemView"), DateView: rendersOf("DateView") },
				providers: Object.fromEntries(
					providerNames.map((name) => [name, before[name] === providers[name] ? "same" : "new"]),
				),
			};
		},
		assertAllObserved: () => assert.deepEqual([...observed].sort(), [...classNames].sort()),
	};
}
