import { copy } from "@tasks-calendar-wrapper/core";
import { reportNotice } from "../../timeline/src/notices";
import { ERROR_NOTICE_MS } from "../../timeline/src/writerconstants";

/** Reports a settings save failure to the user. */
export function reportSaveError(error: unknown) {
	console.error("Tasks Calendar Wrapper: failed to save settings", error);
	reportNotice(copy.settings.tab.saveFailed, ERROR_NOTICE_MS);
}
