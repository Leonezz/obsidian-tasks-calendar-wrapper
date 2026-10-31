import type { App } from "obsidian";

/** The main window's moment locale, passed in so a toggle uses ASCII dates in every Obsidian language. */
export interface MomentLocale {
	/** Reads the locale before a call, or changes it until the synchronous call finishes. */
	locale(): string;
	locale(value: string): unknown;
}

/** A fresh toggle capability, distinguishing missing Tasks from an old or malformed enabled plugin. */
export type TasksToggle =
	| { readonly kind: "none" }
	| { readonly kind: "toggle"; readonly toggle: (line: string, path: string) => string }
	| { readonly kind: "too-old" }
	| { readonly kind: "error"; readonly error: unknown };

/** Whether Tasks can edit a line in its dialog; the caller can explain an old or malformed API separately. */
export type TasksDialogCapability =
	| { readonly kind: "none" }
	| { readonly kind: "edit" }
	| { readonly kind: "too-old" }
	| { readonly kind: "error"; readonly error: unknown };

type ApiResult =
	| { readonly kind: "none" }
	| { readonly kind: "api"; readonly api: Record<string, unknown> }
	| { readonly kind: "error"; readonly error: unknown };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function malformed(member: string): never {
	throw new Error(`Malformed Tasks plugin API: ${member}.`);
}

function readApi(app: App): ApiResult {
	try {
		// @ts-expect-error Obsidian does not expose its plugin registry in the public App type.
		const manager: unknown = app.plugins;
		if (!isObject(manager)) malformed("app.plugins is not an object");
		const plugins = manager.plugins;
		if (!isObject(plugins)) malformed("app.plugins.plugins is not an object");
		const entry = plugins["obsidian-tasks-plugin"];
		if (entry === undefined && !("obsidian-tasks-plugin" in plugins)) return Object.freeze({ kind: "none" });
		if (!isObject(entry)) malformed("the Tasks entry is not an object");
		const api = entry.apiV1;
		if (!isObject(api)) malformed("apiV1 is not an object");
		return Object.freeze({ kind: "api", api });
	} catch (error) {
		return Object.freeze({ kind: "error", error });
	}
}

/** Reads Tasks on this action, and wraps its synchronous toggle with an English locale restored even on failure. */
export function getTasksToggle(app: App, moment: MomentLocale): TasksToggle {
	const result = readApi(app);
	if (result.kind !== "api") return result;
	try {
		const toggle = result.api.executeToggleTaskDoneCommand;
		if (toggle === undefined && !("executeToggleTaskDoneCommand" in result.api)) {
			return Object.freeze({ kind: "too-old" });
		}
		if (typeof toggle !== "function") malformed("executeToggleTaskDoneCommand is not a function");
		// For a few tens of milliseconds after Tasks is enabled, updated or reloaded, apiV1 already works but
		// Tasks has not finished reading its settings, so a toggle then uses its default format and statuses.
		return Object.freeze({
			kind: "toggle",
			toggle(line: string, path: string): string {
				const previous = moment.locale();
				try {
					moment.locale("en");
					return toggle.call(result.api, line, path) as string;
				} finally {
					moment.locale(previous);
				}
			},
		});
	} catch (error) {
		return Object.freeze({ kind: "error", error });
	}
}

/** Reads the dialog capability afresh, without opening a dialog or relying on Tasks' version number. */
export function canEditInTasksDialog(app: App): TasksDialogCapability {
	const result = readApi(app);
	if (result.kind !== "api") return result;
	try {
		const edit = result.api.editTaskLineModal;
		if (edit === undefined && !("editTaskLineModal" in result.api)) return Object.freeze({ kind: "too-old" });
		if (typeof edit !== "function") malformed("editTaskLineModal is not a function");
		return Object.freeze({ kind: "edit" });
	} catch (error) {
		return Object.freeze({ kind: "error", error });
	}
}
