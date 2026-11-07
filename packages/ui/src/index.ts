/**
 * The timeline components move here from apps/obsidian-plugin/timeline in phase 4 of the
 * restructuring. This package may depend on @tasks-calendar-wrapper/core, never on obsidian.
 * Nothing in the plugin uses this package at runtime yet; steps 4-10 of the restructuring move the components here.
 */
export type { UiHost } from "./host";
export { HostContext, useHost } from "./contexts";
export { useStore } from "./hooks/useStore";
export { useTransitionedStore } from "./hooks/useTransitionedStore";
