/**
 * Pins what the golden tests depend on besides the notes: the time zone, moment's locale, "now", and the
 * collation that localeCompare uses. Import it before anything else, so no date is computed before the
 * clock is fixed.
 */
import moment from "moment";

process.env.TZ = "UTC";
moment.locale("en");

/** "Today" in the golden tests: Thursday 2026-01-15, 09:00 UTC. The fixture notes' dates are placed around it. */
export const GOLDEN_NOW = Date.UTC(2026, 0, 15, 9, 0, 0);
moment.now = () => GOLDEN_NOW;

if (new Date(GOLDEN_NOW).getTimezoneOffset() !== 0) {
    throw new Error("the golden tests need the UTC time zone, but setting TZ had no effect");
}
// ICU takes the collation from the locale the process starts with, so it cannot be set from here.
// scripts/test.mjs starts the tests with LC_ALL=en_US.UTF-8.
const collation = new Intl.Collator().resolvedOptions().locale;
if (!collation.startsWith("en")) {
    throw new Error(`the golden tests sort with English collation, but this process uses "${collation}". Run them with \`pnpm test\`, which sets LC_ALL.`);
}
