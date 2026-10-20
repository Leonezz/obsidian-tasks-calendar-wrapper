import {
	copyJsonValue,
	createStore,
	deepFreeze,
	mergeOptions,
	migrateSortOption,
	type Store,
} from "@tasks-calendar-wrapper/core";
import { defaultUserOptions, type UserOption } from "../useroptions";

/**
 * The plugin's options: one frozen snapshot, which every load and every change replaces as a whole. Code handed the
 * options can keep them, as nothing changes them afterwards, and changing them in place throws a TypeError instead of
 * reaching some views and not others. In phase 2 no view subscribes: the plugin itself hands the options to the
 * timelines 200 ms after the last change.
 */
export type Settings = Readonly<UserOption>;

export type SettingsStore = Store<Settings>;

/** A store holding no options, as the plugin did before it loaded them. */
export function createSettingsStore(): SettingsStore {
	return createStore<Settings>(Object.freeze({}) as Settings);
}

/**
 * The options read from data.json: the saved ones over the defaults, in the defaults' order and then the ones this
 * version does not know, in the file's order. A sort saved as a lambda is read as today's sort key, which the next
 * save writes. Nothing is frozen but the copy: neither the defaults nor what was read.
 */
export function loadedSettings(saved: Partial<UserOption> | null | undefined): Settings {
	const merged = mergeOptions(defaultUserOptions, saved);
	return deepFreeze({ ...merged, sort: migrateSortOption(merged.sort) });
}

/**
 * The options with these changes; options a change adds come after the others. The changes are copied, so the lists
 * and maps the caller handed in are neither frozen nor tied to the options.
 */
export function withChanges(settings: Settings, changes: Partial<UserOption>): Settings {
	return deepFreeze({ ...settings, ...copyJsonValue(changes) });
}
