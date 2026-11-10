import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Events, type App } from "obsidian";
import { act, createElement, memo, startTransition, type ComponentProps, type ReactNode } from "react";
import jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import type { Store } from "@tasks-calendar-wrapper/core";
import {
	type UiHost,
	type ListChangeClock,
	Content,
	sameContentProps,
	type ContentProps,
	TaskRow,
	sameRowModelProps,
	StatusMarker as StripWithIcon,
	TagBadge,
	FileBadge,
	DateStatusBadge,
	ModifyBadge,
	YearHeader,
	DayHeader,
	Year,
	DayContent,
	Counters,
	CounterItem,
	QuickEntry,
	MultiSelect,
	TodayFocus,
	Timeline,
	type TimelineProps,
	providerValues,
	rendersOf,
	resetRenderCounts,
	onTimelineRender as onTimelineRenderHook,
} from "@tasks-calendar-wrapper/ui";
import { TasksTimelineView } from "../src/views";
import type { PluginUiHost } from "../src/uihost";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import type { TimelineState } from "../src/state/timeline";
import { createViewState, onLoadViewState, type ViewStateHandle } from "../src/state/viewstate";
import { createTaskIndex, type ParseNote } from "../timeline/src/taskindex";
import type { TaskWriter, WriteEvent } from "../timeline/src/taskwriter";
import { moment } from "../utils/moment";
import { parseKeyOf } from "../utils/parsekey";
import { ObsidianBridge, bridgeTree, type MountedBridgeHandle } from "../timeline/src/bridge";
import {
	createBridgeActions,
	listChanged,
	listUpdate,
	type BridgeActions,
	type BridgeProps as ActionBridgeProps,
	type BridgeState,
} from "../timeline/src/bridgeactions";
import { goldenApp, loadVault } from "./golden-vault";
import { unusedNotices, unusedWriter } from "./view-harness";
import { testHost } from "./stubs/host";

/** Supplies host and view-state defaults for cases written before those props existed. */
export type BridgeProps = Omit<ActionBridgeProps, "host" | "viewState"> & {
	readonly host?: UiHost;
	readonly viewState?: ViewStateHandle;
};

/** The action harness keeps writable state and methods so tests can replace or spy on them. */
export type BridgeHandle = {
	state: BridgeState;
	props: ActionBridgeProps;
	setState(update: Update): void;
	handleCreateNewTask: BridgeActions["handleCreateNewTask"];
	handleCompleteTask: BridgeActions["handleCompleteTask"];
	handleFilterEnable: BridgeActions["handleFilterEnable"];
	handleRowMenu: BridgeActions["handleRowMenu"];
	handleSetDate: BridgeActions["handleSetDate"];
	handleDateBadge: BridgeActions["handleDateBadge"];
	handleModifyTask: BridgeActions["handleModifyTask"];
	handleOpenFile: BridgeActions["handleOpenFile"];
	handleTagClick: BridgeActions["handleTagClick"];
	onUpdateTasks: BridgeActions["onUpdateTasks"];
	getTaskItemHandlers: BridgeActions["getTaskItemHandlers"];
	render(): ReactNode;
	mount(): void;
	unmount(): void;
};

type Update =
	Partial<BridgeState> | ((state: BridgeState, props: BridgeHandle["props"]) => Partial<BridgeState> | null) | null;
type DeferredBridge = BridgeHandle & {
	flush(): void;
	renderPending(): void;
	commit(): void;
	flushLatest(): Update | undefined;
};
type BridgeOptions = { mode?: "sync" | "deferred"; mount?: boolean };

