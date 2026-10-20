import {
	copyJsonValue,
	createStore,
	deepFreeze,
	describedValue,
	mergeOptions,
	migrated,
	migrateSortOption,
	type Migration,
	settingIssues,
	type SettingType,
	type Store,
} from "@tasks-calendar-wrapper/core";
import { settingsSchema } from "../settings-schema";
import { defaultUserOptions, type UserOption } from "../useroptions";

/**
 * The plugin's options: one frozen snapshot, which every load and every change replaces as a whole. Code handed the
 * options can keep them, as nothing changes them afterwards, and changing them in place throws a TypeError instead of
 * reaching some views and not others. In phase 2 no view subscribes: the plugin itself hands the options to the
 * timelines 200 ms after the last change.
 */
export type Settings = Readonly<UserOption>;

/** The version of the options' shape this plugin writes to data.json; a file without one holds version 0. */
export const SETTINGS_VERSION = 1;

/** The options, and the version data.json held when they were loaded. */
export interface SettingsState {
	readonly options: Settings;
	readonly storedVersion: number;
}

export type SettingsStore = Store<SettingsState>;

/** A store holding no options, as the plugin did before it loaded them, and no version. */
export function createSettingsStore(): SettingsStore {
	return createStore<SettingsState>(deepFreeze({ options: {} as Settings, storedVersion: 0 }));
}

/**
 * The migrations of saved options, all run on every load, whatever version data.json says: a 0.3.x device writes the
 * old shapes back next to the version a newer one saved. They never rename or delete a key, nor change an old value
 * that still means something, so 0.3.x reads the file as before.
 */
export const MIGRATIONS: readonly Migration<UserOption>[] = Object.freeze([
	// A sort saved as a lambda is read as today's sort key, which the next save writes.
	Object.freeze({
		id: "sort-lambda-to-key",
		apply: (options: UserOption) => ({ ...options, sort: migrateSortOption(options.sort) }),
	}),
]);

/**
 * The options read from data.json: the saved ones over the defaults, in the defaults' order and then the ones this
 * version does not know, in the file's order, after the migrations. settingsVersion is not an option and is left out.
 * Nothing is frozen but the copy: neither the defaults nor what was read.
 */
export function loadedSettings(saved: Partial<UserOption> | null | undefined): Settings {
	const merged = mergeOptions(defaultUserOptions, saved);
	const options = Object.fromEntries(
		Object.entries(merged).filter(([key]) => key !== "settingsVersion"),
	) as UserOption;
	return deepFreeze(migrated(options, MIGRATIONS));
}

/** The version data.json holds: its settingsVersion when that is a finite number, else 0. */
export function storedVersionOf(saved: unknown): number {
	const version = isRecord(saved) ? saved.settingsVersion : undefined;
	return isVersion(version) ? version : 0;
}

const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The state read from data.json, frozen. */
export function loadedState(saved: Partial<UserOption> | null | undefined): SettingsState {
	return Object.freeze({ options: loadedSettings(saved), storedVersion: storedVersionOf(saved) });
}

/**
 * The options with these changes; options a change adds come after the others. The changes are copied, so the lists
 * and maps the caller handed in are neither frozen nor tied to the options.
 */
export function withChanges(settings: Settings, changes: Partial<UserOption>): Settings {
	return deepFreeze({ ...settings, ...copyJsonValue(changes) });
}

/** The state with these changes to its options, frozen. */
export function changedState(state: SettingsState, changes: Partial<UserOption>): SettingsState {
	return Object.freeze({ ...state, options: withChanges(state.options, changes) });
}

/**
 * What data.json is to hold: all the options, then settingsVersion, never lower than the version the file held, so a
 * newer device's stays. The options are copied by assignment, as before: assignment drops a "__proto__" key a
 * hand-edited data.json may hold, and a copy that is not frozen keeps the keys after one from failing to be assigned.
 */
export function savedForm(state: SettingsState): Record<string, unknown> {
	return Object.assign({}, copyJsonValue(state.options), {
		settingsVersion: Math.max(state.storedVersion, SETTINGS_VERSION),
	});
}

/** What each type of option should be, as the warnings say it. */
const EXPECTED: Readonly<Record<SettingType, string>> = {
	boolean: "true or false",
	string: "text",
	stringList: "a list of texts",
	stringMap: "a map of texts",
	stringListMap: "a map of lists of texts",
};

/**
 * One warning for each option of the wrong type in the loaded options, in the schema's order, and for a settingsVersion
 * that is not a finite number. The values are used as they are; the warnings only say so in the developer console.
 */
export function settingWarnings(saved: unknown, settings: Settings): readonly string[] {
	const version = isRecord(saved) && "settingsVersion" in saved ? saved.settingsVersion : undefined;
	// JSON reads a number too large for a double, such as 1e400, as Infinity, which is named as it is.
	const found = typeof version === "number" ? String(version) : describedValue(version);
	const versionWarnings =
		version === undefined || isVersion(version)
			? []
			: [
					`Tasks Calendar Wrapper: data.json holds ${found} for "settingsVersion", which should be a finite number. It is read as 0.`,
				];
	const optionWarnings = settingIssues(settings, settingsSchema).map(
		({ key, expected, found }) =>
			`Tasks Calendar Wrapper: data.json holds ${found} for "${key}", which should be ${EXPECTED[expected]}. It is used as it is.`,
	);
	return Object.freeze([...versionWarnings, ...optionWarnings]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
