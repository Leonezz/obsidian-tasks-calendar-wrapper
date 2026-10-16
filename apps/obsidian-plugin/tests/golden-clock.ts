/**
 * Pins what the golden tests depend on besides the notes: the time zone, the locale and "now".
 * Import it before anything else, so no date is computed before the clock is fixed.
 */
import moment from "moment";

process.env.TZ = "UTC";
moment.locale("en");

/** "Today" in the golden tests: Thursday 2026-01-15, 09:00 UTC. The fixture notes' dates are placed around it. */
export const GOLDEN_NOW = Date.UTC(2026, 0, 15, 9, 0, 0);
moment.now = () => GOLDEN_NOW;
