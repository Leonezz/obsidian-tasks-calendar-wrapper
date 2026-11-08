import { Notice } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";

/** Reports a settings save failure to the user. */
export function reportSaveError(error: unknown) {
	console.error("Tasks Calendar Wrapper: failed to save settings", error);
	new Notice(copy.settings.tab.saveFailed, 5000);
}