/** Drives the shared actions with synchronous or deferred state/commit semantics. */
export function bridgeActions(props: BridgeProps, options: BridgeOptions & { mode: "deferred" }): DeferredBridge;
export function bridgeActions(props: BridgeProps, options?: BridgeOptions): BridgeHandle;
export function bridgeActions(props: BridgeProps, { mode = "sync", mount = true }: BridgeOptions = {}): BridgeHandle {
	const bridgeProps = {
		...props,
		host: props.host ?? testHost,
		viewState: props.viewState ?? createViewState(onLoadViewState(props.store.getSnapshot().options)),
	};
	let seen = bridgeProps.store.getSnapshot();
	let unsubscribe: (() => void) | undefined;
	let state: Omit<BridgeState, "quickFilter"> = {
		userOptions: seen.options,
		tasks: seen.tasks,
		reloadId: seen.reloadId,
	};
	const bridge: BridgeActions & BridgeHandle = Object.assign(
		createBridgeActions(
			bridgeProps,
			() => bridge.state,
			(update) => bridge.setState(update),
		),
		{
			state,
			props: bridgeProps,
			setState: (update: Update) => {
				const before = bridge.state;
				apply(update);
				reportCommit(before);
			},
			render: () => bridgeTree(bridge.props, bridge.state, bridge),
			mount: () => {
				const onStateChanged = () => {
					const next = bridge.props.store.getSnapshot();
					const before = seen;
					seen = next;
					if (next.options !== before.options) bridge.setState({ userOptions: next.options });
					if (listChanged(before, next))
						startTransition(() => bridge.setState(listUpdate(bridge.props.store)));
				};
				unsubscribe = bridge.props.store.subscribe(onStateChanged);
				// A change between reading the state and subscribing would not be heard of otherwise.
				onStateChanged();
				bridge.props.onListCommitted?.(bridge.state.reloadId ?? 0);
			},
			unmount: () => unsubscribe?.(),
		},
	);
	let lastState: typeof state | undefined;
	let snapshot: BridgeState = state;
	Object.defineProperty(bridge, "state", {
		get: () => {
			const quickFilter = bridgeProps.viewState.store.getSnapshot().quickFilter;
			if (lastState !== state || snapshot.quickFilter !== quickFilter) {
				lastState = state;
				snapshot = { ...state, quickFilter };
			}
			return snapshot;
		},
		set: (next: BridgeState) => {
			state = { userOptions: next.userOptions, tasks: next.tasks, reloadId: next.reloadId };
		},
	});
	const apply = (update: Update) => {
		bridge.state = {
			...bridge.state,
			...(typeof update === "function" ? update(bridge.state, bridge.props) : update),
		};
	};
	const reportCommit = (before: BridgeState) => {
		const id = bridge.state.reloadId;
		if (id !== undefined && id !== before.reloadId) bridge.props.onListCommitted?.(id);
	};
	if (mode === "sync") {
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
		for (const state of before) reportCommit(state);
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

/** Exposes the real function bridge's actions and latest rendered state through its test handle. */
export function mountBridge(props: BridgeProps) {
	const bridge: { current: MountedBridgeHandle | null } = { current: null };
	const wrapper = uiWrappers.get(ObsidianBridge)!;
	for (const observer of uiObservers) observer.created?.(wrapper.key);
	const element = createElement(wrapper.render as typeof ObsidianBridge, {
		...props,
		host: props.host ?? testHost,
		viewState: props.viewState ?? createViewState(onLoadViewState(props.store.getSnapshot().options)),
		handleRef: bridge,
	});
	return { element, bridge, bridgeState: () => bridge.current!.state };
}

export { timelineElement } from "./timeline-element";

/** Uses the renderprobe hook for this wrapper and the timeline's commit clock. */
export function onTimelineRender(t: TestContext, wrap: (props: TimelineProps, rendered: ReactNode) => ReactNode) {
	let captured: ListChangeClock;
	t.after(
		onTimelineRenderHook((props, rendered, clock) => {
			captured = clock;
			return wrap(props, rendered);
		}),
	);
	return { clock: () => captured };
}

/** Observes strip renders through the stable JSX wrapper installed when the harness loads. */
export function onStripRender(t: TestContext, spy: () => void) {
	const observer: UiObserver = {
		rendered: (key) => {
			if (key === "StripWithIcon") spy();
		},
	};
	uiObservers.add(observer);
	t.after(() => {
		uiObservers.delete(observer);
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
		viewState: ViewStateHandle;
		resolveEnv: BridgeProps["resolveEnv"];
		uiHost: PluginUiHost;
	};
	const container = document.body.appendChild(document.createElement("div"));
	Object.assign(container, { empty: () => container.replaceChildren() });
	(view.containerEl as unknown as { children: HTMLElement[] }).children[1] = container;
	const bridgeProps: BridgeProps = {
		plugin: view,
		host: internals.uiHost,
		store: internals.store,
		viewState: internals.viewState,
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
		host: internals.uiHost,
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

const componentNames = [
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
const uiComponents = {
	ObsidianBridge,
	TimelineView: Timeline,
	YearView: Year,
	NormalDateContent: DayContent,
	QuickEntry,
	MultiSelect,
	YearHeader,
	DateHeader: DayHeader,
	TodayFocus,
	Counters,
	CounterItem,
	StripWithIcon,
	TagBadge,
	FileBadge,
	DateStatusBadge,
	ModifyBadge,
};
type UiComponentName = keyof typeof uiComponents | "Content" | "TaskRow";
type UiObserver = {
	created?: (key: UiComponentName) => void;
	rendered?: (key: UiComponentName) => void;
};
const uiObservers = new Set<UiObserver>();
const uiWrappers = new Map<unknown, { key: UiComponentName; render: (props: never) => ReactNode }>();
for (const key of Object.keys(uiComponents) as (keyof typeof uiComponents)[]) {
	const component = uiComponents[key];
	assert.equal(typeof component, "function", `${key} is a plain function component`);
	assert.equal(component.prototype?.render, undefined, `${key} is a plain function component`);
	uiWrappers.set(component, {
		key,
		render: (props: never) => {
			for (const observer of uiObservers) observer.rendered?.(key);
			return component(props);
		},
	});
}
const memoContent = Content as unknown as {
	$$typeof: symbol;
	type: ((props: ContentProps) => ReactNode) & { prototype?: { render?: unknown } };
	compare: typeof sameContentProps;
};
assert.equal(typeof Content, "object", "Content is a React.memo object");
assert.equal(memoContent.$$typeof, Symbol.for("react.memo"), "Content is a React.memo object");
assert.equal(typeof memoContent.type, "function", "Content wraps a plain function component");
assert.equal(memoContent.type.prototype?.render, undefined, "Content wraps a plain function component");
assert.equal(memoContent.compare, sameContentProps, "Content compares with sameContentProps");
uiWrappers.set(Content, {
	key: "Content",
	render: memo(function counted(props: ContentProps) {
		for (const observer of uiObservers) observer.rendered?.("Content");
		return memoContent.type(props);
	}, memoContent.compare),
});
type TaskRowProps = ComponentProps<typeof TaskRow>;
const memoTaskRow = TaskRow as unknown as {
	$$typeof: symbol;
	type: ((props: TaskRowProps) => ReactNode) & { prototype?: { render?: unknown } };
	compare: typeof sameRowModelProps;
};
assert.equal(typeof TaskRow, "object", "TaskRow is a React.memo object");
assert.equal(memoTaskRow.$$typeof, Symbol.for("react.memo"), "TaskRow is a React.memo object");
assert.equal(typeof memoTaskRow.type, "function", "TaskRow wraps a plain function component");
assert.equal(memoTaskRow.type.prototype?.render, undefined, "TaskRow wraps a plain function component");
assert.equal(memoTaskRow.compare, sameRowModelProps, "TaskRow compares with sameRowModelProps");
uiWrappers.set(TaskRow, {
	key: "TaskRow",
	render: memo(function counted(props: TaskRowProps) {
		for (const observer of uiObservers) observer.rendered?.("TaskRow");
		return memoTaskRow.type(props);
	}, memoTaskRow.compare),
});
const runtime = jsxRuntime as unknown as Record<"jsx" | "jsxs", (type: unknown, ...args: unknown[]) => unknown>;
// Stable types from the first mount let observers join later without remounting a component.
for (const key of ["jsx", "jsxs"] as const) {
	const create = runtime[key];
	runtime[key] = (type: unknown, ...args: unknown[]) => {
		const wrapper = uiWrappers.get(type);
		if (!wrapper) return create(type, ...args);
		for (const observer of uiObservers) observer.created?.(wrapper.key);
		return create(wrapper.render, ...args);
	};
}
const providerNames = ["QuickEntryHandlerContext", "ViewActions"] as const;

/** Counts function and memo renders through the stable JSX wrappers. */
export function countRenders(t: TestContext) {
	const counts = Object.fromEntries(componentNames.map((name) => [name, 0]));
	const observed = new Set<string>();
	const observer: UiObserver = {
		created: (key) => {
			observed.add(key);
		},
		rendered: (key) => {
			counts[key]++;
		},
	};
	uiObservers.add(observer);
	t.after(() => {
		uiObservers.delete(observer);
	});
	let before: ReturnType<typeof providerValues> = {};
	resetRenderCounts();
	return {
		reset: () => {
			before = providerValues();
			for (const name of componentNames) counts[name] = 0;
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
		assertAllObserved: () => assert.deepEqual([...observed].sort(), [...componentNames].sort()),
	};
}
